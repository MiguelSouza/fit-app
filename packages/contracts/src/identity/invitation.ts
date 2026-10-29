import { z } from 'zod';

/**
 * Where an invitation is in its life, as the panel shows it.
 *
 * Three of the four are not stored anywhere: `pending`, `accepted`, `expired`
 * and `revoked` are read off the dates the invitation carries (`expiresAt`,
 * `acceptedAt`, `revokedAt`), because a status column would need a job to turn
 * `pending` into `expired` at midnight and would be wrong in between. The API
 * answers the status; the client never computes it.
 */
export const invitationStatusSchema = z.enum(['pending', 'accepted', 'expired', 'revoked']).meta({
  id: 'InvitationStatus',
  description:
    'Situação do convite: pendente, aceito, expirado ou revogado. ' +
    'Derivada das datas, não guardada numa coluna',
});

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/** Bounds of the free text fields. Wide enough for a real name and a phone. */
const NAME_MIN = 2;
const NAME_MAX = 120;
const CONTACT_MIN = 3;
const CONTACT_MAX = 160;

/**
 * `POST /v1/invitations`: what the professional fills in to invite a patient
 * (card I-02).
 *
 * Both fields are optional, and an invitation with neither is a valid
 * invitation: the professional sends the link by WhatsApp to somebody they are
 * already talking to, and the name is there so the list of invitations says
 * who each link was for. Nothing here identifies the patient to the platform —
 * who they are is what they themselves fill in when they accept.
 *
 * Who invites is **not** in this body: it is the `sub` of the verified access
 * token (ADR 0007), and the organization is the one that professional belongs
 * to.
 */
export const createInvitationRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(NAME_MIN, { error: 'Informe o nome com pelo menos 2 caracteres.' })
      .max(NAME_MAX)
      .optional()
      .meta({ description: 'Como o profissional chama o paciente convidado', example: 'Ana' }),

    /**
     * A phone number, an e-mail, anything the professional writes down to
     * remember where the link went. Free text: it is a note to self, not a
     * channel the platform sends anything through — the link travels on
     * WhatsApp, by the professional's own hand.
     */
    contact: z
      .string()
      .trim()
      .min(CONTACT_MIN, { error: 'Informe o contato com pelo menos 3 caracteres.' })
      .max(CONTACT_MAX)
      .optional()
      .meta({ description: 'Contato do paciente convidado', example: '+55 11 90000-0000' }),
  })
  .meta({
    id: 'CreateInvitationRequest',
    description: 'Dados opcionais de um convite de paciente',
  });

export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/**
 * One invitation, as the professional's own list shows it.
 *
 * The token is **not** here, at any point: it is answered once, by the
 * creation, and what the database keeps is a hash of it (see
 * `CreatedInvitation` below). A list that carried the token would mean every
 * render of the screen, every cache and every proxy log in between holding a
 * credential that opens a patient's account.
 */
export const invitationSchema = z
  .object({
    id: z.uuid().meta({ description: 'Id do convite' }),

    status: invitationStatusSchema,

    /**
     * What the professional typed about the person they invited. It is theirs
     * and goes back to their own screen; it never reaches a log (CLAUDE.md,
     * "Saúde e LGPD"), which is why the masking list of
     * `@fit-app/observability` has both field names in it.
     */
    name: z.string().min(1).optional().meta({ description: 'Nome do paciente convidado' }),

    contact: z.string().min(1).optional().meta({ description: 'Contato do paciente convidado' }),

    createdAt: z.iso.datetime().meta({ description: 'Quando o convite foi criado, em UTC' }),

    /** 14 days after the creation. An invitation that is not used dies. */
    expiresAt: z.iso.datetime().meta({ description: 'Quando o convite expira, em UTC' }),

    /** Absent until the patient accepts; an accepted invitation is spent. */
    acceptedAt: z.iso.datetime().optional().meta({ description: 'Quando o convite foi aceito' }),

    revokedAt: z.iso.datetime().optional().meta({ description: 'Quando o convite foi revogado' }),
  })
  .meta({ id: 'Invitation', description: 'Um convite de paciente' });

export type Invitation = z.infer<typeof invitationSchema>;

/**
 * The answer of `POST /v1/invitations`: the invitation, and the token, **once**.
 *
 * The token is the secret half of the link the professional sends on WhatsApp,
 * and this is the only response of the whole API that carries it. The database
 * keeps only its hash, so nobody — not us, not a backup, not a leaked dump —
 * can rebuild the link afterwards: whoever loses it revokes the invitation and
 * creates another.
 *
 * It travels under the name `token` on purpose: that name is on the masking
 * list every logger and every Sentry filter of this platform reads
 * (`@fit-app/observability`), so an object that happens to be logged comes out
 * with `[redacted]` in its place.
 */
export const createdInvitationSchema = z
  .object({
    invitation: invitationSchema,

    token: z
      .string()
      .min(1)
      .meta({
        description:
          'Token do convite, em texto puro. Respondido só aqui, na criação: o banco guarda ' +
          'apenas o hash. É o que vai no link enviado ao paciente',
      }),
  })
  .meta({
    id: 'CreatedInvitation',
    description: 'O convite criado e o token do link, respondido uma única vez',
  });

export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

/**
 * `GET /v1/invitations`: every invitation of the professional's organization,
 * the most recent first.
 *
 * An object with one field, and not a bare array, so the endpoint can grow a
 * page cursor or a total without every client having to change shape.
 */
export const invitationListSchema = z
  .object({
    invitations: z
      .array(invitationSchema)
      .meta({ description: 'Convites da organização, do mais recente para o mais antigo' }),
  })
  .meta({ id: 'InvitationList', description: 'Convites da organização do profissional' });

export type InvitationList = z.infer<typeof invitationListSchema>;
