import { describe, expect, it } from 'vitest'
import {
  apply,
  createRng,
  fold,
  foldPublic,
  project,
  runGame,
  sample,
  validate,
  validateNightChoice,
  visibleTo,
  validateSpeechChoice,
  winner,
} from '../shared/game/rules'
import { ROLES } from '../shared/game/roles'
import { renderEvent } from '../shared/event-templates'
import type {
  ContestantChoice,
  ContestantRequest,
  GameConfig,
  GameEvent,
  GameEventInput,
  NightRequest,
  Observer,
  Ports,
  RoleId,
  SeatState,
  SpeechChoice,
  SpeechRequest,
} from '../shared/types/game'

describe('five-seat setup', () => {
  it('samples three distinct implemented Townsfolk, Scarlet Woman and Imp from a reproducible seed', () => {
    const roles = sample(createRng(18))
    expect(roles).toHaveLength(5)
    expect(roles.filter((role) => ROLES[role].type === 'townsfolk')).toHaveLength(3)
    expect(roles).toContain('scarletwoman')
    expect(roles).toContain('imp')
    expect(sample(createRng(18))).toEqual(roles)
    expect(validate(roles)).toEqual([])
    const sampled = new Set(
      Array.from({ length: 100 }, (_, seed) => sample(createRng(seed))).flat(),
    )
    for (const role of [
      'washerwoman',
      'librarian',
      'investigator',
      'fortuneteller',
      'undertaker',
      'ravenkeeper',
    ])
      expect(sampled.has(role as RoleId)).toBe(true)
  })
})

const PUBLIC_TYPES = [
  'phase.started',
  'game.ended',
  'dawn.announced',
  'whisper.room.opened',
  'public.speech',
  'slayer.resolved',
  'nomination',
  'virgin.triggered',
  'vote',
  'vote.tallied',
  'execution',
]
const STORYTELLER_TYPES = [
  'storyteller.decision',
  'discretion.requested',
  'discretion.resolved',
  'grimoire.set',
  'status.changed',
  'role.changed',
  'ability.resolved',
  'night.death',
]
const SEAT_TYPES = [
  'told',
  'seat.memo.updated',
  'night.choice',
  'whisper.candidates',
  'whisper.speech',
  'whisper.room.closed',
]
const SPECTATOR_TYPES = [
  'game.created',
  'game.aborted',
  'contestant.decision',
  'whisper.proposed',
  'whisper.ranked',
  'future.unknown',
]
const OBSERVERS: Observer[] = ['spectator', 'storyteller', 'seat:1', 'seat:2', 'seat:3', 'public']

describe('whole-event audience matrix', () => {
  for (const [types, audience] of [
    [PUBLIC_TYPES, 'public'],
    [STORYTELLER_TYPES, 'storyteller'],
    [SEAT_TYPES, 'seat'],
    [SPECTATOR_TYPES, 'spectator'],
  ] as const) {
    for (const type of types) {
      for (const observer of OBSERVERS) {
        it(`${type} is correctly projected for ${observer}`, () => {
          const room = type === 'whisper.speech' || type === 'whisper.room.closed'
          const event = { seq: 1, type, seat: 1, members: [1, 2], raw: 'private reasoning' }
          const expected =
            observer === 'spectator' ||
            (observer === 'storyteller' && audience !== 'spectator') ||
            audience === 'public' ||
            (audience === 'seat' && (observer === 'seat:1' || (room && observer === 'seat:2')))
          expect(visibleTo(event, observer)).toBe(expected)
          const events = [event] as unknown as GameEvent[]
          expect(project(events, observer)).toEqual(expected ? events : [])
        })
      }
    }
  }
  it('does not accept an invented audience field or malformed seat observer', () => {
    expect(visibleTo({ type: 'unknown', seat: 1 }, 'seat:1')).toBe(false)
    expect(visibleTo({ type: 'told', seat: 1 }, 'seat:01')).toBe(false)
    expect(visibleTo({ type: 'whisper.room.closed' }, 'seat:1')).toBe(false)
  })
})

describe('setup and metadata boundaries', () => {
  it('records all 22 official bilingual roles and full night positions', () => {
    const roles = Object.values(ROLES)
    expect(roles).toHaveLength(22)
    expect(roles.filter((role) => role.type === 'townsfolk')).toHaveLength(13)
    expect(roles.filter((role) => role.type === 'outsider')).toHaveLength(4)
    expect(roles.filter((role) => role.type === 'minion')).toHaveLength(4)
    expect(roles.filter((role) => role.type === 'demon')).toHaveLength(1)
    for (const role of roles) {
      expect(role.name.en).not.toBe('')
      expect(role.name.zh).not.toBe('')
      expect(role.ability.en).not.toBe('')
      expect(role.ability.zh).not.toBe('')
      expect(role.alignment).toBe(role.type === 'minion' || role.type === 'demon' ? 'evil' : 'good')
    }
    expect(ROLES.soldier.ability).toEqual({
      en: 'You are safe from the Demon.',
      zh: '恶魔的负面能力对你无效。',
    })
    expect(
      roles
        .filter((role) => role.firstNight !== null)
        .sort((a, b) => (a.firstNight ?? 0) - (b.firstNight ?? 0))
        .map((role) => role.id),
    ).toEqual([
      'poisoner',
      'washerwoman',
      'librarian',
      'investigator',
      'chef',
      'empath',
      'fortuneteller',
      'butler',
      'spy',
    ])
    expect(
      roles
        .filter((role) => role.otherNight !== null)
        .sort((a, b) => (a.otherNight ?? 0) - (b.otherNight ?? 0))
        .map((role) => role.id),
    ).toEqual([
      'poisoner',
      'monk',
      'scarletwoman',
      'imp',
      'ravenkeeper',
      'empath',
      'fortuneteller',
      'undertaker',
      'butler',
      'spy',
    ])
  })
  it('rejects wrong seat counts, duplicate roles, unsupported roles and invalid demons', () => {
    expect(validate(['soldier'])).toContainEqual({ code: 'invalid_seat_count' })
    expect(validate(['soldier', 'soldier', 'empath', 'scarletwoman', 'imp'])).toContainEqual({
      code: 'duplicate_role',
    })
    expect(validate(['soldier', 'chef', 'empath', 'scarletwoman', 'baron'])).toContainEqual({
      code: 'invalid_demon',
    })
    expect(validate(['soldier', 'chef', 'empath', 'saint', 'imp'])).toContainEqual({
      code: 'invalid_role_counts',
    })
    expect(validate(['soldier', 'chef', 'empath', 'poisoner', 'imp'])).toContainEqual({
      code: 'unsupported_role',
    })
  })
  it('rejects malformed night choices with structured codes, but allows self and dead targets', () => {
    const request: NightRequest = {
      tool: 'night_choice',
      seat: 5,
      role: 'imp',
      day: 2,
      targets: [1, 2, 3, 4, 5],
    }
    for (const targets of [[], [1, 2], [0], [6], [1.5], ['1'], null]) {
      expect(validateNightChoice({ reasoning: 'choose', targets }, request)).toContainEqual({
        code: 'invalid_targets',
      })
    }
    expect(validateNightChoice(null, request)).toContainEqual({ code: 'invalid_targets' })
    expect(validateNightChoice({ reasoning: 2, targets: [1] }, request)).toContainEqual({
      code: 'invalid_reasoning',
    })
    expect(
      validateNightChoice({ reasoning: '', targets: [1], memo: 'x'.repeat(2001) }, request),
    ).toContainEqual({ code: 'invalid_memo' })
    expect(validateNightChoice({ reasoning: '', targets: [5], memo: '' }, request)).toEqual([])
    expect(validateNightChoice({ reasoning: '', targets: [1] }, request)).toEqual([])
  })
})

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
  speechLimit: 10,
  whisperLimit: 3,
  language: 'en',
  seed: 18,
  logVersion: 2,
  promptVersion: 2,
}
const ORDER: RoleId[] = ['soldier', 'chef', 'empath', 'scarletwoman', 'imp']

function seatsFor(roles = ORDER): SeatState[] {
  return roles.map((role, index) => ({
    seat: index + 1,
    role,
    alignment: ROLES[role].alignment,
    alive: true,
    poisoned: false,
    protected: false,
    abilityUsed: false,
    voteUsed: false,
    master: null,
  }))
}

async function game(
  targets: number[],
  options: {
    seats?: SeatState[]
    d14?: number
    choose?: (request: ContestantRequest) => ContestantChoice
    discretion?: Ports['discretion']
  } = {},
) {
  const events: GameEvent[] = [{ seq: 1, type: 'game.created', ...CONFIG }]
  if (options.seats) events.push({ seq: 2, type: 'grimoire.set', seats: options.seats })
  let memory = fold(events)
  const before = structuredClone(memory)
  let calls = 0
  const requests: NightRequest[] = []
  const discretionCalls: string[] = []
  const prefixes: { length: number; memory: typeof memory }[] = []
  const commit = (input: GameEventInput): GameEvent => {
    const event = { ...input, seq: events.length + 1 }
    events.push(event)
    memory = apply(memory, event)
    prefixes.push({ length: events.length, memory: structuredClone(memory) })
    return event
  }
  const ports: Ports = {
    config: CONFIG,
    log: events,
    rng: createRng(CONFIG.seed),
    commit,
    discretion: (id, candidates) => {
      discretionCalls.push(id)
      if (options.discretion) return options.discretion(id, candidates, memory)
      if (id === 'D1') {
        expect(candidates).toEqual({ type: 'setup', sample: sample(createRng(CONFIG.seed)) })
        return Promise.resolve(ORDER)
      }
      expect(candidates).toEqual([3, 4])
      return Promise.resolve(options.d14 ?? 4)
    },
    askContestants: (batch) => {
      const choices = batch.map((request) => {
        let choice: ContestantChoice
        if (request.tool === 'nominate') {
          choice = options.choose?.(request) ?? { reasoning: 'Pass', nominee: null }
        } else if (request.tool === 'speak') {
          choice =
            request.kind === 'free'
              ? { reasoning: 'Pass', speech: null, slayer_target: null }
              : (options.choose?.(request) ?? {
                  reasoning: 'Explain',
                  speech: 'My argument.',
                  slayer_target: null,
                })
        } else if (request.tool === 'vote') {
          choice = options.choose?.(request) ?? { reasoning: 'Vote', raise_hand: false }
        } else {
          requests.push(structuredClone(request))
          if (request.role !== 'imp' && options.choose) choice = options.choose(request)
          else {
            const target = targets[calls++]
            if (target === undefined) throw new Error('Script exhausted')
            choice = {
              reasoning: `Choose ${String(target)}`,
              targets: [target],
              memo: `Day ${String(request.day)}`,
            }
          }
        }
        commit({
          type: 'contestant.decision',
          seat: request.seat,
          request,
          raw: choice,
          model: 'test',
          usage: null,
          durationMs: 0,
          attempt: 1,
          validation: [],
        })
        return choice
      })
      for (const [index, choice] of choices.entries()) {
        const request = batch[index]
        if (request && choice.memo !== undefined)
          commit({ type: 'seat.memo.updated', seat: request.seat, memo: choice.memo })
      }
      return Promise.resolve(choices)
    },
  }
  const result = await runGame(ports)
  expect(result).toEqual(memory)
  expect(result).toEqual(fold(events))
  expect(before).toEqual(fold(options.seats ? events.slice(0, 2) : events.slice(0, 1)))
  for (const event of events) {
    if (event.type !== 'ability.resolved' && !(event.type === 'told' && event.kind === 'ability'))
      continue
    const observers: Observer[] = [
      `seat:${String(event.seat)}` as Observer,
      'storyteller',
      'spectator',
    ]
    for (const language of ['zh', 'en'] as const) {
      for (const observer of observers) {
        const text = renderEvent(event, language, observer)
        expect(text).not.toContain('[object Object]')
        if (event.type === 'told') {
          expect(text).not.toBe('')
          if (typeof event.content.result === 'boolean')
            expect(text).toContain(
              language === 'zh'
                ? event.content.result
                  ? '是'
                  : '否'
                : event.content.result
                  ? 'Yes'
                  : 'No',
            )
          if (typeof event.content.result === 'object')
            expect(text).toContain(ROLES[event.content.result.role].name[language])
        }
      }
    }
  }
  for (const prefix of prefixes) expect(prefix.memory).toEqual(fold(events.slice(0, prefix.length)))
  return { events, state: memory, requests, discretionCalls }
}

describe('information Townsfolk through the rules seam', () => {
  it('enumerates first-night pairs without the recipient and skips the zero-outsider singleton', async () => {
    const { events, requests, discretionCalls } = await game([4, 5], {
      seats: seatsFor(['washerwoman', 'librarian', 'investigator', 'scarletwoman', 'imp']),
      discretion: (_id, candidates) => {
        if (!Array.isArray(candidates)) throw new Error('Expected information candidates')
        const choice = candidates[0]
        if (choice === undefined) throw new Error('Missing information candidate')
        return Promise.resolve(choice)
      },
    })
    expect(discretionCalls).toEqual(['D4', 'D6'])
    const d4 = events.find(
      (event) => event.type === 'discretion.requested' && event.discretion === 'D4',
    )
    expect(d4).toMatchObject({
      candidates: [
        { seats: [2, 3], role: 'librarian' },
        { seats: [2, 3], role: 'investigator' },
        { seats: [2, 4], role: 'librarian' },
        { seats: [2, 5], role: 'librarian' },
        { seats: [3, 4], role: 'investigator' },
        { seats: [3, 5], role: 'investigator' },
      ],
    })
    expect(events.filter((event) => event.type === 'told' && event.kind === 'ability')).toEqual([
      expect.objectContaining({
        seat: 1,
        content: { role: 'washerwoman', result: { seats: [2, 3], role: 'librarian' } },
      }),
      expect.objectContaining({ seat: 2, content: { role: 'librarian', result: 0 } }),
      expect.objectContaining({
        seat: 3,
        content: { role: 'investigator', result: { seats: [1, 4], role: 'scarletwoman' } },
      }),
    ])
    expect(requests.map((request) => request.role)).toEqual(['imp', 'imp'])
    const told = events.find(
      (event) => event.type === 'told' && event.kind === 'ability' && event.seat === 1,
    )
    if (!told) throw new Error('Missing Washerwoman information')
    for (const language of ['zh', 'en'] as const) {
      for (const observer of ['seat:1', 'storyteller', 'spectator'] as const) {
        const text = renderEvent(told, language, observer)
        expect(text).toContain(language === 'zh' ? '图书管理员' : 'Librarian')
        expect(text).toContain(language === 'zh' ? '2 号' : 'Seat 2')
        expect(text).toContain(language === 'zh' ? '3 号' : 'Seat 3')
        expect(text).toContain(
          observer === 'seat:1'
            ? language === 'zh'
              ? '你'
              : 'you'
            : language === 'zh'
              ? '1 号'
              : 'Seat 1',
        )
      }
    }
  })
  it.each([
    [[1, 2], true],
    [[3, 4], false],
    [[4, 5], true],
  ] as const)(
    'fixes a good red herring including self and answers for %j',
    async (targets, answer) => {
      const { events, state } = await game([4, 5], {
        seats: seatsFor(['fortuneteller', 'chef', 'soldier', 'scarletwoman', 'imp']),
        discretion: (id, candidates) => {
          expect(id).toBe('D3')
          expect(candidates).toEqual([1, 2, 3])
          return Promise.resolve(1)
        },
        choose: (request) =>
          request.tool === 'night_choice'
            ? { reasoning: 'Probe', targets: [...targets] }
            : request.tool === 'nominate'
              ? { reasoning: 'Pass', nominee: null }
              : { reasoning: 'Vote', raise_hand: false },
      })
      expect(state.redHerring).toBe(1)
      expect(
        events.filter(
          (event) => event.type === 'discretion.requested' && event.discretion === 'D3',
        ),
      ).toHaveLength(1)
      expect(
        events.filter(
          (event) => event.type === 'ability.resolved' && event.role === 'fortuneteller',
        ),
      ).toEqual([
        expect.objectContaining({ result: answer }),
        expect.objectContaining({ result: answer }),
      ])
      const setup = events.findIndex((event) => event.type === 'phase.started')
      expect(
        events
          .slice(0, setup)
          .some((event) => event.type === 'grimoire.set' && event.redHerring === 1),
      ).toBe(true)
    },
  )
  it.each(['chef', 'drunk', 'spy', 'recluse'] as const)(
    'Undertaker learns the executed %s, not a night death',
    async (role) => {
      const { events } = await game([4, 5], {
        seats: seatsFor(['undertaker', role, 'soldier', 'scarletwoman', 'imp']),
        choose: (request) =>
          request.tool === 'nominate'
            ? {
                reasoning: 'Nominate once',
                nominee:
                  request.day === 1 && request.seat === 1 && request.nominees.length === 5
                    ? 2
                    : null,
              }
            : request.tool === 'speak'
              ? { reasoning: 'Explain', speech: 'Execute this seat.', slayer_target: null }
              : { reasoning: 'Execute', raise_hand: true },
      })
      expect(
        events.filter(
          (event) =>
            event.type === 'told' &&
            event.kind === 'ability' &&
            event.content.role === 'undertaker',
        ),
      ).toEqual([
        expect.objectContaining({ content: { role: 'undertaker', result: { target: 2, role } } }),
      ])
    },
  )
  it('Undertaker gets no information without execution', async () => {
    const { events } = await game([4, 5], {
      seats: seatsFor(['undertaker', 'chef', 'soldier', 'scarletwoman', 'imp']),
    })
    expect(
      events.filter((event) => event.type === 'ability.resolved' && event.role === 'undertaker'),
    ).toEqual([])
  })
  it.each([
    [3, 4],
    [3, 5],
  ])(
    'Undertaker sees the executed Imp and Fortune Teller probes %j after succession',
    async (...targets) => {
      const { events } = await game([3, 4], {
        seats: seatsFor(['undertaker', 'fortuneteller', 'soldier', 'scarletwoman', 'imp']),
        discretion: () => Promise.resolve(1),
        choose: (request) =>
          request.tool === 'nominate'
            ? {
                reasoning: 'Nominate once',
                nominee:
                  request.day === 1 && request.seat === 1 && request.nominees.length === 5
                    ? 5
                    : null,
              }
            : request.tool === 'night_choice'
              ? { reasoning: 'Probe', targets: request.day === 1 ? [3, 4] : targets }
              : request.tool === 'speak'
                ? { reasoning: 'Explain', speech: 'Execute the Demon.', slayer_target: null }
                : { reasoning: 'Execute', raise_hand: true },
      })
      expect(
        events.filter(
          (event) =>
            event.type === 'told' &&
            event.kind === 'ability' &&
            event.content.role === 'undertaker',
        ),
      ).toEqual([
        expect.objectContaining({
          content: { role: 'undertaker', result: { target: 5, role: 'imp' } },
        }),
      ])
      expect(
        events.flatMap((event) =>
          event.type === 'ability.resolved' && event.role === 'fortuneteller' ? [event.result] : [],
        ),
      ).toEqual([false, true])
    },
  )
  it.each([
    [1, 'ravenkeeper'],
    [2, 'drunk'],
    [5, 'imp'],
  ] as const)(
    'wakes Ravenkeeper immediately on night death to inspect seat %s',
    async (target, role) => {
      const { events, requests } = await game([1, 4, 5], {
        seats: seatsFor(['ravenkeeper', 'drunk', 'soldier', 'scarletwoman', 'imp']),
        choose: (request) =>
          request.tool === 'night_choice'
            ? { reasoning: 'Inspect', targets: [target] }
            : { reasoning: 'Pass', nominee: null },
      })
      const death = events.findIndex((event) => event.type === 'night.death' && event.seat === 1)
      expect(events.slice(death, death + 5)).toEqual([
        expect.objectContaining({ type: 'night.death', seat: 1 }),
        expect.objectContaining({ type: 'contestant.decision', seat: 1 }),
        expect.objectContaining({ type: 'night.choice', seat: 1, targets: [target] }),
        expect.objectContaining({ type: 'ability.resolved', seat: 1, result: { target, role } }),
        expect.objectContaining({
          type: 'told',
          seat: 1,
          kind: 'ability',
          content: { role: 'ravenkeeper', result: { target, role } },
        }),
      ])
      expect(requests.filter((request) => request.role === 'ravenkeeper')).toHaveLength(1)
    },
  )
  it('does not wake Ravenkeeper on daytime execution', async () => {
    const { requests } = await game([4, 5], {
      seats: seatsFor(['ravenkeeper', 'chef', 'soldier', 'scarletwoman', 'imp']),
      choose: (request) =>
        request.tool === 'nominate'
          ? {
              reasoning: 'Nominate',
              nominee:
                request.day === 1 && request.seat === 2 && request.nominees.length === 5 ? 1 : null,
            }
          : request.tool === 'speak'
            ? { reasoning: 'Explain', speech: 'Execute.', slayer_target: null }
            : { reasoning: 'Vote', raise_hand: true },
    })
    expect(requests.some((request) => request.role === 'ravenkeeper')).toBe(false)
  })
  it('shows a real Drunk card to Librarian and never the believed Townsfolk', async () => {
    const seats = seatsFor(['librarian', 'drunk', 'soldier', 'scarletwoman', 'imp'])
    const drunk = seats[1]
    if (!drunk) throw new Error('Missing Drunk seat')
    drunk.believedRole = 'washerwoman'
    const { events } = await game([4, 5], {
      seats,
      discretion: (_id, candidates) => {
        expect(candidates).toEqual([
          { seats: [2, 3], role: 'drunk' },
          { seats: [2, 4], role: 'drunk' },
          { seats: [2, 5], role: 'drunk' },
        ])
        return Promise.resolve({ seats: [2, 3], role: 'drunk' })
      },
    })
    expect(events.find((event) => event.type === 'told' && event.kind === 'ability')).toMatchObject(
      { content: { role: 'librarian', result: { seats: [2, 3], role: 'drunk' } } },
    )
  })
  it('skips D4 for one legal information candidate', async () => {
    const { discretionCalls, events } = await game([3], {
      seats: seatsFor(['washerwoman', 'chef', 'imp']),
    })
    expect(discretionCalls).toEqual([])
    expect(events.find((event) => event.type === 'told' && event.kind === 'ability')).toMatchObject(
      { content: { role: 'washerwoman', result: { seats: [2, 3], role: 'chef' } } },
    )
  })
  it('rejects invalid Fortune Teller count, duplicate and out-of-range targets', () => {
    const request: NightRequest = {
      tool: 'night_choice',
      seat: 1,
      role: 'fortuneteller',
      day: 1,
      targets: [1, 2, 3, 4, 5],
    }
    for (const targets of [[1], [1, 1], [0, 2], [1, 2, 3]])
      expect(validateNightChoice({ reasoning: 'Probe', targets }, request)).toContainEqual({
        code: 'invalid_targets',
      })
    expect(validateNightChoice({ reasoning: 'Probe', targets: [1, 5] }, request)).toEqual([])
  })
})

describe('nominations through the rules seam', () => {
  it('asks a simultaneous batch, runs reason and defense, votes clockwise, and cancels tied leaders', async () => {
    const seen: ContestantRequest[] = []
    const { events } = await game([4, 5], {
      choose: (request) => {
        seen.push(structuredClone(request))
        if (request.tool === 'nominate') {
          return {
            reasoning: 'Nominate',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 1 && request.seat === 3 && request.nominees.includes(4)
                  ? 4
                  : null,
          }
        }
        if (request.tool === 'vote') return { reasoning: 'Vote', raise_hand: request.seat <= 3 }
        return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
      },
    })
    const nominations = events.filter((event) => event.type === 'nomination')
    expect(nominations).toHaveLength(2)
    expect(new Set(nominations.map((event) => event.nominee))).toEqual(new Set([2, 4]))
    expect(events.filter((event) => event.type === 'execution')).toEqual([])
    const tallies = events.filter((event) => event.type === 'vote.tallied')
    expect(tallies).toEqual([
      expect.objectContaining({ votes: 3, threshold: 3, aboutToBeExecuted: true }),
      expect.objectContaining({ votes: 3, threshold: 3, aboutToBeExecuted: false }),
    ])
    const first = nominations[0]
    if (!first) throw new Error('Missing nomination')
    expect(
      events.filter((event) => event.seq > first.seq && event.type === 'public.speech').slice(0, 2),
    ).toEqual([
      expect.objectContaining({
        type: 'public.speech',
        seat: first.nominator,
        kind: 'nomination',
        speech: 'My argument.',
      }),
      expect.objectContaining({
        type: 'public.speech',
        seat: first.nominee,
        kind: 'defense',
        speech: 'My argument.',
      }),
    ])
    const votes = seen.filter((request) => request.tool === 'vote')
    expect(votes.slice(0, 5).map((request) => request.seat)).toEqual(
      Array.from({ length: 5 }, (_, offset) => ((first.nominee + offset) % 5) + 1),
    )
    expect(votes[2]?.threshold).toBe(3)
    expect(votes[2]?.highestVoteCount).toBe(0)
    expect(votes[2]?.votes).toHaveLength(2)
    const afterTie = events.findIndex((event) => event === tallies[1])
    const publicState = foldPublic(events.slice(0, afterTie + 1))
    expect([...publicState.nominators].sort()).toEqual([1, 3])
    expect([...publicState.nominees].sort()).toEqual([2, 4])
    expect(publicState).toMatchObject({
      aboutToBeExecuted: null,
      highestVoteCount: 3,
    })
    const firstBatch = events
      .slice(0, first.seq - 1)
      .flatMap((event) =>
        event.type === 'contestant.decision' && event.request.tool === 'nominate' ? [event] : [],
      )
    expect(firstBatch.map((event) => event.seat)).toEqual([1, 2, 3, 4, 5])
  })
  it('executes the Imp after nominations close and Scarlet Woman kills on the following night', async () => {
    const { events, requests } = await game([2, 3], {
      choose: (request) => {
        if (request.tool === 'nominate')
          return {
            reasoning: 'Execute the demon',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(5) ? 5 : null,
          }
        if (request.tool === 'vote') return { reasoning: 'Execute', raise_hand: true }
        return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
      },
    })
    const execution = events.findIndex((event) => event.type === 'execution')
    expect(events.slice(execution, execution + 4)).toEqual([
      expect.objectContaining({ type: 'execution', seat: 5 }),
      expect.objectContaining({ type: 'role.changed', seat: 4, from: 'scarletwoman', to: 'imp' }),
      expect.objectContaining({ type: 'told', seat: 4, kind: 'imp' }),
      expect.objectContaining({ type: 'phase.started', day: 2, phase: 'night' }),
    ])
    expect(requests[0]).toMatchObject({ seat: 4, day: 2 })
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'evil' })
  })
  it('allows dead nominees and self nomination, spending a dead vote only once without calling again', async () => {
    const seen: ContestantRequest[] = []
    const { events } = await game([2, 4, 5], {
      choose: (request) => {
        seen.push(structuredClone(request))
        if (request.tool === 'nominate')
          return {
            reasoning: 'Nominate',
            nominee:
              request.day === 2 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 2 && request.seat === 3 && request.nominees.includes(3)
                  ? 3
                  : null,
          }
        if (request.tool === 'vote')
          return { reasoning: 'Use my vote', raise_hand: request.seat === 2 }
        return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
      },
    })
    expect(
      seen.filter(
        (request) => request.tool === 'nominate' && request.day >= 2 && request.seat === 2,
      ),
    ).toEqual([])
    expect(seen.filter((request) => request.tool === 'vote' && request.seat === 2)).toHaveLength(1)
    expect(events.filter((event) => event.type === 'vote' && event.seat === 2)).toEqual([
      expect.objectContaining({ raiseHand: true, voteUsed: true }),
      expect.objectContaining({ raiseHand: false, voteUsed: false }),
    ])
    expect(events.filter((event) => event.type === 'vote.tallied')).toEqual([
      expect.objectContaining({ votes: 1, threshold: 2, aboutToBeExecuted: false }),
      expect.objectContaining({ votes: 0, threshold: 2, aboutToBeExecuted: false }),
    ])
    expect(foldPublic(events).seats[1]).toMatchObject({ alive: false, voteUsed: true })
    expect(fold(events).seats[1]).toMatchObject({ alive: false, voteUsed: true })
  })
  it('reports the highest earlier tally even when it was below the execution threshold', async () => {
    let round = 0
    const seen: ContestantRequest[] = []
    await game([4, 5], {
      choose: (request) => {
        seen.push(structuredClone(request))
        if (request.tool === 'nominate')
          return {
            reasoning: 'Nominate',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 1 && request.seat === 3 && request.nominees.includes(4)
                  ? 4
                  : null,
          }
        if (request.tool === 'speak' && request.kind === 'nomination') round++
        if (request.tool === 'vote')
          return { reasoning: 'Vote', raise_hand: request.seat <= (round === 1 ? 2 : 3) }
        return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
      },
    })
    const votes = seen.filter((request) => request.tool === 'vote')
    expect(votes[5]).toMatchObject({ highestVoteCount: 2, threshold: 3 })
  })
  it('rejects a second nomination of the same seat in one day', async () => {
    const seen: ContestantRequest[] = []
    await expect(
      game([], {
        choose: (request) => {
          seen.push(structuredClone(request))
          if (request.tool === 'nominate')
            return {
              reasoning: 'Repeat target',
              nominee: request.seat === 1 || request.seat === 3 ? 2 : null,
            }
          if (request.tool === 'vote') return { reasoning: 'Abstain', raise_hand: false }
          return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
        },
      }),
    ).rejects.toThrow('Invalid nomination from ports')
    const nominationRequests = seen.filter((request) => request.tool === 'nominate')
    expect(nominationRequests[0]?.nominees).toContain(2)
    expect(nominationRequests.at(-1)?.nominees).not.toContain(2)
    expect(nominationRequests).toHaveLength(9)
  })
  it.each([
    ['nomination', null],
    ['nomination', ''],
    ['nomination', '   '],
    ['defense', null],
    ['defense', ''],
    ['defense', '   '],
  ] as const)('rejects an empty %s speech (%s)', async (kind, speech) => {
    await expect(
      game([], {
        choose: (request) =>
          request.tool === 'nominate'
            ? { reasoning: 'Nominate', nominee: request.seat === 1 ? 2 : null }
            : {
                reasoning: 'Explain',
                speech:
                  request.tool === 'speak' && request.kind === kind ? speech : 'A valid argument.',
                slayer_target: null,
              },
      }),
    ).rejects.toThrow('Invalid nomination speech from ports')
  })
  it('ends immediately after executing the Imp below five alive without succession or another night', async () => {
    const { events } = await game([2], {
      choose: (request) => {
        if (request.tool === 'nominate')
          return {
            reasoning: 'Nominate',
            nominee:
              request.day === 2 && request.seat === 1 && request.nominees.includes(5) ? 5 : null,
          }
        if (request.tool === 'vote') return { reasoning: 'Execute', raise_hand: true }
        return { reasoning: 'Explain', speech: 'My argument.', slayer_target: null }
      },
    })
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'execution', seat: 5 }),
      expect.objectContaining({ type: 'game.ended', winner: 'good' }),
    ])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([])
  })
})

describe('scripted pure rules seam', () => {
  it('creates the grimoire and private roles, resolves Chef then Empath without model calls, and opens public discussion', async () => {
    const { events, requests } = await game([5, 2, 3])
    expect(events.filter((event) => event.type === 'told' && event.kind === 'role')).toEqual(
      ORDER.map(
        (role, index) =>
          expect.objectContaining({ seat: index + 1, kind: 'role', content: { role } }) as unknown,
      ),
    )
    const firstDawn = events.findIndex((event) => event.type === 'dawn.announced')
    const firstNight = events.slice(0, firstDawn)
    expect(
      firstNight.flatMap((event) =>
        event.type === 'ability.resolved' || (event.type === 'told' && event.kind === 'ability')
          ? [[event.type, event.seat]]
          : [],
      ),
    ).toEqual([
      ['ability.resolved', 2],
      ['told', 2],
      ['ability.resolved', 3],
      ['told', 3],
    ])
    expect(firstNight.filter((event) => event.type === 'ability.resolved')).toEqual([
      expect.objectContaining({ seat: 2, role: 'chef', result: 1, deviated: false }),
      expect.objectContaining({ seat: 3, role: 'empath', result: 1, deviated: false }),
    ])
    expect(requests.map((request) => [request.seat, request.day, request.role])).toEqual([
      [5, 2, 'imp'],
      [4, 3, 'imp'],
      [4, 4, 'imp'],
    ])
    expect(requests.every((request) => request.targets.join(',') === '1,2,3,4,5')).toBe(true)
    expect(
      events
        .filter((event) => event.type === 'phase.started')
        .every(
          (event) =>
            event.phase === 'first-night' ||
            event.phase === 'night' ||
            event.phase === 'dawn' ||
            event.phase === 'public' ||
            event.phase === 'nomination',
        ),
    ).toBe(true)
    expect(events.filter((event) => event.type === 'dawn.announced')).toEqual([
      expect.objectContaining({ day: 1, deaths: [] }),
      expect.objectContaining({ day: 2, deaths: [5] }),
      expect.objectContaining({ day: 3, deaths: [2] }),
    ])
  })
  it('resolves a choice before effects, soldier immunity and dead targets without a re-selection', async () => {
    const { events, state, requests } = await game([1, 2, 2, 5, 3])
    expect(requests).toHaveLength(5)
    const outcomes = events.flatMap((event) =>
      event.type === 'ability.resolved' && event.role === 'imp' ? [event.result] : [],
    )
    expect(outcomes).toEqual([
      { target: 1, outcome: 'soldier' },
      { target: 2, outcome: 'killed' },
      { target: 2, outcome: 'dead' },
      { target: 5, outcome: 'killed' },
      { target: 3, outcome: 'killed' },
    ])
    const death = events.findIndex((event) => event.type === 'night.death')
    expect(events.slice(death - 3, death + 1).map((event) => event.type)).toEqual([
      'seat.memo.updated',
      'night.choice',
      'ability.resolved',
      'night.death',
    ])
    expect(events.filter((event) => event.type === 'night.death' && event.seat === 2)).toHaveLength(
      1,
    )
    expect(state.seats.find((seat) => seat.seat === 1)?.alive).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'evil' })
  })
  it('uses alive count before demon death for mandatory Scarlet Woman succession at five', async () => {
    const { events, state, discretionCalls } = await game([5, 2, 3])
    const death = events.findIndex((event) => event.type === 'night.death')
    expect(events.slice(death, death + 3)).toEqual([
      expect.objectContaining({ type: 'night.death', seat: 5 }),
      expect.objectContaining({ type: 'role.changed', seat: 4, from: 'scarletwoman', to: 'imp' }),
      expect.objectContaining({ type: 'told', seat: 4, kind: 'imp', content: { role: 'imp' } }),
    ])
    expect(discretionCalls).toEqual(['D1'])
    expect(state.seats.find((seat) => seat.seat === 4)?.role).toBe('imp')
    expect(events.find((event) => event.type === 'night.choice' && event.seat === 4)).toMatchObject(
      { targets: [2] },
    )
  })
  it('self-kills below five with a single living minion, skipping D14 external input', async () => {
    const { discretionCalls, events } = await game([2, 5, 3])
    expect(discretionCalls).toEqual(['D1'])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([
      expect.objectContaining({ seat: 4, to: 'imp' }),
    ])
    expect(
      events.filter((event) => event.type === 'discretion.requested' && event.discretion === 'D14'),
    ).toEqual([])
  })
  it('uses D14 among real living minions below five, not Scarlet Woman priority', async () => {
    const seats = seatsFor(['chef', 'empath', 'poisoner', 'scarletwoman', 'imp'])
    const { events, discretionCalls, requests } = await game([1, 5, 2], { seats, d14: 3 })
    expect(discretionCalls).toEqual(['D14'])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([
      expect.objectContaining({ seat: 3, from: 'poisoner', to: 'imp' }),
    ])
    expect(requests.map((request) => request.seat)).toEqual([5, 5, 3])
    const requested = events.findIndex((event) => event.type === 'discretion.requested')
    expect(events.slice(requested, requested + 4).map((event) => event.type)).toEqual([
      'discretion.requested',
      'discretion.resolved',
      'role.changed',
      'told',
    ])
  })
  it('self-kills without a living minion and ends good before dawn', async () => {
    const { events } = await game([4, 5])
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([])
    expect(events.at(-2)).toMatchObject({ type: 'night.death', seat: 5 })
  })
  it('does not wake a dead Empath after the Imp kills it', async () => {
    const { events } = await game([3, 2, 4])
    const death = events.findIndex((event) => event.type === 'night.death' && event.seat === 3)
    expect(
      events
        .slice(death + 1)
        .filter((event) => event.type === 'ability.resolved' && event.role === 'empath'),
    ).toEqual([])
  })
  it('Empath skips dead neighbors and Chef includes the wraparound evil pair', async () => {
    const seats = seatsFor(['imp', 'chef', 'empath', 'soldier', 'scarletwoman'])
    const { events } = await game([2, 5, 1], { seats })
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.role === 'chef'),
    ).toMatchObject({ result: 1 })
    const empath = events.flatMap((event) =>
      event.type === 'ability.resolved' && event.role === 'empath' ? [event.result] : [],
    )
    expect(empath).toEqual([0, 1, 1])
  })
})

describe('folds at arbitrary log prefixes and winner precedence', () => {
  it('reveals night deaths only at dawn and never folds hidden truth into public state', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'grimoire.set', seats: seatsFor() },
      { seq: 2, type: 'phase.started', day: 2, phase: 'night' },
      { seq: 3, type: 'status.changed', seat: 1, status: 'poisoned', value: true },
      { seq: 4, type: 'night.death', seat: 2, cause: 'imp' },
      { seq: 5, type: 'role.changed', seat: 4, from: 'scarletwoman', to: 'imp' },
      { seq: 6, type: 'phase.started', day: 2, phase: 'dawn' },
      { seq: 7, type: 'dawn.announced', day: 2, deaths: [2] },
      { seq: 8, type: 'vote', seat: 2, raiseHand: true, voteUsed: true },
      { seq: 9, type: 'game.ended', winner: 'good', reason: 'test' },
    ]
    for (let length = 0; length <= events.length; length++) {
      const prefix = events.slice(0, length)
      expect(foldPublic(prefix)).toEqual(foldPublic(project(prefix, 'public')))
      const grimoire = fold(prefix)
      if (length >= 1) {
        expect(grimoire.seats[1]?.alive).toBe(length < 4)
        expect(grimoire.seats[0]?.poisoned).toBe(length >= 3)
        expect(grimoire.seats[3]?.role).toBe(length >= 5 ? 'imp' : 'scarletwoman')
        expect(grimoire.seats[1]?.voteUsed).toBe(length >= 8)
      }
      expect(foldPublic(prefix).seats[1]?.alive).toBe(length < 7)
      expect(foldPublic(prefix).seats[1]?.voteUsed).toBe(length >= 8)
      expect(grimoire.ended).toBe(length >= 9)
    }
  })
  it('folds public nominations, ties, executions and next-day resets', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'phase.started', day: 1, phase: 'nomination' },
      { seq: 2, type: 'nomination', nominator: 1, nominee: 2 },
      { seq: 3, type: 'vote.tallied', nominee: 2, votes: 4, threshold: 3, aboutToBeExecuted: true },
      {
        seq: 4,
        type: 'vote.tallied',
        nominee: 3,
        votes: 3,
        threshold: 3,
        aboutToBeExecuted: false,
      },
      {
        seq: 5,
        type: 'vote.tallied',
        nominee: 4,
        votes: 4,
        threshold: 3,
        aboutToBeExecuted: false,
      },
      { seq: 6, type: 'execution', seat: 2 },
      { seq: 7, type: 'phase.started', day: 2, phase: 'dawn' },
    ]
    expect(foldPublic(events.slice(0, 4))).toMatchObject({
      nominators: [1],
      nominees: [2],
      aboutToBeExecuted: 2,
    })
    expect(foldPublic(events.slice(0, 5)).aboutToBeExecuted).toBe(null)
    expect(foldPublic(events)).toMatchObject({
      day: 2,
      nominators: [],
      nominees: [],
      aboutToBeExecuted: null,
    })
    expect(foldPublic(events).seats[1]?.alive).toBe(false)
  })
  it('gives good precedence when both the demon is dead and only two players remain', () => {
    const seats = seatsFor().map((seat) => ({ ...seat, alive: seat.seat <= 2 }))
    expect(winner(fold([{ seq: 1, type: 'grimoire.set', seats }]))).toEqual({
      winner: 'good',
      reason: 'all_demons_dead',
    })
    const demonAlive = seatsFor().map((seat) => ({ ...seat, alive: seat.seat >= 4 }))
    expect(winner(fold([{ seq: 1, type: 'grimoire.set', seats: demonAlive }]))).toEqual({
      winner: 'evil',
      reason: 'two_alive',
    })
    expect(winner(fold([{ seq: 1, type: 'grimoire.set', seats: seatsFor() }]))).toBe(null)
  })
})

describe('public conversation', () => {
  it('batches every eligible seat, prioritizes remaining speeches and never repeats a speaker', async () => {
    const config = { ...CONFIG, speechLimit: 2 }
    const events: GameEvent[] = [
      { seq: 1, type: 'game.created', ...config },
      { seq: 2, type: 'grimoire.set', seats: seatsFor() },
    ]
    const batches: number[][] = []
    await expect(
      runGame({
        config,
        log: events,
        rng: () => 0,
        commit: (input) => {
          if (input.type === 'phase.started' && input.day === 2) throw new Error('script_complete')
          const event: GameEvent = { ...input, seq: events.length + 1 }
          events.push(event)
          return event
        },
        discretion: () => Promise.reject(new Error('Unexpected discretion')),
        askContestants: (batch) => {
          if (batch.every((request) => request.tool === 'nominate'))
            return Promise.resolve(batch.map(() => ({ reasoning: 'Pass', nominee: null })))
          batches.push(batch.map((request) => request.seat))
          return Promise.resolve(
            batch.map((request) => ({
              reasoning: 'Join the discussion',
              speech: `Speech from ${String(request.seat)}`,
              slayer_target: null,
            })),
          )
        },
      }),
    ).rejects.toThrow('script_complete')
    expect(batches[0]).toEqual([1, 2, 3, 4, 5])
    expect(
      events.filter((event) => event.type === 'public.speech').map((event) => event.seat),
    ).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5])
    expect(batches[1]).toEqual([2, 3, 4, 5])
    expect(batches.at(-1)).toEqual([5])
  })
})

async function conversation(
  respond: (batch: SpeechRequest[], events: readonly GameEvent[]) => SpeechChoice[],
  seats = seatsFor(),
  rng = createRng(20),
) {
  const events: GameEvent[] = [
    { seq: 1, type: 'game.created', ...CONFIG },
    { seq: 2, type: 'grimoire.set', seats },
  ]
  await expect(
    runGame({
      config: CONFIG,
      log: events,
      rng,
      discretion: () => Promise.reject(new Error('Unexpected discretion')),
      commit: (input) => {
        if (input.type === 'phase.started' && input.day === 2) throw new Error('script_complete')
        const event = { ...input, seq: events.length + 1 }
        events.push(event)
        return event
      },
      askContestants: (batch) => {
        if (batch.every((request) => request.tool === 'nominate'))
          return Promise.resolve(batch.map(() => ({ reasoning: 'Pass', nominee: null })))
        const speeches = batch.filter((request) => request.tool === 'speak')
        if (speeches.length !== batch.length) throw new Error('Unexpected non-speech request')
        const choices = respond(speeches, events)
        return Promise.resolve(
          choices.map((choice, index) => {
            const request = batch[index]
            if (!request) throw new Error('Missing request')
            const decision: GameEvent = {
              seq: events.length + 1,
              type: 'contestant.decision',
              seat: request.seat,
              request,
              raw: choice,
              model: 'script',
              usage: null,
              durationMs: 0,
              attempt: 1,
              validation: { ok: true },
            }
            events.push(decision)
            return { ...choice, decision: decision.seq }
          }),
        )
      },
    }),
  ).rejects.toThrow('script_complete')
  return events
}

describe('public conversation edge cases', () => {
  it('lets dead seats speak and ends on eligible passes even if the last speaker has allowance', async () => {
    const seats = seatsFor()
    const dead = seats[0]
    if (!dead) throw new Error('Missing seat')
    dead.alive = false
    const batches: number[][] = []
    const events = await conversation((batch) => {
      batches.push(batch.map((request) => request.seat))
      return batch.map((request) => ({
        reasoning: 'Can still contribute after death',
        speech: batches.length === 1 && request.seat === 1 ? 'My information still matters.' : null,
        slayer_target: null,
      }))
    }, seats)
    expect(batches).toEqual([
      [1, 2, 3, 4, 5],
      [2, 3, 4, 5],
    ])
    expect(events.filter((event) => event.type === 'public.speech')).toMatchObject([
      { seat: 1, speech: 'My information still matters.' },
    ])
  })

  it.each(['soldier', 'slayer'] as const)(
    'publicly resolves a %s fake or spent shot as nothing happening',
    async (role) => {
      const seats = seatsFor()
      const shooter = seats[0]
      if (!shooter) throw new Error('Missing seat')
      shooter.role = role
      shooter.abilityUsed = true
      let round = 0
      const events = await conversation((batch) => {
        round++
        return batch.map((request) => ({
          reasoning: 'Claim a shot',
          speech: round === 1 && request.seat === 1 ? 'I shoot Seat 5.' : null,
          slayer_target: round === 1 && request.seat === 1 ? 5 : null,
        }))
      }, seats)
      const speech = events.find((event) => event.type === 'public.speech')
      expect(speech).toMatchObject({ seat: 1, slayerTarget: 5 })
      expect(events.find((event) => event.seq === (speech?.seq ?? 0) + 1)).toMatchObject({
        type: 'slayer.resolved',
        seat: 1,
        target: 5,
        died: false,
      })
      expect(fold(events).seats.find((seat) => seat.seat === 5)?.alive).toBe(true)
      expect(project(events, 'public').some((event) => event.type === 'slayer.resolved')).toBe(true)
    },
  )

  it('uses seeded randomness among tied offers and keeps losing offers only in decisions', async () => {
    const play = () => {
      let round = 0
      return conversation((batch) => {
        round++
        return batch.map((request) => ({
          reasoning: 'A private proposal',
          speech: round === 1 ? `Offer ${String(request.seat)}` : null,
          slayer_target: null,
        }))
      })
    }
    const events = await play()
    expect(events.filter((event) => event.type === 'public.speech')).toEqual(
      (await play()).filter((event) => event.type === 'public.speech'),
    )
    const spoken = events.filter((event) => event.type === 'public.speech')
    expect(spoken).toHaveLength(1)
    expect(events.filter((event) => event.type === 'contestant.decision')).toHaveLength(9)
    expect(spoken[0]?.decision).toBeGreaterThan(0)
    expect(
      project(events, 'public').filter((event) => event.type === 'contestant.decision'),
    ).toEqual([])
  })

  it('restricts claimed shots to nonempty public speech without restricting fake shooters', () => {
    const request: SpeechRequest = { tool: 'speak', seat: 1, day: 1, kind: 'free', remaining: 10 }
    const choice = { reasoning: '', speech: 'I shoot.', slayer_target: 5 }
    expect(validateSpeechChoice(choice, request)).toEqual([])
    expect(validateSpeechChoice({ ...choice, speech: null }, request)).toContainEqual({
      code: 'invalid_slayer_target',
    })
    expect(validateSpeechChoice({ ...choice, speech: '' }, request)).toContainEqual({
      code: 'invalid_slayer_target',
    })
    expect(validateSpeechChoice({ ...choice, slayer_target: 6 }, request)).toContainEqual({
      code: 'invalid_slayer_target',
    })
    expect(validateSpeechChoice(choice, { ...request, kind: 'nomination' })).toContainEqual({
      code: 'invalid_slayer_target',
    })
    expect(
      validateSpeechChoice(
        { ...choice, speech: null, slayer_target: null },
        { ...request, kind: 'defense' },
      ),
    ).toContainEqual({ code: 'invalid_speech' })
    expect(validateSpeechChoice({ ...choice, speech: '', slayer_target: null }, request)).toEqual(
      [],
    )
  })
})
