// Lint rules. Besides ordinary correctness checks this enforces the XSS policy for the code that ships to users (src/):
// nothing may turn a string into markup or code. Translations arrive from third-party services and transcripts from speech
// recognition, so the UI is built node by node (core/dom.js h() / icon()) and text goes in as text nodes.
//   npm run lint        (runs automatically before npm test)

import js from '@eslint/js';
import globals from 'globals';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

const why = 'Strings must never become markup: build nodes with h() / icon() and set text with textContent (see core/dom.js).';

const SYNTAX = [
  { selector: "NewExpression[callee.name='DOMParser']", message: 'Do not parse HTML strings (' + why + ')' },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^on/i]", message: 'No inline event handlers: use addEventListener.' },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value='style']", message: 'The CSP blocks style attributes: set el.style.<prop> instead.' },
  { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
  { selector: "NewExpression[callee.name='Function']", message: 'No new Function.' },
  { selector: "CallExpression[callee.name=/^(alert|confirm|prompt)$/], CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]", message: 'Native dialogs look foreign in an installed app: use the toast or a sheet.' },
];

const rules = {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'warn',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', '.netlify/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, __APP_VERSION__: 'readonly' } },
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      ...rules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-restricted-syntax': ['error', ...SYNTAX],
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: why },
        { property: 'outerHTML', message: why },
        { property: 'insertAdjacentHTML', message: why },
        { object: 'document', property: 'write', message: why },
      ],
    },
  },
  { files: ['src/sw.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.serviceworker } } },
  { files: ['src/theme-boot.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } } },
  {
    files: ['tools/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules,
  },
];
