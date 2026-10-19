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
  validateContestantChoice,
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
  InformationResult,
  NightRequest,
  Observer,
  Ports,
  RoleId,
  SeatState,
  SpeechChoice,
  SpeechRequest,
} from '../shared/types/game'

describe('five-seat setup', () => {
  it('samples three distinct implemented Townsfolk, one Minion and Imp from a reproducible seed', () => {
    const roles = sample(createRng(18))
    expect(roles).toHaveLength(5)
    expect(roles.filter((role) => ROLES[role].type === 'townsfolk')).toHaveLength(3)
    expect(roles.filter((role) => ROLES[role].type === 'minion')).toHaveLength(1)
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
      'poisoner',
      'scarletwoman',
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
    expect(validate(['soldier', 'chef', 'empath', 'spy', 'imp'])).toContainEqual({
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
  whisperLimit: 0,
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
    act?: (request: ContestantRequest) => ContestantChoice
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
      if (id === 'D2' && Array.isArray(candidates)) {
        const role = candidates.find(
          (candidate) =>
            candidate === 'slayer' || candidate === 'soldier' || candidate === 'virgin',
        )
        if (typeof role !== 'string') throw new Error('Missing passive Drunk fixture identity')
        return Promise.resolve(role)
      }
      if (id === 'D8' && Array.isArray(candidates) && candidates[0] !== undefined)
        return Promise.resolve(candidates[0])
      expect(candidates).toEqual([3, 4])
      return Promise.resolve(options.d14 ?? 4)
    },
    askContestants: (batch) => {
      const choices = batch.map((request) => {
        let choice: ContestantChoice
        if (options.act) {
          if (request.day > 8) throw new Error('Role scenario did not finish within its script')
          if (request.tool === 'night_choice') requests.push(structuredClone(request))
          choice = options.act(request)
        } else if (request.tool === 'nominate') {
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
        } else if (request.tool === 'night_choice') {
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
        } else {
          throw new Error('Unexpected whisper request')
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
    drunk.believedRole = 'slayer'
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
    const { events, discretionCalls, requests } = await game([1, 5, 2], {
      seats,
      d14: 3,
      choose: (request) =>
        request.tool === 'night_choice' ? { reasoning: '', targets: [3] } : passAction(request),
    })
    expect(discretionCalls).toEqual(['D14'])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([
      expect.objectContaining({ seat: 3, from: 'poisoner', to: 'imp' }),
    ])
    expect(
      requests.filter((request) => request.role === 'imp').map((request) => request.seat),
    ).toEqual([5, 5, 3])
    const requested = events.findIndex((event) => event.type === 'discretion.requested')
    expect(events.slice(requested, requested + 5).map((event) => event.type)).toEqual([
      'discretion.requested',
      'discretion.resolved',
      'role.changed',
      'status.changed',
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

async function whispers(
  choose: (request: ContestantRequest) => ContestantChoice | Promise<ContestantChoice>,
  options: { limit?: number; seed?: number; seats?: SeatState[] } = {},
) {
  const config = { ...CONFIG, whisperLimit: options.limit ?? 1, seed: options.seed ?? 22 }
  const events: GameEvent[] = [
    { seq: 1, type: 'game.created', ...config },
    { seq: 2, type: 'grimoire.set', seats: options.seats ?? seatsFor() },
  ]
  const requests: ContestantRequest[] = []
  await expect(
    runGame({
      config,
      log: events,
      rng: createRng(config.seed),
      discretion: () => Promise.reject(new Error('Unexpected discretion')),
      commit: (input) => {
        if (input.type === 'phase.started' && input.phase === 'public')
          throw new Error('whispers_complete')
        const event = { ...input, seq: events.length + 1 }
        events.push(event)
        return event
      },
      askContestants: (batch) => {
        requests.push(...structuredClone(batch))
        return Promise.all(batch.map(async (request) => choose(request)))
      },
    }),
  ).rejects.toThrow('whispers_complete')
  return { events, requests }
}

describe('whispers through the rules seam', () => {
  it('merges identical membership regardless of proposal order and gives stable anonymous candidates', async () => {
    const { events, requests } = await whispers((request) => {
      if (request.tool === 'propose_whisper')
        return {
          reasoning: 'Meet',
          members: request.seat === 1 ? [3, 2] : request.seat === 2 ? [1, 3] : null,
        }
      if (request.tool === 'rank_whispers')
        return { reasoning: 'Accept', ranking: request.rooms.map((room) => room.id) }
      return { reasoning: 'Pass', speech: null, slayer_target: null }
    })
    expect(events.filter((event) => event.type === 'whisper.room.opened')).toMatchObject([
      { round: 1, members: [1, 2, 3] },
    ])
    expect(
      events.filter((event) => event.type === 'whisper.candidates' && event.round === 1),
    ).toMatchObject(
      [1, 2, 3, 4, 5].map((seat) => ({
        seat,
        round: 1,
        rooms: seat <= 3 ? [{ id: 1, members: [1, 2, 3] }] : [],
      })),
    )
    expect(
      requests.filter((request) => request.tool === 'rank_whispers').map((request) => request.seat),
    ).toEqual([1, 2, 3])
    expect(
      project(events, 'storyteller').some(
        (event) => event.type === 'whisper.proposed' || event.type === 'whisper.ranked',
      ),
    ).toBe(false)
  })
})

describe('whisper allocation and allowances', () => {
  it('uses the whole membership rank sum before assigning disjoint rooms, without shrinking rooms', async () => {
    const { events } = await whispers((request) => {
      if (request.tool === 'propose_whisper')
        return {
          reasoning: '',
          members:
            request.round === 1
              ? (({ 1: [2, 3], 2: [4], 3: [5] } as Record<number, number[]>)[request.seat] ?? null)
              : null,
        }
      if (request.tool === 'rank_whispers')
        return {
          reasoning: '',
          ranking:
            ({ 1: [1], 2: [2, 1], 3: [3, 1], 4: [2], 5: [3] } as Record<number, number[]>)[
              request.seat
            ] ?? [],
        }
      return { reasoning: '', speech: null, slayer_target: null }
    })
    const rooms = events.filter((event) => event.type === 'whisper.room.opened')
    expect(rooms.map((room) => room.members).sort()).toEqual([
      [2, 4],
      [3, 5],
    ])
    expect(rooms.every((room) => room.round === 1)).toBe(true)
  })

  it('breaks equal rank sums reproducibly with the seed rather than candidate order', async () => {
    const play = async (seed: number) => {
      const { events } = await whispers(
        (request) => {
          if (request.tool === 'propose_whisper')
            return {
              reasoning: '',
              members:
                request.round === 1
                  ? (({ 1: [2], 2: [3], 3: [1] } as Record<number, number[]>)[request.seat] ?? null)
                  : null,
            }
          if (request.tool === 'rank_whispers')
            return {
              reasoning: '',
              ranking:
                ({ 1: [1, 3], 2: [2, 1], 3: [3, 2] } as Record<number, number[]>)[request.seat] ??
                [],
            }
          return { reasoning: '', speech: null, slayer_target: null }
        },
        { seed },
      )
      return events
        .filter((event) => event.type === 'whisper.room.opened')
        .map((event) => event.members)
    }
    expect(await play(22)).toEqual(await play(22))
    const outcomes = await Promise.all([1, 2, 3, 4, 5, 6].map(play))
    expect(outcomes.every((rooms) => rooms.length === 1)).toBe(true)
    expect(new Set(outcomes.map((rooms) => JSON.stringify(rooms))).size).toBeGreaterThan(1)
  })

  it('drops a room omitted by one member, never downgrades it, and ends with no room', async () => {
    const { events, requests } = await whispers(
      (request) => {
        if (request.tool === 'propose_whisper')
          return { reasoning: '', members: request.seat === 1 ? [2, 3] : null }
        if (request.tool === 'rank_whispers')
          return { reasoning: '', ranking: request.seat === 3 ? [] : [1] }
        throw new Error('No room should converse')
      },
      { limit: 3 },
    )
    expect(events.filter((event) => event.type === 'whisper.room.opened')).toEqual([])
    expect(requests.filter((request) => request.tool === 'propose_whisper')).toHaveLength(5)
  })

  it('charges only formed rooms, excludes exhausted seats, allows dead seats and distinguishes repeated rooms', async () => {
    const seats = seatsFor().map((seat) => ({ ...seat, alive: seat.seat !== 1 }))
    const { events, requests } = await whispers(
      (request) => {
        if (request.tool === 'propose_whisper')
          return {
            reasoning: '',
            members: request.seat === 1 ? [2] : request.seat === 3 ? [4] : null,
          }
        if (request.tool === 'rank_whispers')
          return {
            reasoning: '',
            ranking:
              request.round === 1 && request.seat === 4 ? [] : request.rooms.map((room) => room.id),
          }
        return {
          reasoning: '',
          speech: request.seat === 1 ? 'Even dead, I can speak.' : null,
          slayer_target: null,
        }
      },
      { limit: 2, seats },
    )
    const rooms = events.filter((event) => event.type === 'whisper.room.opened')
    expect(rooms.map((room) => [room.round, room.members]).sort()).toEqual([
      [1, [1, 2]],
      [2, [1, 2]],
      [2, [3, 4]],
      [3, [3, 4]],
    ])
    expect(new Set(rooms.map((room) => room.roomId)).size).toBe(4)
    expect(
      requests.find(
        (request) =>
          request.tool === 'propose_whisper' && request.round === 2 && request.seat === 3,
      ),
    ).toMatchObject({ remaining: 2 })
    expect(
      requests.filter((request) => request.tool === 'propose_whisper' && request.round === 3),
    ).toMatchObject([
      { seat: 3, remaining: 1, eligible: [3, 4, 5] },
      { seat: 4, remaining: 1, eligible: [3, 4, 5] },
      { seat: 5, remaining: 2, eligible: [3, 4, 5] },
    ])
    expect(events.filter((event) => event.type === 'whisper.speech')).toMatchObject([
      { seat: 1, round: 1 },
      { seat: 1, round: 2 },
    ])
  })

  it('converses concurrently with isolated events and closes all rooms before the next round', async () => {
    let release: (() => void) | undefined
    const otherRoomStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    const { events } = await whispers(async (request) => {
      if (request.tool === 'propose_whisper')
        return {
          reasoning: '',
          members: request.seat === 1 ? [2] : request.seat === 3 ? [4] : null,
        }
      if (request.tool === 'rank_whispers')
        return { reasoning: '', ranking: request.rooms.map((room) => room.id) }
      if (request.tool !== 'speak' || !request.room) throw new Error('Expected room speech')
      if (request.seat === 1) await otherRoomStarted
      if (request.seat === 3) release?.()
      return {
        reasoning: '',
        speech: request.seat % 2 === 1 ? `Private secret ${String(request.seat)}` : null,
        slayer_target: null,
      }
    })
    expect(events.filter((event) => event.type === 'whisper.speech')).toHaveLength(2)
    expect(
      project(events, 'seat:1')
        .filter((event) => event.type === 'whisper.speech')
        .map((event) => event.speech),
    ).toEqual(['Private secret 1'])
    expect(
      project(events, 'seat:3')
        .filter((event) => event.type === 'whisper.speech')
        .map((event) => event.speech),
    ).toEqual(['Private secret 3'])
    expect(
      project(events, 'public').filter(
        (event) => event.type === 'whisper.speech' || event.type === 'whisper.room.closed',
      ),
    ).toEqual([])
    const closed = events.filter((event) => event.type === 'whisper.room.closed')
    expect(closed).toHaveLength(2)
    expect(
      closed.every(
        (event) =>
          event.seq <
          (events.find((event) => event.type === 'whisper.proposed' && event.round === 2)?.seq ??
            Infinity),
      ),
    ).toBe(true)
  })

  it('skips the private phase when the configured limit is zero', async () => {
    const { events, requests } = await whispers(
      () => {
        throw new Error('Must not ask')
      },
      { limit: 0 },
    )
    expect(requests).toEqual([])
    expect(
      events.some((event) => event.type === 'phase.started' && event.phase === 'whisper'),
    ).toBe(false)
  })
})

describe('whisper semantic boundaries', () => {
  it('accepts only other eligible distinct invitees or null, and listed distinct rankings', () => {
    const proposal: ContestantRequest = {
      tool: 'propose_whisper',
      seat: 1,
      day: 1,
      round: 1,
      remaining: 2,
      eligible: [1, 2, 3],
    }
    for (const members of [[], [1], [2, 2], [4], [0], [2.5], ['2'], undefined])
      expect(validateContestantChoice({ reasoning: '', members }, proposal)).toContainEqual({
        code: 'invalid_whisper_members',
      })
    for (const members of [null, [2], [3, 2]])
      expect(validateContestantChoice({ reasoning: '', members }, proposal)).toEqual([])
    const ranking: ContestantRequest = {
      tool: 'rank_whispers',
      seat: 1,
      day: 1,
      round: 1,
      rooms: [
        { id: 7, members: [1, 2] },
        { id: 9, members: [1, 3] },
      ],
    }
    for (const value of [[1], [7, 7], ['7'], null, undefined])
      expect(validateContestantChoice({ reasoning: '', ranking: value }, ranking)).toContainEqual({
        code: 'invalid_whisper_ranking',
      })
    for (const value of [[], [9], [9, 7]])
      expect(validateContestantChoice({ reasoning: '', ranking: value }, ranking)).toEqual([])
    expect(
      validateSpeechChoice(
        { reasoning: '', speech: 'A private shot.', slayer_target: 2 },
        { tool: 'speak', seat: 1, day: 1, kind: 'whisper' },
      ),
    ).toContainEqual({ code: 'invalid_slayer_target' })
    expect(
      validateSpeechChoice(
        { reasoning: '', speech: null, slayer_target: null },
        { tool: 'speak', seat: 1, day: 1, kind: 'whisper' },
      ),
    ).toEqual([])
  })

  it('ends without another proposal batch when everyone exhausts their allowance', async () => {
    const { events, requests } = await whispers((request) => {
      if (request.tool === 'propose_whisper')
        return { reasoning: '', members: request.seat === 1 ? [2, 3, 4, 5] : null }
      if (request.tool === 'rank_whispers') return { reasoning: '', ranking: [1] }
      return { reasoning: '', speech: null, slayer_target: null }
    })
    expect(events.filter((event) => event.type === 'whisper.room.opened')).toHaveLength(1)
    expect(requests.filter((request) => request.tool === 'propose_whisper')).toHaveLength(5)
  })
})

function passAction(request: ContestantRequest): ContestantChoice {
  switch (request.tool) {
    case 'night_choice':
      return { reasoning: '', targets: [5] }
    case 'speak':
      return {
        reasoning: '',
        speech: request.kind === 'free' ? null : 'Argument',
        slayer_target: null,
      }
    case 'nominate':
      return { reasoning: '', nominee: null }
    case 'vote':
      return { reasoning: '', raise_hand: false }
    case 'propose_whisper':
      return { reasoning: '', members: null }
    case 'rank_whispers':
      return { reasoning: '', ranking: [] }
  }
}

describe('protection and daytime triggers', () => {
  it('Monk skips first night, excludes self, protects Imp suicide, and expires next night', async () => {
    const { events, requests } = await game([], {
      seats: seatsFor(['monk', 'chef', 'soldier', 'scarletwoman', 'imp']),
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning: '',
              targets: [request.role === 'monk' ? (request.day === 2 ? 5 : 3) : request.seat],
            }
          : passAction(request),
    })
    const monk = requests.filter((request) => request.role === 'monk')
    expect(monk.map((request) => request.day)).toEqual([2, 3, 4])
    expect(monk.every((request) => !request.targets.includes(1))).toBe(true)
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.role === 'imp'),
    ).toMatchObject({ result: { target: 5, outcome: 'protected' } })
    expect(
      events.filter((event) => event.type === 'night.death').map((event) => event.seat),
    ).toEqual([5, 4])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'status.changed',
        seat: 5,
        status: 'protected',
        value: false,
      }),
    )
  })
  it.each([
    { redirect: false, target: 3, death: 1 },
    { redirect: true, target: 3, death: 3 },
    { redirect: true, target: 2, death: null },
  ])(
    'Mayor D12=$redirect D13=$target resolves exactly one Imp attack',
    async ({ redirect, target, death }) => {
      const candidatesSeen: unknown[] = []
      const { events, discretionCalls } = await game([], {
        seats: seatsFor(['mayor', 'soldier', 'chef', 'scarletwoman', 'imp']),
        discretion: (id, candidates) => {
          candidatesSeen.push(candidates)
          return Promise.resolve(id === 'D12' ? redirect : target)
        },
        act: (request) =>
          request.tool === 'night_choice'
            ? { reasoning: '', targets: [request.day === 2 ? 1 : request.seat] }
            : passAction(request),
      })
      const night2 = events.filter(
        (event) =>
          event.seq >
            (events.find((event) => event.type === 'phase.started' && event.day === 2)?.seq ?? 0) &&
          event.seq <
            (events.find(
              (event) =>
                event.type === 'phase.started' && event.day === 2 && event.phase === 'dawn',
            )?.seq ?? Infinity),
      )
      expect(
        night2.filter((event) => event.type === 'night.death').map((event) => event.seat),
      ).toEqual(death === null ? [] : [death])
      expect(discretionCalls).toEqual(redirect ? ['D12', 'D13'] : ['D12'])
      expect(candidatesSeen[0]).toEqual([false, true])
      if (redirect) expect(candidatesSeen[1]).toEqual([2, 3, 4, 5])
    },
  )
  it('Virgin immediately executes a Townsfolk nominator and overrides a leading execution', async () => {
    const { events } = await game([], {
      seats: seatsFor(['virgin', 'chef', 'soldier', 'scarletwoman', 'imp']),
      act: (request) => {
        if (request.tool === 'nominate' && request.day === 1)
          return {
            reasoning: '',
            nominee:
              request.nominees.includes(4) && request.seat === 2
                ? 4
                : !request.nominees.includes(4) && request.seat === 3
                  ? 1
                  : null,
          }
        if (request.tool === 'vote') return { reasoning: '', raise_hand: true }
        if (request.tool === 'night_choice') return { reasoning: '', targets: [request.seat] }
        return passAction(request)
      },
    })
    const trigger = events.findIndex((event) => event.type === 'virgin.triggered')
    expect(trigger).toBeGreaterThan(0)
    expect(events[trigger + 1]).toMatchObject({ type: 'execution', seat: 3 })
    expect(events.filter((event) => event.type === 'execution')).toEqual([
      expect.objectContaining({ seat: 3 }),
    ])
    expect(events[trigger + 2]).toMatchObject({ type: 'phase.started', phase: 'night', day: 2 })
    expect(fold(events).seats[0]?.abilityUsed).toBe(true)
  })
  it('Slayer spends one shot, kills the Imp, and routes death through Scarlet Woman succession', async () => {
    const { events } = await game([], {
      seats: seatsFor(['slayer', 'chef', 'soldier', 'scarletwoman', 'imp']),
      act: (request) => {
        if (
          request.tool === 'speak' &&
          request.kind === 'free' &&
          request.seat === 1 &&
          request.day <= 2
        )
          return { reasoning: '', speech: 'I shoot.', slayer_target: request.day === 1 ? 5 : 4 }
        if (request.tool === 'night_choice')
          return { reasoning: '', targets: [request.day === 2 ? 2 : request.seat] }
        return passAction(request)
      },
    })
    expect(events.filter((event) => event.type === 'slayer.resolved')).toEqual([
      expect.objectContaining({ seat: 1, target: 5, died: true }),
      expect.objectContaining({ seat: 1, target: 4, died: false }),
    ])
    expect(events.find((event) => event.type === 'role.changed')).toMatchObject({
      seat: 4,
      to: 'imp',
    })
    expect(
      events.filter((event) => event.type === 'status.changed' && event.status === 'abilityUsed'),
    ).toEqual([expect.objectContaining({ seat: 1, value: true })])
  })
  it('Butler chooses a nonself master every night and an illegal vote still counts', async () => {
    const votes: ContestantRequest[] = []
    const { events, requests } = await game([], {
      seats: seatsFor(['butler', 'chef', 'soldier', 'scarletwoman', 'imp']),
      act: (request) => {
        if (request.tool === 'night_choice')
          return { reasoning: '', targets: [request.role === 'butler' ? 5 : request.seat] }
        if (
          request.tool === 'nominate' &&
          request.day === 1 &&
          request.seat === 2 &&
          request.nominees.includes(3)
        )
          return { reasoning: '', nominee: 3 }
        if (request.tool === 'vote') {
          votes.push(request)
          return { reasoning: '', raise_hand: request.seat !== 5 }
        }
        return passAction(request)
      },
    })
    expect(
      requests.filter((request) => request.role === 'butler').map((request) => request.day),
    ).toEqual([1, 2])
    expect(
      requests
        .filter((request) => request.role === 'butler')
        .every((request) => !request.targets.includes(1)),
    ).toBe(true)
    expect(votes.find((request) => request.seat === 1)).toMatchObject({
      master: 5,
      canRaiseHand: true,
    })
    expect(events.find((event) => event.type === 'vote.tallied')).toMatchObject({ votes: 4 })
    expect(
      events.filter((event) => event.type === 'status.changed' && event.status === 'master'),
    ).toHaveLength(2)
  })
  it('Mayor wins only when three live at day end without execution and the ability is effective', async () => {
    const seats = seatsFor(['mayor', 'soldier', 'chef', 'scarletwoman', 'imp']).map((seat) => ({
      ...seat,
      alive: ![2, 4].includes(seat.seat),
    }))
    const { events } = await game([], {
      seats,
      act: (request) =>
        request.tool === 'night_choice'
          ? { reasoning: '', targets: [request.seat] }
          : passAction(request),
    })
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good', reason: 'mayor' })
    expect(events.some((event) => event.type === 'night.choice')).toBe(false)
    for (const poisoned of [true, false]) {
      const result = await game([], {
        seats: seats.map((seat) => ({ ...seat, poisoned: seat.seat === 1 && poisoned })),
        act: (request) => {
          if (
            !poisoned &&
            request.tool === 'nominate' &&
            request.day === 1 &&
            request.seat === 3 &&
            request.nominees.includes(2)
          )
            return { reasoning: '', nominee: 2 }
          if (request.tool === 'vote') return { reasoning: '', raise_hand: true }
          return request.tool === 'night_choice'
            ? { reasoning: '', targets: [request.seat] }
            : passAction(request)
        },
      })
      expect(result.events.at(-1)).toMatchObject({ type: 'game.ended', reason: 'all_demons_dead' })
      if (!poisoned)
        expect(result.events).toContainEqual(
          expect.objectContaining({ type: 'execution', seat: 2 }),
        )
    }
  })
  it('admits each implemented Townsfolk in setup', () => {
    for (const role of ['monk', 'mayor', 'virgin', 'slayer'])
      expect(validate([role, 'chef', 'soldier', 'scarletwoman', 'imp'])).toEqual([])
  })
  it.each(['monk', 'butler'] as const)(
    '%s rejects self even when supplied in the target list',
    (role) => {
      expect(
        validateNightChoice(
          { reasoning: '', targets: [1] },
          { tool: 'night_choice', seat: 1, role, day: 2, targets: [1, 2] },
        ),
      ).toContainEqual({ code: 'invalid_targets' })
    },
  )
  it.each(['dead', 'protected', 'protected-mayor', 'poisoned-mayor'] as const)(
    'Mayor attack handles %s without another Imp choice',
    async (mode) => {
      const seats = seatsFor([
        'mayor',
        'monk',
        'chef',
        mode === 'poisoned-mayor' ? 'poisoner' : 'scarletwoman',
        'imp',
      ]).map((seat) => ({
        ...seat,
        alive: !(mode === 'dead' && seat.seat === 3),
        poisoned: mode === 'poisoned-mayor' && seat.seat === 1,
      }))
      const { events, requests, discretionCalls } = await game([], {
        seats,
        discretion: (id) => Promise.resolve(id === 'D12' ? true : 3),
        act: (request) =>
          request.tool === 'night_choice'
            ? {
                reasoning: '',
                targets: [
                  request.role === 'poisoner'
                    ? 1
                    : request.role === 'monk'
                      ? request.day > 2
                        ? 3
                        : mode === 'protected-mayor'
                          ? 1
                          : mode === 'protected'
                            ? 3
                            : 5
                      : request.day === 2
                        ? 1
                        : request.seat,
                ],
              }
            : passAction(request),
      })
      const dawn = events.find((event) => event.type === 'dawn.announced' && event.day === 2)
      expect(dawn).toMatchObject({ deaths: mode === 'poisoned-mayor' ? [1] : [] })
      expect(discretionCalls).toEqual(
        mode === 'protected-mayor' || mode === 'poisoned-mayor' ? [] : ['D12', 'D13'],
      )
      expect(
        requests.filter((request) => request.role === 'imp' && request.day === 2),
      ).toHaveLength(1)
    },
  )
  it.each(['minion', 'drunk-nominator', 'poisoned', 'drunk-virgin', 'dead-virgin'] as const)(
    'Virgin first nomination with %s never executes and is not restored',
    async (mode) => {
      const seats = seatsFor(['virgin', 'chef', 'soldier', 'scarletwoman', 'imp'])
      const virgin = seats[0]
      const nominatorSeat = seats[1]
      if (!virgin || !nominatorSeat) throw new Error('Missing fixture seats')
      if (mode === 'poisoned') virgin.poisoned = true
      if (mode === 'dead-virgin') virgin.alive = false
      if (mode === 'drunk-virgin') {
        virgin.role = 'drunk'
        virgin.believedRole = 'virgin'
      }
      if (mode === 'drunk-nominator') {
        nominatorSeat.role = 'drunk'
        nominatorSeat.believedRole = 'chef'
      }
      const { events, state } = await game([], {
        seats,
        act: (request) => {
          const nominator = request.day === 1 && mode === 'minion' ? 4 : 2
          if (
            request.tool === 'nominate' &&
            request.day <= 2 &&
            request.seat === nominator &&
            request.nominees.includes(1)
          )
            return { reasoning: '', nominee: 1 }
          if (request.tool === 'night_choice') return { reasoning: '', targets: [request.seat] }
          return passAction(request)
        },
      })
      expect(events.some((event) => event.type === 'virgin.triggered')).toBe(false)
      expect(state.seats[0]?.abilityUsed).toBe(mode !== 'dead-virgin')
      expect(events.filter((event) => event.type === 'nomination')).toHaveLength(2)
    },
  )
  it.each(['miss', 'poisoned', 'drunk', 'dead', 'dead-target', 'before-succession'] as const)(
    'Slayer shot with %s is a public no-op and never grants a second shot',
    async (mode) => {
      const seats = seatsFor(['slayer', 'chef', 'soldier', 'scarletwoman', 'imp'])
      const slayer = seats[0]
      const target = seats[1]
      if (!slayer || !target) throw new Error('Missing fixture seats')
      if (mode === 'poisoned') slayer.poisoned = true
      if (mode === 'drunk') {
        slayer.role = 'drunk'
        slayer.believedRole = 'slayer'
      }
      if (mode === 'dead') slayer.alive = false
      if (mode === 'dead-target') {
        target.alive = false
        target.role = 'imp'
        target.alignment = 'evil'
      }
      const { events, state } = await game([], {
        seats,
        act: (request) => {
          if (
            request.tool === 'speak' &&
            request.kind === 'free' &&
            request.seat === 1 &&
            request.day <= 2
          )
            return {
              reasoning: '',
              speech: 'I shoot.',
              slayer_target:
                request.day === 2
                  ? 5
                  : mode === 'before-succession'
                    ? 4
                    : mode === 'miss' || mode === 'dead-target'
                      ? 2
                      : 5,
            }
          if (request.tool === 'night_choice')
            return { reasoning: '', targets: [request.day === 2 ? 2 : request.seat] }
          return passAction(request)
        },
      })
      expect(
        events.filter((event) => event.type === 'slayer.resolved').every((event) => !event.died),
      ).toBe(true)
      expect(events.filter((event) => event.type === 'slayer.resolved')).toHaveLength(2)
      expect(state.seats[0]?.abilityUsed).toBe(mode !== 'dead')
    },
  )
  it.each(['poisoned', 'dead-target', 'execution'] as const)(
    'Monk protection handles %s without reselecting',
    async (mode) => {
      const seats = seatsFor([
        'monk',
        'chef',
        'soldier',
        mode === 'poisoned' ? 'poisoner' : 'scarletwoman',
        'imp',
      ]).map((seat) => ({
        ...seat,
        poisoned: mode === 'poisoned' && seat.seat === 1,
        alive: !(mode === 'dead-target' && seat.seat === 2),
      }))
      const { events, requests } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'night_choice')
            return {
              reasoning: '',
              targets: [
                request.role === 'poisoner'
                  ? 1
                  : request.role === 'monk'
                    ? 2
                    : request.day === 2
                      ? mode === 'execution'
                        ? 3
                        : 2
                      : request.seat,
              ],
            }
          if (
            request.tool === 'nominate' &&
            request.day === 2 &&
            request.seat === 3 &&
            request.nominees.includes(2) &&
            mode === 'execution'
          )
            return { reasoning: '', nominee: 2 }
          if (request.tool === 'vote') return { reasoning: '', raise_hand: true }
          return passAction(request)
        },
      })
      expect(
        requests.filter((request) => request.role === 'imp' && request.day === 2),
      ).toHaveLength(1)
      expect(
        events.find((event) => event.type === 'dawn.announced' && event.day === 2),
      ).toMatchObject({ deaths: mode === 'poisoned' ? [2] : [] })
      if (mode === 'execution')
        expect(events.find((event) => event.type === 'execution')).toMatchObject({ seat: 2 })
      if (mode === 'poisoned')
        expect(
          events
            .slice(
              0,
              events.findIndex((event) => event.type === 'dawn.announced' && event.day === 2),
            )
            .some(
              (event) =>
                event.type === 'status.changed' &&
                event.status === 'protected' &&
                event.value === true,
            ),
        ).toBe(false)
    },
  )
  it.each(['dead', 'poisoned', 'dead-master'] as const)(
    'Butler handles %s without enforcing the vote restriction',
    async (mode) => {
      const seats = seatsFor(['butler', 'chef', 'soldier', 'scarletwoman', 'imp']).map((seat) => ({
        ...seat,
        poisoned: mode === 'poisoned' && seat.seat === 1,
        alive:
          !(mode === 'dead' && seat.seat === 1) && !(mode === 'dead-master' && seat.seat === 3),
        master: seat.seat === 1 ? 3 : null,
      }))
      const { events, requests } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'night_choice')
            return { reasoning: '', targets: [request.role === 'butler' ? 3 : request.seat] }
          if (
            request.tool === 'nominate' &&
            request.day === 1 &&
            request.seat === 2 &&
            request.nominees.includes(3)
          )
            return { reasoning: '', nominee: 3 }
          if (request.tool === 'vote') return { reasoning: '', raise_hand: request.seat === 1 }
          return passAction(request)
        },
      })
      expect(requests.some((request) => request.role === 'butler')).toBe(mode !== 'dead')
      expect(events.find((event) => event.type === 'vote' && event.seat === 1)).toMatchObject({
        raiseHand: true,
        voteUsed: mode === 'dead',
      })
      expect(events.find((event) => event.type === 'vote.tallied')).toMatchObject({ votes: 1 })
      if (mode !== 'dead')
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'status.changed', status: 'master', value: 3 }),
        )
    },
  )
  it('Slayer ends a game immediately when no Scarlet Woman can inherit, ignoring Monk protection', async () => {
    const seats = seatsFor(['slayer', 'monk', 'soldier', 'scarletwoman', 'imp']).map((seat) => ({
      ...seat,
      alive: seat.seat !== 4,
    }))
    const { events } = await game([], {
      seats,
      act: (request) => {
        if (request.tool === 'night_choice')
          return { reasoning: '', targets: [request.role === 'monk' ? 5 : 3] }
        if (
          request.tool === 'speak' &&
          request.kind === 'free' &&
          request.day === 2 &&
          request.seat === 1
        )
          return { reasoning: '', speech: 'Shoot', slayer_target: 5 }
        return passAction(request)
      },
    })
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'slayer.resolved', died: true }),
      expect.objectContaining({ type: 'game.ended', winner: 'good' }),
    ])
  })
  it('Mayor substitute is an Imp kill and wakes Ravenkeeper immediately before dawn', async () => {
    const { events } = await game([], {
      seats: seatsFor(['mayor', 'ravenkeeper', 'soldier', 'scarletwoman', 'imp']),
      discretion: (id) => Promise.resolve(id === 'D12' ? true : 2),
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning: '',
              targets: [request.role === 'ravenkeeper' ? 2 : request.day === 2 ? 1 : request.seat],
            }
          : passAction(request),
    })
    const death = events.find((event) => event.type === 'night.death' && event.seat === 2)
    const choice = events.find((event) => event.type === 'night.choice' && event.seat === 2)
    const told = events.find(
      (event) => event.type === 'told' && event.kind === 'ability' && event.seat === 2,
    )
    const dawn = events.find((event) => event.type === 'dawn.announced' && event.day === 2)
    expect(death).toMatchObject({ cause: 'imp' })
    expect(choice).toMatchObject({ role: 'ravenkeeper', targets: [2] })
    expect(told).toMatchObject({
      content: { role: 'ravenkeeper', result: { target: 2, role: 'ravenkeeper' } },
    })
    expect(death?.seq).toBeLessThan(choice?.seq ?? 0)
    expect(choice?.seq).toBeLessThan(told?.seq ?? 0)
    expect(told?.seq).toBeLessThan(dawn?.seq ?? 0)
  })
  it('Virgin execution supplies Undertaker information the following night', async () => {
    const { events } = await game([], {
      seats: seatsFor(['virgin', 'undertaker', 'chef', 'scarletwoman', 'imp']),
      act: (request) => {
        if (
          request.tool === 'nominate' &&
          request.day === 1 &&
          request.seat === 3 &&
          request.nominees.includes(1)
        )
          return { reasoning: '', nominee: 1 }
        if (request.tool === 'night_choice')
          return { reasoning: '', targets: [request.day === 2 ? 3 : request.seat] }
        return passAction(request)
      },
    })
    const trigger = events.findIndex((event) => event.type === 'virgin.triggered')
    expect(events[trigger + 1]).toMatchObject({ type: 'execution', seat: 3 })
    expect(
      events.filter(
        (event) => event.type === 'told' && event.kind === 'ability' && event.seat === 2,
      ),
    ).toEqual([
      expect.objectContaining({
        content: { role: 'undertaker', result: { target: 3, role: 'chef' } },
      }),
    ])
  })
  it.each(['drunk', 'dead', 'two-alive'] as const)('Mayor cannot win while %s', async (mode) => {
    const seats = seatsFor(['mayor', 'chef', 'soldier', 'scarletwoman', 'imp']).map((seat) => ({
      ...seat,
      alive:
        mode === 'two-alive'
          ? [1, 5].includes(seat.seat)
          : mode === 'dead'
            ? [2, 3, 5].includes(seat.seat)
            : [1, 3, 5].includes(seat.seat),
    }))
    const mayor = seats[0]
    if (!mayor) throw new Error('Missing Mayor fixture')
    if (mode === 'drunk') {
      mayor.role = 'drunk'
      mayor.believedRole = 'mayor'
    }
    const { events } = await game([], {
      seats,
      act: (request) =>
        request.tool === 'night_choice'
          ? { reasoning: '', targets: [request.seat] }
          : passAction(request),
    })
    expect(events.at(-1)).toMatchObject({
      type: 'game.ended',
      reason: mode === 'two-alive' ? 'two_alive' : 'all_demons_dead',
    })
  })
})

describe('drunkenness and poison through the rules seam', () => {
  it('routes poisoned Chef information through D8 and records truth separately', async () => {
    const seats = seatsFor(['chef', 'soldier', 'empath', 'scarletwoman', 'imp'])
    if (seats[0]) seats[0].poisoned = true
    const { events } = await game([4, 5], {
      seats,
      discretion: (id, candidates) => {
        expect(id).toBe('D8')
        expect(candidates).toEqual([0, 1, 2, 3, 4, 5])
        return Promise.resolve(2)
      },
    })
    expect(events.find((event) => event.type === 'ability.resolved')).toMatchObject({
      seat: 1,
      role: 'chef',
      result: 1,
      deviated: true,
      reason: 'poisoned',
    })
    expect(events.find((event) => event.type === 'told' && event.kind === 'ability')).toMatchObject(
      {
        content: { role: 'chef', result: 2 },
      },
    )
  })
  it('keeps self-poison until dusk, disables a poisoned Imp, and clears poison on source death', async () => {
    const { events } = await game([], {
      seats: seatsFor(['chef', 'soldier', 'poisoner', 'empath', 'imp']),
      act: (request) => {
        if (request.tool !== 'night_choice') return passAction(request)
        return {
          reasoning: '',
          targets: [
            request.role === 'poisoner'
              ? request.day === 1
                ? 3
                : request.day === 2
                  ? 5
                  : 2
              : request.day === 3
                ? 3
                : 5,
          ],
        }
      },
    })
    expect(
      events.filter((event) => event.type === 'status.changed' && event.status === 'poisoned'),
    ).toEqual([
      expect.objectContaining({ seat: 3, value: true }),
      expect.objectContaining({ seat: 3, value: false }),
      expect.objectContaining({ seat: 5, value: true }),
      expect.objectContaining({ seat: 5, value: false }),
      expect.objectContaining({ seat: 2, value: true }),
      expect.objectContaining({ seat: 2, value: false }),
    ])
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.role === 'imp'),
    ).toMatchObject({ result: { target: 5, outcome: 'inactive' } })
    const death = events.findIndex((event) => event.type === 'night.death' && event.seat === 3)
    expect(events[death + 1]).toMatchObject({
      type: 'status.changed',
      seat: 2,
      status: 'poisoned',
      value: false,
    })
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })
  it('uses D2 for an absent Townsfolk identity and wakes a Drunk Monk without protecting', async () => {
    const { events, requests } = await game([1, 4, 5], {
      seats: seatsFor(['drunk', 'chef', 'soldier', 'scarletwoman', 'imp']),
      discretion: (id, candidates) => {
        expect(id).toBe('D2')
        expect(candidates).toContain('monk')
        expect(candidates).not.toContain('chef')
        expect(candidates).not.toContain('soldier')
        expect(candidates).not.toContain('drunk')
        return Promise.resolve('monk' as const)
      },
      choose: (request) =>
        request.tool === 'night_choice' ? { reasoning: '', targets: [2] } : passAction(request),
    })
    expect(
      requests
        .filter((request) => request.seat === 1)
        .map((request) => [request.role, request.day]),
    ).toEqual([['monk', 2]])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'told', seat: 1, kind: 'role', content: { role: 'monk' } }),
    )
    expect(
      events.some((event) => event.type === 'status.changed' && event.status === 'protected'),
    ).toBe(false)
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
    ).toMatchObject({ role: 'drunk', result: { target: 2, outcome: 'inactive' } })
  })
  for (const impairment of ['drunk', 'poisoned'] as const) {
    it.each([
      'washerwoman',
      'librarian',
      'investigator',
      'fortuneteller',
      'undertaker',
      'ravenkeeper',
      'empath',
    ] as const)(
      `${impairment} %s receives plausible D8 information, with real truth retained`,
      async (role) => {
        const seats = seatsFor([
          impairment === 'drunk' ? 'drunk' : role,
          'chef',
          'soldier',
          'poisoner',
          'imp',
        ])
        if (impairment === 'drunk' && seats[0]) seats[0].believedRole = role
        const pairRole = role === 'washerwoman' ? 'mayor' : role === 'librarian' ? 'saint' : 'spy'
        const answer: InformationResult = ['washerwoman', 'librarian', 'investigator'].includes(
          role,
        )
          ? { seats: [2, 3], role: pairRole }
          : role === 'fortuneteller'
            ? true
            : role === 'empath'
              ? 0
              : { target: role === 'ravenkeeper' ? 5 : 3, role: 'mayor' }
        const { events, requests, discretionCalls } = await game([], {
          seats,
          discretion: (id, candidates) => {
            if (id === 'D3') return Promise.resolve(1)
            expect(id).toBe('D8')
            expect(candidates).toContainEqual(answer)
            if (role === 'washerwoman' || role === 'librarian' || role === 'investigator') {
              expect(candidates).toHaveLength(role === 'washerwoman' ? 78 : 25)
              for (const candidate of candidates as (number | { seats: number[] })[])
                if (typeof candidate !== 'number') expect(candidate.seats).not.toContain(1)
            }
            if (role === 'undertaker' || role === 'ravenkeeper') expect(candidates).toHaveLength(22)
            return Promise.resolve(answer)
          },
          act: (request) => {
            if (request.tool === 'night_choice')
              return {
                reasoning: '',
                targets:
                  request.role === 'poisoner'
                    ? [impairment === 'poisoned' ? 1 : 4]
                    : request.role === 'fortuneteller'
                      ? [2, 3]
                      : request.role === 'ravenkeeper'
                        ? [5]
                        : [request.day === 2 ? (role === 'ravenkeeper' ? 1 : 2) : request.seat],
              }
            if (
              role === 'undertaker' &&
              request.tool === 'nominate' &&
              request.day === 1 &&
              request.seat === 2 &&
              request.nominees.includes(3)
            )
              return { reasoning: '', nominee: 3 }
            if (request.tool === 'vote') return { reasoning: '', raise_hand: true }
            return passAction(request)
          },
        })
        expect(discretionCalls).toContain('D8')
        expect(discretionCalls.some((id) => ['D4', 'D5', 'D6'].includes(id))).toBe(false)
        expect(
          events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
        ).toMatchObject({
          role: impairment === 'drunk' ? 'drunk' : role,
          deviated: true,
          reason: impairment,
        })
        expect(
          events.find(
            (event) => event.type === 'told' && event.kind === 'ability' && event.seat === 1,
          ),
        ).toMatchObject({ content: { role, result: answer } })
        if (impairment === 'drunk' && role === 'fortuneteller')
          expect(fold(events).redHerring).toBeNull()
        if (['fortuneteller', 'ravenkeeper'].includes(role))
          expect(requests.some((request) => request.seat === 1 && request.role === role)).toBe(true)
      },
    )
  }
})

describe('poison lifecycle interactions', () => {
  it.each(['drunk', 'poisoned'] as const)(
    '%s Soldier dies to the Imp without a second choice',
    async (mode) => {
      const seats = seatsFor([
        mode === 'drunk' ? 'drunk' : 'soldier',
        'chef',
        'empath',
        'poisoner',
        'imp',
      ])
      if (mode === 'drunk' && seats[0]) seats[0].believedRole = 'soldier'
      const { events, requests } = await game([], {
        seats,
        act: (request) =>
          request.tool === 'night_choice'
            ? {
                reasoning: '',
                targets: [
                  request.role === 'poisoner'
                    ? mode === 'poisoned'
                      ? 1
                      : 4
                    : request.day === 2
                      ? 1
                      : request.seat,
                ],
              }
            : passAction(request),
      })
      expect(events.find((event) => event.type === 'night.death')).toMatchObject({ seat: 1 })
      expect(
        requests.filter((request) => request.day === 2 && request.role === 'imp'),
      ).toHaveLength(1)
    },
  )
  it('poisoned Scarlet Woman cannot inherit an executed Imp with five alive', async () => {
    const { events } = await game([], {
      seats: seatsFor(['soldier', 'chef', 'poisoner', 'scarletwoman', 'imp']),
      act: (request) => {
        if (request.tool === 'night_choice') return { reasoning: '', targets: [4] }
        if (request.tool === 'nominate' && request.seat === 2 && request.nominees.includes(5))
          return { reasoning: '', nominee: 5 }
        if (request.tool === 'vote') return { reasoning: '', raise_hand: true }
        return passAction(request)
      },
    })
    expect(events.some((event) => event.type === 'role.changed')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })
  it('source death restores a poisoned Empath before its later action that same night', async () => {
    const { events } = await game([], {
      seats: seatsFor(['empath', 'chef', 'soldier', 'poisoner', 'imp']),
      discretion: () => Promise.resolve(0),
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning: '',
              targets: [request.role === 'poisoner' ? 1 : request.day === 2 ? 4 : request.seat],
            }
          : passAction(request),
    })
    const death = events.findIndex((event) => event.type === 'night.death' && event.seat === 4)
    expect(events[death + 1]).toMatchObject({
      type: 'status.changed',
      seat: 1,
      status: 'poisoned',
      value: false,
    })
    expect(events[death + 2]).toMatchObject({
      type: 'ability.resolved',
      seat: 1,
      result: 1,
      deviated: false,
    })
    expect(events[death + 2]).not.toHaveProperty('reason')
  })
  it('allows true D8 information when a Drunk Ravenkeeper inspects itself', async () => {
    const seats = seatsFor(['drunk', 'chef', 'soldier', 'scarletwoman', 'imp'])
    if (seats[0]) seats[0].believedRole = 'ravenkeeper'
    const { events } = await game([1, 4, 5], {
      seats,
      choose: (request) =>
        request.tool === 'night_choice' ? { reasoning: '', targets: [1] } : passAction(request),
      discretion: (id, candidates) => {
        expect(id).toBe('D8')
        expect(candidates).toContainEqual({ target: 1, role: 'drunk' })
        return Promise.resolve({ target: 1, role: 'drunk' })
      },
    })
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
    ).toMatchObject({
      role: 'drunk',
      result: { target: 1, role: 'drunk' },
      deviated: false,
      reason: 'drunk',
    })
    expect(
      events.find((event) => event.type === 'told' && event.kind === 'ability' && event.seat === 1),
    ).toMatchObject({ content: { role: 'ravenkeeper', result: { target: 1, role: 'drunk' } } })
  })
  it('accepts any truthful D8 pair, not just the first canonical truth candidate', async () => {
    const seats = seatsFor(['washerwoman', 'chef', 'soldier', 'scarletwoman', 'imp'])
    if (seats[0]) seats[0].poisoned = true
    const { events } = await game([4, 5], {
      seats,
      discretion: () => Promise.resolve({ seats: [2, 3], role: 'soldier' }),
    })
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
    ).toMatchObject({ deviated: false, reason: 'poisoned' })
    expect(events.find((event) => event.type === 'told' && event.kind === 'ability')).toMatchObject(
      { content: { result: { seats: [2, 3], role: 'soldier' } } },
    )
  })
})
