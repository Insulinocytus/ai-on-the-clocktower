import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Provider, TrialResult } from '../shared/types/models'
import { startFakeProvider, type FakeProvider } from './fake-provider'

const SECRET = 'sk-test-secret-value'

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  server: true,
  browser: false,
  env: {
    NUXT_DB_PATH: join(mkdtempSync(join(tmpdir(), 'clocktower-')), 'app.db'),
    CLOCKTOWER_TEST_KEY: SECRET,
  },
})

const createProvider = (body: Record<string, unknown>) =>
  $fetch<Provider>('/api/providers', { method: 'POST', body })

describe('providers', () => {
  it('defaults timeout to 300s and concurrency to 5, and only reports whether the key is set', async () => {
    const created = await createProvider({
      name: 'Local',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'CLOCKTOWER_TEST_KEY',
    })
    expect(created).toMatchObject({ timeoutSec: 300, maxConcurrency: 5, apiKeySet: true })

    const unset = await createProvider({
      name: 'Other',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'CLOCKTOWER_UNSET_KEY',
    })
    expect(unset.apiKeySet).toBe(false)

    const listText = await (await fetch('/api/providers')).text()
    expect(listText).not.toContain(SECRET)
    expect(JSON.parse(listText)).toEqual(expect.arrayContaining([created, unset]))
  })

  it('updates and deletes', async () => {
    const { id } = await createProvider({
      name: 'Before',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'X',
    })
    const updated = await $fetch<Provider>(`/api/providers/${String(id)}`, {
      method: 'PUT',
      body: {
        name: 'After',
        baseUrl: 'http://127.0.0.1:2/v1',
        apiKeyEnv: 'Y',
        timeoutSec: 10,
        maxConcurrency: 2,
      },
    })
    expect(updated).toMatchObject({ id, name: 'After', timeoutSec: 10, maxConcurrency: 2 })

    await $fetch(`/api/providers/${String(id)}`, { method: 'DELETE' })
    const list = await $fetch<Provider[]>('/api/providers')
    expect(list.map((p) => p.id)).not.toContain(id)
    expect((await fetch(`/api/providers/${String(id)}`, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('presets', () => {
  it('rejects extraBody that is not a JSON object, and saves one that is', async () => {
    const provider = await createProvider({
      name: 'P',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'X',
    })
    const preset = (extraBody: string) => ({
      name: 'Preset',
      providerId: provider.id,
      model: 'm',
      extraBody,
    })
    for (const bad of ['{"max_tokens": ', '[1]', 'null']) {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preset(bad)),
      })
      expect(res.status, bad).toBe(400)
    }

    const saved = await $fetch('/api/presets', {
      method: 'POST',
      body: preset('{"max_tokens": 64}'),
    })
    expect(saved).toMatchObject({ forceToolChoice: false, extraBody: '{"max_tokens": 64}' })
  })
})

interface ToolDef {
  type: 'function'
  function: {
    name: string
    parameters: { properties: Record<string, Record<string, unknown>>; required: string[] }
  }
}

describe('trial call', () => {
  let fake: FakeProvider
  beforeAll(async () => {
    fake = await startFakeProvider()
  })
  afterAll(() => fake.close())

  async function trial(
    preset: { forceToolChoice?: boolean; extraBody?: string } = {},
    provider: { apiKeyEnv?: string; timeoutSec?: number } = {},
  ) {
    const { id: providerId } = await createProvider({
      name: 'Fake',
      baseUrl: fake.baseUrl,
      apiKeyEnv: 'CLOCKTOWER_TEST_KEY',
      ...provider,
    })
    const { id } = await $fetch<{ id: number }>('/api/presets', {
      method: 'POST',
      body: { name: 'Trial', providerId, model: 'fake-model', ...preset },
    })
    const before = fake.requests.length
    const result = await $fetch<TrialResult>(`/api/presets/${String(id)}/trial`, {
      method: 'POST',
      body: { lang: 'en' },
    })
    return { result, requests: fake.requests.slice(before) }
  }

  const speak = JSON.stringify({ reasoning: 'r', speech: 'Hello, table.', slayer_target: null })

  it('sends the six tools with forced tool_choice and merged extra_body, and reports a valid tool call', async () => {
    fake.script({ kind: 'toolCall', name: 'speak', arguments: speak })
    const { result, requests } = await trial({
      forceToolChoice: true,
      extraBody: '{"max_tokens": 512, "provider": {"require_parameters": true}}',
    })

    expect(result).toMatchObject({
      valid: true,
      toolCall: { name: 'speak', arguments: JSON.parse(speak) as unknown },
      raw: { id: 'chatcmpl-fake' },
    })
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request?.headers.authorization).toBe(`Bearer ${SECRET}`)
    const body = request?.body ?? {}
    expect(body).toMatchObject({
      model: 'fake-model',
      max_tokens: 512,
      provider: { require_parameters: true },
      tool_choice: { type: 'function', function: { name: 'speak' } },
    })
    expect(body).not.toHaveProperty('temperature')

    const tools = body.tools as ToolDef[]
    expect(tools.map((t) => t.function.name)).toEqual([
      'speak',
      'propose_whisper',
      'rank_whispers',
      'nominate',
      'vote',
      'night_choice',
    ])
    for (const { function: fn } of tools) {
      const keys = Object.keys(fn.parameters.properties)
      expect(keys[0], fn.name).toBe('reasoning')
      expect(keys.at(-1), fn.name).toBe('memo')
      expect(fn.parameters.properties.memo).toMatchObject({ type: 'string', maxLength: 2000 })
      expect(fn.parameters.required).toContain('reasoning')
      expect(fn.parameters.required).not.toContain('memo')
    }
    const seats = [1, 2, 3, 4, 5]
    const props = (name: string) =>
      tools.find((t) => t.function.name === name)?.function.parameters.properties
    expect(props('night_choice')?.targets?.items).toEqual({ type: 'integer', enum: seats })
    expect(props('nominate')?.nominee).toMatchObject({
      type: ['integer', 'null'],
      enum: [...seats, null],
    })
  })

  it('omits tool_choice when the preset does not allow forcing it', async () => {
    fake.script({ kind: 'toolCall', name: 'speak', arguments: speak })
    const { result, requests } = await trial({ forceToolChoice: false })
    expect(result.valid).toBe(true)
    expect(requests[0]?.body).not.toHaveProperty('tool_choice')
  })

  it('does not let extra_body send temperature or force a disallowed tool_choice', async () => {
    fake.script({ kind: 'toolCall', name: 'speak', arguments: speak })
    const { result, requests } = await trial({
      forceToolChoice: false,
      extraBody: '{"temperature":0.7,"tool_choice":"required","max_tokens":64}',
    })
    expect(result.valid).toBe(true)
    expect(requests[0]?.body).toMatchObject({ max_tokens: 64 })
    expect(requests[0]?.body).not.toHaveProperty('temperature')
    expect(requests[0]?.body).not.toHaveProperty('tool_choice')
  })

  it.each([
    ['plain text instead of a tool call', { kind: 'text', content: 'Hello!' }],
    ['an unknown tool', { kind: 'toolCall', name: 'shout', arguments: speak }],
    [
      'a different valid game tool than requested',
      { kind: 'toolCall', name: 'vote', arguments: '{"reasoning":"r","raise_hand":true}' },
    ],
    ['malformed arguments', { kind: 'toolCall', name: 'speak', arguments: '{"reasoning": ' }],
    [
      'a seat outside 1..N',
      {
        kind: 'toolCall',
        name: 'speak',
        arguments: '{"reasoning":"r","speech":"hi","slayer_target":6}',
      },
    ],
    [
      'a memo over 2000 characters',
      {
        kind: 'toolCall',
        name: 'speak',
        arguments: JSON.stringify({
          reasoning: 'r',
          speech: 'hi',
          slayer_target: null,
          memo: 'x'.repeat(2001),
        }),
      },
    ],
  ] as const)('reports %s as invalid, with the raw response', async (_, step) => {
    fake.script(step)
    const { result } = await trial()
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.raw).toMatchObject({ id: 'chatcmpl-fake' })
  })

  it('reports HTTP failures with status and Retry-After', async () => {
    fake.script({ kind: 'rateLimit', retryAfterSec: 7 }, { kind: 'serverError', status: 503 })
    const limited = (await trial()).result
    expect(limited).toMatchObject({ valid: false })
    expect(limited.error).toContain('429')
    expect(limited.error).toContain('Retry-After: 7')
    const failed = (await trial()).result
    expect(failed.error).toContain('503')
  })

  it('gives up after the provider timeout', async () => {
    fake.script({ kind: 'hang' })
    const { result } = await trial({}, { timeoutSec: 1 })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timed out/i)
  })

  it('does not call the provider when its key variable is unset', async () => {
    const { result, requests } = await trial({}, { apiKeyEnv: 'CLOCKTOWER_UNSET_KEY' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('CLOCKTOWER_UNSET_KEY')
    expect(requests).toHaveLength(0)
  })
})
