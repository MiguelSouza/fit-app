import webConfig from '@fit-app/config/eslint/web';

/**
 * What `pnpm --filter @fit-app/web lint` runs: the shared web preset (the
 * monorepo base plus the Next.js and React Hooks rules) with the build output
 * and the file Next.js generates out of the way.
 *
 * `next-env.d.ts` is written by `next build` and says so in its own header, so
 * there is nothing to review in it and no fix that would survive the next
 * build.
 */
export default [...webConfig, { ignores: ['.next/**', 'next-env.d.ts'] }];
