import { z } from 'zod';

/** A single piece the health check looks at: the process, the database. */
export const componentStatusSchema = z.enum(['up', 'down']).meta({
  id: 'ComponentStatus',
  description: 'Estado de um componente',
});

export type ComponentStatus = z.infer<typeof componentStatusSchema>;

export const componentCheckSchema = z
  .object({
    name: z.string().min(1).meta({ description: 'Nome do componente', example: 'database' }),

    status: componentStatusSchema,

    /** Absent when the component is down: there is no round trip to measure. */
    latencyMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .meta({ description: 'Tempo de resposta do componente, em milissegundos' }),
  })
  .meta({ id: 'ComponentCheck', description: 'Resultado da checagem de um componente' });

export type ComponentCheck = z.infer<typeof componentCheckSchema>;

/**
 * `GET /v1/health`: the state of the process and of what it depends on.
 *
 * `degraded` is the answer when a component is down and the API still serves
 * the endpoints that do not need it — the status code stays 200 either way,
 * see the controller in `apps/api`.
 */
export const healthResponseSchema = z
  .object({
    status: z
      .enum(['ok', 'degraded'])
      .meta({ id: 'SystemStatus', description: 'Estado do sistema como um todo' }),

    checks: z.array(componentCheckSchema).meta({ description: 'Um resultado por componente' }),
  })
  .meta({ id: 'HealthResponse', description: 'Estado do processo e das suas dependências' });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
