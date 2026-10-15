import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { type NextConfig } from 'next';

/**
 * The panel reads the same `.env` as the rest of the monorepo.
 *
 * Next.js only looks for `.env*` next to the application, and the repository
 * keeps a single file at the root (see `.env.example`) — the same one the API
 * loads in `apps/api/src/shared/config/env-file.ts`. Both places this app is
 * usually started from are tried, in the same order and for the same reason:
 * `apps/web`, which is where turbo and `pnpm --filter @fit-app/web dev` run,
 * and the root itself.
 *
 * Node does not overwrite a variable that is already in the environment, so a
 * value exported in the shell — or set by the Vercel build, where no file
 * exists and this is a no-op — still wins over the file.
 *
 * It has to happen here, before the config is exported: `next build` inlines
 * every `NEXT_PUBLIC_*` from the environment of the build into the browser
 * bundle, and this file is the last thing that runs before that.
 */
for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);

  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

/**
 * Nothing is configured on purpose. The defaults of Next.js 16 are what this
 * card asks for — App Router, Turbopack, React strict mode — and the two
 * things that would normally live here are elsewhere: Tailwind is a PostCSS
 * plugin (`postcss.config.mjs`) and the compiler options come from the shared
 * preset (`tsconfig.json`).
 */
const nextConfig: NextConfig = {};

export default nextConfig;
