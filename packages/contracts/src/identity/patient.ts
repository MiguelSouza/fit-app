import { z } from 'zod';

/**
 * The patient, as the routes that carry one in the path name them.
 *
 * There is no `Patient` DTO here, and that is the honest state of the platform:
 * what a patient *is* to this product is their check-ins, their measurements
 * and their plan, and each of those is another module's contract with a card of
 * its own. What already travels is the id.
 */

/**
 * The patient's `identity.profile.id` — ours, never the Supabase user id.
 *
 * It is a component of its own so the generated clients take it as more than a
 * bare string (ADR 0008), and because every route that reaches a patient reads
 * it from the same place: the path. Nothing a client sends says *which*
 * professional is asking — that is the `sub` of the verified token (ADR 0007).
 */
export const patientIdSchema = z
  .uuid()
  .meta({ id: 'PatientId', description: 'Id do perfil do paciente no módulo identity' });
