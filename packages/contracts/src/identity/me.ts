import { z } from 'zod';

/**
 * What a person is to the platform: the professional who prescribes and
 * follows up, and the patient who is followed (CLAUDE.md, "O produto em uma
 * frase"). It says nothing about what the professional may do — that is
 * `professional_type`, which the identity card brings in with the rest of the
 * person model.
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
 * Ids and codes only. Name, e-mail and phone are personal data and do not
 * travel in a response that exists to say "which product am I in" — they come
 * with the profile endpoint of the identity card, which logs the access.
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
  })
  .meta({
    id: 'MeResponse',
    description: 'Identidade de quem fez a chamada',
  });

export type MeResponse = z.infer<typeof meResponseSchema>;
