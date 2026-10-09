import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Paths no workspace should lint: build artifacts and dependencies. Exported so
 * a consumer can reuse the list when adding its own ignores.
 */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/cdk.out/**',
];

/**
 * Shared eslint base config (flat config) for the whole monorepo.
 *
 * It does not enable the type-aware rules (`recommendedTypeChecked`): a
 * workspace that wants them must turn `projectService` on in its own
 * `eslint.config.mjs`, because the tsconfig path is local.
 */
export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything here runs on Node (scripts, jobs, config files). Without this,
    // `no-undef` — which typescript-eslint only turns off for TS files — fires on
    // `process`, `console` and friends in plain `.js`/`.mjs` files. A workspace
    // that also runs in the browser adds `globals.browser` on top of this.
    languageOptions: {
      globals: { ...globals.node },
    },
    linterOptions: {
      // An `eslint-disable` that is no longer needed is an error: it keeps the
      // justification from aging along with the code.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // CLAUDE.md: no `any` without a comment justifying it. The escape hatch is
      // `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>`.
      '@typescript-eslint/no-explicit-any': 'error',

      // Matches `verbatimModuleSyntax` in the tsconfig presets.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // Always last: turns off the stylistic rules that prettier owns.
  prettier,
);
