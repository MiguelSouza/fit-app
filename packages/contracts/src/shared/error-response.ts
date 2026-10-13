import { z } from 'zod';

/**
 * The body every endpoint of the API answers an error with, written once here
 * because every client reads it: the panel, the app and whatever comes next.
 *
 * The API builds it in a single place, the global exception filter in
 * `apps/api/src/shared/presentation`, which is also where a domain error
 * becomes a status code.
 */
export const errorResponseSchema = z
  .object({
    error: z
      .object({
        /**
         * Stable and in English, `<module>.<entity>.<problem>`. It is the key
         * the client translates off, which is what lets the message below
         * change without breaking anyone.
         */
        code: z.string().min(1).meta({
          description: 'Identificador estável do erro, usado como chave de i18n pelo cliente',
          example: 'nutrition.plan.not_found',
        }),

        /**
         * pt-BR, safe to show as it is. It never carries patient data: it
         * travels in the response and the client may log it.
         */
        message: z.string().min(1).meta({
          description: 'Texto em pt-BR, pronto para exibir. Nunca carrega dado de paciente',
          example: 'Plano não encontrado.',
        }),
      })
      .meta({ id: 'ApiErrorDetail' }),
  })
  .meta({ id: 'ErrorResponse', description: 'Corpo de erro de toda a API' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
