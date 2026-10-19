import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  generateDataset,
  MAX_DAYS,
  MAX_PATIENTS,
  MIN_DAYS,
  type SyntheticDataset,
} from './synthetic/dataset.ts';
import { PROFILES } from './synthetic/profiles.ts';
import { detectorsFiringFor, summarize, type PatientSummary } from './synthetic/summary.ts';
import { isLocalDate, todayUtc } from './synthetic/time.ts';

/**
 * `pnpm seed:synthetic --patients 20`
 *
 * Writes a cohort of synthetic patients: one organization, one nutritionist
 * and N patients with 90 days of activities, sleep, daily metrics, check-ins,
 * weigh-ins and meal adherence, following the six ready-made profiles in
 * `synthetic/profiles.ts`.
 *
 * Real patient data never enters development or test (CLAUDE.md, "Testes"),
 * and this is what gets used instead: for trying alert rules, for judging what
 * the AI writes about a chart, and for a demo with nobody's body in it.
 *
 * **Where the rows go.** For now, to json files. The four module schemas do
 * not exist yet — card F-07 wired Drizzle Kit and stopped there, and `drizzle/`
 * holds no migration — so there is no table to insert into. The generator is
 * the whole of the work either way: a writer that walks this dataset into
 * Postgres is the step that waits on those tables, and the README of this
 * package says what it will take.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the run lands unless `--out` says otherwise. Not versioned. */
const DEFAULT_OUT = resolve(HERE, '..', '.synthetic');

/** The default seed. Any fixed number does; what matters is that it is fixed. */
const DEFAULT_SEED = 20_260_115;

const DEFAULT_PATIENTS = 10;

/** The window the card asks for. */
const DEFAULT_DAYS = 90;

/**
 * Written into the manifest, and checked before the output directory is
 * cleared: `--out` is a path a person types, and this script is not going to
 * delete a directory it did not write.
 */
const MARKER = 'fit-app-synthetic-patients';

const HELP = `
pnpm seed:synthetic [opções]

Gera uma organização, 1 nutricionista e N pacientes sintéticos com 90 dias de
atividades, sono, métricas diárias, check-ins, peso e adesão. Dados inventados:
nenhum paciente real entra em desenvolvimento ou teste.

Opções
  -p, --patients <n>     quantos pacientes (1 a ${MAX_PATIENTS}; padrão ${DEFAULT_PATIENTS})
  -s, --seed <n>         semente aleatória (padrão ${DEFAULT_SEED})
  -d, --days <n>         tamanho da janela em dias (padrão ${DEFAULT_DAYS})
      --end-date <data>  último dia da janela, YYYY-MM-DD (padrão: hoje em UTC)
  -o, --out <pasta>      onde escrever (padrão scripts/.synthetic)
  -h, --help             esta ajuda

A mesma semente e a mesma janela produzem exatamente os mesmos dados. A semente
e a data usadas ficam no manifest.json da saída, para repetir uma rodada.

Perfis (os primeiros ${PROFILES.length} pacientes recebem um cada, nesta ordem)
${PROFILES.map((profile) => `  ${profile.label.padEnd(29)} ${profile.signature}`).join('\n')}
`.trimStart();

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Reads an option that has to be a whole number, optionally inside a range.
 *
 * The bounds are repeated here and not left to `generateDataset`, which checks
 * them too: those messages are in English, for a caller that passed something
 * impossible from code, and what reaches a person running a command should be
 * one language — pt-BR, as CLAUDE.md asks for anything a user reads.
 */
function integerOption(
  name: string,
  value: string | undefined,
  fallback: number,
  range?: { min: number; max: number },
): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) fail(`--${name} tem de ser um número inteiro, e veio "${value}"`);

  if (range !== undefined && (parsed < range.min || parsed > range.max)) {
    fail(`--${name} tem de estar entre ${range.min} e ${range.max}, e veio ${parsed}`);
  }

  return parsed;
}

function parse(): {
  patients: number;
  seed: number;
  days: number;
  endDate: string;
  out: string;
} {
  // A bare `--` is dropped first: `pnpm seed:synthetic --patients 20` can
  // arrive with pnpm's separator still in it, and `parseArgs` would read
  // everything after it as a positional.
  const argv = process.argv.slice(2).filter((argument) => argument !== '--');

  let values;

  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        patients: { type: 'string', short: 'p' },
        seed: { type: 'string', short: 's' },
        days: { type: 'string', short: 'd' },
        'end-date': { type: 'string' },
        out: { type: 'string', short: 'o' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
  }

  if (values.help === true) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const endDate = values['end-date'] ?? todayUtc();

  if (!isLocalDate(endDate)) fail(`--end-date tem de ser uma data YYYY-MM-DD, e veio "${endDate}"`);

  return {
    patients: integerOption('patients', values.patients, DEFAULT_PATIENTS, {
      min: 1,
      max: MAX_PATIENTS,
    }),
    seed: integerOption('seed', values.seed, DEFAULT_SEED),
    days: integerOption('days', values.days, DEFAULT_DAYS, { min: MIN_DAYS, max: MAX_DAYS }),
    endDate,
    out: values.out === undefined ? DEFAULT_OUT : resolve(values.out),
  };
}

/**
 * Empties the output directory, after making sure it is one of ours.
 *
 * A previous run has to be removed and not merged into: patient codes are
 * reused across runs, and a smaller run over a larger one would otherwise
 * leave patients of the old cohort lying around under the new manifest. But
 * `--out` is typed by a person, so the only directory this will empty is one
 * that is either absent, empty, or carries the marker of this generator.
 */
function prepareOut(out: string): void {
  if (!existsSync(out)) {
    mkdirSync(out, { recursive: true });

    return;
  }

  if (readdirSync(out).length > 0) {
    const manifest = join(out, 'manifest.json');
    const ours = existsSync(manifest) && readFileSync(manifest, 'utf8').includes(MARKER);

    if (!ours) {
      fail(
        `${out} não está vazia e não foi escrita por este gerador (não tem um manifest.json com "${MARKER}"). ` +
          'Escolha outra pasta em --out, ou apague essa à mão.',
      );
    }

    rmSync(out, { recursive: true, force: true, maxRetries: 3 });
    mkdirSync(out, { recursive: true });
  }
}

/** Pretty for what a person opens, compact for the series. */
function writeJson(path: string, value: unknown, pretty: boolean): void {
  writeFileSync(path, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8');
}

function write(out: string, dataset: SyntheticDataset, summaries: readonly PatientSummary[]): void {
  prepareOut(out);

  writeJson(join(out, 'manifest.json'), { marker: MARKER, ...dataset.manifest }, true);
  writeJson(
    join(out, 'organization.json'),
    { organization: dataset.organization, professional: dataset.professional },
    true,
  );

  // The roster without the series: the one file to open to see who is in the
  // cohort, small enough to read.
  writeJson(
    join(out, 'patients.json'),
    dataset.patients.map(({ series: _series, ...patient }) => patient),
    true,
  );

  writeJson(join(out, 'summary.json'), summaries, true);

  const perPatient = join(out, 'patients');

  mkdirSync(perPatient, { recursive: true });

  // One file per patient, and compact: a 90-day series indented is a few
  // hundred kilobytes of whitespace, and nobody reads these by hand.
  for (const patient of dataset.patients) {
    writeJson(join(perPatient, `${patient.code}.json`), patient, false);
  }
}

/** A number with its sign, or a dash when the window had nothing to compare. */
function signed(value: number | null, suffix: string): string {
  if (value === null) return '—';

  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

/**
 * The table that answers "quem precisa de atenção e por quê" for this cohort.
 *
 * It prints values a professional would read off a chart, which the rule
 * against logging health data would normally forbid. It is allowed here for
 * one reason only: there is no person behind any of it. Nothing in this script
 * touches the API's logger, and nothing it prints leaves the terminal.
 */
function report(
  dataset: SyntheticDataset,
  summaries: readonly PatientSummary[],
  out: string,
): void {
  const { manifest, organization, professional } = dataset;
  const lines: string[] = [
    '',
    `organização   ${organization.name}`,
    `nutricionista ${professional.code} ${professional.name}`,
    `janela        ${manifest.startDate} → ${manifest.endDate} (${manifest.days} dias, ${manifest.timezone})`,
    `semente       ${manifest.seed}`,
    `pacientes     ${manifest.patientCount}`,
    '',
    [
      'código'.padEnd(8),
      'perfil'.padEnd(29),
      'Δpeso'.padStart(7),
      'Δsono'.padStart(8),
      'Δtreino'.padStart(8),
      'adesão'.padStart(7),
      'Δadesão'.padStart(8),
      'energia'.padStart(8),
      'check-in'.padStart(9),
      ' sinal',
    ].join(' '),
  ];

  for (const summary of summaries) {
    const profile = PROFILES.find((candidate) => candidate.id === summary.profile);
    const firing = detectorsFiringFor(summary);

    lines.push(
      [
        summary.code.padEnd(8),
        (profile?.label ?? summary.profile).padEnd(29),
        signed(summary.weightChangePct, '%').padStart(7),
        signed(summary.sleepChangeMin, 'min').padStart(8),
        signed(summary.trainingChangePct, '%').padStart(8),
        (summary.mealAdherencePct === null ? '—' : `${summary.mealAdherencePct}%`).padStart(7),
        signed(summary.mealAdherenceChangePts, 'pt').padStart(8),
        (summary.energyScoreMean === null ? '—' : summary.energyScoreMean.toFixed(1)).padStart(8),
        `há ${summary.daysSinceLastCheckIn}d`.padStart(9),
        ` ${firing.length === 0 ? '—' : firing.map((detector) => detector.profile).join(', ')}`,
      ].join(' '),
    );
  }

  lines.push(
    '',
    `escrito em ${out}`,
    'repetir esta rodada: ' +
      `pnpm seed:synthetic --patients ${manifest.patientCount} --seed ${manifest.seed} ` +
      `--days ${manifest.days} --end-date ${manifest.endDate}`,
    '',
  );

  process.stdout.write(`${lines.join('\n')}\n`);
}

/** `generateDataset`, with its own validation errors turned into exit 1. */
function generate(options: Parameters<typeof generateDataset>[0]): SyntheticDataset {
  try {
    return generateDataset(options);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const options = parse();
const dataset = generate(options);

const summaries = dataset.patients.map((patient) =>
  summarize(patient, options.endDate, options.days),
);

write(options.out, dataset, summaries);
report(dataset, summaries, options.out);
