import base from '@fit-app/config/eslint';

/**
 * What `pnpm --filter @fit-app/api-client lint` runs: the monorepo base, with
 * the build output and the generated types out of the way.
 *
 * `src/generated/` is written by `openapi-typescript`, not by us: linting it
 * would be reviewing the generator's style, and the only fix available would
 * be to edit a file that the next `pnpm api:generate` overwrites.
 */
export default [...base, { ignores: ['dist/**', 'src/generated/**'] }];
