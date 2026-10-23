import { afterEach, expect, it, vi } from 'vitest'
import plugin from '../app/plugins/storage.client'

const { initializeApplication, useState } = vi.hoisted(() => ({
  initializeApplication: vi.fn(),
  useState: vi.fn(),
}))
vi.mock('../app/api', () => ({ initializeApplication }))
vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: (setup: unknown) => setup,
  useState,
  showError: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('waits for the exclusive app lock before initializing storage and rendering, then holds it', async () => {
  const ready = { value: false }
  const initialized = Promise.withResolvers<undefined>()
  initializeApplication.mockReturnValue(initialized.promise)
  const request = vi.fn().mockReturnValue(Promise.withResolvers<never>().promise)
  vi.stubGlobal('navigator', { locks: { request } })
  useState.mockReturnValue(ready)
  expect(plugin({} as never)).toBeUndefined()
  expect(request).toHaveBeenCalledWith(
    'ai-on-the-clocktower',
    { mode: 'exclusive' },
    expect.any(Function),
  )
  expect(initializeApplication).not.toHaveBeenCalled()
  expect(ready.value).toBe(false)

  const acquired = request.mock.lastCall?.[2] as () => Promise<void>
  const released = vi.fn()
  void acquired().then(released)
  expect(initializeApplication).toHaveBeenCalledOnce()
  expect(ready.value).toBe(false)

  initialized.resolve(undefined)
  await initialized.promise
  expect(ready.value).toBe(true)
  expect(released).not.toHaveBeenCalled()
})
