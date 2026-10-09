import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Caminhos que nenhum workspace deve lintar: artefatos de build e dependencias.
 * Exportado para que um consumidor possa reaproveitar a lista ao adicionar os
 * proprios ignores.
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
 * Configuracao base de eslint (flat config) compartilhada por todo o monorepo.
 *
 * Nao inclui regras com type information (`recommendedTypeChecked`): cada
 * workspace que quiser isso deve ligar o `projectService` no proprio
 * `eslint.config.mjs`, porque o caminho do tsconfig e local.
 */
export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: {
      // Um `eslint-disable` que deixou de ser necessario e erro: evita que a
      // justificativa envelheca junto com o codigo.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // CLAUDE.md: proibido `any` sem comentario justificando. O escape hatch e
      // `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <motivo>`.
      '@typescript-eslint/no-explicit-any': 'error',

      // Casa com `verbatimModuleSyntax` dos presets de tsconfig.
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
  // Sempre por ultimo: desliga as regras de estilo que o prettier resolve.
  prettier,
);
