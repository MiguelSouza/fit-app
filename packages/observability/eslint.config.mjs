import base from '@fit-app/config/eslint';

/**
 * What `pnpm --filter @fit-app/observability lint` runs: the monorepo base,
 * with the build output out of the way.
 */
export default [...base, { ignores: ['dist/**'] }];
