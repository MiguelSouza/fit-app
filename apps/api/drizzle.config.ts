import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/shared/config/env';
import { loadLocalEnvFile } from './src/shared/config/env-file';

/**
 * What Drizzle Kit reads when it generates or applies a migration.
 *
 * The connection string goes through the same loader the API boots with, so a
 * missing or malformed `DATABASE_URL` fails here with the same message and
 * without ever printing the value (CLAUDE.md, "Saúde e LGPD").
 */
loadLocalEnvFile();
const env = loadEnv(process.env);

/**
 * One schema file per module, each one owning its own Postgres schema
 * (ADR 0004). The glob is what keeps this config out of the modules' way: a
 * new module shows up here by existing, not by being listed.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/infrastructure/*.schema.ts',
  out: './drizzle',
  dbCredentials: { url: env.databaseUrl },

  // Without this, Drizzle Kit diffs against `public` only and reads every
  // table of ours as "not in the database", which turns the first generate
  // into a migration that drops nothing and creates everything twice.
  schemaFilter: ['identity', 'nutrition', 'health', 'insights'],

  // The bookkeeping table lives in a schema of its own: `public` stays empty,
  // and the four domain schemas hold domain tables only.
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },

  // Refuses to apply a migration that would drop or truncate anything without
  // asking first. A prompt is better than a silent data loss in development.
  strict: true,
  verbose: true,
});
