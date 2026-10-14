/**
 * Where the migrations are and how the database keeps track of them.
 *
 * Three constants in one file because two very different programs have to
 * agree on them: Drizzle Kit, which writes and applies them
 * (`drizzle.config.ts`, `pnpm db:migrate`), and the integration test harness,
 * which applies the same SQL to a throwaway container
 * (`shared/testing/integration-postgres.spec-support.ts`). A test database
 * built with other bookkeeping than the real one is not the real one.
 */

/**
 * The folder Drizzle Kit writes the SQL into, relative to `apps/api`. It is
 * versioned and reviewed in the PR (CLAUDE.md, "Convenções").
 */
export const MIGRATIONS_FOLDER = 'drizzle';

/** The table that records which migrations ran. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * The schema that table lives in: a schema of its own, so `public` stays empty
 * and the four domain schemas hold domain tables only (ADR 0004).
 */
export const MIGRATIONS_SCHEMA = 'drizzle';
