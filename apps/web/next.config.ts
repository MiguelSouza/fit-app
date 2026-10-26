import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { withSentryConfig } from '@sentry/nextjs/config';
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

/**
 * The build plugin of Sentry, and the only reason it is here: the source maps
 * (ADR 0013).
 *
 * The SDK itself is started by `src/instrumentation.ts` and
 * `src/instrumentation-client.ts`, which Next.js loads on its own — the plugin
 * is what uploads the maps and then keeps them out of what is served, so a
 * stack trace in the issue names our files and lines instead of one letter
 * variables in a bundle.
 *
 * It needs `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` in the
 * environment **of the build** (on Vercel, project settings). Without them it
 * skips the upload: the build does not fail, which is what keeps a clone
 * working offline and keeps the token out of this repository.
 */
export default withSentryConfig(nextConfig, {
  // The plugin prints a block of its own per build. What matters when it has
  // nothing to upload is said once, by us, in the README.
  silent: true,

  bundleSizeOptimizations: {
    // The SDK's own debug statements, and the code behind the two features
    // this panel turns off in `lib/sentry.ts`: tracing and session replay.
    // Bytes on the connection of whoever is working, for nothing.
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },

  sourcemaps: {
    // Uploaded and then deleted from the output: a source map served next to
    // the bundle is this panel's source code handed to anybody who asks.
    deleteSourcemapsAfterUpload: true,
  },
});
