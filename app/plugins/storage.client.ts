import { defineNuxtPlugin, showError, useState } from 'nuxt/app'
import { initializeApplication } from '../api'
import { APPLICATION_READY_KEY } from '../utils/application'

export default defineNuxtPlugin((nuxtApp) => {
  const ready = useState<boolean | undefined>(APPLICATION_READY_KEY, () => undefined)
  async function initialize() {
    ready.value = undefined
    await initializeApplication()
    ready.value = true
    // Keep the lock until the browser destroys this document.
    await Promise.withResolvers<never>().promise
  }
  void navigator.locks
    .request('ai-on-the-clocktower', { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (lock) return initialize()
      ready.value = false
      return navigator.locks.request('ai-on-the-clocktower', { mode: 'exclusive' }, initialize)
    })
    .catch((error: unknown) => {
      void nuxtApp.runWithContext(() => showError(error instanceof Error ? error : String(error)))
    })
})
