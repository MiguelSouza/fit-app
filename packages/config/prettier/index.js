/**
 * Prettier config shared by the whole monorepo.
 *
 * The encoding, end-of-line and indentation values mirror the root
 * `.editorconfig` on purpose: both tools have to agree.
 *
 * @type {import('prettier').Config}
 */
const config = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      // In markdown a line break is content: reflowing prose would pollute the
      // diff of the ADRs.
      files: '*.md',
      options: { proseWrap: 'preserve' },
    },
  ],
};

export default config;
