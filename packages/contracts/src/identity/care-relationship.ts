import { z } from 'zod';

/**
 * The care link between a practice and a patient, as the clients read it when
 * it ends (card I-07).
 *
 * The link itself is not an endpoint of its own yet: what a client reads today
 * is the one that the acceptance of an invitation creates
 * (`acceptedInvitationSchema`) and the one that either side ends, here. Which
 * is why there is no `CareRelationship` in this file — there is nothing that
 * answers one — and the shape below is the answer of the two routes that end
 * the follow-up.
 */

/**
 * Whether the practice still follows this patient.
 *
 * It is read off `endedAt` at the instant somebody asks and there is no status
 * column behind it: `active` while there is no end, `ended` from the moment
 * there is one. It travels all the same, because a client that has to decide
 * what to render should not be reimplementing the rule from a nullable date.
 */
export const careRelationshipStatusSchema = z.enum(['active', 'ended']).meta({
  id: 'CareRelationshipStatus',
  description: 'Situação do vínculo: ativo, ou encerrado por um dos dois lados',
});

export type CareRelationshipStatus = z.infer<typeof careRelationshipStatusSchema>;

/**
 * The id of a care link, as it travels in a path.
 *
 * The patient's side of ending the follow-up is keyed by it, and the patient's
 * app already holds it: it is answered by the acceptance of the invitation
 * (`acceptedInvitationSchema.careRelationshipId`).
 */
export const careRelationshipIdSchema = z
  .uuid()
  .meta({ id: 'CareRelationshipId', description: 'Id do vínculo de acompanhamento' });

/**
 * The follow-up as it stands **after being ended** — the answer of both routes
 * of card I-07, the patient's and the professional's.
 *
 * It carries ids and instants and no personal data: not the name of the
 * patient, not the name of the practice. Whoever gets this answer is one of the
 * two sides of the link and already knows who the other is.
 *
 * What is **not** in it is who ended it. The two routes are told apart by which
 * one was called, so answering "quem encerrou" to the side that just did it
 * would be telling a caller what they had themselves asked for; the other side
 * learns of it through the internal event (`identity.relationship.ended`) and,
 * when the screen for it lands, through the list that card writes.
 */
export const endedCareRelationshipSchema = z
  .object({
    id: careRelationshipIdSchema,

    organizationId: z.uuid().meta({ description: 'Id da prática que acompanhava o paciente' }),

    /** Always `ended` here, and declared so a client can read one shape. */
    status: careRelationshipStatusSchema,

    startedAt: z.iso.datetime().meta({
      description: 'Quando o acompanhamento começou, em UTC',
      example: '2026-10-01T12:00:00.000Z',
    }),

    endedAt: z.iso.datetime().meta({
      description: 'Quando o acompanhamento foi encerrado, em UTC',
      example: '2026-11-11T12:00:00.000Z',
    }),
  })
  .meta({
    id: 'EndedCareRelationship',
    description: 'O vínculo de acompanhamento encerrado, com as duas datas',
  });

export type EndedCareRelationship = z.infer<typeof endedCareRelationshipSchema>;
