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

const toolChoice = z.object({ function: z.object({ name: z.string() }) })

async function nightProvider(responder?: Parameters<typeof startFakeProvider>[0]) {
  const fake = await startFakeProvider((request) => {
    const name = toolChoice.parse(request.body.tool_choice).function.name
    if (name === 'nominate')
      return { kind: 'toolCall', name, arguments: '{"reasoning":"Pass","nominee":null}' }
    const messages = request.body.messages as { content: string }[]
    const user = messages[1]?.content ?? ''
    if (name === 'night_choice' && /as Fortune Teller|作为占卜师/.test(user))
      return { kind: 'toolCall', name, arguments: '{"reasoning":"Probe","targets":[1,2]}' }
    if (name === 'night_choice' && /as Ravenkeeper|作为守鸦人/.test(user))
      return { kind: 'toolCall', name, arguments: '{"reasoning":"Inspect","targets":[1]}' }
    return responder?.(request)
  })
  return {
    ...fake,
    get requests() {
      return fake.requests.filter(
        (request) =>
          toolChoice.parse(request.body.tool_choice).function.name === 'night_choice' &&
          !/as Fortune Teller|作为占卜师|as Ravenkeeper|作为守鸦人/.test(
            JSON.stringify(request.body.messages),
          ),
      )
    },
  }
}

async function preset(apiKeyEnv: string, baseUrl = 'http://127.0.0.1:1/v1', timeoutSec = 300) {
  const provider = await $fetch<{ id: number }>('/api/providers', {
    method: 'POST',
    body: { name: 'Game provider', baseUrl, apiKeyEnv, timeoutSec },
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
    let nightTurn = 0
    const fake = await startFakeProvider((request) => {
      const choice = toolChoice.parse(request.body.tool_choice)
      const name = choice.function.name
      const messages = request.body.messages as { role: string; content: string }[]
      const user = messages[1]?.content ?? ''
      const args =
        name === 'night_choice'
          ? {
              targets: user.includes('choose 2 distinct players')
                ? [1, 2]
                : [(nightTurn++ % 5) + 1],
            }
          : name === 'nominate'
            ? {
                nominee:
                  user.includes('You are Seat 1.') && user.includes('Nominees today: none.')
                    ? 1
                    : null,
              }
            : name === 'vote'
              ? { raise_hand: true }
              : { speech: 'My nomination argument.', slayer_target: null }
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({ reasoning: 'Choose a legal action.', ...args }),
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
        logVersion: 2,
        promptVersion: 2,
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
        const choice = toolChoice.parse(request.body.tool_choice)
        expect(messages[1]?.content).toContain(`Call ${choice.function.name}.`)
        expect(request.body).not.toHaveProperty('temperature')
        expect(request.body.tools).toEqual(first?.tools)
      }
      const publicEvents = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`, {
        query: { observer: 'public' },
      })
      expect(
        publicEvents.every((event) =>
          [
            'phase.started',
            'dawn.announced',
            'game.ended',
            'nomination',
            'public.speech',
            'vote',
            'vote.tallied',
            'execution',
          ].includes(event.type),
        ),
      ).toBe(true)
      expect(publicEvents.at(-1)?.type).toBe('game.ended')
      expect(publicEvents.some((event) => event.type === 'nomination')).toBe(true)
      expect(publicEvents.some((event) => event.type === 'vote')).toBe(true)
      expect(publicEvents.some((event) => event.type === 'execution')).toBe(true)
      const after = events.at(-3)?.seq ?? 0
      expect(await $fetch(`/api/games/${opened.id}/events`, { query: { after } })).toEqual(
        events.filter((event) => event.seq > after),
      )
    } finally {
      await fake.close()
    }
  })

  it('recovers from invalid arguments without changing the original prompt prefix or applying memo', async () => {
    const fake = await nightProvider()
    const invalid = '{ "reasoning": "retry", "targets": [], "memo": "INVALID MEMO" }'
    try {
      fake.script({ kind: 'toolCall', name: 'night_choice', arguments: invalid })
      for (let turn = 0; turn < 20; turn++)
        fake.script({
          kind: 'toolCall',
          name: 'night_choice',
          arguments: JSON.stringify({ reasoning: 'Recovered', targets: [(turn % 5) + 1] }),
        })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: { presets: Array.from({ length: 5 }, () => model.id), language: 'zh' },
      })
      await expect
        .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status)
        .toBe('ended')
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      const decisions = events.filter(
        (event) =>
          event.type === 'contestant.decision' &&
          event.request.tool === 'night_choice' &&
          event.request.role === 'imp',
      )
      expect(decisions.slice(0, 2)).toMatchObject([
        { attempt: 1, validation: { ok: false, errors: [{ code: 'invalid_targets' }] } },
        { attempt: 2, validation: { ok: true } },
      ])
      expect(
        events.some((event) => event.type === 'seat.memo.updated' && event.memo === 'INVALID MEMO'),
      ).toBe(false)
      const first = fake.requests[0]?.body.messages as { role: string; content: string }[]
      const second = fake.requests[1]?.body.messages as { role: string; content: string }[]
      expect(second[0]).toEqual(first[0])
      expect(second[1]?.content.startsWith(first[1]?.content ?? '')).toBe(true)
      const suffix = second[1]?.content.slice(first[1]?.content.length)
      expect(suffix).toContain('上次提交无效（第 1 次尝试，最多 3 次）')
      expect(suffix).toContain('night_choice')
      expect(suffix).toContain(invalid)
      expect(suffix).toContain('目标')
      expect(suffix).toContain('请按上面的请求重新调用')
      expect(fake.requests[1]?.body.tools).toEqual(fake.requests[0]?.body.tools)
    } finally {
      await fake.close()
    }
  })

  it.each([
    ['missing call', { kind: 'text', content: 'No tool call' }, 'No tool call'],
    ['unknown tool', { kind: 'toolCall', name: 'invented', arguments: '{}' }, 'unknown'],
    [
      'wrong tool',
      { kind: 'toolCall', name: 'vote', arguments: '{"reasoning":"r","raise_hand":true}' },
      'wrong tool',
    ],
    [
      'invalid JSON',
      { kind: 'toolCall', name: 'night_choice', arguments: '{ broken JSON' },
      'not valid JSON',
    ],
    [
      'invalid fields',
      { kind: 'toolCall', name: 'night_choice', arguments: '{"reasoning":"r","targets":[99]}' },
      'schema',
    ],
    ['invalid response', { kind: 'raw', body: {} }, 'choices[0].message'],
    [
      'multiple calls',
      {
        kind: 'raw',
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'night_choice',
                      arguments: '{"reasoning":"a","targets":[1]}',
                    },
                  },
                  {
                    function: {
                      name: 'night_choice',
                      arguments: '{"reasoning":"b","targets":[2]}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      'exactly one',
    ],
  ] as const)('recovers from %s with an English error suffix', async (_name, step, explanation) => {
    const fake = await nightProvider()
    try {
      fake.script(step)
      for (let turn = 0; turn < 20; turn++)
        fake.script({
          kind: 'toolCall',
          name: 'night_choice',
          arguments: JSON.stringify({ reasoning: 'Recovered', targets: [(turn % 5) + 1] }),
        })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
      })
      await expect
        .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
          timeout: 10000,
        })
        .toBe('ended')
      const first = fake.requests[0]?.body.messages as { role: string; content: string }[]
      const retried = fake.requests[1]?.body.messages as { role: string; content: string }[]
      expect(retried[0]).toEqual(first[0])
      expect(retried[1]?.content.startsWith(first[1]?.content ?? '')).toBe(true)
      const suffix = retried[1]?.content.slice(first[1]?.content.length)
      expect(suffix).toContain('Previous submission invalid (attempt 1 of at most 3)')
      expect(suffix).toContain(explanation)
      if (step.kind === 'toolCall') expect(suffix).toContain(step.arguments)
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      expect(
        events
          .filter(
            (event) =>
              event.type === 'contestant.decision' &&
              event.request.tool === 'night_choice' &&
              event.request.role === 'imp',
          )
          .slice(0, 2),
      ).toMatchObject([
        { attempt: 1, validation: { ok: false } },
        { attempt: 2, validation: { ok: true } },
      ])
    } finally {
      await fake.close()
    }
  })

  it.each([
    ['429 with Retry-After', { kind: 'rateLimit', retryAfterSec: 1 }, 'http', 1000],
    ['5xx', { kind: 'serverError', status: 503 }, 'http', 250],
    ['other HTTP errors', { kind: 'serverError', status: 400 }, 'http', 250],
    ['connection interruption', { kind: 'disconnect' }, 'network', 250],
    ['partial response', { kind: 'truncated' }, 'network', 250],
    ['timeout', { kind: 'hang' }, 'timeout', 1250],
  ] as const)(
    'recovers from %s by waiting and resending identical bytes',
    async (_name, step, errorType, minimumDelay) => {
      const fake = await nightProvider()
      try {
        fake.script(step)
        for (let turn = 0; turn < 20; turn++)
          fake.script({
            kind: 'toolCall',
            name: 'night_choice',
            arguments: JSON.stringify({ reasoning: 'Recovered', targets: [(turn % 5) + 1] }),
          })
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 1)
        const opened = await $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
        })
        await expect
          .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
            timeout: 10000,
          })
          .toBe('ended')
        expect(fake.requests[1]?.body).toEqual(fake.requests[0]?.body)
        expect(
          (fake.requests[1]?.receivedAt ?? 0) - (fake.requests[0]?.receivedAt ?? 0),
        ).toBeGreaterThanOrEqual(minimumDelay - 30)
        const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
        expect(
          events
            .filter(
              (event) =>
                event.type === 'contestant.decision' &&
                event.request.tool === 'night_choice' &&
                event.request.role === 'imp',
            )
            .slice(0, 2),
        ).toMatchObject([
          { attempt: 1, validation: { ok: false, code: 'call_failed', errorType } },
          { attempt: 2, validation: { ok: true } },
        ])
      } finally {
        await fake.close()
      }
    },
  )

  it.each(['zh', 'en'] as const)(
    'replaces only accepted seat memos, keeps them out of the timeline, and projects them privately (%s)',
    async (language) => {
      const original = '记'.repeat(2000)
      const memos = [undefined, original, undefined, 'Keep only this claim.', '']
      let turn = 0
      const fake = await nightProvider((request) => {
        const messages = request.body.messages as { content: string }[]
        const user = messages[1]?.content ?? ''
        const ownSeat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
        if (!ownSeat) throw new Error('Missing contestant seat')
        const accepted = turn < memos.length
        const memo = accepted ? memos[turn] : 'Rejected'
        turn++
        return {
          kind: 'toolCall',
          name: 'night_choice',
          arguments: JSON.stringify({
            reasoning: 'Keep targeting the same other seat.',
            targets: accepted ? [ownSeat === 1 ? 2 : 1] : [],
            memo,
          }),
        }
      })
      try {
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
        const opened = await $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: { presets: Array.from({ length: 5 }, () => model.id), language },
        })
        await expect
          .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status)
          .toBe('aborted')
        const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
        const memos = events.filter((event) => event.type === 'seat.memo.updated')
        expect(memos.map((event) => event.memo)).toEqual([original, 'Keep only this claim.', ''])
        const seat = memos[0]?.seat
        expect(seat).toBeTypeOf('number')
        expect(memos.every((event) => event.seat === seat)).toBe(true)
        for (const observer of [
          'spectator',
          'storyteller',
          `seat:${String(seat)}`,
          'public',
          ...[1, 2, 3, 4, 5]
            .filter((other) => other !== seat)
            .map((other) => `seat:${String(other)}`),
        ]) {
          const projected = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`, {
            query: { observer },
          })
          expect(projected.filter((event) => event.type === 'seat.memo.updated')).toEqual(
            ['spectator', 'storyteller', `seat:${String(seat)}`].includes(observer) ? memos : [],
          )
        }
        const memoHeading = language === 'zh' ? '# 你的备忘录\n' : '# Your memo\n'
        const stateHeading = language === 'zh' ? '# 当前公共局面' : '# Current public state'
        const contents = fake.requests.map((request) => {
          const messages = request.body.messages as { role: string; content: string }[]
          const user = messages[1]?.content ?? ''
          const [prefix, suffix] = user.split(memoHeading)
          expect(prefix).not.toContain(original)
          expect(prefix).not.toContain('Keep only this claim.')
          expect(prefix).not.toContain('Rejected')
          return suffix?.split(stateHeading)[0]?.trim()
        })
        expect(contents.slice(2, 6)).toEqual([original, original, 'Keep only this claim.', ''])
      } finally {
        await fake.close()
      }
    },
  )

  it('shares the attempt limit across invalid output and transport failures', async () => {
    const fake = await nightProvider()
    try {
      fake.script(
        {
          kind: 'toolCall',
          name: 'night_choice',
          arguments: '{"reasoning":"r","targets":[],"memo":"INVALID"}',
        },
        { kind: 'serverError', status: 503 },
        { kind: 'toolCall', name: 'night_choice', arguments: '{ last invalid arguments' },
      )
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
      })
      await expect
        .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status)
        .toBe('aborted')
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      expect(
        events.filter(
          (event) =>
            event.type === 'contestant.decision' &&
            event.request.tool === 'night_choice' &&
            event.request.role === 'imp',
        ),
      ).toMatchObject([
        { attempt: 1, validation: { ok: false, errors: [{ code: 'invalid_targets' }] } },
        { attempt: 2, validation: { ok: false, code: 'call_failed', errorType: 'http' } },
        { attempt: 3, validation: { ok: false, errors: [{ code: 'invalid_arguments_json' }] } },
      ])
      expect(fake.requests).toHaveLength(3)
      expect(fake.requests[2]?.body).toEqual(fake.requests[1]?.body)
      expect(
        events.some((event) => event.type === 'night.choice' || event.type === 'seat.memo.updated'),
      ).toBe(false)
      expect(events.at(-1)).toMatchObject({
        type: 'game.aborted',
        reason: 'model_call_failed',
        error: '[{"code":"invalid_arguments_json"}]',
      })
    } finally {
      await fake.close()
    }
  })

  it('honors an HTTP-date Retry-After before resending the same request', async () => {
    const fake = await nightProvider()
    const retryAt = new Date(Date.now() + 2000).toUTCString()
    try {
      fake.script({ kind: 'rateLimit', retryAfterSec: 0, retryAfter: retryAt })
      for (let turn = 0; turn < 20; turn++)
        fake.script({
          kind: 'toolCall',
          name: 'night_choice',
          arguments: JSON.stringify({ reasoning: 'Recovered', targets: [(turn % 5) + 1] }),
        })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
      })
      await expect
        .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
          timeout: 10000,
        })
        .toBe('ended')
      expect(fake.requests[1]?.body).toEqual(fake.requests[0]?.body)
      expect(fake.requests[1]?.receivedAt).toBeGreaterThanOrEqual(Date.parse(retryAt) - 30)
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
    'aborts after three %s attempts, preserving the failing seat and error',
    async (_name, step) => {
      const fake = await nightProvider()
      try {
        fake.script(step, step, step)
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
        const opened = await $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: { presets: Array.from({ length: 5 }, () => model.id), language: 'zh' },
        })
        await expect
          .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status)
          .toBe('aborted')
        const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
        expect(
          events.flatMap((event) =>
            event.type === 'contestant.decision' &&
            event.request.tool === 'night_choice' &&
            event.request.role === 'imp'
              ? [event.attempt]
              : [],
          ),
        ).toEqual([1, 2, 3])
        expect(events.at(-1)).toMatchObject({
          type: 'game.aborted',
          reason: 'model_call_failed',
          seat: expect.any(Number) as unknown,
          error: expect.any(String) as unknown,
        })
        expect(fake.requests).toHaveLength(3)
        if (step.kind === 'serverError') {
          expect(fake.requests[1]?.body).toEqual(fake.requests[0]?.body)
          expect(fake.requests[2]?.body).toEqual(fake.requests[1]?.body)
          expect(
            (fake.requests[1]?.receivedAt ?? 0) - (fake.requests[0]?.receivedAt ?? 0),
          ).toBeGreaterThanOrEqual(220)
          expect(
            (fake.requests[2]?.receivedAt ?? 0) - (fake.requests[1]?.receivedAt ?? 0),
          ).toBeGreaterThanOrEqual(470)
        } else {
          const second = fake.requests[1]?.body.messages as { content: string }[]
          const third = fake.requests[2]?.body.messages as { content: string }[]
          expect(third[1]?.content.startsWith(second[1]?.content ?? '')).toBe(true)
          expect(third[1]?.content).toContain('上次提交无效（第 2 次尝试，最多 3 次）')
        }
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
