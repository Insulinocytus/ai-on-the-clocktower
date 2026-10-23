import { defineNuxtPlugin, showError, useState } from 'nuxt/app'
import { initializeApplication } from '../api'

export default defineNuxtPlugin((nuxtApp) => {
  const ready = useState('application-ready', () => false)
  void navigator.locks
    .request('ai-on-the-clocktower', { mode: 'exclusive' }, async () => {
      await initializeApplication()
      ready.value = true
      // Keep the lock until the browser destroys this document.
      await Promise.withResolvers<never>().promise
    })
    .catch((error: unknown) => {
      void nuxtApp.runWithContext(() => showError(error instanceof Error ? error : String(error)))
    })
})
