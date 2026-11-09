import { z } from 'zod';

/**
 * What a patient may consent to, one purpose at a time.
 *
 * Each value is a purpose and not a screen: LGPD asks for consent per
 * finalidade, so "aceitei os termos" is not one flag but these four answers,
 * each recorded with the version of the text that was shown and each
 * revocable on its own.
 *
 * - `health_data`: the platform may keep and process the patient's health
 *   data — check-ins, measurements, sleep, symptoms. Without it there is no
 *   product, which is why the acceptance of an invitation requires it.
 * - `share_with_professional`: the professional of the practice may see that
 *   data. It is the consent every use case that opens a chart checks, together
 *   with an active link (CLAUDE.md, "Saúde e LGPD"), and the acceptance
 *   requires it too — a link nobody may read through is of no use to either
 *   side.
 * - `wearable_data`: the platform may import what the wearable aggregator
 *   sends (ADR 0003). Optional: a patient who logs food and nothing else is a
 *   patient.
 * - `ai_processing`: the patient's data may go to the AI copilot, anonymized
 *   before it leaves (CLAUDE.md, "Saúde e LGPD"). Optional, and the one whose
 *   absence the insights module has to live with.
 */
export const consentTypeSchema = z
  .enum(['health_data', 'share_with_professional', 'wearable_data', 'ai_processing'])
  .meta({
    id: 'ConsentType',
    description:
      'Finalidade do consentimento: dados de saúde, compartilhamento com o profissional, ' +
      'dados de wearable e processamento por IA. Cada uma é dada e revogada por si',
  });

export type ConsentType = z.infer<typeof consentTypeSchema>;

/**
 * One consent **in force**, as the patient's own screen reads it (card I-05).
 *
 * Three fields and no id: the patient has one consent in force per purpose, so
 * the purpose names it, and the row id is bookkeeping of the database — a
 * client that held it would be tempted to send it back, and the only thing it
 * could ask for is the purpose it already has.
 *
 * `termsVersion` and `grantedAt` are the whole point of the list: "concordei
 * com o quê, e quando". The version is what the API served at the time, never
 * what a client claimed, and it does not move when the terms change — a
 * consent in force keeps saying which text it was given against.
 *
 * There is no `revokedAt` here, by construction: a consent that has one is no
 * longer in force and is not in this list. The revocation's own answer is
 * `revokedConsentSchema` below.
 */
export const consentSchema = z
  .object({
    type: consentTypeSchema,

    termsVersion: z
      .string()
      .min(1)
      .meta({ description: 'Versão do termo que foi mostrada quando o consentimento foi dado' }),

    grantedAt: z.iso.datetime().meta({
      description: 'Quando o consentimento foi dado, em UTC',
      example: '2026-11-09T12:00:00.000Z',
    }),
  })
  .meta({ id: 'Consent', description: 'Um consentimento vigente do paciente' });

export type Consent = z.infer<typeof consentSchema>;

/**
 * `GET /v1/me/consents`: what is in force right now.
 *
 * An object with one field and not a bare array, as the invitation list is, so
 * the endpoint can grow something — a "pode revogar" flag, the text of the
 * current terms — without every client changing shape.
 *
 * What is **not** in it is what was revoked. The revoked rows are kept forever
 * (a revocation never deletes), and they are the platform's own audit trail,
 * not a history screen the patient asked for: the question this endpoint
 * answers is "o que a plataforma pode fazer com os meus dados hoje", and a
 * list mixing the two would answer neither.
 */
export const consentListSchema = z
  .object({
    consents: z
      .array(consentSchema)
      .meta({ description: 'Consentimentos vigentes, na ordem das finalidades' }),
  })
  .meta({ id: 'ConsentList', description: 'Consentimentos vigentes do paciente' });

export type ConsentList = z.infer<typeof consentListSchema>;

/**
 * `POST /v1/me/consents`: the patient gives one purpose.
 *
 * One purpose per request and not a list, which is what makes the endpoint
 * idempotent and the answer unambiguous: giving `wearable_data` is one
 * decision, and a request that carried four would have to explain what
 * happened when two of them were already in force.
 *
 * Nothing else is in the body. **Not** the version of the terms — what the
 * patient agreed to is the text this API served, and a field here would let a
 * caller record agreement to a version that was never shown — and not the
 * profile, which is the `sub` of the verified token (ADR 0007): the only
 * person who may give a consent is the patient themselves.
 */
export const grantConsentRequestSchema = z
  .object({
    type: consentTypeSchema,
  })
  .meta({
    id: 'GrantConsentRequest',
    description: 'A finalidade que o paciente está consentindo',
  });

export type GrantConsentRequest = z.infer<typeof grantConsentRequestSchema>;

/**
 * One consent **as it was revoked**: the row that stays, with both instants on
 * it.
 *
 * `grantedAt` and `termsVersion` are the original ones and are answered on
 * purpose: a revocation is a new state of the same row and never a delete
 * (card I-03), so what the patient gets back is the history — "você deu isso,
 * contra este termo, e tirou agora" — which is also the acceptance criterion
 * "revogação nunca apaga o registro original", visible from the outside.
 */
export const revokedConsentSchema = consentSchema
  .extend({
    revokedAt: z.iso
      .datetime()
      .meta({ description: 'Quando o consentimento foi revogado, em UTC' }),
  })
  .meta({ id: 'RevokedConsent', description: 'Um consentimento revogado, com as duas datas' });

export type RevokedConsent = z.infer<typeof revokedConsentSchema>;

/**
 * `POST /v1/me/consents/{type}/revoke`: what the revocation took back.
 *
 * A **list**, for one request, because of `health_data`: it is the consent the
 * platform rests on, and revoking it takes every other purpose with it in the
 * same transaction — there is no processing of wearable data or of AI over
 * health data nobody may keep. Revoking any other purpose answers a list of
 * one. A client that renders `revoked` as it comes handles both without
 * knowing the rule.
 */
export const revokedConsentListSchema = z
  .object({
    revoked: z
      .array(revokedConsentSchema)
      .min(1)
      .meta({
        description:
          'Os consentimentos que esta revogação encerrou. Revogar `health_data` encerra ' +
          'todas as finalidades vigentes; qualquer outra finalidade encerra só a dela',
      }),
  })
  .meta({
    id: 'RevokedConsentList',
    description: 'O que a revogação encerrou',
  });

export type RevokedConsentList = z.infer<typeof revokedConsentListSchema>;
