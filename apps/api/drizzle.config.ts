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

  // Which schemas Drizzle Kit looks at in the database. It only reads the
  // database for `push` and `pull`, and it defaults to `public` alone: without
  // this list those commands would not see a single table of ours, and `push`
  // would read all of them as missing and try to create them again. The two
  // scripts we run (`generate`, `migrate`) do not use it — `generate` diffs
  // against the snapshots in `out/meta` — but the list has to be right the
  // first time somebody reaches for `push`.
  schemaFilter: ['identity', 'nutrition', 'health', 'insights'],

  // The bookkeeping table lives in a schema of its own: `public` stays empty,
  // and the four domain schemas hold domain tables only.
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },

  // Both of these only affect `push` in Drizzle Kit 0.31 (see the doc comment
  // on `Config` in the installed package): `verbose` prints the statements and
  // `strict` asks before running them. They are no safety net for
  // `pnpm db:migrate`, which applies the reviewed SQL in `drizzle/` without
  // asking — that review happens in the PR, as CLAUDE.md requires.
  strict: true,
  verbose: true,
});
