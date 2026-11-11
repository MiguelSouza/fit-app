import { z } from 'zod';

import { professionalTypeSchema } from './professional';

/**
 * What was accessed: the kind of thing somebody opened or exported about a
 * patient (card I-06).
 *
 * A closed vocabulary and not free text, for two reasons. The patient's screen
 * has to say what was looked at in pt-BR and ready for i18n, so what travels
 * is a code the client translates — a sentence written by the API would be a
 * sentence no client could translate. And a record of an access is only
 * auditable while the words in it mean one thing: a column that accepted
 * anything would hold three spellings of "ficha" within a year.
 *
 * - `patient_chart`: a ficha do paciente, the screen that gathers what the
 *   platform knows about them.
 *
 * It is one value today because the platform has one screen that opens a
 * patient (ADR 0017, and the `nutrition`, `health` and `insights` modules are
 * still skeletons). A new kind of access — the meal plan on its own, the
 * check-ins of a period — is a value appended here and in the database enum,
 * never a reuse of this one.
 */
export const accessLogResourceSchema = z.enum(['patient_chart']).meta({
  id: 'AccessLogResource',
  description: 'O que foi acessado: hoje, a ficha do paciente',
});

export type AccessLogResource = z.infer<typeof accessLogResourceSchema>;

/**
 * What was done to it: read on the screen, or taken out of the platform.
 *
 * The two are not the same event for the patient, which is the whole reason
 * the action is recorded next to the resource: an export leaves a copy of
 * their health data outside the platform, and that is what LGPD's "quem viu
 * meus dados" most needs to be able to show.
 */
export const accessLogActionSchema = z.enum(['view', 'export']).meta({
  id: 'AccessLogAction',
  description: 'O que foi feito: abrir na tela (`view`) ou exportar (`export`)',
});

export type AccessLogAction = z.infer<typeof accessLogActionSchema>;

/**
 * Quem acessou, as the patient reads it.
 *
 * The name is here on purpose, and it is the one piece of personal data this
 * endpoint answers: "quem viu meus dados" is unanswerable with an id, and the
 * person asking is the data subject themselves (LGPD, art. 9º). It is the
 * professional's name, never the patient's, and it does not reach a log — the
 * masking list of `@fit-app/observability` has `name` in it.
 *
 * `professionalType` says what that person is licensed to do, so the patient
 * can tell the nutritionist who prescribes from a trainer of the same
 * practice. Absent when the actor has no professional profile, which no
 * recorded access has today and which the contract still has to allow: what is
 * recorded is who really acted, and the answer must not invent a licence.
 */
export const accessLogActorSchema = z
  .object({
    name: z.string().min(1).meta({
      description: 'Nome de quem acessou. É o profissional, nunca o paciente',
      example: 'Ana Souza',
    }),

    professionalType: professionalTypeSchema.optional(),
  })
  .meta({ id: 'AccessLogActor', description: 'Quem acessou os dados do paciente' });

export type AccessLogActor = z.infer<typeof accessLogActorSchema>;

/**
 * One access, as `GET /v1/me/access-log` answers it: quem, o quê, quando.
 *
 * There is no id in it, as there is none in a consent: a record of an access
 * is not something a client ever asks for again, and the only handle the
 * endpoint needs is the cursor of the next page. There is no id of the
 * professional either — what the patient asked was who, and the name with the
 * licence is the answer; an id would only let a client try to look somebody up.
 */
export const accessLogEntrySchema = z
  .object({
    actor: accessLogActorSchema,

    resource: accessLogResourceSchema,

    action: accessLogActionSchema,

    occurredAt: z.iso.datetime().meta({
      description: 'Quando o acesso aconteceu, em UTC',
      example: '2026-11-09T12:00:00.000Z',
    }),
  })
  .meta({ id: 'AccessLogEntry', description: 'Um acesso aos dados do paciente' });

export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>;

/** The page the app asks for when it asks for nothing. */
export const ACCESS_LOG_DEFAULT_PAGE_SIZE = 20;

/**
 * The most a single request may ask for. A ceiling and not a suggestion: the
 * rows are a patient's own history, they only grow, and a client that asked
 * for all of them would be asking the API to hold a year of somebody's audit
 * trail in memory to serialize it once.
 */
export const ACCESS_LOG_MAX_PAGE_SIZE = 100;

/**
 * The query of `GET /v1/me/access-log`: how many, and from where.
 *
 * **The cursor is opaque.** It is minted by the API, it carries the instant and
 * the row the page ended at, and a client's only correct use of it is to send
 * back what it was given. It is not an offset: the log is append-only and read
 * newest first, so a page taken by `limit`/`offset` would shift under a client
 * the moment one more access was recorded — and the row it skipped would be the
 * one access the patient never saw.
 *
 * `limit` is coerced because a query string has no numbers in it, and it is
 * bounded on both ends: a page of zero is a request that answers nothing, and
 * the ceiling is the API's to decide, not the caller's.
 */
export const accessLogQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ACCESS_LOG_MAX_PAGE_SIZE)
      .default(ACCESS_LOG_DEFAULT_PAGE_SIZE)
      .meta({
        description: `Quantos registros a página traz, de 1 a ${ACCESS_LOG_MAX_PAGE_SIZE}`,
        example: ACCESS_LOG_DEFAULT_PAGE_SIZE,
      }),

    cursor: z
      .string()
      .min(1)
      .optional()
      .meta({
        description:
          'Cursor da próxima página, exatamente como veio em `nextCursor`. Opaco: é a API ' +
          'que o emite e o cliente só o devolve',
      }),
  })
  .meta({ id: 'AccessLogQuery', description: 'Paginação do registro de acessos' });

export type AccessLogQuery = z.infer<typeof accessLogQuerySchema>;

/**
 * `GET /v1/me/access-log`: a page of the patient's own access log, do acesso
 * mais recente para o mais antigo (card I-06).
 *
 * `nextCursor` is absent on the last page, which is how a client knows it has
 * reached the end without having to compare the number of rows it got with the
 * number it asked for. An empty page with no cursor is the honest answer of a
 * patient nobody has opened yet.
 */
export const accessLogPageSchema = z
  .object({
    entries: z.array(accessLogEntrySchema).meta({
      description: 'Os acessos desta página, do mais recente para o mais antigo',
    }),

    nextCursor: z.string().min(1).optional().meta({
      description: 'Cursor da próxima página. Ausente quando esta é a última',
    }),
  })
  .meta({
    id: 'AccessLogPage',
    description: 'Uma página do registro de acessos aos dados do paciente',
  });

export type AccessLogPage = z.infer<typeof accessLogPageSchema>;
