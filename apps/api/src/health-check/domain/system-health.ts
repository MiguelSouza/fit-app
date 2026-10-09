/**
 * How the API describes its own state. Pure: no NestJS, no driver, no I/O
 * (CLAUDE.md rule 4).
 */

/** A piece the API depends on to work. */
export type ComponentName = 'api' | 'database';

export type ComponentStatus = 'up' | 'down';

export interface ComponentHealth {
  readonly name: ComponentName;
  readonly status: ComponentStatus;
  /** How long the check took. Absent when the component did not answer. */
  readonly latencyMs?: number;
}

/** `degraded` is deliberate: the API answers, but not everything it needs does. */
export type SystemStatus = 'ok' | 'degraded';

export interface SystemHealth {
  readonly status: SystemStatus;
  readonly components: readonly ComponentHealth[];
}

/**
 * The rule: the whole is `ok` only while every piece is `up`. One piece down
 * is enough to degrade it, and a list with nothing in it has nothing down,
 * so it is `ok`.
 */
export function summarizeSystemHealth(components: readonly ComponentHealth[]): SystemHealth {
  const degraded = components.some((component) => component.status === 'down');

  return {
    status: degraded ? 'degraded' : 'ok',
    components,
  };
}
