import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // Single-user local tool: client-rendered only, so locale detection and shadcn components need no hydration.
  ssr: false,
  modules: ['@nuxt/eslint', '@nuxtjs/i18n', 'shadcn-nuxt'],
  css: ['~/assets/css/tailwind.css', 'vue-sonner/style.css'],
  vite: { plugins: [tailwindcss()] },
  devServer: { host: '127.0.0.1' },
  runtimeConfig: { dbPath: '.data/app.db' },
  routeRules: { '/': { redirect: '/models' } },
  shadcn: { prefix: '', componentDir: '~/components/ui' },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    // Browser-language detection and persistence live in app/plugins/locale.ts (localStorage, not cookies).
    detectBrowserLanguage: false,
    locales: [
      { code: 'zh', language: 'zh-CN', name: '中文', file: 'zh.json' },
      { code: 'en', language: 'en-US', name: 'EN', file: 'en.json' },
    ],
  },
  typescript: {
    tsConfig: { compilerOptions: { noImplicitReturns: true, noFallthroughCasesInSwitch: true } },
    nodeTsConfig: { include: ['../test/**/*', '../vitest.config.ts', '../scripts/**/*'] },
  },
})
