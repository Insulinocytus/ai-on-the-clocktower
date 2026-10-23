import { describe, expect, it } from 'vitest'
import { createRng, runGame } from '../shared/game/rules'
import { spectatorRows } from '../shared/game/spectator'
import type { ChatMessage } from '../shared/game/tool-calls'
import { buildContestantPrompt } from '../shared/prompts/contestant'
import { buildStorytellerPrompt } from '../shared/prompts/storyteller'
import type {
  ContestantChoice,
  ContestantRequest,
  GameConfig,
  GameEvent,
  Ports,
  RoleId,
} from '../shared/types/game'

const CONFIG: GameConfig = {
  seatCount: 5,
  seats: [],
  storyteller: null,
  discretions: {
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
  },
  speechLimit: 1,
  whisperLimit: 0,
  language: 'en',
  seed: 18,
  engineVersion: 3,
}

function pass(request: ContestantRequest): ContestantChoice {
  switch (request.tool) {
    case 'night_choice':
      return {
        reasoning_summary: 'Choose',
        targets: request.targets.slice(0, request.role === 'fortuneteller' ? 2 : 1),
      }
    case 'speak':
      return { reasoning_summary: 'Pass', speech: null, slayer_target: null }
    case 'nominate':
      return { reasoning_summary: 'Pass', nominee: null }
    case 'vote':
      return { reasoning_summary: 'Pass', raise_hand: false }
    case 'propose_whisper':
      return { reasoning_summary: 'Pass', members: null }
    case 'rank_whispers':
      return { reasoning_summary: 'Accept', ranking: request.rooms.map((room) => room.id) }
  }
}

function decide(ports: Ports, request: ContestantRequest, choice: ContestantChoice) {
  void ports.commit({
    type: 'contestant.decision',
    seat: request.seat,
    request,
    raw: {
      choices: [
        {
          message: {
            tool_calls: [{ function: { name: request.tool, arguments: JSON.stringify(choice) } }],
          },
        },
      ],
    },
    model: 'script',
    usage: null,
    durationMs: 0,
    attempt: 1,
    validation: { ok: true, errors: [] },
  })
  return request.tool === 'speak' ? { ...choice, decision: ports.log.length } : choice
}

async function script(
  roles: RoleId[],
  options: {
    config?: Partial<GameConfig>
    ask: (request: ContestantRequest, ports: Ports) => ContestantChoice
    discretion?: Ports['discretion']
  },
) {
  const config = { ...CONFIG, ...options.config, seatCount: roles.length }
  const events: GameEvent[] = [{ seq: 1, type: 'game.created', ...config }]
  const ports: Ports = {
    config,
    log: events,
    rng: createRng(config.seed),
    commit(input) {
      const event = { ...input, seq: events.length + 1 }
      events.push(event)
      return event
    },
    async discretion(id, candidates, context, requestSeq) {
      if (options.discretion) return options.discretion(id, candidates, context, requestSeq)
      if (id === 'D1') return { choice: roles }
      if (!Array.isArray(candidates) || candidates[0] === undefined)
        throw new Error(`Missing scripted ${id} choice`)
      return { choice: candidates[0] }
    },
    askContestants: (batch) => Promise.resolve(batch.map((request) => options.ask(request, ports))),
  }
  return { state: await runGame(ports), events }
}

describe('prompts at the scripted game seam', () => {
  it.each(['zh', 'en'] as const)(
    'offers all 15 Slayer targets in the %s speak request',
    async (language) => {
      const roles: RoleId[] = [
        'chef',
        'empath',
        'fortuneteller',
        'undertaker',
        'monk',
        'virgin',
        'slayer',
        'soldier',
        'mayor',
        'butler',
        'saint',
        'poisoner',
        'spy',
        'scarletwoman',
        'imp',
      ]
      let user = ''
      const { state } = await script(roles, {
        config: { language },
        ask(request, ports) {
          if (request.tool === 'speak' && request.kind === 'free' && !user) {
            const message = buildContestantPrompt({
              events: ports.log,
              seat: request.seat,
              language,
              request,
            }).messages.at(-1)
            if (message?.role !== 'user') throw new Error('Expected the current request last')
            user = message.content
            void ports.commit({ type: 'game.aborted', reason: 'human' })
          }
          return pass(request)
        },
      })
      expect(state.aborted).toBe(true)
      expect(user).toContain(language === 'zh' ? '目标座位号（1–15）' : 'seat number (1–15)')
      expect(user).not.toContain('1–5')
    },
  )

  it.each(['zh', 'en'] as const)(
    'retains day-one speeches for the storyteller and contestant on night three in %s',
    async (language) => {
      const roles: RoleId[] = ['soldier', 'empath', 'chef', 'poisoner', 'imp']
      let log: readonly GameEvent[] = []
      let storyteller = ''
      let contestant = ''
      const { state } = await script(roles, {
        config: { language, whisperLimit: 1 },
        discretion(id, candidates, context) {
          if (id === 'D1') return Promise.resolve({ choice: roles })
          if (id === 'D8' && context.day === 3)
            storyteller = buildStorytellerPrompt(
              { ...CONFIG, language, whisperLimit: 1 },
              log,
              id,
              candidates,
              context,
            ).messages[1].content
          if (!Array.isArray(candidates) || candidates[0] === undefined)
            throw new Error(`Missing scripted ${id} choice`)
          return Promise.resolve({ choice: candidates[0] })
        },
        ask(request, ports) {
          log = ports.log
          if (request.tool === 'night_choice')
            return { reasoning_summary: 'Choose', targets: [request.role === 'poisoner' ? 2 : 1] }
          if (request.tool === 'propose_whisper' && request.day === 1 && request.seat === 1)
            return { reasoning_summary: 'Invite', members: [2] }
          if (request.tool === 'speak' && request.seat === 1) {
            if (request.day === 3 && request.kind === 'free') {
              const message = buildContestantPrompt({
                events: log,
                seat: request.seat,
                language,
                request,
              }).messages.at(-1)
              if (message?.role !== 'user') throw new Error('Expected the current request last')
              contestant = message.content
              void ports.commit({ type: 'game.aborted', reason: 'human' })
            }
            if (request.day <= 2)
              return {
                reasoning_summary: 'Share',
                speech:
                  request.kind === 'whisper'
                    ? 'DAY_ONE_WHISPER'
                    : `DAY_${String(request.day)}_PUBLIC`,
                slayer_target: null,
              }
          }
          return pass(request)
        },
      })
      expect(state.aborted).toBe(true)
      for (const speech of ['DAY_ONE_WHISPER', 'DAY_1_PUBLIC']) {
        expect(storyteller).toContain(speech)
        expect(contestant).toContain(speech)
      }
      expect(contestant).toContain('DAY_2_PUBLIC')
    },
  )

  it.each(['zh', 'en'] as const)(
    'does not carry unselected speeches forward into contestant prompts in %s',
    async (language) => {
      const prompts: ChatMessage[][] = []
      let count = 0
      const { events } = await script(['soldier', 'empath', 'chef', 'poisoner', 'imp'], {
        config: { language },
        ask(request, ports) {
          if (request.tool === 'nominate') {
            prompts.push(
              buildContestantPrompt({ events: ports.log, seat: request.seat, language, request })
                .messages,
            )
            if (prompts.length === 5) void ports.commit({ type: 'game.aborted', reason: 'human' })
          }
          const choice =
            request.tool === 'speak' && request.kind === 'free'
              ? { reasoning_summary: 'Say', speech: `SAY_${String(++count)}_`, slayer_target: null }
              : pass(request)
          return decide(ports, request, choice)
        },
      })
      const spoken = new Set(
        events.flatMap((event) => (event.type === 'public.speech' ? [event.speech] : [])),
      )
      const offered = Array.from({ length: count }, (_, index) => `SAY_${String(index + 1)}_`)
      const unselected = offered.filter((speech) => !spoken.has(speech))
      const carried = prompts.flatMap((messages) =>
        messages.flatMap((message) =>
          message.role === 'assistant'
            ? message.tool_calls.map((call) => call.function.arguments)
            : [],
        ),
      )
      expect(prompts).toHaveLength(5)
      expect(unselected.length).toBeGreaterThan(0)
      for (const speech of spoken) expect(carried.join()).toContain(speech)
      for (const messages of prompts)
        for (const speech of unselected) expect(JSON.stringify(messages)).not.toContain(speech)
    },
  )

  it('carries passes, whisper proposals and rankings forward into contestant prompts', async () => {
    let prompt = ''
    let seat = 0
    const adopted: { seat: number; tool: string; summary: string }[] = []
    await script(['soldier', 'empath', 'chef', 'poisoner', 'imp'], {
      config: { whisperLimit: 1 },
      ask(request, ports) {
        if (request.tool === 'nominate' && request.day === 2 && !prompt) {
          seat = request.seat
          prompt = JSON.stringify(
            buildContestantPrompt({ events: ports.log, seat, language: 'en', request }).messages,
          )
          void ports.commit({ type: 'game.aborted', reason: 'human' })
        }
        const summary = `ADOPTED_${String(ports.log.length)}_`
        if (request.day === 1) adopted.push({ seat: request.seat, tool: request.tool, summary })
        const choice =
          request.tool === 'propose_whisper'
            ? {
                reasoning_summary: summary,
                members: request.eligible.filter((other) => other !== request.seat).slice(0, 1),
              }
            : { ...pass(request), reasoning_summary: summary }
        return decide(ports, request, choice)
      },
    })
    const own = adopted.filter((entry) => entry.seat === seat)
    expect(new Set(own.map((entry) => entry.tool))).toEqual(
      new Set(['propose_whisper', 'rank_whispers', 'speak', 'nominate']),
    )
    for (const { summary } of own) expect(prompt).toContain(summary)
  })

  it.each([
    {
      arguments: '{"reasoning_summary":"FIRST_REASON","speech":"First","nominee":2}',
      reasoningSummary: 'FIRST_REASON',
    },
    { arguments: '{invalid JSON', reasoningSummary: undefined },
    { arguments: '{"reasoning_summary":42}', reasoningSummary: undefined },
  ])(
    'keeps spectator argument validation for $arguments',
    async ({ arguments: args, reasoningSummary }) => {
      let captured = false
      const { events } = await script(['soldier', 'empath', 'chef', 'poisoner', 'imp'], {
        ask(request, ports) {
          if (request.tool === 'speak' && request.kind === 'free' && !captured) {
            captured = true
            void ports.commit({
              type: 'contestant.decision',
              seat: request.seat,
              request,
              raw: {
                choices: [
                  {
                    message: {
                      tool_calls: [
                        { function: { name: 'speak', arguments: args } },
                        {
                          function: {
                            name: 'speak',
                            arguments: '{"reasoning_summary":"SECOND_REASON"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              model: 'script',
              usage: null,
              durationMs: 0,
              attempt: 1,
              validation: { ok: false },
            })
            void ports.commit({ type: 'game.aborted', reason: 'human' })
          }
          return pass(request)
        },
      })
      const row = spectatorRows(events, true).find((row) => row.losing)
      expect(row).toBeDefined()
      expect(row?.event.type).toBe('contestant.decision')
      expect(row?.reasoningSummary).toBe(reasoningSummary)
    },
  )
})
