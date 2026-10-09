import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the repository's `.env` for local development, if there is one.
 *
 * In staging and production there is no file: the variables come from the task
 * definition and from AWS Secrets Manager (ADR 0005), and this is a no-op.
 *
 * The file sits at the root of the monorepo (see `.env.example`), so both
 * places the API is usually started from are tried: `apps/api`, which is where
 * `pnpm --filter api dev` runs, and the root itself.
 */
const CANDIDATE_PATHS = ['.env', '../../.env'];

export function loadLocalEnvFile(cwd: string = process.cwd()): string | undefined {
  for (const candidate of CANDIDATE_PATHS) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) {
      // Node only overwrites variables the file declares, so a variable
      // already exported in the shell still wins over the file.
      process.loadEnvFile(path);
      return path;
    }
  }

  return undefined;
}
