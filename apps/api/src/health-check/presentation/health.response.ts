import { type ComponentCheck, type HealthResponse } from '@fit-app/contracts';

import { type ComponentHealth, type SystemHealth } from '../domain/system-health';

/**
 * Turns the domain's reading into the wire shape of `GET /v1/health`.
 *
 * The shape itself is not declared here: it is `healthResponseSchema` in
 * `@fit-app/contracts` (CLAUDE.md rule 7, "Contratos primeiro"), which is also
 * what documents the endpoint and validates this function's output — see
 * `SchemaResponse` on the controller.
 */
function presentComponent(component: ComponentHealth): ComponentCheck {
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
