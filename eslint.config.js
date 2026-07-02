const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');

module.exports = [
  {
    ignores: [
      'artifacts/**',
      'backend/dist/**',
      'backend/node_modules/**',
      'frontend/dist/**',
      'frontend/node_modules/**',
      'node_modules/**',
      'public-export/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules
    }
  },
  {
    files: ['scripts/**/*.js', 'tests/playwright/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  }
];
