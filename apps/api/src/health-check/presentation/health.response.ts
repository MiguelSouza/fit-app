import { type ComponentHealth, type SystemHealth } from '../domain/system-health';

/**
 * The wire shape of `GET /v1/health`.
 *
 * It is declared here, and not in `packages/contracts`, because that package
 * is still the placeholder of card F-09. When the Zod schemas land, this type
 * moves there and the controller imports it — CLAUDE.md rule 7 ("Contratos
 * primeiro") is where this ends up.
 */
export interface ComponentCheckResponse {
  readonly name: string;
  readonly status: 'up' | 'down';
  readonly latencyMs?: number;
}

export interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly checks: readonly ComponentCheckResponse[];
}

function presentComponent(component: ComponentHealth): ComponentCheckResponse {
  // `exactOptionalPropertyTypes` is on, so the key is left out rather than set
  // to undefined: the json has no `latencyMs` when the component is down.
  return component.latencyMs === undefined
    ? { name: component.name, status: component.status }
    : { name: component.name, status: component.status, latencyMs: component.latencyMs };
}

export function presentSystemHealth(health: SystemHealth): HealthResponse {
  return {
    status: health.status,
    checks: health.components.map(presentComponent),
  };
}
