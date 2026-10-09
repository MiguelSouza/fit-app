import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { CheckSystemHealthUseCase } from '../application/check-system-health.use-case';
import { presentSystemHealth, type HealthResponse } from './health.response';

/**
 * `GET /v1/health`. The version comes from `defaultVersion` in `bootstrap.ts`,
 * so the path here stays version free.
 */
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
  async get(): Promise<HealthResponse> {
    return presentSystemHealth(await this.checkSystemHealth.execute());
  }
}
