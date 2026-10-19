import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup, startServer, stopServer } from '@nuxt/test-utils/e2e'
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
    if (name === 'speak')
      return {
        kind: 'toolCall',
        name,
        arguments: '{"reasoning":"Pass","speech":null,"slayer_target":null}',
      }
    const messages = request.body.messages as { content: string }[]
    const user = messages[1]?.content ?? ''
    if (name === 'night_choice' && !/as Imp|作为小恶魔/.test(user))
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({
          reasoning: 'Legal non-Imp choice',
          targets: nightTargets(user),
        }),
      }
    return responder?.(request)
  })
  return {
    ...fake,
    get requests() {
      return fake.requests.filter((request) => {
        const input = gameRequest.parse(request.body)
        return (
          input.tool_choice.function.name === 'night_choice' &&
          /as Imp|作为小恶魔/.test(input.messages[1].content)
        )
      })
    },
  }
}
const gameRequest = z.object({
  messages: z.tuple([
    z.object({ role: z.literal('system'), content: z.string() }),
    z.object({ role: z.literal('user'), content: z.string() }),
  ]),
  tool_choice: toolChoice,
})

function nightTargets(user: string, turn = 0): number[] {
  const domain = /Legal targets: ([^.]+)\.|合法目标：([^。]+)。/.exec(user)
  const targets = (domain?.[1] ?? domain?.[2] ?? '').match(/\d+/g)?.map(Number) ?? []
  const count = /as Fortune Teller|作为占卜师/.test(user) ? 2 : 1
  if (targets.length < count) throw new Error('Missing legal night targets in fixture prompt')
  return Array.from({ length: count }, (_, index) => {
    const target = targets[(turn + index) % targets.length]
    if (target === undefined) throw new Error('Missing fixture target')
    return target
  })
}

async function preset(
  apiKeyEnv: string,
  baseUrl = 'http://127.0.0.1:1/v1',
  timeoutSec = 300,
  maxConcurrency = 5,
) {
  const provider = await $fetch<{ id: number }>('/api/providers', {
    method: 'POST',
    body: { name: 'Game provider', baseUrl, apiKeyEnv, timeoutSec, maxConcurrency },
  })
  return $fetch<{ id: number; providerId: number }>('/api/presets', {
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
      body: JSON.stringify({
        presets: [a.id, b.id, a.id, b.id, a.id],
        language: 'en',
        whisperLimit: 0,
      }),
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
          ? { targets: nightTargets(user, nightTurn++) }
          : name === 'nominate'
            ? {
                nominee:
                  user.includes('You are Seat 1.') && user.includes('Nominees today: none.')
                    ? user.includes('Your character: Virgin;')
                      ? 2
                      : 1
                    : null,
              }
            : name === 'vote'
              ? { raise_hand: true }
              : {
                  speech: user.includes('phase: public discussion.')
                    ? user.includes('You are Seat 1.') && !user.includes('A public claim.')
                      ? 'A public claim.'
                      : null
                    : 'My nomination argument.',
                  slayer_target: null,
                }
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
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        },
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
      expect(
        publicEvents.some((event) => event.type === 'public.speech' && event.kind === 'free'),
      ).toBe(true)
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
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'zh',
          whisperLimit: 0,
        },
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
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        },
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
          body: {
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'en',
            whisperLimit: 0,
          },
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
      const scriptedRequests: string[] = []
      const fake = await startFakeProvider((request) => {
        const input = gameRequest.parse(request.body)
        const name = input.tool_choice.function.name
        const user = input.messages[1].content
        const ownSeat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
        if (!ownSeat) throw new Error('Missing contestant seat')
        let action: Record<string, unknown>
        switch (name) {
          case 'night_choice':
            action = { targets: nightTargets(user) }
            break
          case 'speak':
            action = { speech: 'Continue the discussion.', slayer_target: null }
            if (ownSeat === 1) {
              scriptedRequests.push(user)
              const accepted = turn < memos.length
              action.memo = accepted ? memos[turn] : 'Rejected'
              if (!accepted) action.speech = 42
              turn++
            }
            break
          case 'nominate':
            action = { nominee: null }
            break
          case 'vote':
            action = { raise_hand: false }
            break
          case 'propose_whisper':
            action = { members: null }
            break
          case 'rank_whispers':
            action = { ranking: [] }
            break
          default:
            throw new Error(`Unexpected fixture tool: ${name}`)
        }
        return {
          kind: 'toolCall',
          name,
          arguments: JSON.stringify({
            reasoning: 'Exercise memo updates before any deaths.',
            ...action,
          }),
        }
      })
      try {
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
        const opened = await $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: { presets: Array.from({ length: 5 }, () => model.id), language, whisperLimit: 0 },
        })
        await expect
          .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
            timeout: 10000,
          })
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
        const contents = scriptedRequests.map((user) => {
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
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        },
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
        events.some(
          (event) =>
            (event.type === 'night.choice' && event.role === 'imp') ||
            event.type === 'seat.memo.updated',
        ),
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
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        },
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
          body: {
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'zh',
            whisperLimit: 0,
          },
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
  it('aborts an in-flight game once without recording the canceled decision or further requests', async () => {
    const fake = await startFakeProvider()
    try {
      fake.script({ kind: 'hang' })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        },
      })
      await expect.poll(() => fake.requests.length).toBe(1)
      expect(await $fetch(`/api/games/${opened.id}/abort`, { method: 'POST' })).toMatchObject({
        status: 'aborted',
        reason: 'human',
      })
      await $fetch(`/api/games/${opened.id}/abort`, { method: 'POST' })
      await expect.poll(() => fake.requests[0]?.closed).toBe(true)
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      expect(events.filter((event) => event.type === 'game.aborted')).toHaveLength(1)
      expect(events.some((event) => event.type === 'contestant.decision')).toBe(false)
      expect(events.at(-1)).toMatchObject({ type: 'game.aborted', reason: 'human' })
      expect(fake.requests).toHaveLength(1)
    } finally {
      await fake.close()
    }
  })

  it('shares provider capacity across games in FIFO order and removes aborted queued calls', async () => {
    const fake = await startFakeProvider()
    const games: GameSummary[] = []
    try {
      fake.script({ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' })
      const provider = await $fetch<{ id: number }>('/api/providers', {
        method: 'POST',
        body: {
          name: 'Shared queue',
          baseUrl: fake.baseUrl,
          apiKeyEnv: 'CLOCKTOWER_GAME_KEY',
          maxConcurrency: 1,
        },
      })
      for (const name of ['first', 'canceled', 'third']) {
        const model = await $fetch<{ id: number }>('/api/presets', {
          method: 'POST',
          body: { name, model: name, providerId: provider.id },
        })
        games.push(
          await $fetch<GameSummary>('/api/games', {
            method: 'POST',
            body: {
              presets: Array.from({ length: 5 }, () => model.id),
              language: 'en',
              whisperLimit: 0,
            },
          }),
        )
      }
      await expect.poll(() => fake.requests.length).toBeGreaterThan(0)
      expect(fake.requests).toHaveLength(1)
      const [first, canceled, third] = games
      if (!first || !canceled || !third) throw new Error('Missing game')
      await $fetch(`/api/games/${canceled.id}/abort`, { method: 'POST' })
      expect(fake.requests).toHaveLength(1)
      await $fetch(`/api/games/${first.id}/abort`, { method: 'POST' })
      await expect.poll(() => fake.requests.length).toBe(2)
      expect(fake.requests.map((request) => request.body.model)).toEqual(['first', 'third'])
      const events = await $fetch<GameEvent[]>(`/api/games/${canceled.id}/events`)
      expect(events.some((event) => event.type === 'contestant.decision')).toBe(false)
    } finally {
      for (const game of games) await $fetch(`/api/games/${game.id}/abort`, { method: 'POST' })
      await fake.close()
    }
  })

  it('reads updated provider capacity when granting queued calls', async () => {
    const fake = await startFakeProvider()
    const gate = Promise.withResolvers<undefined>()
    const calls: Promise<unknown>[] = []
    try {
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
      fake.script(
        {
          kind: 'toolCall',
          name: 'speak',
          arguments: '{"reasoning":"r","speech":null,"slayer_target":null}',
          waitFor: gate.promise,
        },
        { kind: 'hang' },
        { kind: 'hang' },
      )
      calls.push(
        $fetch(`/api/presets/${String(model.id)}/trial`, { method: 'POST', body: { lang: 'en' } }),
      )
      await expect.poll(() => fake.requests.length).toBe(1)
      for (const name of ['second', 'third']) {
        const queued = await $fetch<{ id: number }>('/api/presets', {
          method: 'POST',
          body: { name, model: name, providerId: model.providerId },
        })
        calls.push(
          $fetch(`/api/presets/${String(queued.id)}/trial`, {
            method: 'POST',
            body: { lang: 'en' },
          }),
        )
      }
      await $fetch(`/api/providers/${String(model.providerId)}`, {
        method: 'PUT',
        body: {
          name: 'Updated',
          baseUrl: fake.baseUrl,
          apiKeyEnv: 'CLOCKTOWER_GAME_KEY',
          maxConcurrency: 2,
        },
      })
      gate.resolve(undefined)
      await expect.poll(() => fake.requests.length).toBe(3)
      expect(fake.requests[0]?.body.model).toBe('fake-model')
      expect(
        fake.requests
          .slice(1)
          .map((request) => request.body.model)
          .sort(),
      ).toEqual(['second', 'third'])
    } finally {
      gate.resolve(undefined)
      await fake.close()
      await Promise.allSettled(calls)
    }
  })

  it('starts each timeout only after a queued request gets its slot', async () => {
    const fake = await startFakeProvider()
    const gate = Promise.withResolvers<undefined>()
    const calls: Promise<{ valid: boolean; error?: string }>[] = []
    try {
      // The app runs in a subprocess: exercise its real timeout, not the Vitest clock.
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 1, 1)
      fake.script(
        { kind: 'hang' },
        {
          kind: 'toolCall',
          name: 'speak',
          arguments: '{"reasoning":"r","speech":null,"slayer_target":null}',
          waitFor: gate.promise,
        },
      )
      calls.push(
        $fetch(`/api/presets/${String(model.id)}/trial`, { method: 'POST', body: { lang: 'en' } }),
      )
      await expect.poll(() => fake.requests.length).toBe(1)
      calls.push(
        $fetch(`/api/presets/${String(model.id)}/trial`, { method: 'POST', body: { lang: 'en' } }),
      )
      expect(await calls[0]).toMatchObject({ valid: false, error: 'Timed out after 1s' })
      await expect.poll(() => fake.requests.length).toBe(2)
      gate.resolve(undefined)
      expect(await calls[1]).toMatchObject({ valid: true })
    } finally {
      gate.resolve(undefined)
      await fake.close()
      await Promise.allSettled(calls)
    }
  })

  it('releases provider slots during backoff and cancels the delayed retry on termination', async () => {
    const fake = await startFakeProvider()
    const games: GameSummary[] = []
    try {
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
      for (let i = 0; i < 20; i++) fake.script({ kind: 'rateLimit', retryAfterSec: 60 })
      for (const name of ['backoff', 'other-game']) {
        const contestant = await $fetch<{ id: number }>('/api/presets', {
          method: 'POST',
          body: { name, model: name, providerId: model.providerId },
        })
        games.push(
          await $fetch<GameSummary>('/api/games', {
            method: 'POST',
            body: {
              presets: Array.from({ length: 5 }, () => contestant.id),
              language: 'en',
              whisperLimit: 0,
            },
          }),
        )
      }
      await expect
        .poll(() => fake.requests.some((request) => request.body.model === 'other-game'))
        .toBe(true)
      for (const game of games) {
        await $fetch(`/api/games/${game.id}/abort`, { method: 'POST' })
        const events = await $fetch<GameEvent[]>(`/api/games/${game.id}/events`)
        expect(
          events
            .filter((event) => event.type === 'contestant.decision')
            .every((event) => event.attempt === 1),
        ).toBe(true)
        expect(events.at(-1)).toMatchObject({ type: 'game.aborted', reason: 'human' })
      }
    } finally {
      for (const game of games) await $fetch(`/api/games/${game.id}/abort`, { method: 'POST' })
      await fake.close()
    }
  })

  it('keeps different provider ids independent even when their URLs are identical', async () => {
    const fake = await startFakeProvider()
    const games: GameSummary[] = []
    try {
      fake.script({ kind: 'hang' }, { kind: 'hang' })
      for (let index = 0; index < 2; index++) {
        const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
        games.push(
          await $fetch<GameSummary>('/api/games', {
            method: 'POST',
            body: {
              presets: Array.from({ length: 5 }, () => model.id),
              language: 'en',
              whisperLimit: 0,
            },
          }),
        )
      }
      await expect.poll(() => fake.requests.length).toBe(2)
      expect(fake.requests.every((request) => !request.closed)).toBe(true)
    } finally {
      for (const game of games) await $fetch(`/api/games/${game.id}/abort`, { method: 'POST' })
      await fake.close()
    }
  })

  it('marks unfinished games aborted once on process restart while preserving terminal games', async () => {
    const fake = await startFakeProvider()
    try {
      fake.script({ kind: 'hang' }, { kind: 'hang' })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
      const open = () =>
        $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: {
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'en',
            whisperLimit: 0,
          },
        })
      const finished = await open()
      await $fetch(`/api/games/${finished.id}/abort`, { method: 'POST' })
      const unfinished = await open()
      await expect.poll(() => fake.requests.some((request) => !request.closed)).toBe(true)
      await stopServer()
      await startServer()
      const list = await $fetch<GameSummary[]>('/api/games')
      expect(list.find((game) => game.id === unfinished.id)).toMatchObject({
        status: 'aborted',
        reason: 'process_restart',
      })
      expect(list.find((game) => game.id === finished.id)).toMatchObject({
        status: 'aborted',
        reason: 'human',
      })
      await stopServer()
      await startServer()
      const events = await $fetch<GameEvent[]>(`/api/games/${unfinished.id}/events`)
      expect(events.filter((event) => event.type === 'game.aborted')).toEqual([
        expect.objectContaining({ reason: 'process_restart' }),
      ])
      expect(fake.requests.filter((request) => !request.closed)).toHaveLength(0)
    } finally {
      await fake.close()
    }
  })
})

it.each([0, -1, 1.5, '2', null])(
  'rejects invalid per-conversation speech limit %s',
  async (speechLimit) => {
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        presets: [1, 1, 1, 1, 1],
        language: 'en',
        whisperLimit: 0,
        speechLimit,
      }),
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
    if (tool === 'nominate')
      return { kind: 'toolCall', name: tool, arguments: '{"reasoning":"Pass","nominee":null}' }
    roles.set(role, seat)
    if (tool === 'night_choice') {
      const victims = [...roles]
        .filter(([character]) => !['Imp', 'Scarlet Woman', 'Soldier', 'Mayor'].includes(character))
        .map(([, target]) => target)
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({
          reasoning: 'Advance the night.',
          targets:
            role === 'Imp'
              ? [day <= 3 ? victims[0] : seat]
              : role === 'Monk'
                ? [roles.get('Scarlet Woman')]
                : nightTargets(user),
        }),
      }
    }
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
    const args = {
      reasoning: 'Private offer, not spoken.',
      speech: `SPEECH-D${String(day)}-S${String(seat)}-O${String(offer)}`,
      slayer_target: null,
    }
    return { kind: 'toolCall', name: tool, arguments: JSON.stringify(args) }
  })
  try {
    const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
    const opened = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: {
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
        speechLimit: 1,
      },
    })
    const log = () => $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
    await expect
      .poll(
        () =>
          fake.requests.filter(
            (request) => gameRequest.parse(request.body).tool_choice.function.name === 'speak',
          ).length,
      )
      .toBe(5)
    await expect
      .poll(
        async () =>
          (await log()).filter(
            (event) => event.type === 'contestant.decision' && event.request.tool === 'speak',
          ).length,
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
    const publicDays = events.flatMap((event) =>
      event.type === 'phase.started' && event.phase === 'public' ? [event.day] : [],
    )
    expect(publicDays.length).toBeGreaterThanOrEqual(3)
    for (const day of publicDays)
      expect(
        speeches.filter((event) => event.speech.startsWith(`SPEECH-D${String(day)}-`)),
      ).toHaveLength(5)
    expect(new Set(speeches.map((event) => event.speech)).size).toBe(speeches.length)
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
    const victim = events.find((event) => event.type === 'night.death')
    expect(
      captured.some(
        (request) =>
          victim?.type === 'night.death' &&
          request.seat === victim.seat &&
          request.day === 2 &&
          request.tool === 'speak',
      ),
    ).toBe(true)
    for (const request of fake.requests)
      expect(request.body.tools).toEqual(fake.requests[0]?.body.tools)
  } finally {
    release?.()
    await fake.close()
  }
})

it('updates pass and unselected public-speech memos but rejects invalid-attempt memos', async () => {
  let nightTurn = 0
  const attempts = new Map<number, number>()
  const fake = await startFakeProvider((request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages[1].content
    const tool = input.tool_choice.function.name
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    if (tool === 'night_choice')
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({
          reasoning: 'Advance the game',
          targets: nightTargets(user, nightTurn++),
        }),
      }
    if (tool === 'nominate')
      return { kind: 'toolCall', name: tool, arguments: '{"reasoning":"Pass","nominee":null}' }
    const attempt = (attempts.get(seat) ?? 0) + 1
    attempts.set(seat, attempt)
    const firstOffer = attempt === 1 && seat <= 2
    return {
      kind: 'toolCall',
      name: tool,
      arguments: JSON.stringify({
        reasoning: 'Keep my own notes even if I do not speak',
        speech: firstOffer ? `Unselected-or-selected offer from Seat ${String(seat)}` : null,
        slayer_target: seat === 4 && attempt === 1 ? 1 : null,
        memo:
          seat === 4 && attempt === 1
            ? 'INVALID ATTEMPT MEMO'
            : firstOffer
              ? `Offer memo ${String(seat)}`
              : seat === 3 && attempt === 1
                ? 'Pass memo'
                : seat === 4 && attempt === 2
                  ? 'Recovered pass memo'
                  : undefined,
      }),
    }
  })
  try {
    const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
    const opened = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: {
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
        speechLimit: 1,
      },
    })
    await expect
      .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
        timeout: 10000,
      })
      .toBe('ended')
    const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
    const speeches = events.filter((event) => event.type === 'public.speech')
    expect(speeches).toHaveLength(1)
    const selected = speeches[0]
    if (!selected) throw new Error('Missing selected speech')
    const unselected = selected.seat === 1 ? 2 : 1
    expect(selected.seat).toBeOneOf([1, 2])
    expect(events.filter((event) => event.type === 'seat.memo.updated')).toEqual([
      expect.objectContaining({ seat: 1, memo: 'Offer memo 1' }),
      expect.objectContaining({ seat: 2, memo: 'Offer memo 2' }),
      expect.objectContaining({ seat: 3, memo: 'Pass memo' }),
      expect.objectContaining({ seat: 4, memo: 'Recovered pass memo' }),
    ])
    expect(
      events
        .filter((event) => event.type === 'seat.memo.updated')
        .every((event) => event.seq < selected.seq),
    ).toBe(true)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'contestant.decision',
        seat: unselected,
        validation: { ok: true, errors: [] },
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'contestant.decision',
        seat: 4,
        attempt: 1,
        validation: { ok: false, errors: [{ code: 'invalid_slayer_target' }] },
      }),
    )
  } finally {
    await fake.close()
  }
})

it('retries only the failing public seat and commits speech and memos after the whole batch succeeds', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let nightTurn = 0
  const attempts = new Map<number, number>()
  const fake = await startFakeProvider(async (request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages[1].content
    const tool = input.tool_choice.function.name
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    if (tool === 'night_choice')
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({
          reasoning: 'Advance the game',
          targets: nightTargets(user, nightTurn++),
        }),
      }
    if (tool === 'nominate')
      return { kind: 'toolCall', name: tool, arguments: '{"reasoning":"Pass","nominee":null}' }
    const firstBatch =
      user.includes('# Current public state\nDay 1;') && !user.includes('Recovered public claim.')
    if (!firstBatch)
      return {
        kind: 'toolCall',
        name: tool,
        arguments: '{"reasoning":"Pass","speech":null,"slayer_target":null}',
      }
    const attempt = (attempts.get(seat) ?? 0) + 1
    attempts.set(seat, attempt)
    if (seat === 5 && attempt === 2) await pending
    return {
      kind: 'toolCall',
      name: tool,
      arguments: JSON.stringify({
        reasoning: 'Answer my own request independently',
        speech: seat === 5 && attempt === 2 ? 'Recovered public claim.' : null,
        slayer_target: seat === 5 && attempt === 1 ? 1 : null,
        memo:
          seat === 5 && attempt === 1 ? 'INVALID RETRY MEMO' : `Valid batch memo ${String(seat)}`,
      }),
    }
  })
  try {
    const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
    const opened = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: {
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
        speechLimit: 1,
      },
    })
    const log = () => $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
    await expect.poll(() => attempts.get(5)).toBe(2)
    await expect
      .poll(
        async () =>
          (await log()).filter(
            (event) => event.type === 'contestant.decision' && event.request.tool === 'speak',
          ).length,
      )
      .toBe(5)
    const blocked = await log()
    expect([1, 2, 3, 4, 5].map((seat) => attempts.get(seat))).toEqual([1, 1, 1, 1, 2])
    expect(
      blocked.filter(
        (event) => event.type === 'seat.memo.updated' || event.type === 'public.speech',
      ),
    ).toEqual([])
    expect(blocked.at(-1)?.type).not.toBe('game.aborted')
    release?.()
    await expect
      .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
        timeout: 10000,
      })
      .toBe('ended')
    const events = await log()
    expect([1, 2, 3, 4, 5].map((seat) => attempts.get(seat))).toEqual([1, 1, 1, 1, 2])
    const speech = events.find((event) => event.type === 'public.speech')
    expect(speech).toMatchObject({ seat: 5, speech: 'Recovered public claim.', kind: 'free' })
    if (!speech) throw new Error('Missing recovered speech')
    const successful = events.find((event) => event.seq === speech.decision)
    expect(successful).toMatchObject({
      type: 'contestant.decision',
      seat: 5,
      attempt: 2,
      validation: { ok: true, errors: [] },
      raw: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      reasoning: 'Answer my own request independently',
                      speech: 'Recovered public claim.',
                      slayer_target: null,
                      memo: 'Valid batch memo 5',
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    })
    const memos = events.filter((event) => event.type === 'seat.memo.updated')
    expect(memos.map((event) => [event.seat, event.memo])).toEqual([
      [1, 'Valid batch memo 1'],
      [2, 'Valid batch memo 2'],
      [3, 'Valid batch memo 3'],
      [4, 'Valid batch memo 4'],
      [5, 'Valid batch memo 5'],
    ])
    expect(
      memos.every((event) => event.seq > (successful?.seq ?? Infinity) && event.seq < speech.seq),
    ).toBe(true)
  } finally {
    release?.()
    await fake.close()
  }
})

it.each([-1, 0.5, '3', null])('rejects invalid whisper room limit %s', async (whisperLimit) => {
  const response = await fetch('/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ presets: [1, 1, 1, 1, 1], language: 'en', whisperLimit }),
  })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('whisperLimit')
})

it.each(['en', 'zh'] as const)(
  'runs private rooms with localized %s requests, semantic retries and isolated projections',
  async (language) => {
    const invalid = new Set<string>()
    let nightTurn = 0
    const fake = await startFakeProvider((request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      const user = input.messages[1].content
      const seat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
      let args: Record<string, unknown>
      if (name === 'propose_whisper') {
        const fail = seat === 1 && !invalid.has('members')
        if (fail) invalid.add('members')
        args = { members: fail ? [1] : seat <= 4 ? [seat % 2 ? seat + 1 : seat - 1] : null }
      } else if (name === 'rank_whispers') {
        const fail = seat === 3 && !invalid.has('ranking')
        if (fail) invalid.add('ranking')
        args = { ranking: [fail ? 999 : seat <= 2 ? 1 : 2] }
      } else if (name === 'speak') {
        const whisper = user.includes(
          language === 'en' ? 'Only room members see the conversation.' : '内容仅房间成员可见。',
        )
        const fail = whisper && seat === 1 && !invalid.has('shot')
        if (fail) invalid.add('shot')
        args = {
          speech: whisper ? `Room secret ${seat <= 2 ? 'A' : 'B'} seat ${String(seat)}` : null,
          slayer_target: fail ? 2 : null,
        }
      } else if (name === 'nominate') args = { nominee: null }
      else args = { targets: nightTargets(user, nightTurn++) }
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({ reasoning: 'Private reasoning', ...args }),
      }
    })
    try {
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
      const opened = await $fetch<GameSummary>('/api/games', {
        method: 'POST',
        body: {
          presets: Array.from({ length: 5 }, () => model.id),
          language,
          whisperLimit: 1,
          speechLimit: 1,
        },
      })
      await expect
        .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
          timeout: 15000,
        })
        .toBe('ended')
      const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
      expect(events[0]).toMatchObject({ type: 'game.created', whisperLimit: 1 })
      expect(
        events
          .filter((event) => event.type === 'whisper.room.opened')
          .slice(0, 2)
          .map((event) => event.members)
          .sort(),
      ).toEqual([
        [1, 2],
        [3, 4],
      ])
      const errors = events.flatMap((event) =>
        event.type === 'contestant.decision' && event.attempt === 1
          ? [JSON.stringify(event.validation)]
          : [],
      )
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('invalid_whisper_members'),
          expect.stringContaining('invalid_whisper_ranking'),
          expect.stringContaining('invalid_slayer_target'),
        ]),
      )
      for (const observer of ['seat:1', 'seat:3', 'public', 'storyteller']) {
        const projection = await $fetch<GameEvent[]>(
          `/api/games/${opened.id}/events?observer=${observer}`,
        )
        const speech = projection.filter((event) => event.type === 'whisper.speech')
        if (observer === 'public') expect(speech).toEqual([])
        else if (observer === 'seat:1')
          expect(
            speech.every(
              (event) => event.members.includes(1) && !event.speech.includes('Room secret B'),
            ),
          ).toBe(true)
        else if (observer === 'seat:3')
          expect(
            speech.every(
              (event) => event.members.includes(3) && !event.speech.includes('Room secret A'),
            ),
          ).toBe(true)
        else expect(speech.length).toBeGreaterThan(0)
        expect(
          projection.some(
            (event) => event.type === 'whisper.proposed' || event.type === 'whisper.ranked',
          ),
        ).toBe(false)
      }
      const requests = fake.requests.map((request) => gameRequest.parse(request.body))
      for (const request of requests) {
        const user = request.messages[1].content
        const seat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
        expect(user).not.toContain(seat <= 2 ? 'Room secret B' : 'Room secret A')
        if (request.tool_choice.function.name === 'propose_whisper')
          expect(user).toContain(language === 'en' ? 'room entries remaining' : '本阶段还可进入')
        if (request.tool_choice.function.name === 'rank_whispers')
          expect(user).toContain(
            language === 'en'
              ? 'Candidate rooms (number: member seats)'
              : '候选房间（编号：成员座位）',
          )
      }
    } finally {
      await fake.close()
    }
  },
)

it('defaults to three private room entries and leaves a no-room round for public discussion', async () => {
  let nightTurn = 0
  const fake = await startFakeProvider((request) => {
    const input = gameRequest.parse(request.body)
    const name = input.tool_choice.function.name
    const user = input.messages[1].content
    const args =
      name === 'propose_whisper'
        ? { members: null }
        : name === 'nominate'
          ? { nominee: null }
          : name === 'speak'
            ? { speech: null, slayer_target: null }
            : { targets: nightTargets(user, nightTurn++) }
    return { kind: 'toolCall', name, arguments: JSON.stringify({ reasoning: '', ...args }) }
  })
  try {
    const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl)
    const opened = await $fetch<GameSummary>('/api/games', {
      method: 'POST',
      body: { presets: Array.from({ length: 5 }, () => model.id), language: 'en' },
    })
    await expect
      .poll(async () => (await $fetch<GameSummary>(`/api/games/${opened.id}`)).status, {
        timeout: 15000,
      })
      .toBe('ended')
    const events = await $fetch<GameEvent[]>(`/api/games/${opened.id}/events`)
    expect(events[0]).toMatchObject({ type: 'game.created', whisperLimit: 3 })
    expect(events.filter((event) => event.type === 'whisper.room.opened')).toEqual([])
    expect(events.some((event) => event.type === 'phase.started' && event.phase === 'public')).toBe(
      true,
    )
    expect(
      events.filter(
        (event) => event.type === 'contestant.decision' && event.request.tool === 'rank_whispers',
      ),
    ).toEqual([])
  } finally {
    await fake.close()
  }
})
