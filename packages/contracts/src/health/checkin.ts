import { z } from 'zod';

/**
 * The daily check-in: the ten seconds a patient spends saying how the day went
 * (card P-02).
 *
 * It is the one source of data no wearable has — how much energy somebody felt
 * they had, how well they think they slept, how hungry they were, what their
 * gut did — and it is the module `health` that owns it.
 *
 * Everything here is answered on a **scale the patient taps**, never typed, and
 * the two free fields are optional: a check-in that takes a sentence to fill in
 * is a check-in nobody fills in on a Tuesday.
 */

/**
 * The day a check-in is about, as `YYYY-MM-DD`.
 *
 * **A plain string and deliberately not a `date-time`.** A check-in belongs to
 * a day in the patient's life, and that day is read in the patient's own time
 * zone (CLAUDE.md, "Dados de saúde": UTC in the database, the zone on the
 * profile) — the same reasoning that dates a night of sleep by the day it
 * began. An instant here would carry a midnight and an offset nobody chose,
 * and the first client to parse it in its own zone would move somebody's
 * Tuesday to Monday.
 *
 * It is not declared as the JSON Schema `date` format for the same reason: the
 * generated clients turn that into their own date type, which is a timestamp
 * again by another name. What travels is the text, and whether those digits
 * name a day that exists is checked in the domain — `2026-02-31` matches the
 * pattern and is not a day.
 */
export const checkinDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'use o formato YYYY-MM-DD')
  .meta({
    id: 'CheckinDate',
    description:
      'O dia do check-in, `YYYY-MM-DD`, no fuso do paciente. É um dia do calendário e não ' +
      'um instante: não tem hora e não tem fuso',
    example: '2026-11-27',
  });

export type CheckinDate = z.infer<typeof checkinDateSchema>;

/** The bottom of every scale of a check-in. */
export const CHECKIN_SCALE_MIN = 1;

/**
 * The top of every scale. Five and not ten: the patient answers by tapping one
 * of five, and a row of ten targets is a row nobody hits on the first try —
 * which is the difference between a check-in of ten seconds and one of thirty.
 */
export const CHECKIN_SCALE_MAX = 5;

/**
 * One answer on a scale of 1 to 5. Energy, perceived sleep quality and hunger
 * all use it.
 *
 * **What the numbers mean is the client's to label, and it is not a quantity.**
 * `4` of energy is not twice `2`: it is the fourth of five words the screen
 * shows, in pt-BR. Which is why nothing in the platform averages these on its
 * own — a trend over a week is a rule of `insights`, with a card of its own.
 */
export const checkinScaleSchema = z
  .int()
  .min(CHECKIN_SCALE_MIN)
  .max(CHECKIN_SCALE_MAX)
  .meta({
    id: 'CheckinScale',
    description: `Uma resposta na escala de ${CHECKIN_SCALE_MIN} a ${CHECKIN_SCALE_MAX}`,
    example: 3,
  });

export type CheckinScale = z.infer<typeof checkinScaleSchema>;

/**
 * What the patient may report having felt, as chips on the screen.
 *
 * A closed vocabulary and not free text, for the reason the access log's is
 * closed: a symptom is only comparable across weeks while the word for it
 * means one thing, and a column that accepted anything would hold four
 * spellings of "inchaço" within a month. The patient's screen shows pt-BR and
 * the wire carries a code, so the list is translatable and the history stays
 * countable.
 *
 * `other` is the escape hatch the card asks for ("lista de opções + outro"):
 * it says "algo que não está aqui", and what it was goes in `otherSymptom`
 * next to it. It is not a free-form symptom field by another name — a code
 * that keeps showing up in `other` is the product's cue to add a chip.
 *
 * A value is appended to this list, never reused and never reordered: the
 * codes are in the database and in a year of somebody's history.
 */
export const checkinSymptomSchema = z
  .enum([
    'bloating',
    'nausea',
    'heartburn',
    'constipation',
    'diarrhea',
    'headache',
    'cramps',
    'muscle_soreness',
    'dizziness',
    'other',
  ])
  .meta({
    id: 'CheckinSymptom',
    description:
      'Um sintoma do check-in, em código: o cliente traduz. `other` é "algo que não está ' +
      'nesta lista", e o que foi vai em `otherSymptom`',
  });

export type CheckinSymptom = z.infer<typeof checkinSymptomSchema>;

/**
 * The longest `otherSymptom` the API keeps. Short on purpose: it is the name of
 * a symptom, not the story of it — the story is the note.
 */
export const CHECKIN_OTHER_SYMPTOM_MAX_LENGTH = 80;

/**
 * The longest note. Half a screen of a phone, which is as much as somebody
 * types standing in a kitchen, and a bound the column can be trusted to hold.
 */
export const CHECKIN_NOTE_MAX_LENGTH = 500;

/**
 * `PUT /v1/me/checkins/{date}`: the check-in the patient is saving.
 *
 * **The day is in the path and never in the body**, which is what makes the
 * request idempotent: sending it twice saves one check-in, as the acceptance
 * criterion asks ("um check-in por paciente por dia: atualiza, não duplica").
 * The patient is not in it either — they are the `sub` of the verified token
 * (ADR 0007), so there is no field a client could point at somebody else.
 *
 * The three scales are required and everything else is optional: a day with
 * nothing to report is three taps, and `symptoms` absent means "nada a
 * relatar" — not "não respondi". There is no way to say the latter, on purpose:
 * the check-in that exists is the one that was filled in.
 */
export const recordCheckinRequestSchema = z
  .object({
    energy: checkinScaleSchema.meta({
      description: `Energia percebida no dia, de ${CHECKIN_SCALE_MIN} a ${CHECKIN_SCALE_MAX}`,
    }),

    sleepQuality: checkinScaleSchema.meta({
      description:
        'Qualidade do sono **percebida** pelo paciente, na mesma escala. É o que a pessoa ' +
        'achou, não o que o wearable mediu: os dois convivem e não se corrigem',
    }),

    hunger: checkinScaleSchema.meta({
      description: `Fome ao longo do dia, de ${CHECKIN_SCALE_MIN} a ${CHECKIN_SCALE_MAX}`,
    }),

    /**
     * A set, written as an array because JSON has no sets. Repeated values and
     * the order are both meaningless and are normalized away by the API, which
     * answers the list in the order of the vocabulary.
     */
    symptoms: z
      .array(checkinSymptomSchema)
      .default([])
      .meta({
        description:
          'Os sintomas do dia, em código. Ausente ou vazio significa "nada a relatar". ' +
          'Repetições e ordem não importam: a API responde na ordem do vocabulário',
      }),

    otherSymptom: z
      .string()
      .max(CHECKIN_OTHER_SYMPTOM_MAX_LENGTH)
      .optional()
      .meta({
        description:
          'O que foi o `other`, em poucas palavras. Só é guardado quando `other` está em ' +
          '`symptoms`; sem ele, é descartado',
      }),

    note: z.string().max(CHECKIN_NOTE_MAX_LENGTH).optional().meta({
      description: 'Nota livre do paciente sobre o dia. Texto em branco é o mesmo que nota nenhuma',
    }),
  })
  .meta({
    id: 'RecordCheckinRequest',
    description: 'O check-in do dia, como o paciente preenche',
  });

export type RecordCheckinRequest = z.infer<typeof recordCheckinRequestSchema>;

/**
 * One check-in, as the API answers it — to the patient who wrote it and to the
 * professional who follows them.
 *
 * **The same shape for both**, and that is deliberate: what the professional
 * reads is what the patient said, with nothing added and nothing scored. A
 * reading of these values — "merece revisão" — is `insights`, it is produced
 * elsewhere and it never arrives disguised as a field of the check-in itself
 * (CLAUDE.md, "Saúde e LGPD": linguagem de apoio, nunca de diagnóstico).
 *
 * There is no id: a patient has one check-in per day, so the day names it, and
 * an id in a client's hands would only be a second way of asking for something
 * it already has the address of.
 *
 * `recordedAt` and `updatedAt` are the two instants of the same row: when the
 * check-in was first saved, and when it last changed. They are what tells a
 * check-in filled in at breakfast from one corrected at midnight, which is the
 * only thing a professional needs to know about the editing of it.
 */
export const checkinSchema = z
  .object({
    date: checkinDateSchema,

    energy: checkinScaleSchema,

    sleepQuality: checkinScaleSchema,

    hunger: checkinScaleSchema,

    symptoms: z.array(checkinSymptomSchema).meta({
      description: 'Os sintomas relatados, na ordem do vocabulário. Vazio quando não houve',
    }),

    otherSymptom: z.string().min(1).optional().meta({
      description: 'O que foi o `other`, quando o paciente escreveu. Ausente quando não escreveu',
    }),

    note: z.string().min(1).optional().meta({
      description: 'A nota do paciente. Ausente quando não houve',
    }),

    recordedAt: z.iso.datetime().meta({
      description: 'Quando o check-in foi salvo pela primeira vez, em UTC',
      example: '2026-11-27T12:00:00.000Z',
    }),

    updatedAt: z.iso.datetime().meta({
      description:
        'Quando o check-in mudou pela última vez, em UTC. Igual a `recordedAt` enquanto ' +
        'ninguém o corrigiu',
      example: '2026-11-27T12:00:00.000Z',
    }),
  })
  .meta({ id: 'Checkin', description: 'Um check-in diário do paciente' });

export type Checkin = z.infer<typeof checkinSchema>;

/**
 * The longest period one request may ask for, in days, both ends included.
 *
 * A year and a day: enough for "o ano todo" on a screen, and a ceiling all the
 * same, because the rows are health data and a request without one would ask
 * the API to serialize a whole history to answer a chart of two weeks.
 */
export const CHECKIN_PERIOD_MAX_DAYS = 366;

/**
 * The query of both listings: `from` and `to`, inclusive.
 *
 * **Both are required, and there is no default.** A default would be the API
 * guessing which days somebody meant, and it cannot: "os últimos sete dias"
 * depends on what day it is where the patient is, and the professional reading
 * the list may be in another zone entirely. The client knows the period it is
 * drawing; it says so.
 *
 * There is no paging. The period is bounded instead, which is the honest shape
 * for this data: a check-in list is read as a calendar, not scrolled, and a
 * cursor over at most a year of one-per-day rows would be machinery nobody
 * uses.
 */
export const checkinPeriodQuerySchema = z
  .object({
    from: checkinDateSchema.meta({ description: 'Primeiro dia do período, incluído' }),
    to: checkinDateSchema.meta({ description: 'Último dia do período, incluído' }),
  })
  .meta({
    id: 'CheckinPeriodQuery',
    description: `O período da listagem, de no máximo ${CHECKIN_PERIOD_MAX_DAYS} dias`,
  });

export type CheckinPeriodQuery = z.infer<typeof checkinPeriodQuerySchema>;

/**
 * `GET /v1/me/checkins` and `GET /v1/patients/{patientId}/checkins`: the
 * check-ins of a period, from the oldest day to the newest.
 *
 * The period comes back in the answer, which is not redundancy: a client
 * drawing two weeks needs to know which fortnight these rows are, and a cached
 * answer that cannot say so is an answer that gets drawn on the wrong calendar.
 *
 * **Days with no check-in are simply not in the list.** The API does not fill
 * them with nulls: a day nobody answered is not a check-in with empty values,
 * and the client that draws a calendar knows which days it asked for.
 */
export const checkinListSchema = z
  .object({
    from: checkinDateSchema,
    to: checkinDateSchema,

    checkins: z.array(checkinSchema).meta({
      description: 'Os check-ins do período, do dia mais antigo para o mais recente',
    }),
  })
  .meta({ id: 'CheckinList', description: 'Os check-ins de um período' });

export type CheckinList = z.infer<typeof checkinListSchema>;
