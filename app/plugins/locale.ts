export const LOCALE_KEY = 'locale'

// Interface language: the saved choice wins; on first visit, follow the browser.
export default defineNuxtPlugin({
  name: 'locale',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const saved = localStorage.getItem(LOCALE_KEY)
    const browser = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    await nuxtApp.$i18n.setLocale(saved === 'zh' || saved === 'en' ? saved : browser)
  },
})
