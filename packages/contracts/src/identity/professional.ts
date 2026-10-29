import { z } from 'zod';

import { organizationMembershipSchema } from './organization';

/**
 * What kind of professional this is.
 *
 * It matters because the rules hang off it and not off the generic role: only
 * a nutritionist may edit a meal plan, and CLAUDE.md ("Saúde e LGPD") asks for
 * `professional_type` to be checked, never `role`. The platform is for sports
 * nutritionists, so `nutritionist` is the default and the only type the
 * registration creates on its own; `trainer` is the other professional the
 * product already foresees around the same patient (CLAUDE.md, "O produto em
 * uma frase": food, training, sleep and symptoms in one place).
 */
export const professionalTypeSchema = z.enum(['nutritionist', 'trainer']).meta({
  id: 'ProfessionalType',
  description: 'Tipo do profissional. Só o nutricionista edita plano alimentar',
});

export type ProfessionalType = z.infer<typeof professionalTypeSchema>;

/** Bounds of the free text fields. Wide enough for a real name, bounded anyway. */
const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 120;
const COUNCIL_NUMBER_MIN = 3;
const COUNCIL_NUMBER_MAX = 32;
const SPECIALTY_MAX = 120;

/**
 * `POST /v1/professionals/me`: what the professional fills in on the first
 * access, right after signing in with Supabase Auth.
 *
 * Who the person is does **not** travel in this body: the caller is the `sub`
 * of the verified access token (ADR 0007), so nobody can register a
 * professional in somebody else's name by changing a field.
 */
export const registerProfessionalRequestSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(FULL_NAME_MIN, { error: 'Informe seu nome completo.' })
      .max(FULL_NAME_MAX)
      .meta({ description: 'Nome completo do profissional', example: 'Ana Souza' }),

    /**
     * The council registration number, `CRN-3 12345` for a nutritionist. Kept
     * as free text: the format differs by council and by region, and a regular
     * expression here would turn a real number into a form nobody can submit.
     */
    councilNumber: z
      .string()
      .trim()
      .min(COUNCIL_NUMBER_MIN, { error: 'Informe o número do seu conselho.' })
      .max(COUNCIL_NUMBER_MAX)
      .meta({ description: 'Número do registro no conselho', example: 'CRN-3 12345' }),

    /** Optional: a professional with no declared specialty is a professional. */
    specialty: z
      .string()
      .trim()
      .max(SPECIALTY_MAX)
      .optional()
      .meta({ description: 'Especialidade declarada', example: 'Nutrição esportiva' }),

    /**
     * Absent means `nutritionist`, which is what the platform is for. The
     * default lives in the domain and not in this schema, so a caller that is
     * not the panel gets the same one.
     */
    professionalType: professionalTypeSchema.optional(),
  })
  .meta({
    id: 'RegisterProfessionalRequest',
    description: 'Dados do primeiro acesso de um profissional',
  });

export type RegisterProfessionalRequest = z.infer<typeof registerProfessionalRequestSchema>;

/**
 * The professional half of the caller's identity: what they are allowed to be
 * asked to do, and the practices they belong to.
 *
 * Absent when the caller is not a professional, which is why `GET /v1/me`
 * carries it as an optional field instead of as empty structures: a patient
 * has no council number and belongs to no organization.
 */
export const professionalIdentitySchema = z
  .object({
    type: professionalTypeSchema,

    councilNumber: z
      .string()
      .min(1)
      .meta({ description: 'Número do registro no conselho', example: 'CRN-3 12345' }),

    specialty: z.string().min(1).optional().meta({ description: 'Especialidade declarada' }),

    /**
     * Every professional belongs to at least one, and in the MVP to exactly
     * one: the solo practice created with their registration.
     */
    organizations: z
      .array(organizationMembershipSchema)
      .meta({ description: 'Organizações a que o profissional pertence' }),
  })
  .meta({
    id: 'ProfessionalIdentity',
    description: 'Dados profissionais de quem fez a chamada',
  });

export type ProfessionalIdentity = z.infer<typeof professionalIdentitySchema>;
