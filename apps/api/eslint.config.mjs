import apiConfig from '@fit-app/config/eslint/api';

/**
 * What `pnpm --filter api lint` runs: the shared API preset (which carries the
 * boundary between the domain modules, CLAUDE.md rule 1) plus the two things
 * that only make sense inside a NestJS app.
 */
export default [
  ...apiConfig,
  {
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // NestJS resolves a constructor dependency from the type metadata that
      // `emitDecoratorMetadata` writes, and that metadata only exists for a
      // value import. `consistent-type-imports` sees a class used solely as a
      // parameter type and rewrites the import to `import type`, which erases
      // the metadata and turns every injection into a runtime
      // "Nest can't resolve dependencies" error. The rule has no notion of
      // decorator metadata, so it stays off in this app; the rest of the
      // monorepo keeps it on.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
