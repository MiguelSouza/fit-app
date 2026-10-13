import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the Dart client of the API, for the Flutter app.
 *
 * It is the last step of `pnpm api:generate` at the root of the monorepo, and
 * it reads the same `apps/api/openapi.json` the TypeScript client is generated
 * from — one document, one contract, two platforms.
 *
 * The generator runs **in Docker**, which the repository already requires for
 * the local Supabase stack: `openapi-generator` is a Java program, and asking
 * every machine here for a JDK of the right major version is a worse trade
 * than one pinned image.
 */
const IMAGE = 'openapitools/openapi-generator-cli:v7.18.0';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the repository is mounted inside the container. */
const MOUNT = '/local';

const DOCUMENT = 'apps/api/openapi.json';

/**
 * `apps/mobile` is not a pnpm package and is not in `pnpm-workspace.yaml`: it
 * is built by the Flutter toolchain. The client lands as a Dart package next
 * to the app that will depend on it (`path: packages/api_client` in its
 * pubspec).
 *
 * The output is **not** committed. The generated package only becomes usable
 * after `dart run build_runner build` writes the `built_value` part files, and
 * that belongs to the Flutter workspace of card F-14; until then it is an
 * artifact, and `.gitignore` keeps it out of the repository.
 */
const OUTPUT = 'apps/mobile/packages/api_client';

/**
 * `dart-dio`: `dio` for the http client and `built_value` for the
 * serialization, which is what makes the models immutable and the json parsing
 * generated instead of hand written.
 */
const GENERATOR = 'dart-dio';

const PROPERTIES = [
  'pubName=fit_app_api_client',
  'pubVersion=0.1.0',
  'pubDescription=Cliente Dart gerado do OpenAPI da API da fit-app',
  'serializationLibrary=built_value',
];

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!existsSync(resolve(REPO_ROOT, DOCUMENT))) {
  fail(`${DOCUMENT} is missing. Run \`pnpm api:generate\` at the root, which writes it first.`);
}

try {
  // A file left behind by an endpoint that no longer exists would survive
  // otherwise: the generator overwrites what it generates and leaves the rest
  // alone. The whole directory is generated, and git ignores it.
  rmSync(resolve(REPO_ROOT, OUTPUT), { recursive: true, force: true, maxRetries: 3 });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);

  fail(`could not clear ${OUTPUT} (${reason}). Close whatever is holding it and try again.`);
}

const docker = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--volume',
    `${REPO_ROOT}:${MOUNT}`,
    IMAGE,
    'generate',
    '--input-spec',
    `${MOUNT}/${DOCUMENT}`,
    '--generator-name',
    GENERATOR,
    '--output',
    `${MOUNT}/${OUTPUT}`,
    ...PROPERTIES.flatMap((property) => ['--additional-properties', property]),
  ],
  { stdio: 'inherit' },
);

if (docker.error !== undefined) {
  fail(
    `could not run docker (${docker.error.message}). The Docker engine has to be running: it is what generates the Dart client.`,
  );
}

if (docker.status !== 0) {
  process.exit(docker.status ?? 1);
}

process.stdout.write(`dart client written to ${OUTPUT}\n`);
