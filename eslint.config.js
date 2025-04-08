import babelParser from '@babel/eslint-parser';
import babelPresetEnv from '@babel/preset-env';
import importPlugin from 'eslint-plugin-import';
import optimizeRegexPlugin from 'eslint-plugin-optimize-regex';
import oxlintPlugin from 'eslint-plugin-oxlint';
import promisePlugin from 'eslint-plugin-promise';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import json from 'eslint-plugin-json';
import pluginESx from 'eslint-plugin-es-x';
import nodePlugin from 'eslint-plugin-n';
import globals from 'globals';

const commonRules = {
  'n/no-missing-import': 'off',
  'n/no-extraneous-import': 'off',
  indent: 'off',
  'multiline-ternary': 'off',
  'func-call-spacing': 'off',
  'operator-linebreak': 'off',
  'space-before-function-paren': 'off',
  semi: ['error', 'always'],
  'comma-dangle': 'off',
  'dot-notation': 'off',
  'default-case-last': 'off',
  'no-undef': 'off',
  'no-use-before-define': 'off',
  'sort-imports': 'off',
  camelcase: 'off',
  'no-useless-return': 'off',
  'sort-requires/sort-requires': 'off',
  'no-console': [
    'error',
    { allow: ['warn', 'error', 'info', 'table', 'debug', 'clear'] },
  ],
  'no-unused-vars': 'off',
  'no-restricted-globals': [
    'error',
    {
      name: 'name',
      message: 'Use local parameter instead.',
    },
    {
      name: 'event',
      message: 'Use local parameter instead.',
    },
    {
      name: 'fdescribe',
      message: 'Do not commit fdescribe. Use describe instead.',
    },
  ],
  'optimize-regex/optimize-regex': 'warn',
  'es-x/no-async-iteration': 'error',
  'es-x/no-malformed-template-literals': 'error',
  'es-x/no-regexp-lookbehind-assertions': 'error',
  'es-x/no-regexp-named-capture-groups': 'error',
  'es-x/no-regexp-s-flag': 'error',
  'es-x/no-regexp-unicode-property-escapes': 'error',
};

const jsConfig = {
  files: ['**/*.{js,jsx,mjs}'],
  plugins: {
    'es-x': pluginESx,
    import: importPlugin,
  },
  languageOptions: {
    ecmaVersion: 2024,
    parser: babelParser,
    parserOptions: {
      sourceType: 'module',
      requireConfigFile: false,
      babelOptions: {
        babelrc: false,
        configFile: false,
        plugins: ['@babel/plugin-syntax-import-assertions'],
        presets: [[babelPresetEnv]],
      },
    },
  },
  rules: {
    ...commonRules,
    semi: ['error', 'always'],
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};

const tsConfig = {
  files: ['**/*.{ts,tsx,mts}'],
  plugins: {
    'es-x': pluginESx,
    '@typescript-eslint': typescript,
    import: importPlugin,
  },
  languageOptions: {
    ecmaVersion: 2024,
    parser: tsParser,
    parserOptions: {
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
      },
      project: './tsconfig.json',
      createDefaultProgram: true,
    },
  },
  rules: {
    ...commonRules,
    ...typescript.configs['recommended'].rules,
    'no-shadow': 'off',
    '@typescript-eslint/strict-boolean-expressions': 'error',
    '@typescript-eslint/no-unnecessary-condition': 'error',
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      { allowExpressions: true },
    ],
    '@typescript-eslint/explicit-member-accessibility': 'off',
    '@typescript-eslint/no-use-before-define': [
      'error',
      { functions: false, classes: false, typedefs: false },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
    ],
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'warn',
      {
        name: 'react-redux',
        importNames: ['useSelector', 'useDispatch'],
        message:
          'Use typed hooks `useAppDispatch` and `useAppSelector` instead.',
      },
    ],
  },
};

const jsonConfig = {
  files: ['**/*.json'],
  plugins: { json },
  processor: 'json/json',
  languageOptions: {
    ecmaVersion: 2024,
  },
  rules: {
    'json/*': ['error', { allowComments: true }],
  },
};

// const vitestConfig = {
//   files: ['**/vitest.config.js', 'vitest.workspace.js'],
//   plugins: {
//     'es-x': pluginESx,
//     import: importPlugin,
//   },
//   languageOptions: {
//     ecmaVersion: 2024,
//     parser: babelParser,
//     parserOptions: {
//       sourceType: 'module',
//       requireConfigFile: false,
//       babelOptions: {
//         babelrc: false,
//         configFile: false,
//         plugins: ['@babel/plugin-syntax-import-assertions'],
//         presets: [[babelPresetEnv]],
//       },
//     },
//     globals: {
//       ...globals.node,
//     },
//   },
//   rules: {
//     ...commonRules,
//   },
// };

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ['**/eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      parser: babelParser,
      parserOptions: {
        sourceType: 'module',
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: [[babelPresetEnv]],
        },
      },
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/.cache/**',
      '**/bundled/**',
      '**/build/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/test/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,mts}'],
    plugins: {
      'optimize-regex': optimizeRegexPlugin,
      promise: promisePlugin,
      oxlint: oxlintPlugin,
    },
    languageOptions: {
      ecmaVersion: 2024,
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {},
  },
  // vitestConfig,
  jsConfig,
  tsConfig,
  jsonConfig,
  nodePlugin.configs['flat/recommended-script'],
  {
    rules: {
      'n/no-missing-import': 'off',
    },
  },
];
