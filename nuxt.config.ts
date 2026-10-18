import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['shadcn-nuxt', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  devServer: { host: '127.0.0.1' },
  shadcn: { prefix: '', componentDir: '~/components/ui' },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'zh',
    locales: [
      { code: 'zh', language: 'zh-CN', files: ['zh.json', 'models.zh.json', 'new.zh.json'] },
      { code: 'en', language: 'en-US', files: ['en.json', 'models.en.json', 'new.en.json'] },
    ],
    detectBrowserLanguage: false,
  },
})
