import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { useState } = vi.hoisted(() => ({ useState: vi.fn() }))
vi.mock('nuxt/app', () => ({
  defineNuxtPlugin: (setup: unknown) => setup,
  useState,
  showError: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('renders only after acquiring the app lock and opening storage, without waiting for persistence permission', async () => {
  // Reload the plugin's storage dependency to simulate a fresh document.
  const { default: plugin } = await import('../app/plugins/storage.client')
  const ready = { value: undefined as boolean | undefined }
  const persist = vi.fn().mockReturnValue(Promise.withResolvers<boolean>().promise)
  const request = vi.fn().mockReturnValue(Promise.withResolvers<never>().promise)
  const open = vi.spyOn(indexedDB, 'open')
  vi.stubGlobal('navigator', { locks: { request }, storage: { persist } })
  useState.mockReturnValue(ready)
  expect(plugin({} as never)).toBeUndefined()
  expect(request).toHaveBeenCalledWith(
    'ai-on-the-clocktower',
    { mode: 'exclusive', ifAvailable: true },
    expect.any(Function),
  )
  expect(open).not.toHaveBeenCalled()
  expect(ready.value).toBeUndefined()

  const acquired = request.mock.lastCall?.[2] as (lock: Lock) => Promise<void>
  const released = vi.fn()
  void acquired({} as Lock).then(released)
  expect(open).toHaveBeenCalledOnce()
  expect(ready.value).toBeUndefined()

  await vi.waitFor(() => {
    expect(ready.value).toBe(true)
  })
  expect(persist).toHaveBeenCalledOnce()
  expect(released).not.toHaveBeenCalled()
})

it('shows a blocked warning only when another tab owns the lock and automatically starts after it closes', async () => {
  // Reload the plugin's storage dependency to simulate a fresh document.
  const { default: plugin } = await import('../app/plugins/storage.client')
  const ready = { value: undefined as boolean | undefined }
  const request = vi.fn().mockReturnValue(Promise.withResolvers<never>().promise)
  const open = vi.spyOn(indexedDB, 'open')
  vi.stubGlobal('navigator', {
    locks: { request },
    storage: { persist: vi.fn().mockResolvedValue(false) },
  })
  useState.mockReturnValue(ready)
  void plugin({} as never)
  expect(ready.value).toBeUndefined()

  const unavailable = request.mock.lastCall?.[2] as (lock: null) => Promise<void>
  void unavailable(null)
  expect(ready.value).toBe(false)
  expect(open).not.toHaveBeenCalled()
  expect(request).toHaveBeenLastCalledWith(
    'ai-on-the-clocktower',
    { mode: 'exclusive' },
    expect.any(Function),
  )

  const acquired = request.mock.lastCall?.[2] as () => Promise<void>
  void acquired()
  expect(ready.value).toBeUndefined()
  await vi.waitFor(() => {
    expect(ready.value).toBe(true)
  })
})
