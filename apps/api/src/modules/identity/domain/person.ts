/**
 * What a person is to the platform. Pure: no NestJS, no driver, no I/O
 * (CLAUDE.md rule 4).
 *
 * The vocabulary is declared here and not imported from `@fit-app/contracts`,
 * the same way `health-check/domain` declares its own: the domain is what the
 * rules are written against, and the contract is one of its readers. The two
 * cannot drift apart silently — the controller maps the contract into these
 * types and the presenter maps them back, so a value that exists on one side
 * only stops the build at that boundary.
 */

/**
 * The professional who prescribes and follows up, and the patient who is
 * followed.
 *
 * It says nothing about what the professional may do: that is
 * `ProfessionalType`, and every rule checks that one (CLAUDE.md, "Saúde e
 * LGPD": "checar `professional_type`, não o papel genérico").
 */
export type PersonRole = 'professional' | 'patient';

/** What the professional is licensed as. Only a nutritionist edits a meal plan. */
export type ProfessionalType = 'nutritionist' | 'trainer';

/**
 * What a professional is when nobody says otherwise. The platform is for
 * sports nutritionists, so this is the only type a registration creates on its
 * own (card I-01).
 */
export const DEFAULT_PROFESSIONAL_TYPE: ProfessionalType = 'nutritionist';

/**
 * The time zone a profile starts with: where the practices this product is
 * being built for are (the database is in São Paulo, ADR 0002).
 *
 * It is a default and not a constant of the platform — the person's own zone is
 * what turns a UTC instant into "yesterday night" (CLAUDE.md, "Dados de
 * saúde"), and whoever practises elsewhere changes it on their profile.
 */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
