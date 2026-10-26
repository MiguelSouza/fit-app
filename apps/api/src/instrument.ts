import { loadLocalEnvFile } from './shared/config/env-file';
import { resolveEnv } from './shared/config/env.module';
import { initSentry } from './shared/observability/sentry';

/**
 * The first thing the process runs, imported at the top of `main.ts` before
 * anything else.
 *
 * It is a file of its own and not three lines inside `bootstrap()` because of
 * the order: the Sentry SDK instruments `http`, `express` and `pg` by wrapping
 * them as they are loaded, so a module imported before `Sentry.init` is a
 * module it never sees — and an `import` at the top of `main.ts` runs before
 * any function in it. With this file first, a request gets its own scope and
 * an event knows which route it came from (ADR 0013).
 *
 * The `.env` of the repository is read here for the same reason: `SENTRY_DSN`
 * has to exist before the line below, and `main.ts` would read it too late.
 * In staging and production there is no file and it is a no-op.
 *
 * An environment Sentry cannot be configured from is **not** this file's to
 * report: `main.ts` reads the same variables a moment later and stops the
 * process with a message naming what is wrong. Starting without reporting is
 * also the right outcome of the one case that is not a mistake — no DSN,
 * which is a laptop and the CI.
 */
loadLocalEnvFile();

try {
  initSentry(resolveEnv());
} catch {
  // Deliberately silent. `resolveEnv()` memoizes nothing when it throws, so
  // `main.ts` asks again, gets the same error and prints it properly.
}
