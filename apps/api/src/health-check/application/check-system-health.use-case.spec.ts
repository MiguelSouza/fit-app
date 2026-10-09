import { CheckSystemHealthUseCase } from './check-system-health.use-case';
import { type DatabaseStatusPort } from './ports/database-status.port';
import { type ComponentHealth } from '../domain/system-health';

/**
 * Example of an `application/` test: the use case against a fake port, with
 * no container and no database.
 *
 * CLAUDE.md ("Testes") asks for Testcontainers and a real Postgres for the
 * *critical* use cases — the ones that read and write patient data. This one
 * owns no data, so the port is enough; the Postgres adapter has its own test
 * in `infrastructure/`.
 */
function portAnswering(database: ComponentHealth): DatabaseStatusPort {
  return { check: () => Promise.resolve(database) };
}

describe('CheckSystemHealthUseCase', () => {
  it('reports ok with the api and the database up', async () => {
    const useCase = new CheckSystemHealthUseCase(
      portAnswering({ name: 'database', status: 'up', latencyMs: 2 }),
    );

    await expect(useCase.execute()).resolves.toEqual({
      status: 'ok',
      components: [
        { name: 'api', status: 'up' },
        { name: 'database', status: 'up', latencyMs: 2 },
      ],
    });
  });

  it('reports degraded with the database down, and still names the api as up', async () => {
    const useCase = new CheckSystemHealthUseCase(
      portAnswering({ name: 'database', status: 'down' }),
    );

    await expect(useCase.execute()).resolves.toEqual({
      status: 'degraded',
      components: [
        { name: 'api', status: 'up' },
        { name: 'database', status: 'down' },
      ],
    });
  });
});
