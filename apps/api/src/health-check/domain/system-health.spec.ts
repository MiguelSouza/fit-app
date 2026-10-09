import { summarizeSystemHealth, type ComponentHealth } from './system-health';

/**
 * Example of a `domain/` test: a pure rule, no NestJS test module, no
 * database. This is the pattern for macro calculation and for the alert rules
 * (CLAUDE.md, "Testes").
 */
describe('summarizeSystemHealth', () => {
  const up: ComponentHealth = { name: 'api', status: 'up' };
  const down: ComponentHealth = { name: 'database', status: 'down' };

  it('is ok when every component is up', () => {
    expect(summarizeSystemHealth([up, { name: 'database', status: 'up', latencyMs: 3 }])).toEqual({
      status: 'ok',
      components: [up, { name: 'database', status: 'up', latencyMs: 3 }],
    });
  });

  it('is degraded when any component is down', () => {
    expect(summarizeSystemHealth([up, down]).status).toBe('degraded');
  });

  it('is ok when there is nothing to check', () => {
    expect(summarizeSystemHealth([])).toEqual({ status: 'ok', components: [] });
  });

  it('keeps the components in the order they were checked', () => {
    expect(summarizeSystemHealth([down, up]).components).toEqual([down, up]);
  });
});
