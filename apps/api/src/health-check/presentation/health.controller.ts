import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@fit-app/contracts';

import { CheckSystemHealthUseCase } from '../application/check-system-health.use-case';
import { SchemaResponse } from '../../shared/presentation/schema-response.decorator';
import { presentSystemHealth } from './health.response';
import { Public } from '../../shared/auth/public.decorator';
import { presentSystemHealth, type HealthResponse } from './health.response';

/**
 * `GET /v1/health`. The version comes from `defaultVersion` in `bootstrap.ts`,
 * so the path here stays version free.
 *
 * `@Public()` because whoever calls this has no session: an ALB target group,
 * a `curl` during a deploy, an uptime check. It answers about the process and
 * the database, never about a person, so there is nothing here to protect.
 */
@Public()
@Controller({ path: 'health' })
export class HealthController {
  constructor(private readonly checkSystemHealth: CheckSystemHealthUseCase) {}

  /**
   * Always 200, including with the database down — the body is what says
   * which piece is failing.
   *
   * It is a status report, not a liveness gate: a database blip would
   * otherwise fail every task's health check at once and pull the whole
   * service out of the load balancer, when the API is still up and the
   * endpoints that do not touch Postgres still answer. The probe that *does*
   * take a task out of rotation belongs to the ECS and ALB card, next to the
   * target group that reads it.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @SchemaResponse(healthResponseSchema, 'Estado do processo e das suas dependências')
  async get(): Promise<HealthResponse> {
    return presentSystemHealth(await this.checkSystemHealth.execute());
  }
}
