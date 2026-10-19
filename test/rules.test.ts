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
  winner,
} from '../shared/game/rules'
import { ROLES } from '../shared/game/roles'
import type {
  GameConfig,
  GameEvent,
  GameEventInput,
  NightRequest,
  Observer,
  Ports,
  RoleId,
  SeatState,
} from '../shared/types/game'

describe('five-seat setup', () => {
  it('samples all five implemented roles without replacement from a reproducible seed', () => {
    const roles = sample(createRng(18))
    expect([...roles].sort()).toEqual(['chef', 'empath', 'imp', 'scarletwoman', 'soldier'])
    expect(sample(createRng(18))).toEqual(roles)
    expect(validate(roles)).toEqual([])
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
    const request: NightRequest = { seat: 5, role: 'imp', day: 2, targets: [1, 2, 3, 4, 5] }
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
  logVersion: 1,
  promptVersion: 1,
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

async function game(targets: number[], options: { seats?: SeatState[]; d14?: number } = {}) {
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
      if (id === 'D1') {
        expect(candidates).toEqual({ type: 'setup', sample: sample(createRng(CONFIG.seed)) })
        return Promise.resolve(ORDER)
      }
      expect(candidates).toEqual([3, 4])
      return Promise.resolve(options.d14 ?? 4)
    },
    askContestants: (batch) => {
      expect(batch).toHaveLength(1)
      const request = batch[0]
      if (!request) throw new Error('No request')
      requests.push(structuredClone(request))
      const target = targets[calls++]
      if (target === undefined) throw new Error('Script exhausted')
      const choice = {
        reasoning: `Choose ${String(target)}`,
        targets: [target],
        memo: `Day ${String(request.day)}`,
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
      commit({ type: 'seat.memo.updated', seat: request.seat, memo: choice.memo })
      return Promise.resolve([choice])
    },
  }
  const result = await runGame(ports)
  expect(result).toEqual(memory)
  expect(result).toEqual(fold(events))
  expect(before).toEqual(fold(options.seats ? events.slice(0, 2) : events.slice(0, 1)))
  for (const prefix of prefixes) expect(prefix.memory).toEqual(fold(events.slice(0, prefix.length)))
  return { events, state: memory, requests, discretionCalls }
}

describe('scripted pure rules seam', () => {
  it('creates the grimoire and private roles, resolves Chef then Empath without model calls, and skips day actions', async () => {
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
            event.phase === 'first-night' || event.phase === 'night' || event.phase === 'dawn',
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
