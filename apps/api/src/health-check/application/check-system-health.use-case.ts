import { Inject, Injectable } from '@nestjs/common';

import {
  summarizeSystemHealth,
  type ComponentHealth,
  type SystemHealth,
} from '../domain/system-health';
import { DATABASE_STATUS_PORT, type DatabaseStatusPort } from './ports/database-status.port';

/**
 * Collects the state of every piece and lets the domain summarize it.
 *
 * There is no authorization check here, and that is on purpose: this is the
 * only use case in the API that reads no patient data. Everything that touches
 * a patient goes through `identity` first (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class CheckSystemHealthUseCase {
  constructor(@Inject(DATABASE_STATUS_PORT) private readonly databaseStatus: DatabaseStatusPort) {}

  async execute(): Promise<SystemHealth> {
    // The process is answering this request, so the API itself is up by
    // definition. The interesting part is what it depends on.
    const api: ComponentHealth = { name: 'api', status: 'up' };

    return summarizeSystemHealth([api, await this.databaseStatus.check()]);
  }
}
