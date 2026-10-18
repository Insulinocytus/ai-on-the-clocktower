// @ts-check
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import tseslint from 'typescript-eslint'
import withNuxt from './.nuxt/eslint.config.mjs'

/** @param {readonly { rules?: object }[]} configs */
const rulesOf = (configs) => Object.assign({}, ...configs.map((config) => config.rules))

// Only rules are layered on top of Nuxt, so its vue-eslint-parser + TS parser wiring for .vue stays intact.
export default withNuxt(
  {
    files: ['**/*.{ts,mts,cts,vue}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      ...rulesOf(tseslint.configs.strictTypeChecked),
      ...rulesOf(tseslint.configs.stylisticTypeChecked),
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  comments.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
      // Formatting belongs to Prettier, which self-closes void elements and would fight this rule.
      'vue/html-self-closing': 'off',
    },
  },
  {
    // shadcn-vue components declare optional TS props (e.g. `class`) without defaults throughout; undefined is the intended default.
    files: ['app/components/ui/**/*.vue'],
    rules: { 'vue/require-default-prop': 'off' },
  },
)
