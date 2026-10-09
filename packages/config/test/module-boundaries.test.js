import assert from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';

import apiConfig, { apiModules } from '../eslint/api.js';

const RULE = 'no-restricted-imports';

/**
 * The file doing the import in every case: a `nutrition` use case. The path is
 * made up on purpose. `lintText` never reads the disk, and `apps/api` has no
 * code yet (card F-05); all that matters is that the path matches the `files`
 * of the config.
 */
const importerPath = 'apps/api/src/modules/nutrition/application/create-plan.ts';

const eslint = new ESLint({
  overrideConfigFile: true,
  // `typescript-eslint` and `eslint` describe the flat config with two separate
  // types that are structurally the same but not assignable to each other. The
  // cast is where that ends; it is not hiding a shape mismatch.
  overrideConfig: /** @type {import('eslint').Linter.Config[]} */ (
    /** @type {unknown} */ (apiConfig)
  ),
});

/**
 * @param {string} source the import specifier
 * @returns {Promise<string[]>} the boundary rule messages, if any
 */
async function boundaryErrors(source) {
  const [result] = await eslint.lintText(
    `import { thing } from '${source}';\nexport const used = thing;\n`,
    { filePath: importerPath },
  );

  assert.ok(result, `eslint did not lint ${importerPath}: the config did not match the path`);

  const unexpected = result.messages.filter((m) => m.ruleId !== RULE && m.severity === 2);
  assert.deepEqual(
    unexpected.map((m) => `${m.ruleId}: ${m.message}`),
    [],
    `the test case broke a rule other than ${RULE}`,
  );

  return result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message);
}

test('the boundary closes an internal file of another module', async () => {
  const blocked = [
    '../../identity/domain/person',
    '../../identity/index',
    '../../identity/identity.module',
    '../../health/infrastructure/sleep.repository',
    '../../../insights/domain/alert-rule',
    '../identity/domain/person',
    '@modules/identity/domain/person',
    'src/modules/identity/domain/person',
    'apps/api/src/modules/identity/domain/person',
  ];

  for (const source of blocked) {
    const errors = await boundaryErrors(source);
    assert.equal(errors.length, 1, `'${source}' should have broken lint, and did not`);
    assert.match(errors[0] ?? '', /Module boundary/);
  }
});

test('the boundary lets the public API of another module through', async () => {
  for (const source of ['../../identity', '../../health', '@modules/insights']) {
    assert.deepEqual(
      await boundaryErrors(source),
      [],
      `'${source}' is an index.ts import: it must pass`,
    );
  }
});

test('the boundary does not get in the way inside the module itself', async () => {
  const allowed = [
    './create-plan.types',
    '../domain/meal',
    '../../domain/plan',
    '../../nutrition.module',
    // A module name in the middle of the path is not an escape: this is a
    // folder of `nutrition` that happens to be called `health`.
    '../domain/health/score',
    './health/thing',
  ];

  for (const source of allowed) {
    assert.deepEqual(
      await boundaryErrors(source),
      [],
      `'${source}' is internal to the module: it must pass`,
    );
  }
});

test('the boundary does not get in the way of an external or workspace package', async () => {
  for (const source of ['@nestjs/common', 'date-fns', '@fit-app/contracts']) {
    assert.deepEqual(
      await boundaryErrors(source),
      [],
      `'${source}' is not an API module: it must pass`,
    );
  }
});

test('every module in CLAUDE.md has its boundary configured', async () => {
  const configured = apiConfig
    .flatMap((entry) => entry.files ?? [])
    .flatMap((pattern) => (typeof pattern === 'string' ? [pattern] : pattern));

  for (const moduleName of apiModules) {
    assert.ok(
      configured.includes(`**/apps/api/src/modules/${moduleName}/**/*.ts`),
      `module '${moduleName}' is in CLAUDE.md but has no boundary in lint`,
    );
  }
});
