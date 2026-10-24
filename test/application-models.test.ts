import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import {
  createPreset,
  createProvider,
  deletePreset,
  deleteProvider,
  initializeApplication,
  listPresets,
  listProviders,
  requireModelRecord,
  updatePreset,
  updateProvider,
} from '../app/api'
import { inTransaction } from '../app/api/storage'

const SECRET = 'sk-test-secret-value'

const providerInput = {
  name: 'Local',
  baseUrl: 'http://127.0.0.1:1/v1',
  apiFormat: 'openai_completions',
  apiKey: SECRET,
}

describe('application providers', () => {
  it('stores the API key and defaults timeout to 300s and concurrency to 5', async () => {
    const created = await createProvider(providerInput)
    expect(created).toMatchObject({ timeoutSec: 300, maxConcurrency: 5, apiKey: SECRET })
    expect(created).not.toHaveProperty('apiKeyEnv')
    expect(created).not.toHaveProperty('apiKeySet')
    expect(await listProviders()).toContainEqual(created)
  })

  it('reads model records within transactions and only constructs missing-record errors on failure', async () => {
    const provider = await createProvider(providerInput)
    const preset = await createPreset({ name: 'Lookup', providerId: provider.id, model: 'm' })
    const missing = new Error('Missing model')
    const makeError = vi.fn(() => missing)
    expect(await requireModelRecord('providers', provider.id, undefined, makeError)).toEqual(
      provider,
    )
    expect(makeError).not.toHaveBeenCalled()
    expect(
      await inTransaction('presets', 'readonly', (transaction) =>
        requireModelRecord('presets', preset.id, transaction),
      ),
    ).toEqual(preset)
    await expect(requireModelRecord('providers', -1)).rejects.toThrow('Provider not found')
    await expect(requireModelRecord('presets', -1)).rejects.toThrow('Not found')
    await expect(requireModelRecord('providers', -1, undefined, makeError)).rejects.toBe(missing)
    expect(makeError).toHaveBeenCalledOnce()
  })

  it('updates and deletes providers, rejecting missing records', async () => {
    const { id } = await createProvider({ ...providerInput, name: 'Before' })
    const updated = await updateProvider(id, {
      ...providerInput,
      name: 'After',
      baseUrl: 'http://127.0.0.1:2/v1',
      apiKey: 'replacement-key',
      timeoutSec: 10,
      maxConcurrency: 2,
    })
    expect(updated).toMatchObject({
      id,
      name: 'After',
      apiKey: 'replacement-key',
      timeoutSec: 10,
      maxConcurrency: 2,
    })
    expect(await listProviders()).toContainEqual(updated)
    await deleteProvider(id)
    expect((await listProviders()).map((provider) => provider.id)).not.toContain(id)
    await expect(deleteProvider(id)).rejects.toThrow('Not found')
    await expect(updateProvider(id, providerInput)).rejects.toThrow('Not found')
  })

  it.each([undefined, '', '   '])(
    'requires an API key (%s) with validation issues on create and update',
    async (apiKey) => {
      const input = { ...providerInput, apiKey }
      const issues = {
        issues: expect.arrayContaining([expect.objectContaining({ path: ['apiKey'] })]) as unknown,
      }
      await expect(createProvider(input)).rejects.toMatchObject(issues)
      const saved = await createProvider(providerInput)
      await expect(updateProvider(saved.id, input)).rejects.toMatchObject(issues)
      expect(await listProviders()).toContainEqual(saved)
    },
  )

  it.each([undefined, 'gemini'])(
    'requires a known API format (%s) on create and update',
    async (apiFormat) => {
      const input = { ...providerInput, apiFormat }
      const issues = {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['apiFormat'] }),
        ]) as unknown,
      }
      await expect(createProvider(input)).rejects.toMatchObject(issues)
      const saved = await createProvider({ ...providerInput, apiFormat: 'anthropic_messages' })
      await expect(updateProvider(saved.id, input)).rejects.toMatchObject(issues)
      expect(await listProviders()).toContainEqual(saved)
    },
  )

  it.each([NaN, Infinity, 0.5])(
    'rejects invalid record IDs (%s) with validation issues',
    async (id) => {
      const issues = {
        issues: expect.arrayContaining([expect.objectContaining({ path: ['id'] })]) as unknown,
      }
      await expect(updateProvider(id, providerInput)).rejects.toMatchObject(issues)
      await expect(deleteProvider(id)).rejects.toMatchObject(issues)
      await expect(
        updatePreset(id, { name: 'P', providerId: 1, model: 'm' }),
      ).rejects.toMatchObject(issues)
      await expect(deletePreset(id)).rejects.toMatchObject(issues)
    },
  )

  it('keeps storage usable when persistent storage permission fails', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    })
    try {
      await initializeApplication()
      const provider = await createProvider({ ...providerInput, name: 'Without persistence' })
      expect(await listProviders()).toContainEqual(provider)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requests persistent storage at startup and retains providers and presets after module reload', async () => {
    const persist = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('navigator', { storage: { persist } })
    try {
      await initializeApplication()
      expect(persist).toHaveBeenCalledOnce()
      const provider = await createProvider(providerInput)
      const preset = await createPreset({ name: 'Persisted', providerId: provider.id, model: 'm' })
      vi.resetModules()
      // A fresh module instance simulates a page reload without clearing IndexedDB.
      const reloaded = await import('../app/api')
      expect(await reloaded.listProviders()).toContainEqual(provider)
      expect(await reloaded.listPresets()).toContainEqual(preset)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('application presets', () => {
  it('stores presets with a JSON-object extraBody and rejects malformed input with issues', async () => {
    const provider = await createProvider(providerInput)
    const preset = (extraBody: string) => ({
      name: 'Preset',
      providerId: provider.id,
      model: 'm',
      extraBody,
    })
    for (const extraBody of ['{"max_tokens": ', '[1]', 'null']) {
      await expect(createPreset(preset(extraBody))).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['extraBody'],
            message: 'extraBody must be a JSON object',
          }),
        ]) as unknown,
      })
    }
    const saved = await createPreset(preset('{"max_tokens": 64}'))
    expect(saved).toMatchObject({ forceToolChoice: false, extraBody: '{"max_tokens": 64}' })
    expect(await listPresets()).toContainEqual(saved)
    await expect(createPreset({ ...preset('{}'), providerId: -1 })).rejects.toThrow(
      'Provider -1 does not exist',
    )
  })

  it('updates and deletes presets and cascades provider deletion without touching other presets', async () => {
    const provider = await createProvider(providerInput)
    const other = await createProvider({ ...providerInput, name: 'Other' })
    const input = { name: 'Before', providerId: provider.id, model: 'm' }
    const preset = await createPreset(input)
    const updated = await updatePreset(preset.id, {
      ...input,
      name: 'After',
      model: 'updated',
      forceToolChoice: true,
      extraBody: '{"max_tokens":32}',
    })
    expect(updated).toEqual({
      ...input,
      id: preset.id,
      name: 'After',
      model: 'updated',
      forceToolChoice: true,
      extraBody: '{"max_tokens":32}',
    })
    expect(await listPresets()).toContainEqual(updated)
    await expect(updatePreset(preset.id, { ...input, providerId: -1 })).rejects.toThrow(
      'Provider -1 does not exist',
    )
    await expect(updatePreset(preset.id, { ...input, extraBody: '[]' })).rejects.toMatchObject({
      issues: expect.any(Array) as unknown,
    })
    await deletePreset(preset.id)
    expect((await listPresets()).map(({ id }) => id)).not.toContain(preset.id)
    await expect(deletePreset(preset.id)).rejects.toThrow('Not found')
    await expect(updatePreset(preset.id, input)).rejects.toThrow('Not found')

    const cascaded = await createPreset(input)
    const untouched = await createPreset({ ...input, providerId: other.id })
    await deleteProvider(provider.id)
    const remaining = await listPresets()
    expect(remaining).not.toContainEqual(cascaded)
    expect(remaining).toContainEqual(untouched)
  })
})
