// Config used by editors, by the pre-commit hook (`lint-staged`) and by manual
// runs at the root (`pnpm exec eslint .`). Each workspace has its own
// `eslint.config.mjs`, which is what `turbo run lint` executes.
//
// This points at the API preset rather than the base one, so the boundary
// between the domain modules applies to whoever edits `apps/api` from the
// monorepo root.
export { default } from '@fit-app/config/eslint/api';
