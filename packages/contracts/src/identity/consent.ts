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
