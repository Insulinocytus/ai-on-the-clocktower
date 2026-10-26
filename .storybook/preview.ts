import type { Preview } from '@storybook-vue/nuxt'
import { tryUseNuxtApp } from 'nuxt/app'
import { sb } from 'storybook/test'
import { LOCALE_KEY } from '../app/plugins/locale'

sb.mock(import('../app/api/index.ts'))

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Palette',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['night', 'day'], dynamicTitle: true },
    },
    locale: {
      description: 'Interface language',
      toolbar: { title: 'Locale', icon: 'globe', items: ['zh', 'en'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'night', locale: 'zh' },
  parameters: {
    a11y: { test: 'error' },
  },
  // The locale plugin reads the choice when a story's Nuxt app is created; toolbar changes reuse the live app.
  beforeEach: async ({ globals }) => {
    const locale = globals.locale as 'zh' | 'en'
    document.documentElement.dataset.theme = globals.theme as string
    localStorage.setItem(LOCALE_KEY, locale)
    await tryUseNuxtApp()?.$i18n.setLocale(locale)
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div class="grain min-h-screen bg-paper text-ink"><story /></div>',
    }),
  ],
}

export default preview
