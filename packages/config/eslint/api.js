import base from './base.js';

/**
 * The API domain modules. The source of truth is CLAUDE.md, section "Módulos de
 * domínio": adding a module to this list is what turns its boundary on in lint.
 */
export const apiModules = ['identity', 'nutrition', 'health', 'insights'];

/**
 * The relative prefixes lint follows when looking for a module escape.
 *
 * An import that leaves module A and reaches inside module B always has the
 * shape `(../)+<module B>/<internal>`: the module name comes right after the
 * last `..`, because the modules are siblings under `src/modules`. Following
 * only those prefixes is what avoids a false positive on a legitimate internal
 * import such as `../domain/health/score`, where a module name shows up in the
 * middle of the path.
 *
 * Five levels cover the folder depth CLAUDE.md foresees
 * (`modules/<module>/<layer>/...`) with room to spare.
 */
const relativePrefixes = Array.from({ length: 5 }, (_, depth) =>
  Array.from({ length: depth + 1 }, () => '..').join('/'),
);

/**
 * The ways of spelling a module path that lint recognizes: a relative path, a
 * path containing `modules/` (absolute from the app root) and the `@modules/`
 * alias.
 *
 * @param {string} target the module whose internal files stay closed
 * @returns {string[]} .gitignore-style patterns, which is what `no-restricted-imports` expects
 */
function internalPaths(target) {
  return [
    `**/modules/${target}/**`,
    `@modules/${target}/**`,
    ...relativePrefixes.map((prefix) => `${prefix}/${target}/**`),
  ];
}

/**
 * Where a module's files are, written the two ways eslint may see them.
 *
 * `files` is matched against the path of the file relative to the config file
 * being applied, and eslint 10 applies the config file nearest to the linted
 * file. So the same file has two names: `apps/api/src/modules/...` when the
 * root config answers for it (an editor, `lint-staged`, `eslint .` at the
 * root) and `src/modules/...` when `apps/api/eslint.config.mjs` does
 * (`pnpm --filter api lint`, which is what `turbo run lint` runs). Naming only
 * the first one leaves the boundary off exactly where the code is.
 *
 * @param {string} current the module whose files the entry applies to
 * @returns {string[]} the patterns that name that module’s files
 */
function boundaryFiles(current) {
  return [`**/apps/api/src/modules/${current}/**/*.ts`, `**/src/modules/${current}/**/*.ts`];
}

/**
 * CLAUDE.md rule 1 ("Fronteira de módulo"): from inside a module, the other
 * modules exist only through their `index.ts`.
 *
 * The pattern closes `<module>/<anything>` and lets `<module>` alone through,
 * which is exactly the `index.ts` import. Importing your own module by relative
 * path (`../domain/plan`) stays free.
 *
 * @param {string} current the module the linted file belongs to
 */
function moduleBoundaryRule(current) {
  const patterns = apiModules
    .filter((other) => other !== current)
    .map((other) => ({
      group: internalPaths(other),
      message:
        `Module boundary: '${current}' cannot import an internal file of '${other}'. ` +
        `Import the whole module ('../../${other}' or '@modules/${other}'), which resolves ` +
        `its index.ts, or react to an event instead. See CLAUDE.md, "Regras de arquitetura", rule 1.`,
    }));

  return {
    files: boundaryFiles(current),
    rules: {
      'no-restricted-imports': ['error', { patterns }],
    },
  };
}

/**
 * Eslint flat config for `apps/api`: the monorepo base plus the boundary
 * between the domain modules.
 *
 * `apps/api/eslint.config.mjs` and the monorepo root both apply it, so the
 * boundary is the same rule for `pnpm --filter api lint`, for the pre-commit
 * hook and for an editor.
 */
export default [...base, ...apiModules.map(moduleBoundaryRule)];
