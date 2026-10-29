import { z } from 'zod';

import { professionalIdentitySchema } from './professional';

/**
 * What a person is to the platform: the professional who prescribes and
 * follows up, and the patient who is followed (CLAUDE.md, "O produto em uma
 * frase"). It says nothing about what the professional may do — that is
 * `professional_type`, which travels in `professional` below.
 */
export const personRoleSchema = z.enum(['professional', 'patient']).meta({
  id: 'PersonRole',
  description: 'Papel da pessoa na plataforma',
});

export type PersonRole = z.infer<typeof personRoleSchema>;

/**
 * `GET /v1/me`: who the caller is, as the panel and the app need it to decide
 * which screen to open and in which time zone to read the dates.
 *
 * Ids and codes, and nothing about anybody else. The caller's e-mail and
 * phone do not travel here — the client already has them from the session —
 * and no patient of theirs shows up at all; reading somebody else's chart is
 * another endpoint, the one that logs the access (CLAUDE.md, "Saúde e LGPD").
 * The only free text is the name of the caller's own practice, inside
 * `professional`, which is theirs to read.
 */
export const meResponseSchema = z
  .object({
    personId: z.uuid().meta({ description: 'Id da pessoa no módulo identity' }),

    role: personRoleSchema,

    /**
     * The patient's time zone is what turns a UTC timestamp into "yesterday
     * night" (CLAUDE.md, "Dados de saúde"), so every client needs it before
     * drawing a single date.
     */
    timeZone: z.string().min(1).meta({
      description: 'Fuso horário da pessoa, no formato IANA',
      example: 'America/Sao_Paulo',
    }),

    /**
     * The type that decides what the caller may edit and the practices they
     * belong to. Absent for a patient, who has no council number and belongs
     * to no organization — which is why it is an optional field and not a pair
     * of empty structures every patient would have to carry.
     *
     * A professional always has it: the registration creates the profile and
     * the professional in the same transaction, and whoever signed in without
     * registering has no profile at all, which `GET /v1/me` answers as 404.
     */
    professional: professionalIdentitySchema.optional(),
  })
  .meta({
    id: 'MeResponse',
    description: 'Identidade de quem fez a chamada',
  });

export type MeResponse = z.infer<typeof meResponseSchema>;
