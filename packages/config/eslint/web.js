import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import base from './base.js';

/**
 * Eslint flat config for `apps/web`: the monorepo base plus what React and the
 * Next.js App Router add on top of it.
 *
 * Three things come in, and nothing else:
 *
 * - **`@next/eslint-plugin-next`**, in its `core-web-vitals` set, which is what
 *   catches the mistakes only the framework can see: an `<a>` to an internal
 *   route, a synchronous `<script>`, an `async` client component.
 * - **`eslint-plugin-react-hooks`**, in its `recommended-latest` set, which in
 *   version 7 is the React Compiler's own analysis — the rules of hooks, plus
 *   purity and immutability of a component's render. (`recommended` is the same
 *   list minus the newest rule; the preset here tracks the plugin.)
 * - **the browser globals**, which the base does not carry: it assumes Node,
 *   because until this card every workspace ran there.
 *
 * What does **not** come in is `eslint-config-next`. It would bring a second
 * `typescript-eslint` preset, with its own parser and rule set, on top of the
 * one the base already applies to the whole monorepo — two configurations
 * deciding the same thing. The two plugins above are the part of it that says
 * something the base cannot.
 */
export default [
  ...base,
  {
    // `files` keeps the entry from being a global config object: eslint 10
    // would otherwise apply these globals to every file it sees, including the
    // `.mjs` of the root.
    files: ['**/*.{js,mjs,jsx,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
];
