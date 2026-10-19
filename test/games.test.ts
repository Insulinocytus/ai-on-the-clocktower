import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { GameEvent } from '../shared/types/game'
import type { GameSummary } from '../shared/types/game-view'
import { startFakeProvider } from './fake-provider'
import { buildContestantPrompt } from '../shared/prompts/contestant'

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  server: true,
  browser: false,
  env: {
    NUXT_DB_PATH: join(mkdtempSync(join(tmpdir(), 'clocktower-games-')), 'app.db'),
    CLOCKTOWER_GAME_KEY: 'game-test-secret',
  },
})

const gameRequest = z.object({
  messages: z.tuple([
    z.object({ role: z.literal('system'), content: z.string() }),
    z.object({ role: z.literal('user'), content: z.string() }),
  ]),
  tool_choice: z.object({ function: z.object({ name: z.string() }) }),
})

async function preset(apiKeyEnv: string, baseUrl = 'http://127.0.0.1:1/v1') {
  const provider = await $fetch<{ id: number }>('/api/providers', {
    method: 'POST',
    body: { name: 'Game provider', baseUrl, apiKeyEnv },
  })
  return $fetch<{ id: number }>('/api/presets', {
    method: 'POST',
    body: {
      name: 'Game preset',
      providerId: provider.id,
      model: 'fake-model',
      forceToolChoice: true,
    },
  })
}

describe('games HTTP seam', () => {
  it('refuses opening a game and lists every missing provider credential', async () => {
    const a = await preset('CLOCKTOWER_MISSING_A')
    const b = await preset('CLOCKTOWER_MISSING_B')
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presets: [a.id, b.id, a.id, b.id, a.id], language: 'en' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      data: { missing: ['CLOCKTOWER_MISSING_A', 'CLOCKTOWER_MISSING_B'] },
    })
    expect(await $fetch('/api/games')).toEqual([])
  })

  it('runs an actual game through the provider to game.ended and replays projected events', async () => {
    let turn = 0
    const fake = await startFakeProvider((request) => {
      const input = gameRequest.parse(request.body)
      const tool = input.tool_choice.function.name
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify(
          tool === 'speak'
            ? { reasoning: 'Pass', speech: null, slayer_target: null }
            : {
                reasoning: 'Choose the next seat.',
                targets: [(turn++ % 5) + 1],
                memo: 'Remember my previous choice.',
              },
        ),
      }
    })
    try {
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
      })
      const summary = () => $fetch<GameSummary>(`/api/games/${opened.id}`)
      await expect
        .poll(async () => (await summary()).status, { timeout: 10000 })
        .not.toBe('running')
      expect(await summary()).toMatchObject({ status: 'ended', replayable: true })
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      expect(events.at(-1)).toMatchObject({ type: 'game.ended' })
      expect(events.map((event) => event.seq)).toEqual(
        Array.from({ length: events.length }, (_, index) => index + 1),
      )
      expect(events[0]).toMatchObject({
        type: 'game.created',
        seatCount: 5,
        language: 'en',
        logVersion: 1,
        promptVersion: 2,
        speechLimit: 10,
        storyteller: null,
      })
      expect(Object.values(opened.config.discretions)).toEqual(
        Array.from({ length: 14 }, () => 'random'),
      )
      expect(fake.requests.length).toBeGreaterThan(0)
      const decisions = events.filter((event) => event.type === 'contestant.decision')
      expect(decisions).toHaveLength(fake.requests.length)
      for (const decision of decisions)
        expect(decision).toMatchObject({
          attempt: 1,
          validation: { ok: true },
          raw: { id: 'chatcmpl-fake' },
        })
      for (const [index, decision] of decisions.entries()) {
        const prior = events.filter((event) => event.seq < decision.seq)
        const prompt = buildContestantPrompt({
          events: prior,
          seat: decision.seat,
          language: 'en',
          request: decision.request,
        })
        const repeated = buildContestantPrompt({
          events: [
            ...prior,
            {
              seq: decision.seq,
              type: 'seat.memo.updated',
              seat: decision.seat,
              memo: 'Changed memo within the same day',
            },
          ],
          seat: decision.seat,
          language: 'en',
          request: decision.request,
        })
        const captured = fake.requests[index]?.body.messages as { role: string; content: string }[]
        expect(prompt.messages).toEqual(captured)
        expect(repeated.messages[0]).toEqual(prompt.messages[0])
        expect(repeated.messages[1].content.split('# Your memo')[0]).toBe(
          prompt.messages[1].content.split('# Your memo')[0],
        )
      }
      const first = fake.requests[0]?.body
      expect(first?.tools).toHaveLength(6)
      for (const request of fake.requests) {
        const messages = request.body.messages as { role: string; content: string }[]
        expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
        expect(messages[0]?.content).toContain('Death is not elimination')
        expect(messages[0]?.content).toContain('Saint')
        expect(messages[1]?.content).not.toContain('Game preset')
        expect(messages[1]?.content).not.toContain('fake-model')
        expect(messages[1]?.content).toMatch(/Call (night_choice|speak)\./)
        expect(request.body).not.toHaveProperty('temperature')
        expect(request.body.tools).toEqual(first?.tools)
      }
      const publicEvents = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`, {
        query: { observer: 'public' },
      })
      expect(
        publicEvents.every((event) =>
          ['phase.started', 'dawn.announced', 'game.ended'].includes(event.type),
        ),
      ).toBe(true)
      expect(publicEvents.at(-1)?.type).toBe('game.ended')
      const after = events.at(-3)?.seq ?? 0
      expect(await $fetch(`/api/games/${opened.id}/events`, { query: { after } })).toEqual(
        events.filter((event) => event.seq > after),
      )
    } finally {
      await fake.close()
    }
  })

  it.each([
    ['call failure', { kind: 'serverError', status: 503 }],
    ['invalid output', { kind: 'text', content: 'No tool call' }],
    [
      'semantic failure',
      { kind: 'toolCall', name: 'night_choice', arguments: '{"reasoning":"r","targets":[]}' },
    ],
  ] as const)(
    'aborts immediately after one %s, preserving the failing seat and error',
    async (_name, step) => {
      const fake = await startFakeProvider()
      try {
        fake.script(step)
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
        const opened = await $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: { presets: Array.from({ length: 5 }, () => model.id), language: 'zh' },
        })
        await expect
          .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status)
          .toBe('aborted')
        const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
        expect(events.filter((event) => event.type === 'contestant.decision')).toHaveLength(1)
        expect(events.at(-1)).toMatchObject({
          type: 'game.aborted',
          reason: 'model_call_failed',
          seat: expect.any(Number) as unknown,
          error: expect.any(String) as unknown,
        })
        expect(fake.requests).toHaveLength(5)
        const after = events.at(-3)?.seq ?? 0
        const response = await fetch(`/api/games/${opened.id}/stream?after=0`, {
          headers: { 'Last-Event-ID': String(after) },
        })
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('SSE response has no body')
        let body = ''
        const decoder = new TextDecoder()
        while (!body.includes('event: ready')) {
          const chunk = await reader.read()
          if (chunk.done) break
          body += decoder.decode(chunk.value, { stream: true })
        }
        await reader.cancel()
        const ids = body
          .split('\n')
          .filter((line) => line.startsWith('id:'))
          .map((line) => Number(line.slice(3).trim()))
        expect(ids).toEqual(events.filter((event) => event.seq > after).map((event) => event.seq))
        expect(new Set(ids).size).toBe(ids.length)
      } finally {
        await fake.close()
      }
    },
  )
})

it.each([0, -1, 1.5, '2', null])(
  'rejects invalid per-conversation speech limit %s',
  async (speechLimit) => {
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presets: [1, 1, 1, 1, 1], language: 'en', speechLimit }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('speechLimit')
  },
)

it('isolates public batches, logs decisions immediately, and trims old speech only at day boundaries', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const roles = new Map<string, number>()
  const offers = new Map<string, number>()
  const captured: { seat: number; day: number; tool: string; prefix: string; system: string }[] = []
  const fake = await startFakeProvider(async (request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages[1].content
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    const day = Number(/# Current public state\nDay (\d+);/.exec(user)?.[1])
    const role = /Your character: ([^;]+);/.exec(user)?.[1] ?? ''
    const tool = input.tool_choice.function.name
    roles.set(role, seat)
    captured.push({
      seat,
      day,
      tool,
      prefix: user.split('# Your memo')[0] ?? '',
      system: input.messages[0].content,
    })
    const key = `${String(day)}:${String(seat)}`
    const offer = (offers.get(key) ?? 0) + 1
    offers.set(key, offer)
    if (day === 1 && seat === 5 && offer === 1) await pending
    const args =
      tool === 'speak'
        ? {
            reasoning: 'Private offer, not spoken.',
            speech: `SPEECH-D${String(day)}-S${String(seat)}-O${String(offer)}`,
            slayer_target: null,
          }
        : {
            reasoning: 'Move to the next day.',
            targets: [day === 2 ? roles.get('Chef') : day === 3 ? roles.get('Empath') : seat],
          }
    return { kind: 'toolCall', name: tool, arguments: JSON.stringify(args) }
  })
  try {
    const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
    const opened = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en', speechLimit: 1 },
    })
    const log = () => $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
    await expect.poll(() => fake.requests.length).toBe(5)
    await expect
      .poll(
        async () => (await log()).filter((event) => event.type === 'contestant.decision').length,
      )
      .toBe(4)
    expect((await log()).some((event) => event.type === 'public.speech')).toBe(false)
    expect(captured.every((request) => !request.prefix.includes('SPEECH-'))).toBe(true)
    release?.()
    await expect
      .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
        timeout: 10000,
      })
      .toBe('ended')
    const events = await log()
    expect(events[0]).toMatchObject({ type: 'game.created', speechLimit: 1 })
    const speeches = events.filter((event) => event.type === 'public.speech')
    expect(speeches).toHaveLength(15)
    expect(new Set(speeches.map((event) => event.speech)).size).toBe(15)
    for (const speech of speeches)
      expect(events.find((event) => event.seq === speech.decision)).toMatchObject({
        type: 'contestant.decision',
        seat: speech.seat,
      })
    const decisions = events.filter((event) => event.type === 'contestant.decision')
    expect(decisions).toHaveLength(fake.requests.length)
    const bySeat = new Map<number, typeof captured>()
    for (const request of captured) {
      expect(request.system).toBe(captured[0]?.system)
      const prior = bySeat.get(request.seat) ?? []
      const previous = prior.at(-1)
      if (previous?.day === request.day)
        expect(request.prefix.startsWith(previous.prefix.trimEnd())).toBe(true)
      if (request.day === 2) expect(request.prefix).toContain('SPEECH-D1-')
      if (request.day === 3) {
        expect(request.prefix).not.toContain('SPEECH-D1-')
        expect(request.prefix).toContain('SPEECH-D2-')
        expect(request.prefix).toContain('Public discussion')
      }
      expect(request.prefix).not.toContain('Private offer, not spoken.')
      expect(request.prefix).not.toContain('omitted')
      prior.push(request)
      bySeat.set(request.seat, prior)
    }
    const chef = roles.get('Chef')
    expect(
      captured.some(
        (request) => request.seat === chef && request.day === 2 && request.tool === 'speak',
      ),
    ).toBe(true)
    for (const request of fake.requests)
      expect(request.body.tools).toEqual(fake.requests[0]?.body.tools)
  } finally {
    release?.()
    await fake.close()
  }
})
