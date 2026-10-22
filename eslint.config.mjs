// @ts-check
import eslint from '@eslint/js';
import checkFile from 'eslint-plugin-check-file';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      'check-file': checkFile,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/naming-convention': [
        'warn', // 'error'로 바꾸면 lint 실패 처리
        {
          selector: 'class',
          format: ['PascalCase'],
        },
        {
          selector: ['interface', 'typeAlias', 'enum'],
          format: ['PascalCase'],
        },
        {
          selector: ['variable', 'function'],
          format: ['camelCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],
      'check-file/filename-naming-convention': [
        'warn',
        {
          '**/*.controller.ts': 'KEBAB_CASE',
          '**/*.service.ts': 'KEBAB_CASE',
          '**/*.repository.ts': 'KEBAB_CASE',
          '**/*.module.ts': 'KEBAB_CASE',
          '**/*.error.ts': 'KEBAB_CASE',
          '**/*.dto.ts': 'KEBAB_CASE',
          '**/*.spec.ts': 'KEBAB_CASE',
        },
        {
          ignoreMiddleExtensions: true,
        },
      ],
    },
  },
);
