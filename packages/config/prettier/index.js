/**
 * Configuracao de prettier compartilhada por todo o monorepo.
 *
 * Os valores de encoding, fim de linha e indentacao espelham o `.editorconfig`
 * da raiz de proposito: as duas ferramentas precisam concordar.
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
      // Em markdown, quebra de linha e conteudo: reformatar texto corrido
      // poluiria o diff dos ADRs.
      files: '*.md',
      options: { proseWrap: 'preserve' },
    },
  ],
};

export default config;
