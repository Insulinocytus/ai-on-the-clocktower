import 'fake-indexeddb/auto'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { reactive } from 'vue'
import {
  abortGame,
  createGame,
  createPreset,
  createProvider,
  deletePreset,
  gameEvents,
  getGame,
  listGames,
  resumeGame,
  resetGameRunnersForTest,
  submitManualDiscretion,
  subscribeGame,
  trialPreset,
  updateProvider,
} from '../app/api'
import type { GameEvent } from '../shared/types/game'
import type { GameSummary } from '../shared/types/game-view'
import { startFakeProvider } from './fake-provider'
import { preset } from './game-fixtures'
import { buildContestantPrompt } from '../shared/prompts/contestant'

const toolChoice = z.object({ function: z.object({ name: z.string() }) })
const randomDiscretions = {
  D1: 'random',
  seating: 'random',
  D2: 'random',
  D3: 'random',
  D4: 'random',
  D5: 'random',
  D6: 'random',
  D7: 'random',
  D8: 'random',
  D10: 'random',
  D11: 'random',
  D12: 'random',
  D13: 'random',
  D14: 'random',
} as const

async function nightProvider() {
  const action = gameActions()
  const fake = await startFakeProvider(
    (request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      const user = input.messages.at(-1)?.content ?? ''
      const args = action(name, user)
      if (name === 'night_choice' && /as Imp|作为小恶魔/.test(currentRequestText(user))) return
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({ reasoning_summary: 'Legal action', ...args }),
      }
    },
    (request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({
          reasoning_summary: 'Recovered',
          ...action(name, input.messages.at(-1)?.content ?? ''),
        }),
      }
    },
  )
  return {
    ...fake,
    get requests() {
      return fake.requests.filter((request) => {
        const input = gameRequest.parse(request.body)
        return (
          input.tool_choice.function.name === 'night_choice' &&
          /as Imp|作为小恶魔/.test(currentRequestText(input.messages.at(-1)?.content ?? ''))
        )
      })
    },
  }
}
const gameRequest = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.string().nullable(),
      tool_calls: z
        .array(
          z.object({
            id: z.string(),
            type: z.literal('function'),
            function: z.object({ name: z.string(), arguments: z.string() }),
          }),
        )
        .optional(),
      tool_call_id: z.string().optional(),
    }),
  ),
  tool_choice: toolChoice,
})

function currentRequestText(user: string): string {
  const start = Math.max(user.lastIndexOf('# This request\n'), user.lastIndexOf('# 本次请求\n'))
  if (start < 0) throw new Error('Missing current request in fixture prompt')
  return user.slice(start)
}

function nightTargets(user: string): number[] {
  const request = currentRequestText(user)
  const domain = /Legal targets: ([^.]+)\.|合法目标：([^。]+)。/.exec(request)
  const targets = (domain?.[1] ?? domain?.[2] ?? '').match(/\d+/g)?.map(Number) ?? []
  const countMatch = /Put (\d+) legal seat|targets 填 (\d+) 个/.exec(request)
  const count = Number(countMatch?.[1] ?? countMatch?.[2])
  if (!count || targets.length < count)
    throw new Error('Missing legal night targets in fixture prompt')
  if (/as Imp|作为小恶魔|as Poisoner|作为投毒者/.test(request)) {
    const identity = /You are Seat (\d+)|你是 (\d+) 号/.exec(user)
    const seat = Number(identity?.[1] ?? identity?.[2])
    if (!targets.includes(seat)) throw new Error('Missing fixture self target')
    return [seat]
  }
  return targets.slice(0, count)
}

function gameActions() {
  const roles = new Map<number, string>()
  return (name: string, user: string): Record<string, unknown> => {
    const identity = /You are Seat (\d+)|你是 (\d+) 号/.exec(user)
    const seat = Number(identity?.[1] ?? identity?.[2])
    const role = /Your character: ([^;]+);|你的角色：([^；]+)；/.exec(user)
    roles.set(seat, role?.[1] ?? role?.[2] ?? '')
    switch (name) {
      case 'night_choice': {
        const targets = nightTargets(user)
        if (/as Monk|作为僧侣/.test(currentRequestText(user))) {
          const domain = /Legal targets: ([^.]+)\.|合法目标：([^。]+)。/.exec(
            currentRequestText(user),
          )
          const legal = (domain?.[1] ?? domain?.[2] ?? '').match(/\d+/g)?.map(Number) ?? []
          const target = legal.find((other) => !['Imp', '小恶魔'].includes(roles.get(other) ?? ''))
          if (target === undefined) throw new Error('Missing non-Imp Monk target')
          return { targets: [target] }
        }
        return { targets }
      }
      case 'speak':
        return {
          speech: /cannot pass|不能 pass/.test(user) ? 'My argument.' : null,
          slayer_target: null,
        }
      case 'nominate':
        return { nominee: null }
      case 'vote':
        return { raise_hand: !/only false is legal|只能填 false/.test(user) }
      case 'propose_whisper':
        return { members: null }
      case 'rank_whispers':
        return { ranking: [] }
      default:
        throw new Error(`Unexpected fixture tool: ${name}`)
    }
  }
}

describe('games application seam', () => {
  it('keeps a deleted preset missing from a saved game template after another preset is created', async () => {
    const original = await preset('game-test-secret')
    const savedTemplate = {
      presets: Array.from({ length: 5 }, () => original.id),
      language: 'en',
    }
    await deletePreset(original.id)
    const replacement = await createPreset({
      name: 'Replacement',
      providerId: original.providerId,
      model: 'replacement-model',
    })
    const gamesBefore = await listGames()
    await expect(createGame(savedTemplate)).rejects.toThrow('Not found')
    expect(replacement.id).toBeGreaterThan(original.id)
    expect(await listGames()).toEqual(gamesBefore)
  })

  it('accepts only the first legal manual submission and rejects submissions after abort', async () => {
    const model = await preset('game-test-secret')
    const opened = await createGame({
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
    })
    const history = () => gameEvents(opened.id)
    try {
      await expect.poll(async () => (await getGame(opened.id)).status).toBe('waiting')
      expect(Object.values(opened.config.discretions)).toEqual(
        Array.from({ length: 14 }, () => 'manual'),
      )
      expect(await listGames()).toContainEqual(
        expect.objectContaining({ id: opened.id, status: 'waiting' }),
      )
      const request = (await history()).find((event) => event.type === 'discretion.requested')
      expect(request).toMatchObject({ discretion: 'D1', source: 'manual' })
      if (!request) throw new Error('Missing manual request')
      const submit = (choice: unknown, seq = request.seq) =>
        submitManualDiscretion(opened.id, seq, choice)
      await expect(submit(['imp'])).rejects.toThrow('Illegal discretion choice')
      await expect(submit(null, request.seq + 999)).rejects.toThrow(
        'Manual discretion is no longer pending',
      )
      const choice = reactive(['chef', 'fortuneteller', 'soldier', 'poisoner', 'imp'])
      const responses = await Promise.allSettled([submit(choice), submit(choice)])
      expect(responses.filter((response) => response.status === 'fulfilled')).toHaveLength(1)
      const conflicts = responses.filter((response) => response.status === 'rejected')
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.reason).toMatchObject({
        message: 'Manual discretion is no longer pending',
        data: { choice },
      })
      await expect
        .poll(
          async () =>
            (await history()).filter((event) => event.type === 'discretion.requested').length,
        )
        .toBe(2)
      const events = await history()
      const resolved = events.filter((event) => event.type === 'discretion.resolved')
      expect(resolved).toEqual([
        expect.objectContaining({ discretion: 'D1', source: 'manual', choice }),
      ])
      expect(resolved[0]).not.toHaveProperty('decision')
      expect(resolved[0]).not.toHaveProperty('reasoningSummary')
      expect(events.some((event) => event.type === 'storyteller.decision')).toBe(false)
      const pending = events.findLast((event) => event.type === 'discretion.requested')
      if (pending?.type !== 'discretion.requested' || !Array.isArray(pending.candidates))
        throw new Error('Missing red-herring request')
      expect(pending).toMatchObject({ discretion: 'D3', source: 'manual' })
      await expect(submit(999, pending.seq)).rejects.toThrow('Illegal discretion choice')
      await abortGame(opened.id)
      await expect(submit(pending.candidates[0], pending.seq)).rejects.toMatchObject({
        message: 'Manual discretion is no longer pending',
        data: { status: 'aborted' },
      })
      expect(
        (await history()).filter((event) => event.type === 'discretion.resolved'),
      ).toHaveLength(1)
    } finally {
      await abortGame(opened.id)
    }
  })

  it('accepts a manual D10 registration with reversed object keys and rejects duplicate submissions', async () => {
    const action = gameActions()
    const fake = await startFakeProvider((request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({
          reasoning_summary: 'Legal action',
          ...action(name, input.messages.at(-1)?.content ?? ''),
        }),
      }
    })
    let gameId: string | undefined
    try {
      const model = await preset('game-test-secret', fake.baseUrl)
      const game = await createGame({
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
        discretions: { ...randomDiscretions, D1: 'manual', D10: 'manual' },
      })
      gameId = game.id
      const history = () => gameEvents(game.id)
      const pending = async () => {
        const request = (await history()).findLast(
          (event) => event.type === 'discretion.requested' && event.source === 'manual',
        )
        return request?.type === 'discretion.requested' ? request : undefined
      }
      const submit = (seq: number, choice: unknown) => submitManualDiscretion(game.id, seq, choice)
      await expect.poll(async () => (await pending())?.discretion).toBe('D1')
      const setup = await pending()
      if (!setup) throw new Error('Missing setup request')
      const roles = ['chef', 'empath', 'soldier', 'spy', 'imp']
      await expect(submit(setup.seq, roles)).resolves.toMatchObject({ choice: roles })
      await expect.poll(async () => (await pending())?.discretion).toBe('D10')
      const registration = await pending()
      if (registration?.type !== 'discretion.requested' || !Array.isArray(registration.candidates))
        throw new Error('Missing registration request')
      const candidate = z
        .object({ alignment: z.string(), role: z.string() })
        .parse(registration.candidates[0])
      const choice = { role: candidate.role, alignment: candidate.alignment }
      await expect(submit(registration.seq, choice)).resolves.toMatchObject({ choice })
      await expect(submit(registration.seq, choice)).rejects.toMatchObject({
        message: 'Manual discretion is no longer pending',
        data: { choice },
      })
      await expect.poll(async () => (await getGame(game.id)).status).toBe('ended')
      expect(await history()).toContainEqual(
        expect.objectContaining({
          type: 'discretion.resolved',
          discretion: 'D10',
          source: 'manual',
          choice,
        }),
      )
      expect(
        (await history()).filter(
          (event) => event.type === 'discretion.resolved' && event.discretion === 'D10',
        ),
      ).toHaveLength(1)
    } finally {
      if (gameId) await abortGame(gameId)
      await fake.close()
    }
  })

  it('requires a storyteller preset when a discretion uses it', async () => {
    const seat = await preset('game-test-secret')
    await expect(
      createGame({
        presets: Array.from({ length: 5 }, () => seat.id),
        language: 'en',
        discretions: { D1: 'storyteller' },
      }),
    ).rejects.toThrow('Storyteller preset is required')
  })

  it.each(['zh', 'en'])(
    'runs storyteller discretion with semantic retry in %s',
    async (language) => {
      const action = gameActions()
      let attempts = 0
      const fake = await startFakeProvider((request) => {
        const input = gameRequest.parse(request.body)
        const name = input.tool_choice.function.name
        if (name === 'decide') {
          attempts++
          return {
            kind: 'toolCall',
            name,
            arguments: JSON.stringify({
              reasoning_summary: 'Balance the game',
              roles: [
                ['soldier', 'chef', 'empath', 'scarlet_woman', 'fortune_teller'],
                ['imp'],
                ['soldier', 'chef', 'empath', 'scarletwoman', 'imp'],
              ][attempts - 1],
            }),
          }
        }
        return {
          kind: 'toolCall',
          name,
          arguments: JSON.stringify({
            reasoning_summary: 'Private contestant thought',
            ...action(name, input.messages.at(-1)?.content ?? ''),
          }),
        }
      })
      try {
        const model = await preset('game-test-secret', fake.baseUrl)
        const game = await createGame({
          presets: Array.from({ length: 5 }, () => model.id),
          storyteller: model.id,
          language,
          whisperLimit: 0,
          discretions: { ...randomDiscretions, D1: 'storyteller', seating: 'storyteller' },
        })
        await expect.poll(async () => (await getGame(game.id)).status).toBe('ended')
        const events = await gameEvents(game.id)
        const decisions = events.filter((event) => event.type === 'storyteller.decision')
        expect(decisions).toMatchObject([
          {
            attempt: 1,
            discretion: 'D1',
            validation: { ok: false, errors: [{ code: 'invalid_arguments' }] },
          },
          { attempt: 2, discretion: 'D1', validation: { ok: false } },
          { attempt: 3, discretion: 'D1', validation: { ok: true } },
        ])
        expect(events.find((event) => event.type === 'discretion.resolved')).toMatchObject({
          source: 'storyteller',
          decision: decisions[2]?.seq,
        })
        expect(events[0]).toMatchObject({
          storyteller: { id: model.id },
          discretions: { D1: 'storyteller', seating: 'storyteller' },
        })
        const requests = fake.requests.filter(
          (request) => toolChoice.parse(request.body.tool_choice).function.name === 'decide',
        )
        expect(requests).toHaveLength(3)
        const first = gameRequest.parse(requests[0]?.body)
        const second = gameRequest.parse(requests[1]?.body)
        expect(second.messages.slice(0, -1)).toEqual(first.messages.slice(0, -1))
        expect(
          second.messages.at(-1)?.content?.startsWith(first.messages.at(-1)?.content ?? ''),
        ).toBe(true)
        expect(second.messages.at(-1)?.content).toContain(
          language === 'zh' ? '上次提交无效' : 'Previous submission invalid',
        )
        expect(second.messages.at(-1)?.content).toMatch(
          /\/roles\/3 = "scarlet_woman".*scarletwoman/,
        )
        expect(second.messages.at(-1)?.content).toMatch(
          /\/roles\/4 = "fortune_teller".*fortuneteller/,
        )
        expect(requests[1]?.body.tools).toEqual(requests[0]?.body.tools)
        const tools = requests[0]?.body.tools as {
          function: { parameters: { properties: Record<string, unknown>; required: string[] } }
        }[]
        expect(tools).toHaveLength(1)
        expect(Object.keys(tools[0]?.function.parameters.properties ?? {})).toEqual([
          'reasoning_summary',
          'seats',
          'roles',
          'number',
          'answer',
          'alignment',
        ])
        expect(tools[0]?.function.parameters.required).toEqual(['reasoning_summary'])
        expect(tools[0]?.function.parameters.properties.reasoning_summary).toMatchObject({
          type: 'string',
          maxLength: 500,
        })
        for (const observer of ['public', 'seat:1'] as const)
          expect(
            (await gameEvents(game.id, observer)).some(
              (event) => event.type === 'storyteller.decision',
            ),
          ).toBe(false)
      } finally {
        await fake.close()
      }
    },
  )

  it.each([4, 16])('rejects a game with %i seats before opening it', async (seatCount) => {
    const model = await preset('game-test-secret')
    const before = await listGames()
    await expect(
      createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: seatCount }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      }),
    ).rejects.toThrow('presets')
    expect(await listGames()).toEqual(before)
  })

  it.each([5, 10, 15])('records a complete %i-seat game', async (seatCount) => {
    const action = gameActions()
    let nominated = false
    let claimed = false
    const fake = await startFakeProvider((request) => {
      const choice = toolChoice.parse(request.body.tool_choice)
      const name = choice.function.name
      const user = gameRequest.parse(request.body).messages.at(-1)?.content ?? ''
      const args = action(name, user)
      if (name === 'nominate' && !nominated && !/Your character: (Virgin|Imp);/.test(user)) {
        args.nominee = Number(/You are Seat (\d+)\./.exec(user)?.[1])
        nominated = true
      }
      if (name === 'speak' && currentRequestText(user).includes('Public discussion:') && !claimed) {
        args.speech = 'A public claim.'
        claimed = true
      }
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({
          reasoning_summary: 'Choose a legal action.',
          ...args,
        }),
      }
    })
    try {
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: seatCount }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      })
      const summary = () => getGame(opened.id)
      await expect
        .poll(async () => (await summary()).status, { timeout: 10000 })
        .not.toBe('running')
      expect(await summary()).toMatchObject({ status: 'ended', compatible: true })
      const events = await gameEvents(opened.id)
      expect(events.at(-1)).toMatchObject({ type: 'game.ended' })
      expect(events.map((event) => event.seq)).toEqual(
        Array.from({ length: events.length }, (_, index) => index + 1),
      )
      expect(events[0]).toMatchObject({
        type: 'game.created',
        seatCount,
        language: 'en',
        engineVersion: 3,
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
      const unmatched = fake.requests.map((request) => gameRequest.parse(request.body))
      const previousRequests = new Map<
        number,
        {
          messages: z.infer<typeof gameRequest>['messages']
          decision: (typeof decisions)[number]
        }
      >()
      for (const decision of decisions) {
        const prior = events.filter((event) => event.seq < decision.seq)
        const prompt = buildContestantPrompt({
          events: prior,
          seat: decision.seat,
          language: 'en',
          request: decision.request,
        })
        const match = unmatched.findIndex((request) =>
          isDeepStrictEqual(request.messages, prompt.messages),
        )
        expect(match, `request for decision seq ${String(decision.seq)}`).not.toBe(-1)
        const matched = unmatched.splice(match, 1)[0]
        if (!matched) throw new Error('Missing matched provider request')
        const messages = matched.messages
        const previous = previousRequests.get(decision.seat)
        if (previous) {
          const earlier = previous.messages
          expect(messages.slice(0, earlier.length - 1)).toEqual(earlier.slice(0, -1))
          const raw = z
            .object({
              choices: z.array(
                z.object({
                  message: z.object({
                    tool_calls: z.array(
                      z.object({
                        function: z.object({ name: z.string(), arguments: z.string() }),
                      }),
                    ),
                  }),
                }),
              ),
            })
            .parse(previous.decision.raw)
          expect(messages).toContainEqual({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call_${String(previous.decision.seq)}`,
                type: 'function',
                function: raw.choices[0]?.message.tool_calls[0]?.function,
              },
            ],
          })
        }
        previousRequests.set(decision.seat, { messages, decision })
      }
      const first = fake.requests[0]?.body
      expect(first?.tools).toHaveLength(6)
      for (const request of fake.requests) {
        const messages = request.body.messages as { role: string; content: string }[]
        expect(messages[0]?.role).toBe('system')
        expect(messages.at(-1)?.role).toBe('user')
        expect(messages[0]?.content).toContain('Death is not elimination')
        expect(messages[0]?.content).toContain('Saint')
        expect(messages[1]?.content).not.toContain('Game preset')
        expect(messages[1]?.content).not.toContain('fake-model')
        const choice = toolChoice.parse(request.body.tool_choice)
        expect(messages.at(-1)?.content).toContain(`Call ${choice.function.name}.`)
        expect(request.body).not.toHaveProperty('temperature')
        expect(request.body.tools).toEqual(first?.tools)
      }
      const seatEvents = await gameEvents(
        opened.id,
        `seat:${String(seatCount)}` as `seat:${number}`,
      )
      const tells = seatEvents.filter((event) => event.type === 'told')
      expect(tells).toContainEqual(
        expect.objectContaining({ type: 'told', seat: seatCount, kind: 'role' }),
      )
      expect(tells.every((event) => event.seat === seatCount)).toBe(true)
      await expect(gameEvents(opened.id, 'seat:16')).rejects.toThrow('observer')
      const publicEvents = await gameEvents(opened.id, 'public')
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
      expect(await gameEvents(opened.id, 'spectator', after)).toEqual(
        events.filter((event) => event.seq > after),
      )
    } finally {
      await fake.close()
    }
  })

  it('recovers from invalid arguments without changing the original prompt prefix', async () => {
    const fake = await nightProvider()
    const invalid = '{ "reasoning_summary": "retry", "targets": [] }'
    try {
      fake.script({ kind: 'toolCall', name: 'night_choice', arguments: invalid })
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'zh',
        whisperLimit: 0,
      })
      await expect.poll(async () => (await getGame(opened.id)).status).toBe('ended')
      const events = await gameEvents(opened.id)
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
      const first = fake.requests[0]?.body.messages as { role: string; content: string }[]
      const second = fake.requests[1]?.body.messages as { role: string; content: string }[]
      expect(second.slice(0, -1)).toEqual(first.slice(0, -1))
      expect(second.at(-1)?.content.startsWith(first.at(-1)?.content ?? '')).toBe(true)
      const suffix = second.at(-1)?.content.slice(first.at(-1)?.content.length)
      expect(suffix).toContain('上次提交无效（第 1 次尝试，最多 5 次）')
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
      { kind: 'toolCall', name: 'vote', arguments: '{"reasoning_summary":"r","raise_hand":true}' },
      'wrong tool',
    ],
    [
      'invalid JSON',
      { kind: 'toolCall', name: 'night_choice', arguments: '{ broken JSON' },
      'not valid JSON',
    ],
    [
      'invalid fields',
      {
        kind: 'toolCall',
        name: 'night_choice',
        arguments: '{"reasoning_summary":"r","targets":[99]}',
      },
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
                      arguments: '{"reasoning_summary":"a","targets":[1]}',
                    },
                  },
                  {
                    function: {
                      name: 'night_choice',
                      arguments: '{"reasoning_summary":"b","targets":[2]}',
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
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      })
      await expect
        .poll(async () => (await getGame(opened.id)).status, {
          timeout: 10000,
        })
        .toBe('ended')
      const first = fake.requests[0]?.body.messages as { role: string; content: string }[]
      const retried = fake.requests[1]?.body.messages as { role: string; content: string }[]
      expect(retried.slice(0, -1)).toEqual(first.slice(0, -1))
      expect(retried.at(-1)?.content.startsWith(first.at(-1)?.content ?? '')).toBe(true)
      const suffix = retried.at(-1)?.content.slice(first.at(-1)?.content.length)
      expect(suffix).toContain('Previous submission invalid (attempt 1 of at most 5)')
      expect(suffix).toContain(explanation)
      if (step.kind === 'toolCall') expect(suffix).toContain(step.arguments)
      const events = await gameEvents(opened.id)
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
        const model = await preset('game-test-secret', fake.baseUrl, 1)
        const opened = await createGame({
          discretions: randomDiscretions,
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'en',
          whisperLimit: 0,
        })
        await expect
          .poll(async () => (await getGame(opened.id)).status, {
            timeout: 10000,
          })
          .toBe('ended')
        expect(fake.requests[1]?.body).toEqual(fake.requests[0]?.body)
        expect(
          (fake.requests[1]?.receivedAt ?? 0) - (fake.requests[0]?.receivedAt ?? 0),
        ).toBeGreaterThanOrEqual(minimumDelay - 30)
        const events = await gameEvents(opened.id)
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

  it('shares the attempt limit across invalid output and transport failures, then aborts the pause as human', async () => {
    const fake = await nightProvider()
    try {
      fake.script(
        {
          kind: 'toolCall',
          name: 'night_choice',
          arguments: '{"reasoning_summary":"r","targets":[]}',
        },
        { kind: 'serverError', status: 503 },
        { kind: 'toolCall', name: 'night_choice', arguments: '{ invalid arguments' },
        {
          kind: 'toolCall',
          name: 'night_choice',
          arguments: '{"reasoning_summary":"r","targets":[]}',
        },
        { kind: 'toolCall', name: 'night_choice', arguments: '{ last invalid arguments' },
      )
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      })
      await expect.poll(async () => (await getGame(opened.id)).status).toBe('paused')
      const events = await gameEvents(opened.id)
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
        { attempt: 4, validation: { ok: false, errors: [{ code: 'invalid_targets' }] } },
        { attempt: 5, validation: { ok: false, errors: [{ code: 'invalid_arguments_json' }] } },
      ])
      expect(fake.requests).toHaveLength(5)
      expect(fake.requests[2]?.body).toEqual(fake.requests[1]?.body)
      expect(events.some((event) => event.type === 'night.choice' && event.role === 'imp')).toBe(
        false,
      )
      expect(events.at(-1)).toMatchObject({
        type: 'game.paused',
        seat: expect.any(Number) as unknown,
        error: expect.stringContaining('invalid_arguments_json') as unknown,
      })
      const aborted = await abortGame(opened.id)
      expect(aborted).toMatchObject({ status: 'aborted', reason: 'human' })
      const final = (await gameEvents(opened.id)).at(-1)
      expect(final).toMatchObject({ type: 'game.aborted', reason: 'human' })
      expect(final).not.toHaveProperty('seat')
      expect(fake.requests).toHaveLength(5)
    } finally {
      await fake.close()
    }
  })

  it('honors an HTTP-date Retry-After before resending the same request', async () => {
    const fake = await nightProvider()
    const retryAt = new Date(Date.now() + 2000).toUTCString()
    try {
      fake.script({ kind: 'rateLimit', retryAfterSec: 0, retryAfter: retryAt })
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      })
      await expect
        .poll(async () => (await getGame(opened.id)).status, {
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
      {
        kind: 'toolCall',
        name: 'night_choice',
        arguments: '{"reasoning_summary":"r","targets":[]}',
      },
    ],
  ] as const)(
    'pauses after five %s attempts, preserving the failing seat and error, then resumes on retry',
    async (_name, step) => {
      const fake = await nightProvider()
      try {
        const failures = step.kind === 'serverError' ? 6 : 5
        fake.script(...Array.from({ length: failures }, () => step))
        const model = await preset('game-test-secret', fake.baseUrl)
        const opened = await createGame({
          discretions: randomDiscretions,
          presets: Array.from({ length: 5 }, () => model.id),
          language: 'zh',
          whisperLimit: 0,
        })
        await expect
          .poll(async () => (await getGame(opened.id)).status, {
            timeout: 10000,
          })
          .toBe('paused')
        const events = await gameEvents(opened.id)
        expect(
          events.flatMap((event) =>
            event.type === 'contestant.decision' &&
            event.request.tool === 'night_choice' &&
            event.request.role === 'imp'
              ? [event.attempt]
              : [],
          ),
        ).toEqual([1, 2, 3, 4, 5])
        expect(events.at(-1)).toMatchObject({
          type: 'game.paused',
          seat: expect.any(Number) as unknown,
          error: expect.any(String) as unknown,
        })
        expect(fake.requests).toHaveLength(5)
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
          expect(third.slice(0, -1)).toEqual(second.slice(0, -1))
          expect(third.at(-1)?.content.startsWith(second.at(-1)?.content ?? '')).toBe(true)
          expect(third.at(-1)?.content).toContain('上次提交无效（第 2 次尝试，最多 5 次）')
        }
        const after = events.at(-3)?.seq ?? 0
        const received: GameEvent[] = []
        const subscriptionError = (error: unknown) => {
          throw error
        }
        const unsubscribe = subscribeGame(
          opened.id,
          'spectator',
          after,
          (event) => {
            received.push(event)
          },
          subscriptionError,
        )
        try {
          await expect.poll(() => received).toEqual(events.filter((event) => event.seq > after))
          const ids = received.map((event) => event.seq)
          expect(new Set(ids).size).toBe(ids.length)
        } finally {
          unsubscribe()
        }
        const resumed = await resumeGame(opened.id)
        expect(resumed.status).toBe('running')
        await expect
          .poll(async () => (await getGame(opened.id)).status, {
            timeout: 10000,
          })
          .toBe('ended')
        const finished = await gameEvents(opened.id)
        const pausedAt = finished.find((event) => event.type === 'game.paused')?.seq ?? 0
        expect(
          finished.filter((event) => event.type === 'game.resumed').map((event) => event.seq),
        ).toEqual([expect.any(Number)])
        expect(finished.find((event) => event.type === 'game.resumed')?.seq).toBeGreaterThan(
          pausedAt,
        )
        expect(
          finished.find(
            (event) =>
              event.type === 'contestant.decision' &&
              event.request.tool === 'night_choice' &&
              event.request.role === 'imp' &&
              event.attempt === failures + 1,
          ),
        ).toMatchObject({ validation: { ok: true } })
        if (step.kind === 'serverError') {
          const gap = (fake.requests[6]?.receivedAt ?? 0) - (fake.requests[5]?.receivedAt ?? 0)
          expect(gap).toBeGreaterThanOrEqual(220)
          expect(gap).toBeLessThan(2000)
        } else {
          const sixth = fake.requests[5]?.body.messages as { content: string }[]
          expect(sixth.at(-1)?.content).toContain('上次提交无效（第 5 次尝试，最多 10 次）')
        }
        await expect(resumeGame(opened.id)).rejects.toThrow('Game is not paused')
      } finally {
        await fake.close()
      }
    },
  )
  it('aborts an in-flight game once without recording the canceled decision or further requests', async () => {
    const fake = await startFakeProvider()
    try {
      fake.script({ kind: 'hang' })
      const model = await preset('game-test-secret', fake.baseUrl, 300, 1)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        whisperLimit: 0,
      })
      await expect.poll(() => fake.requests.length).toBe(1)
      expect(await abortGame(opened.id)).toMatchObject({
        status: 'aborted',
        reason: 'human',
      })
      await abortGame(opened.id)
      await expect.poll(() => fake.requests[0]?.closed).toBe(true)
      const events = await gameEvents(opened.id)
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
      const provider = await createProvider({
        name: 'Shared queue',
        baseUrl: fake.baseUrl,
        apiKey: 'game-test-secret',
        maxConcurrency: 1,
      })
      for (const name of ['first', 'canceled', 'third']) {
        const model = await createPreset({ name, model: name, providerId: provider.id })
        games.push(
          await createGame({
            discretions: randomDiscretions,
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'en',
            whisperLimit: 0,
          }),
        )
        if (name === 'first') await expect.poll(() => fake.requests.length).toBe(1)
      }
      await expect.poll(() => fake.requests.length).toBeGreaterThan(0)
      expect(fake.requests).toHaveLength(1)
      const [first, canceled, third] = games
      if (!first || !canceled || !third) throw new Error('Missing game')
      await abortGame(canceled.id)
      expect(fake.requests).toHaveLength(1)
      await abortGame(first.id)
      await expect.poll(() => fake.requests.length).toBe(2)
      expect(fake.requests.map((request) => request.body.model)).toEqual(['first', 'third'])
      const events = await gameEvents(canceled.id)
      expect(events.some((event) => event.type === 'contestant.decision')).toBe(false)
    } finally {
      for (const game of games) await abortGame(game.id)
      await fake.close()
    }
  })

  it('reads updated provider capacity when granting queued calls', async () => {
    const fake = await startFakeProvider()
    const gate = Promise.withResolvers<undefined>()
    const calls: Promise<unknown>[] = []
    try {
      const model = await preset('game-test-secret', fake.baseUrl, 300, 1)
      fake.script(
        {
          kind: 'toolCall',
          name: 'speak',
          arguments: '{"reasoning_summary":"r","speech":null,"slayer_target":null}',
          waitFor: gate.promise,
        },
        { kind: 'hang' },
        { kind: 'hang' },
      )
      calls.push(trialPreset(model.id, { lang: 'en' }))
      await expect.poll(() => fake.requests.length).toBe(1)
      for (const name of ['second', 'third']) {
        const queued = await createPreset({ name, model: name, providerId: model.providerId })
        calls.push(trialPreset(queued.id, { lang: 'en' }))
      }
      await updateProvider(model.providerId, {
        name: 'Updated',
        baseUrl: fake.baseUrl,
        apiKey: 'game-test-secret',
        maxConcurrency: 2,
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
      // Exercise the real provider timeout, not the Vitest clock.
      const model = await preset('game-test-secret', fake.baseUrl, 1, 1)
      fake.script(
        { kind: 'hang' },
        {
          kind: 'toolCall',
          name: 'speak',
          arguments: '{"reasoning_summary":"r","speech":null,"slayer_target":null}',
          waitFor: gate.promise,
        },
      )
      calls.push(trialPreset(model.id, { lang: 'en' }))
      await expect.poll(() => fake.requests.length).toBe(1)
      calls.push(trialPreset(model.id, { lang: 'en' }))
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
      const model = await preset('game-test-secret', fake.baseUrl, 300, 1)
      for (let i = 0; i < 20; i++) fake.script({ kind: 'rateLimit', retryAfterSec: 60 })
      for (const name of ['backoff', 'other-game']) {
        const contestant = await createPreset({ name, model: name, providerId: model.providerId })
        games.push(
          await createGame({
            discretions: randomDiscretions,
            presets: Array.from({ length: 5 }, () => contestant.id),
            language: 'en',
            whisperLimit: 0,
          }),
        )
      }
      await expect
        .poll(() => fake.requests.some((request) => request.body.model === 'other-game'))
        .toBe(true)
      for (const game of games) {
        await abortGame(game.id)
        const events = await gameEvents(game.id)
        expect(
          events
            .filter((event) => event.type === 'contestant.decision')
            .every((event) => event.attempt === 1),
        ).toBe(true)
        expect(events.at(-1)).toMatchObject({ type: 'game.aborted', reason: 'human' })
      }
    } finally {
      for (const game of games) await abortGame(game.id)
      await fake.close()
    }
  })

  it('keeps different provider ids independent even when their URLs are identical', async () => {
    const fake = await startFakeProvider()
    const games: GameSummary[] = []
    try {
      fake.script({ kind: 'hang' }, { kind: 'hang' })
      for (let index = 0; index < 2; index++) {
        const model = await preset('game-test-secret', fake.baseUrl, 300, 1)
        games.push(
          await createGame({
            discretions: randomDiscretions,
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'en',
            whisperLimit: 0,
          }),
        )
      }
      await expect.poll(() => fake.requests.length).toBe(2)
      expect(fake.requests.every((request) => !request.closed)).toBe(true)
    } finally {
      for (const game of games) await abortGame(game.id)
      await fake.close()
    }
  })
})

it.each([0, -1, 1.5, '2', null])(
  'rejects invalid per-conversation speech limit %s',
  async (speechLimit) => {
    await expect(
      createGame({
        discretions: randomDiscretions,
        presets: [1, 1, 1, 1, 1],
        language: 'en',
        whisperLimit: 0,
        speechLimit,
      }),
    ).rejects.toThrow('speechLimit')
  },
)

it('isolates public batches, logs decisions immediately, and retains old speech across days', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const roles = new Map<string, number>()
  const offers = new Map<string, number>()
  const captured: { seat: number; day: number; tool: string; prefix: string; system: string }[] = []
  const action = gameActions()
  const fake = await startFakeProvider(async (request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages.at(-1)?.content ?? ''
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    const day = Number(/# Current public state\nDay (\d+);/.exec(user)?.[1])
    const role = /Your character: ([^;]+);/.exec(user)?.[1] ?? ''
    const tool = input.tool_choice.function.name
    const defaults = action(tool, user)
    roles.set(role, seat)
    if (tool !== 'night_choice' && tool !== 'speak')
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({ reasoning_summary: 'Pass', ...defaults }),
      }
    if (tool === 'night_choice') {
      const victims = [...roles]
        .filter(([character]) => !['Imp', 'Scarlet Woman', 'Soldier', 'Mayor'].includes(character))
        .map(([, target]) => target)
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({
          reasoning_summary: 'Advance the night.',
          targets:
            role === 'Imp'
              ? [day <= 3 ? victims[0] : seat]
              : role === 'Monk'
                ? [
                    [...roles.values()].find(
                      (target) =>
                        target !== seat && target !== roles.get('Imp') && target !== victims[0],
                    ),
                  ]
                : defaults.targets,
        }),
      }
    }
    captured.push({
      seat,
      day,
      tool,
      prefix: input.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content?.split('# Your identity')[0])
        .join('\n'),
      system: input.messages[0]?.content ?? '',
    })
    const key = `${String(day)}:${String(seat)}`
    const offer = (offers.get(key) ?? 0) + 1
    offers.set(key, offer)
    if (day === 1 && seat === 5 && offer === 1) await pending
    const args = {
      reasoning_summary: 'Private offer, not spoken.',
      speech: `SPEECH-D${String(day)}-S${String(seat)}-O${String(offer)}`,
      slayer_target: null,
    }
    return { kind: 'toolCall', name: tool, arguments: JSON.stringify(args) }
  })
  try {
    const model = await preset('game-test-secret', fake.baseUrl)
    const opened = await createGame({
      discretions: randomDiscretions,
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
      whisperLimit: 0,
      speechLimit: 1,
    })
    const log = () => gameEvents(opened.id)
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
      .poll(async () => (await getGame(opened.id)).status, {
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
        expect(request.prefix).toContain('SPEECH-D1-')
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

it('records accepted pass and unselected public-speech decisions and rejects invalid shots', async () => {
  const action = gameActions()
  const attempts = new Map<number, number>()
  const fake = await startFakeProvider((request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages.at(-1)?.content ?? ''
    const tool = input.tool_choice.function.name
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    const args = action(tool, user)
    if (tool !== 'speak')
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({ reasoning_summary: 'Advance', ...args }),
      }
    const attempt = (attempts.get(seat) ?? 0) + 1
    attempts.set(seat, attempt)
    const firstOffer = attempt === 1 && seat <= 2
    return {
      kind: 'toolCall',
      name: tool,
      arguments: JSON.stringify({
        reasoning_summary: 'Choose whether to speak',
        speech: firstOffer ? `Unselected-or-selected offer from Seat ${String(seat)}` : null,
        slayer_target: seat === 4 && attempt === 1 ? 1 : null,
      }),
    }
  })
  try {
    const model = await preset('game-test-secret', fake.baseUrl)
    const opened = await createGame({
      discretions: randomDiscretions,
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
      whisperLimit: 0,
      speechLimit: 1,
    })
    await expect
      .poll(async () => (await getGame(opened.id)).status, {
        timeout: 10000,
      })
      .toBe('ended')
    const events = await gameEvents(opened.id)
    const speeches = events.filter((event) => event.type === 'public.speech')
    expect(speeches).toHaveLength(1)
    const selected = speeches[0]
    if (!selected) throw new Error('Missing selected speech')
    const unselected = selected.seat === 1 ? 2 : 1
    expect(selected.seat).toBeOneOf([1, 2])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'contestant.decision',
        seat: 3,
        validation: { ok: true, errors: [] },
      }),
    )
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

it('retries only the failing public seat and commits speech after the whole batch succeeds', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const action = gameActions()
  const attempts = new Map<number, number>()
  const fake = await startFakeProvider(async (request) => {
    const input = gameRequest.parse(request.body)
    const user = input.messages.at(-1)?.content ?? ''
    const tool = input.tool_choice.function.name
    const seat = Number(/You are Seat (\d+)\./.exec(user)?.[1])
    const args = action(tool, user)
    if (tool !== 'speak')
      return {
        kind: 'toolCall',
        name: tool,
        arguments: JSON.stringify({ reasoning_summary: 'Advance', ...args }),
      }
    const firstBatch =
      user.includes('# Current public state\nDay 1;') && !user.includes('Recovered public claim.')
    if (!firstBatch)
      return {
        kind: 'toolCall',
        name: tool,
        arguments: '{"reasoning_summary":"Pass","speech":null,"slayer_target":null}',
      }
    const attempt = (attempts.get(seat) ?? 0) + 1
    attempts.set(seat, attempt)
    if (seat === 5 && attempt === 2) await pending
    return {
      kind: 'toolCall',
      name: tool,
      arguments: JSON.stringify({
        reasoning_summary: 'Answer my own request independently',
        speech: seat === 5 && attempt === 2 ? 'Recovered public claim.' : null,
        slayer_target: seat === 5 && attempt === 1 ? 1 : null,
      }),
    }
  })
  try {
    const model = await preset('game-test-secret', fake.baseUrl)
    const opened = await createGame({
      discretions: randomDiscretions,
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
      whisperLimit: 0,
      speechLimit: 1,
    })
    const log = () => gameEvents(opened.id)
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
    expect(blocked.filter((event) => event.type === 'public.speech')).toEqual([])
    expect(blocked.at(-1)?.type).not.toBe('game.aborted')
    release?.()
    await expect
      .poll(async () => (await getGame(opened.id)).status, {
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
                      reasoning_summary: 'Answer my own request independently',
                      speech: 'Recovered public claim.',
                      slayer_target: null,
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    })
  } finally {
    release?.()
    await fake.close()
  }
})

it.each([-1, 0.5, '3', null])('rejects invalid whisper room limit %s', async (whisperLimit) => {
  await expect(
    createGame({
      discretions: randomDiscretions,
      presets: [1, 1, 1, 1, 1],
      language: 'en',
      whisperLimit,
    }),
  ).rejects.toThrow('whisperLimit')
})

it.each(['en', 'zh'] as const)(
  'runs private rooms with localized %s requests, semantic retries and isolated projections',
  async (language) => {
    const invalid = new Set<string>()
    const action = gameActions()
    const fake = await startFakeProvider((request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      const user = input.messages.at(-1)?.content ?? ''
      const seat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
      let args = action(name, user)
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
      }
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({ reasoning_summary: 'Private thought', ...args }),
      }
    })
    try {
      const model = await preset('game-test-secret', fake.baseUrl)
      const opened = await createGame({
        discretions: randomDiscretions,
        presets: Array.from({ length: 5 }, () => model.id),
        language,
        whisperLimit: 1,
        speechLimit: 1,
      })
      await expect
        .poll(async () => (await getGame(opened.id)).status, {
          timeout: 15000,
        })
        .toBe('ended')
      const events = await gameEvents(opened.id)
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
      for (const observer of ['seat:1', 'seat:3', 'public', 'storyteller'] as const) {
        const projection = await gameEvents(opened.id, observer)
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
        const user = request.messages.at(-1)?.content ?? ''
        const seat = Number(/(?:You are Seat |你是 )(\d+)/.exec(user)?.[1])
        expect(JSON.stringify(request.messages)).not.toContain(
          seat <= 2 ? 'Room secret B' : 'Room secret A',
        )
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
  const action = gameActions()
  const fake = await startFakeProvider((request) => {
    const input = gameRequest.parse(request.body)
    const name = input.tool_choice.function.name
    const user = input.messages.at(-1)?.content ?? ''
    const args = action(name, user)
    return { kind: 'toolCall', name, arguments: JSON.stringify({ reasoning_summary: '', ...args }) }
  })
  try {
    const model = await preset('game-test-secret', fake.baseUrl)
    const opened = await createGame({
      discretions: randomDiscretions,
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
    })
    await expect
      .poll(async () => (await getGame(opened.id)).status, {
        timeout: 15000,
      })
      .toBe('ended')
    const events = await gameEvents(opened.id)
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

it('replays completed seats in a partial batch and requests only the missing seats after refresh', async () => {
  const action = gameActions()
  let interrupted = false
  const fake = await startFakeProvider((request) => {
    const input = gameRequest.parse(request.body)
    const name = input.tool_choice.function.name
    const user = input.messages.at(-1)?.content ?? ''
    if (name === 'decide')
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({
          reasoning_summary: 'Setup',
          roles: ['soldier', 'chef', 'empath', 'scarletwoman', 'imp'],
        }),
      }
    if (name === 'speak' && !interrupted && !user.includes('You are Seat 5.'))
      return { kind: 'hang' }
    return {
      kind: 'toolCall',
      name,
      arguments: JSON.stringify({ reasoning_summary: 'Replay', ...action(name, user) }),
    }
  })
  let id: string | undefined
  try {
    const model = await preset('replay', fake.baseUrl)
    const game = await createGame({
      presets: Array.from({ length: 5 }, () => model.id),
      storyteller: model.id,
      language: 'en',
      discretions: { ...randomDiscretions, D1: 'storyteller', seating: 'storyteller' },
      whisperLimit: 0,
    })
    id = game.id
    await expect
      .poll(
        async () =>
          (await gameEvents(game.id)).filter(
            (event) => event.type === 'contestant.decision' && event.request.tool === 'speak',
          ).length,
      )
      .toBe(1)
    await expect
      .poll(
        () =>
          fake.requests.filter(
            (request) => gameRequest.parse(request.body).tool_choice.function.name === 'speak',
          ).length,
      )
      .toBe(5)
    await resetGameRunnersForTest()
    const before = await gameEvents(game.id)
    expect(await getGame(game.id)).toMatchObject({ status: 'paused' })
    interrupted = true
    const requestsBefore = fake.requests.length
    await resumeGame(game.id)
    await expect.poll(async () => (await getGame(game.id)).status, { timeout: 10000 }).toBe('ended')
    const after = await gameEvents(game.id)
    expect(after.slice(0, before.length)).toEqual(before)
    const decisionsBefore = before.filter((event) => event.type === 'contestant.decision').length
    const decisionsAfter = after.filter((event) => event.type === 'contestant.decision').length
    expect(fake.requests.length - requestsBefore).toBe(decisionsAfter - decisionsBefore)
    const answeredRequest = fake.requests.slice(0, requestsBefore).find((request) => {
      const input = gameRequest.parse(request.body)
      return (
        input.tool_choice.function.name === 'speak' &&
        input.messages.at(-1)?.content?.includes('You are Seat 5.')
      )
    })
    expect(fake.requests.slice(requestsBefore).map((request) => request.body)).not.toContainEqual(
      answeredRequest?.body,
    )
  } finally {
    if (id) await abortGame(id)
    await fake.close()
  }
})

it.each(['invalid', 'transport'] as const)(
  'continues %s attempts and resumes a persisted decision-failure pause after refresh',
  async (failure) => {
    const fake = await nightProvider()
    let id: string | undefined
    try {
      fake.script(
        ...Array.from({ length: 5 }, () =>
          failure === 'invalid'
            ? {
                kind: 'toolCall' as const,
                name: 'night_choice',
                arguments: '{"reasoning_summary":"retry","targets":[]}',
              }
            : { kind: 'serverError' as const, status: 503 },
        ),
      )
      const model = await preset('replay', fake.baseUrl)
      const game = await createGame({
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        discretions: randomDiscretions,
        whisperLimit: 0,
      })
      id = game.id
      await expect
        .poll(async () => (await getGame(game.id)).status, { timeout: 10000 })
        .toBe('paused')
      await resetGameRunnersForTest()
      const before = await gameEvents(game.id)
      await resumeGame(game.id)
      await expect
        .poll(async () => (await getGame(game.id)).status, { timeout: 10000 })
        .toBe('ended')
      const after = await gameEvents(game.id)
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after[before.length]).toMatchObject({ type: 'game.resumed' })
      const next = after.slice(before.length).find((event) => event.type === 'contestant.decision')
      expect(next).toMatchObject({ attempt: 6, validation: { ok: true } })
      if (failure === 'invalid') {
        const prompt = gameRequest.parse(fake.requests[5]?.body).messages.at(-1)?.content
        expect(prompt).toContain('attempt 5 of at most 10')
      }
    } finally {
      if (id) await abortGame(id)
      await fake.close()
    }
  },
)

it('continues an unfinished decision from its next attempt after refresh', async () => {
  const fake = await nightProvider()
  let id: string | undefined
  try {
    fake.script(
      { kind: 'toolCall', name: 'night_choice', arguments: '{}' },
      { kind: 'toolCall', name: 'night_choice', arguments: '{}' },
      { kind: 'hang' },
    )
    const model = await preset('replay', fake.baseUrl)
    const game = await createGame({
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
      discretions: randomDiscretions,
      whisperLimit: 0,
    })
    id = game.id
    await expect.poll(() => fake.requests.length).toBe(3)
    await resetGameRunnersForTest()
    const before = await gameEvents(game.id)
    await resumeGame(game.id)
    await expect.poll(async () => (await getGame(game.id)).status, { timeout: 10000 }).toBe('ended')
    const after = await gameEvents(game.id)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(
      after.slice(before.length).find((event) => event.type === 'contestant.decision'),
    ).toMatchObject({ attempt: 3, validation: { ok: true } })
    expect(after.some((event) => event.type === 'game.resumed')).toBe(false)
    expect(fake.requests[3]?.body).toEqual(fake.requests[2]?.body)
  } finally {
    if (id) await abortGame(id)
    await fake.close()
  }
})

it.each(['within', 'after'] as const)(
  'continues %s concurrent whisper rooms after a refresh without rewriting events',
  async (checkpoint) => {
    const action = gameActions()
    let refreshed = false
    const fake = await startFakeProvider((request) => {
      const input = gameRequest.parse(request.body)
      const name = input.tool_choice.function.name
      const user = input.messages.at(-1)?.content ?? ''
      const seat = Number(/You are Seat (\d+)/.exec(user)?.[1])
      const whisper = currentRequestText(user).includes('Only room members see the conversation.')
      let args = action(name, user)
      if (name === 'propose_whisper')
        args = { members: seat <= 4 ? [seat % 2 ? seat + 1 : seat - 1] : null }
      if (name === 'rank_whispers') args = { ranking: [seat <= 2 ? 1 : 2] }
      if (name === 'speak' && whisper)
        args = { speech: `Room ${String(seat)} secret`, slayer_target: null }
      if (
        !refreshed &&
        name === 'speak' &&
        (checkpoint === 'within' ? whisper && seat >= 3 : !whisper)
      )
        return { kind: 'hang' }
      return {
        kind: 'toolCall',
        name,
        arguments: JSON.stringify({ reasoning_summary: 'Recovery', ...args }),
      }
    })
    let id: string | undefined
    try {
      const model = await preset('replay-whispers', fake.baseUrl)
      const game = await createGame({
        presets: Array.from({ length: 5 }, () => model.id),
        language: 'en',
        discretions: randomDiscretions,
        whisperLimit: 1,
        speechLimit: 2,
      })
      id = game.id
      await expect
        .poll(async () => {
          const events = await gameEvents(game.id)
          return checkpoint === 'within'
            ? events.some((event) => event.type === 'whisper.speech')
            : events.filter((event) => event.type === 'whisper.room.closed').length >= 2
        })
        .toBe(true)
      await resetGameRunnersForTest()
      const before = await gameEvents(game.id)
      expect(before.filter((event) => event.type === 'whisper.room.opened')).toHaveLength(2)
      refreshed = true
      await resumeGame(game.id)
      await expect
        .poll(async () => (await getGame(game.id)).status, { timeout: 10000 })
        .toBe('ended')
      const after = await gameEvents(game.id)
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after.map((event) => event.seq)).toEqual(after.map((_, index) => index + 1))
    } finally {
      if (id) await abortGame(id)
      await fake.close()
    }
  },
)
