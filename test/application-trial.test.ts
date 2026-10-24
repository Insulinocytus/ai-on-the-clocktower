import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPreset, createProvider, trialPreset } from '../app/api'
import { startFakeProvider, type FakeProvider } from './fake-provider'
import type { ApiFormat } from '../shared/types/models'

const SECRET = 'sk-test-secret-value'
const speak = JSON.stringify({
  reasoning_summary: 'r',
  speech: 'Hello, table.',
  slayer_target: null,
})

interface ToolDef {
  type: 'function'
  function: {
    name: string
    parameters: { properties: Record<string, Record<string, unknown>>; required: string[] }
  }
}

describe('application trial call', () => {
  let fake: FakeProvider
  beforeAll(async () => {
    fake = await startFakeProvider()
  })
  afterAll(() => fake.close())

  async function trial(
    preset: { forceToolChoice?: boolean; extraBody?: string } = {},
    provider: { timeoutSec?: number; maxConcurrency?: number } = {},
  ) {
    const { id: providerId } = await createProvider({
      name: 'Fake',
      baseUrl: fake.baseUrl,
      apiFormat: fake.apiFormat,
      apiKey: SECRET,
      ...provider,
    })
    const { id } = await createPreset({ name: 'Trial', providerId, model: 'fake-model', ...preset })
    const before = fake.requests.length
    const result = await trialPreset(id, { lang: 'en' })
    return { result, requests: fake.requests.slice(before) }
  }

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
    expect(tools.map((tool) => tool.function.name)).toEqual([
      'speak',
      'propose_whisper',
      'rank_whispers',
      'nominate',
      'vote',
      'night_choice',
    ])
    for (const { function: fn } of tools) {
      expect(Object.keys(fn.parameters.properties)[0], fn.name).toBe('reasoning_summary')
      expect(fn.parameters.properties.reasoning_summary).toMatchObject({
        type: 'string',
        maxLength: 500,
      })
      expect(fn.parameters.required).toContain('reasoning_summary')
      expect(fn.parameters.properties).not.toHaveProperty('memo')
    }
    expect(
      tools.find((tool) => tool.function.name === 'night_choice')?.function.parameters.properties
        .targets?.items,
    ).toEqual({ type: 'integer', enum: [1, 2, 3, 4, 5] })
    expect(
      tools.find((tool) => tool.function.name === 'nominate')?.function.parameters.properties
        .nominee,
    ).toMatchObject({ type: ['integer', 'null'], enum: [1, 2, 3, 4, 5, null] })
  })

  it('omits tool_choice when the preset does not allow forcing it', async () => {
    fake.script({ kind: 'toolCall', name: 'speak', arguments: speak })
    const { result, requests } = await trial({ forceToolChoice: false })
    expect(result.valid).toBe(true)
    expect(requests[0]?.body).not.toHaveProperty('tool_choice')
  })

  it('does not let extra_body override core fields, send temperature or force a disallowed tool_choice', async () => {
    fake.script({ kind: 'toolCall', name: 'speak', arguments: speak })
    const { result, requests } = await trial({
      forceToolChoice: false,
      extraBody:
        '{"temperature":0.7,"tool_choice":"required","max_tokens":64,"model":"wrong","messages":[],"tools":[]}',
    })
    expect(result.valid).toBe(true)
    expect(requests[0]?.body).toMatchObject({ max_tokens: 64, model: 'fake-model' })
    expect(requests[0]?.body.messages).toHaveLength(2)
    expect(requests[0]?.body.tools).toHaveLength(6)
    expect(requests[0]?.body).not.toHaveProperty('temperature')
    expect(requests[0]?.body).not.toHaveProperty('tool_choice')
  })

  it.each([
    ['plain text instead of a tool call', { kind: 'text', content: 'Hello!' }],
    ['an unknown tool', { kind: 'toolCall', name: 'shout', arguments: speak }],
    [
      'a different valid game tool than requested',
      { kind: 'toolCall', name: 'vote', arguments: '{"reasoning_summary":"r","raise_hand":true}' },
    ],
    [
      'malformed arguments',
      { kind: 'toolCall', name: 'speak', arguments: '{"reasoning_summary": ' },
    ],
    [
      'a seat outside 1..N',
      {
        kind: 'toolCall',
        name: 'speak',
        arguments: '{"reasoning_summary":"r","speech":"hi","slayer_target":6}',
      },
    ],
    [
      'a reasoning summary over 500 characters',
      {
        kind: 'toolCall',
        name: 'speak',
        arguments: JSON.stringify({
          reasoning_summary: 'x'.repeat(501),
          speech: 'hi',
          slayer_target: null,
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

  it('reports HTTP failures with status and Retry-After without retrying a trial', async () => {
    fake.script({ kind: 'rateLimit', retryAfterSec: 7 }, { kind: 'serverError', status: 503 })
    const limited = (await trial()).result
    expect(limited).toMatchObject({ valid: false })
    expect(limited.error).toContain('429')
    expect(limited.error).toContain('Retry-After: 7')
    expect(limited.raw).toContain('rate limited')
    const failed = (await trial()).result
    expect(failed.error).toContain('503')
  })

  it('gives up after the provider timeout', async () => {
    fake.script({ kind: 'hang' })
    const { result } = await trial({}, { timeoutSec: 1 })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/timed out/i)
  })

  it.each([
    ['connection interruption', { kind: 'disconnect' }],
    ['truncated response', { kind: 'truncated' }],
  ] as const)('reports %s as a network failure', async (_, step) => {
    fake.script(step)
    expect((await trial()).result).toMatchObject({
      valid: false,
      error: expect.stringContaining('Request failed') as unknown,
      raw: null,
    })
  })

  it('validates the preset and language before making a request', async () => {
    const before = fake.requests.length
    await expect(trialPreset(-1, { lang: 'en' })).rejects.toThrow('Not found')
    await expect(trialPreset(1, { lang: 'bad' })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['lang'] })]) as unknown,
    })
    expect(fake.requests).toHaveLength(before)
  })

  it('shares the concurrency queue across a provider’s presets but not across providers', async () => {
    const provider = await createProvider({
      name: 'Limited',
      baseUrl: fake.baseUrl,
      apiFormat: fake.apiFormat,
      apiKey: SECRET,
      maxConcurrency: 1,
    })
    const first = await createPreset({ name: 'First', model: 'first', providerId: provider.id })
    const second = await createPreset({ name: 'Second', model: 'second', providerId: provider.id })
    const gate = Promise.withResolvers<undefined>()
    fake.script(
      { kind: 'toolCall', name: 'speak', arguments: speak, waitFor: gate.promise },
      { kind: 'toolCall', name: 'speak', arguments: speak },
      { kind: 'toolCall', name: 'speak', arguments: speak },
    )
    const before = fake.requests.length
    const running = trialPreset(first.id, { lang: 'en' })
    await expect.poll(() => fake.requests.length).toBe(before + 1)
    const queued = trialPreset(second.id, { lang: 'en' })
    try {
      expect((await trial()).result.valid).toBe(true)
      expect(fake.requests.slice(before).map(({ body }) => body.model)).toEqual([
        'first',
        'fake-model',
      ])
    } finally {
      gate.resolve(undefined)
    }
    expect((await running).valid).toBe(true)
    expect((await queued).valid).toBe(true)
    expect(fake.requests.slice(before).map(({ body }) => body.model)).toEqual([
      'first',
      'fake-model',
      'second',
    ])
  })

  it('cancels a queued call without dispatching it or blocking the next call', async () => {
    const provider = await createProvider({
      name: 'Queue',
      baseUrl: fake.baseUrl,
      apiFormat: fake.apiFormat,
      apiKey: SECRET,
      maxConcurrency: 1,
    })
    const preset = await createPreset({ name: 'Queued', model: 'queued', providerId: provider.id })
    const gate = Promise.withResolvers<undefined>()
    fake.script(
      { kind: 'toolCall', name: 'speak', arguments: speak, waitFor: gate.promise },
      { kind: 'toolCall', name: 'speak', arguments: speak },
      { kind: 'toolCall', name: 'speak', arguments: speak },
    )
    const before = fake.requests.length
    const running = trialPreset(preset.id, { lang: 'en' })
    await expect.poll(() => fake.requests.length).toBe(before + 1)
    const controller = new AbortController()
    const cancelled = trialPreset(preset.id, { lang: 'en' }, controller.signal)
    const reason = new Error('Cancel queued trial')
    const rejected = expect(cancelled).rejects.toBe(reason)
    const next = trialPreset(preset.id, { lang: 'en' })
    expect((await trial()).result.valid).toBe(true)
    controller.abort(reason)
    try {
      await rejected
      expect(fake.requests).toHaveLength(before + 2)
    } finally {
      gate.resolve(undefined)
    }
    expect((await running).valid).toBe(true)
    expect((await next).valid).toBe(true)
    expect(fake.requests).toHaveLength(before + 3)
  })

  it('cancels an active request and frees the provider slot', async () => {
    const provider = await createProvider({
      name: 'Cancel',
      baseUrl: fake.baseUrl,
      apiFormat: fake.apiFormat,
      apiKey: SECRET,
      maxConcurrency: 1,
    })
    const preset = await createPreset({ name: 'Active', model: 'active', providerId: provider.id })
    fake.script({ kind: 'hang' }, { kind: 'toolCall', name: 'speak', arguments: speak })
    const before = fake.requests.length
    const controller = new AbortController()
    const running = trialPreset(preset.id, { lang: 'en' }, controller.signal)
    const reason = new Error('Cancel active trial')
    const rejected = expect(running).rejects.toBe(reason)
    await expect.poll(() => fake.requests.length).toBe(before + 1)
    const next = trialPreset(preset.id, { lang: 'en' })
    controller.abort(reason)
    await rejected
    expect((await next).valid).toBe(true)
    await expect.poll(() => fake.requests[before]?.closed).toBe(true)
    expect(fake.requests).toHaveLength(before + 2)
  })
})

describe('trial call in other API formats', () => {
  async function trial(
    apiFormat: ApiFormat,
    step: Parameters<FakeProvider['script']>[0],
    preset: { forceToolChoice?: boolean; extraBody?: string } = {},
  ) {
    const fake = await startFakeProvider(undefined, undefined, apiFormat)
    try {
      fake.script(step)
      const { id: providerId } = await createProvider({
        name: apiFormat,
        baseUrl: fake.baseUrl,
        apiFormat,
        apiKey: SECRET,
      })
      const { id } = await createPreset({
        name: 'Trial',
        providerId,
        model: 'fake-model',
        ...preset,
      })
      const result = await trialPreset(id, { lang: 'en' })
      expect(fake.requests).toHaveLength(1)
      return { result, request: fake.requests[0] }
    } finally {
      await fake.close()
    }
  }
  const speakCall = { kind: 'toolCall', name: 'speak', arguments: speak } as const

  it('sends an OpenAI Responses request without temperature and with store off by default', async () => {
    const { result, request } = await trial('openai_responses', speakCall, {
      forceToolChoice: true,
      extraBody: '{"temperature":0.7,"reasoning":{"effort":"low"},"input":[],"model":"wrong"}',
    })
    expect(result).toMatchObject({
      valid: true,
      toolCall: { name: 'speak', arguments: JSON.parse(speak) as unknown },
      raw: { id: 'resp-fake' },
    })
    expect(request?.path).toBe('/v1/responses')
    expect(request?.headers.authorization).toBe(`Bearer ${SECRET}`)
    const body = request?.body ?? {}
    expect(body).toMatchObject({
      model: 'fake-model',
      store: false,
      reasoning: { effort: 'low' },
      tool_choice: { type: 'function', name: 'speak' },
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('messages')
    expect((body.input as { role: string }[]).map((item) => item.role)).toEqual(['system', 'user'])
    const tools = body.tools as Record<string, unknown>[]
    expect(tools).toHaveLength(6)
    expect(tools[0]).toMatchObject({
      type: 'function',
      name: 'speak',
      strict: false,
      parameters: { type: 'object' },
    })
    expect(tools[0]).not.toHaveProperty('function')
  })

  it('lets extra_body turn OpenAI Responses storage on and omits a disallowed tool_choice', async () => {
    const { result, request } = await trial('openai_responses', speakCall, {
      extraBody: '{"store":true,"tool_choice":"required"}',
    })
    expect(result.valid).toBe(true)
    expect(request?.body.store).toBe(true)
    expect(request?.body).not.toHaveProperty('tool_choice')
  })

  it('sends an Anthropic Messages request with browser headers, top-level system and default max_tokens', async () => {
    const { result, request } = await trial('anthropic_messages', speakCall, {
      forceToolChoice: true,
      extraBody: '{"temperature":0.7,"system":"wrong","messages":[]}',
    })
    expect(result).toMatchObject({
      valid: true,
      toolCall: { name: 'speak', arguments: JSON.parse(speak) as unknown },
      raw: { id: 'msg-fake' },
    })
    expect(request?.path).toBe('/v1/messages')
    expect(request?.headers).toMatchObject({
      'x-api-key': SECRET,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(request?.headers).not.toHaveProperty('authorization')
    const body = request?.body ?? {}
    expect(body).toMatchObject({
      model: 'fake-model',
      max_tokens: 16000,
      tool_choice: { type: 'tool', name: 'speak' },
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body.system).toContain('Blood on the Clocktower')
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: expect.stringContaining('Call speak') as unknown }],
      },
    ])
    const tools = body.tools as Record<string, unknown>[]
    expect(tools).toHaveLength(6)
    expect(tools[0]).toMatchObject({ name: 'speak', input_schema: { type: 'object' } })
    expect(tools[0]).not.toHaveProperty('function')
  })

  it('lets extra_body override the Anthropic max_tokens default', async () => {
    const { request } = await trial('anthropic_messages', speakCall, {
      extraBody: '{"max_tokens":512}',
    })
    expect(request?.body.max_tokens).toBe(512)
    expect(request?.body).not.toHaveProperty('tool_choice')
  })

  it.each([
    ['openai_responses', 'function_call', { call_id: 'a', arguments: speak }],
    ['anthropic_messages', 'tool_use', { id: 'a', input: JSON.parse(speak) as unknown }],
  ] as const)(
    'reports %s responses with the same errors as OpenAI Completions',
    async (format, type, call) => {
      const text = await trial(format, { kind: 'text', content: 'Hello!' })
      expect(text.result).toMatchObject({ valid: false, error: 'No tool call' })
      const wrong = await trial(format, {
        kind: 'toolCall',
        name: 'vote',
        arguments: '{"reasoning_summary":"r","raise_hand":true}',
      })
      expect(wrong.result).toMatchObject({
        valid: false,
        error: 'Expected tool "speak", got "vote"',
      })
      const unknown = await trial(format, { kind: 'toolCall', name: 'shout', arguments: speak })
      expect(unknown.result).toMatchObject({ valid: false, error: 'Unknown tool "shout"' })
      const unrecognised = await trial(format, { kind: 'raw', body: {} })
      expect(unrecognised.result).toMatchObject({
        valid: false,
        error: 'Response is not in a recognised API format',
      })
      const twice = { type, name: 'speak', ...call }
      const multiple = await trial(format, {
        kind: 'raw',
        body:
          format === 'openai_responses' ? { output: [twice, twice] } : { content: [twice, twice] },
      })
      expect(multiple.result).toMatchObject({
        valid: false,
        error: 'Expected one tool call, got 2',
      })
    },
  )
})
