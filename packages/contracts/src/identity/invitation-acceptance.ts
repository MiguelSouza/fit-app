import { z } from 'zod';

import { consentTypeSchema } from './consent';

/**
 * `POST /v1/invitations/accept`: the patient's side of the link (card I-03).
 *
 * By the time this request is made the person already signed in with Supabase
 * Auth, so who they are is the `sub` of the verified token (ADR 0007) and is
 * **not** in this body. What is in it is the link they opened, the name they
 * want to be called by and the purposes they consent to.
 */

/** Bounds of the free text fields, the same ones the professional's form has. */
const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 120;
const TIME_ZONE_MAX = 64;

/**
 * The token of the invitation, as it travels.
 *
 * 43 characters of `base64url` is what the API issues (ADR 0015), and the
 * bounds are wide enough around it that a token of another length is refused
 * as a malformed request instead of as a wrong link. No character class: what
 * makes a token valid is matching the stored hash, and a pattern here would
 * only move that answer earlier and say more about the format than it should.
 */
const TOKEN_MIN = 20;
const TOKEN_MAX = 200;

export const acceptInvitationRequestSchema = z
  .object({
    /**
     * It travels in the body, not in the path and not in a query parameter:
     * the token is a bearer credential, and a path is what lands in an access
     * log, in a referrer and in a breadcrumb. A body does not.
     */
    token: z
      .string()
      .trim()
      .min(TOKEN_MIN, { error: 'Link de convite inválido.' })
      .max(TOKEN_MAX, { error: 'Link de convite inválido.' })
      .meta({ description: 'Token do convite, o que vem no link' }),

    fullName: z
      .string()
      .trim()
      .min(FULL_NAME_MIN, { error: 'Informe seu nome completo.' })
      .max(FULL_NAME_MAX)
      .meta({ description: 'Nome completo do paciente', example: 'Ana Souza' }),

    /**
     * The IANA zone of the patient, which is what turns a UTC instant into
     * "ontem à noite" (CLAUDE.md, "Dados de saúde"). Optional: absent means
     * the platform's default, decided in the domain and not here.
     */
    timeZone: z
      .string()
      .trim()
      .max(TIME_ZONE_MAX)
      .optional()
      .meta({ description: 'Fuso horário do paciente, no formato IANA', example: 'America/Bahia' }),

    /**
     * The purposes the patient consents to, as they ticked them.
     *
     * **Which of them are required is not declared here.** `health_data` and
     * `share_with_professional` are, and that rule lives in the domain of
     * `identity` so every caller gets the same refusal with the same code,
     * with a message that says what is missing — instead of a generic 400 from
     * a schema. Repeated values are the same consent and are collapsed there
     * too, which is why there is no bound on the list: the item type only has
     * four values in it.
     */
    consents: z.array(consentTypeSchema).meta({
      description:
        'Finalidades que o paciente aceitou. `health_data` e `share_with_professional` ' +
        'são obrigatórias; `wearable_data` e `ai_processing` são opcionais e podem ser ' +
        'dadas depois',
    }),
  })
  .meta({
    id: 'AcceptInvitationRequest',
    description: 'Aceite de um convite por um paciente: o link, o nome e os consentimentos',
  });

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/**
 * The answer of `POST /v1/invitations/accept`: the patient is in.
 *
 * It carries ids, instants and the purposes in force — and no personal data of
 * anybody. Not the name of the patient, who already knows it, and not the name
 * of the professional or of the practice: who is following them is what
 * `GET /v1/me` will answer when the patient's side of it lands, with the
 * authorization that belongs there.
 */
export const acceptedInvitationSchema = z
  .object({
    /** The patient's profile id, which is the platform's and not Supabase's. */
    profileId: z.uuid().meta({ description: 'Id do perfil do paciente' }),

    organizationId: z.uuid().meta({ description: 'Id da organização que passa a acompanhar' }),

    careRelationshipId: z.uuid().meta({ description: 'Id do vínculo de acompanhamento criado' }),

    acceptedAt: z.iso.datetime().meta({ description: 'Quando o convite foi aceito, em UTC' }),

    /**
     * What is in force after the acceptance, which for a patient accepting a
     * second invitation includes consents they had already given.
     */
    consents: z
      .array(consentTypeSchema)
      .meta({ description: 'Finalidades consentidas que estão vigentes' }),
  })
  .meta({
    id: 'AcceptedInvitation',
    description: 'O vínculo criado pelo aceite do convite',
  });

export type AcceptedInvitation = z.infer<typeof acceptedInvitationSchema>;
