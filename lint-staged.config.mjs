/**
 * What the pre-commit hook runs, over the staged files only.
 *
 * Order matters: eslint fixes first (it may rewrite imports and break lines),
 * prettier formats afterwards and has the final word on style.
 *
 * `--no-warn-ignored` keeps the commit from failing when a staged file is in
 * the eslint ignore list, and `--max-warnings=0` treats a warning as an error:
 * neither should get through a commit.
 *
 * @type {import('lint-staged').Configuration}
 */
const config = {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,jsonc,md,yml,yaml,css,html}': ['prettier --write'],
};

export default config;
