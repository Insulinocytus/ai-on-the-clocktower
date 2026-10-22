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
  validateDiscretionChoice,
  winner,
} from '../shared/game/rules'
import { ROLES } from '../shared/game/roles'
import { channelBlocks } from '../shared/game/channels'
import { seatFootprint, spectatorRows } from '../shared/game/spectator'
import { renderEvent } from '../shared/event-templates'
import { buildContestantPrompt } from '../shared/prompts/contestant'
import {
  buildStorytellerPrompt,
  discretionRequest,
  parseStorytellerChoice,
} from '../shared/prompts/storyteller'
import type {
  ContestantChoice,
  ContestantRequest,
  DiscretionChoice,
  DiscretionContext,
  DiscretionSource,
  GameConfig,
  GameEvent,
  GameEventInput,
  InformationResult,
  NightRequest,
  Observer,
  Ports,
  Registration,
  RoleId,
  SeatState,
  SpeechChoice,
  SpeechRequest,
} from '../shared/types/game'

describe('spectator presentation of projected logs', () => {
  it('limits a seat footprint to its actions and targets through the selected room end', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'phase.started', day: 1, phase: 'whisper' },
      { seq: 2, type: 'whisper.room.opened', round: 1, roomId: 'a', members: [1, 2] },
      { seq: 3, type: 'whisper.room.opened', round: 1, roomId: 'b', members: [3, 4] },
      {
        seq: 4,
        type: 'whisper.speech',
        round: 1,
        roomId: 'a',
        members: [1, 2],
        seat: 2,
        speech: 'Peer speech',
        decision: 0,
      },
      {
        seq: 5,
        type: 'whisper.speech',
        round: 1,
        roomId: 'b',
        members: [3, 4],
        seat: 3,
        speech: 'Selected end',
        decision: 0,
      },
      {
        seq: 6,
        type: 'whisper.speech',
        round: 1,
        roomId: 'a',
        members: [1, 2],
        seat: 1,
        speech: 'Future speech in earlier block',
        decision: 0,
      },
      { seq: 7, type: 'phase.started', day: 1, phase: 'nomination' },
      { seq: 8, type: 'nomination', nominator: 2, nominee: 1 },
    ]
    expect(seatFootprint(channelBlocks(events), 1, 5)).toEqual([])
    expect(
      seatFootprint(channelBlocks(events), 1, 8).map((block) =>
        block.events.map((event) => event.seq),
      ),
    ).toEqual([[6], [8]])
  })

  it('shows adopted summaries and passes before effects, dims only losing decisions, and marks false tells only in their projected prefix', () => {
    const decision = (seq: number, seat: number, speech: string | null): GameEvent => ({
      seq,
      type: 'contestant.decision',
      seat,
      request: { tool: 'speak', seat, day: 1, kind: 'free' },
      raw: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'speak',
                    arguments: JSON.stringify({
                      reasoning_summary: `Reason ${String(seq)}`,
                      speech,
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
      model: 'fake',
      usage: {},
      durationMs: 10,
      attempt: 1,
      validation: { ok: true },
    })
    const events: GameEvent[] = [
      decision(1, 1, 'Adopted'),
      decision(2, 2, 'Not selected'),
      decision(3, 3, null),
      { seq: 4, type: 'public.speech', seat: 1, kind: 'free', speech: 'Adopted', decision: 1 },
      {
        seq: 5,
        type: 'ability.resolved',
        seat: 1,
        role: 'chef',
        result: 0,
        deviated: true,
        reason: 'poisoned',
      },
      { seq: 6, type: 'told', seat: 1, kind: 'ability', content: { role: 'chef', result: 1 } },
    ]
    const rows = spectatorRows(project(events, 'spectator'), false)
    expect(rows.map((row) => row.event.seq)).toEqual([1, 3, 4, 5, 6])
    expect(rows[0]).toMatchObject({ reasoningSummary: 'Reason 1', losing: false })
    expect(rows[0]?.speech).toBeUndefined()
    expect(rows[1]).toMatchObject({ reasoningSummary: 'Reason 3', speech: null, losing: false })
    expect(rows[2]?.reasoningSummary).toBeUndefined()
    expect(rows[4]).toMatchObject({ falseInfo: true, falseReason: 'poisoned' })
    expect(
      spectatorRows(events, true)
        .filter((row) => row.losing)
        .map((row) => row.speech),
    ).toEqual(['Not selected'])
    expect(spectatorRows(project(events, 'seat:1'), true)).toEqual([
      expect.objectContaining({ event: events[0], reasoningSummary: 'Reason 1', losing: false }),
      expect.objectContaining({ event: events[3] }),
      expect.objectContaining({ event: events[5], falseInfo: false }),
    ])
    expect(spectatorRows(events.slice(0, 4), false).some((row) => row.falseInfo)).toBe(false)
  })
})

describe('spectator channel blocks', () => {
  it('keeps interleaved room instances separate, announcements first, and folds at each end', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'phase.started', day: 1, phase: 'first-night' },
      { seq: 2, type: 'phase.started', day: 1, phase: 'dawn' },
      { seq: 3, type: 'dawn.announced', day: 1, deaths: [] },
      { seq: 4, type: 'phase.started', day: 1, phase: 'whisper' },
      { seq: 5, type: 'whisper.proposed', seat: 1, round: 1, members: [2] },
      { seq: 6, type: 'whisper.room.opened', round: 1, roomId: 'a', members: [1, 2] },
      { seq: 7, type: 'whisper.room.opened', round: 1, roomId: 'b', members: [3, 4] },
      {
        seq: 8,
        type: 'whisper.speech',
        round: 1,
        roomId: 'b',
        members: [3, 4],
        seat: 3,
        speech: 'B',
        decision: 0,
      },
      {
        seq: 9,
        type: 'whisper.speech',
        round: 1,
        roomId: 'a',
        members: [1, 2],
        seat: 1,
        speech: 'A',
        decision: 0,
      },
      { seq: 10, type: 'whisper.room.closed', round: 1, roomId: 'a', members: [1, 2] },
      { seq: 11, type: 'whisper.room.closed', round: 1, roomId: 'b', members: [3, 4] },
      { seq: 12, type: 'whisper.proposed', seat: 2, round: 2, members: [1] },
      { seq: 13, type: 'whisper.room.opened', round: 2, roomId: 'c', members: [2, 1] },
      { seq: 14, type: 'phase.started', day: 1, phase: 'public' },
      { seq: 15, type: 'public.speech', kind: 'free', seat: 1, speech: 'Public', decision: 0 },
      { seq: 16, type: 'phase.started', day: 1, phase: 'nomination' },
      { seq: 17, type: 'nomination', nominator: 1, nominee: 2 },
      {
        seq: 18,
        type: 'vote.tallied',
        nominee: 2,
        votes: 3,
        threshold: 3,
        aboutToBeExecuted: true,
      },
      { seq: 19, type: 'execution', seat: 2 },
    ]
    const blocks = channelBlocks(events)
    expect(blocks.map((block) => block.kind)).toEqual([
      'first-night',
      'dawn',
      'allocation',
      'room',
      'room',
      'allocation',
      'room',
      'public',
      'nomination',
    ])
    const rooms = blocks.filter((block) => block.kind === 'room')
    expect(rooms.map((block) => block.events.map((event) => event.seq))).toEqual([
      [6, 9, 10],
      [7, 8, 11],
      [13],
    ])
    expect(rooms.map((block) => block.occurrence)).toEqual([1, 1, 2])
    expect(rooms[0]?.end).toBe(10)
    expect(
      foldPublic(events.filter((event) => event.seq <= (rooms[0]?.end ?? 0))).seats[1]?.alive,
    ).toBe(true)
    expect(
      foldPublic(events.filter((event) => event.seq <= (blocks.at(-1)?.end ?? 0))).seats[1]?.alive,
    ).toBe(false)
    expect(channelBlocks(events.slice(0, 9)).map((block) => block.key)).toEqual(
      blocks.slice(0, 5).map((block) => block.key),
    )
  })
  it('routes parallel room decisions by their request, not the last active room', () => {
    const decision = (seq: number, request: ContestantRequest): GameEvent => ({
      seq,
      type: 'contestant.decision',
      seat: request.seat,
      request,
      raw: {},
      model: 'fake',
      usage: {},
      durationMs: 0,
      attempt: 1,
      validation: { ok: true },
    })
    const events: GameEvent[] = [
      { seq: 1, type: 'phase.started', day: 1, phase: 'whisper' },
      { seq: 2, type: 'whisper.room.opened', round: 1, roomId: 'a', members: [1, 2] },
      { seq: 3, type: 'whisper.room.opened', round: 1, roomId: 'b', members: [3, 4] },
      decision(4, {
        tool: 'speak',
        kind: 'whisper',
        day: 1,
        seat: 1,
        room: { id: 'a', round: 1, members: [1, 2] },
      }),
      decision(5, {
        tool: 'speak',
        kind: 'whisper',
        day: 1,
        seat: 3,
        room: { id: 'b', round: 1, members: [3, 4] },
      }),
      decision(6, {
        tool: 'propose_whisper',
        day: 1,
        seat: 1,
        round: 2,
        remaining: 1,
        eligible: [2],
      }),
      { seq: 7, type: 'whisper.proposed', seat: 1, round: 2, members: null },
      { seq: 8, type: 'phase.started', day: 1, phase: 'public' },
      { seq: 9, type: 'phase.started', day: 1, phase: 'nomination' },
    ]
    expect(channelBlocks(events).map((block) => block.events.map((event) => event.seq))).toEqual([
      [1],
      [2, 4],
      [3, 5],
      [6, 7],
      [8],
      [9],
    ])
  })
})

describe('five-seat setup', () => {
  it('samples reproducible five-seat setups with the mandatory Baron modifier', () => {
    const roles = sample(createRng(18))
    expect(roles).toHaveLength(5)
    expect(roles.filter((role) => ROLES[role].type === 'townsfolk')).toHaveLength(
      roles.includes('baron') ? 1 : 3,
    )
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
      'spy',
      'baron',
      'butler',
      'drunk',
      'recluse',
      'saint',
    ])
      expect(sampled.has(role as RoleId)).toBe(true)
  })
  it('validates Baron as one Townsfolk and two distinct Outsiders, with no unmodified fallback', () => {
    expect(validate(['soldier', 'butler', 'drunk', 'baron', 'imp'])).toEqual([])
    expect(validate(['chef', 'recluse', 'saint', 'baron', 'imp'])).toEqual([])
    expect(validate(['soldier', 'chef', 'empath', 'baron', 'imp'])).toContainEqual({
      code: 'invalid_role_counts',
    })
    for (let seed = 0; seed < 100; seed++) {
      const roles = sample(createRng(seed))
      expect(validate(roles)).toEqual([])
      expect(roles.filter((role) => ROLES[role].type === 'outsider')).toHaveLength(
        roles.includes('baron') ? 2 : 0,
      )
    }
  })
})

describe('uniform legal role-set sampling', () => {
  it.each([
    [5, 930, 72],
    [6, 3480, 48],
    [7, 5577, 1716],
    [8, 16588, 1144],
    [9, 23452, 286],
    [10, 28314, 23166],
    [11, 36036, 15444],
    [12, 34749, 3861],
    [13, 31603, 30888],
    [14, 23452, 20592],
    [15, 9438, 5148],
  ])('makes every legal %i-seat role set reachable with equal mass', (count, total, baronTotal) => {
    const sets = new Set<string>()
    let barons = 0
    for (let index = 0; index < total; index++) {
      let calls = 0
      const roles = sample(() => (calls++ === 0 ? (index + 0.5) / total : 0.5), count)
      expect(validate(roles)).toEqual([])
      sets.add(roles.toSorted().join(','))
      if (roles.includes('baron')) barons++
      if (roles.includes('drunk'))
        expect(
          Object.values(ROLES).some(
            (role) => role.type === 'townsfolk' && !roles.includes(role.id),
          ),
        ).toBe(true)
    }
    expect(sets.size).toBe(total)
    expect(barons).toBe(baronTotal)
  })

  it('keeps the fixed-seed Baron ratio near 72/930 and seats the Imp uniformly', () => {
    const rng = createRng(1632)
    let barons = 0
    const demonSeats = [0, 0, 0, 0, 0]
    for (let index = 0; index < 10000; index++) {
      const roles = sample(rng)
      if (roles.includes('baron')) barons++
      const seat = roles.indexOf('imp')
      demonSeats[seat] = (demonSeats[seat] ?? 0) + 1
    }
    expect(Math.abs(barons / 10000 - 72 / 930)).toBeLessThan(0.01)
    for (const count of demonSeats) expect(Math.abs(count / 10000 - 0.2)).toBeLessThan(0.015)
  })

  it('makes all 120 seat permutations of a fixed five-role set equally reachable', () => {
    const permutations = new Set<string>()
    for (let index = 0; index < 120; index++) {
      let remainder = index
      let calls = 0
      const roles = sample(() => {
        if (calls++ === 0) return 0
        const bound = 7 - calls
        const choice = remainder % bound
        remainder = Math.floor(remainder / bound)
        return (choice + 0.5) / bound
      })
      permutations.add(roles.join(','))
    }
    expect(permutations.size).toBe(120)
  })
})

const PUBLIC_TYPES = [
  'phase.started',
  'game.ended',
  'dawn.announced',
  'whisper.proposed',
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
  'contestant.decision',
  'night.choice',
  'whisper.candidates',
  'whisper.speech',
  'whisper.room.closed',
]
const SPECTATOR_TYPES = ['game.created', 'game.aborted', 'whisper.ranked', 'future.unknown']
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
  it('checks setup composition and seating against the chosen role set', () => {
    const roles: RoleId[] = ['soldier', 'chef', 'empath', 'scarletwoman', 'imp']
    expect(validateDiscretionChoice(roles, { type: 'setup', sample: roles }, 5)).toEqual([])
    expect(validateDiscretionChoice(['imp'], { type: 'setup', sample: roles }, 5)).toEqual([
      { code: 'invalid_seat_count' },
      { code: 'invalid_role_counts' },
    ])
    expect(
      validateDiscretionChoice(roles.toReversed(), { type: 'seating', roles, sample: roles }, 5),
    ).toEqual([])
    expect(
      validateDiscretionChoice(
        ['monk', ...roles.slice(1)],
        { type: 'seating', roles, sample: roles },
        5,
      ),
    ).toEqual([{ code: 'invalid_discretion' }])
  })
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
  it('rejects wrong seat counts, duplicate roles, unknown roles and invalid demons', () => {
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
    expect(validate(['soldier', 'chef', 'empath', 'invented', 'imp'])).toContainEqual({
      code: 'unsupported_role',
    })
  })
  it.each([
    [5, 3, 0, 1],
    [6, 3, 1, 1],
    [7, 5, 0, 1],
    [8, 5, 1, 1],
    [9, 5, 2, 1],
    [10, 7, 0, 2],
    [11, 7, 1, 2],
    [12, 7, 2, 2],
    [13, 9, 0, 3],
    [14, 9, 1, 3],
    [15, 9, 2, 3],
  ])(
    'samples and validates every %i-player setup, including mandatory Baron counts',
    (count, townsfolk, outsiders, minions) => {
      const seen = new Set<RoleId>()
      const baronSeen = new Set<boolean>()
      for (let seed = 0; seed < 100; seed++) {
        const roles = sample(createRng(seed), count)
        expect(roles).toHaveLength(count)
        expect(validate(roles)).toEqual([])
        const baron = roles.includes('baron')
        baronSeen.add(baron)
        for (const role of roles) seen.add(role)
        expect(roles.filter((role) => ROLES[role].type === 'townsfolk')).toHaveLength(
          townsfolk - (baron ? 2 : 0),
        )
        expect(roles.filter((role) => ROLES[role].type === 'outsider')).toHaveLength(
          outsiders + (baron ? 2 : 0),
        )
        expect(roles.filter((role) => ROLES[role].type === 'minion')).toHaveLength(minions)
        expect(roles.filter((role) => ROLES[role].type === 'demon')).toEqual(['imp'])
      }
      expect(baronSeen).toEqual(new Set([false, true]))
      expect(seen.size).toBe(22)
    },
  )
  it('rejects a sole Townsfolk Washerwoman at five and six seats', () => {
    for (const roles of [
      ['washerwoman', 'butler', 'drunk', 'baron', 'imp'],
      ['washerwoman', 'butler', 'drunk', 'saint', 'baron', 'imp'],
    ])
      expect(validate(roles)).toEqual([{ code: 'no_washerwoman_truth' }])
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
      expect(validateNightChoice({ reasoning_summary: 'choose', targets }, request)).toContainEqual(
        {
          code: 'invalid_targets',
        },
      )
    }
    expect(validateNightChoice(null, request)).toContainEqual({ code: 'invalid_targets' })
    expect(validateNightChoice({ reasoning_summary: 2, targets: [1] }, request)).toContainEqual({
      code: 'invalid_reasoning_summary',
    })
    expect(
      validateNightChoice({ reasoning_summary: 'x'.repeat(501), targets: [1] }, request),
    ).toContainEqual({ code: 'invalid_reasoning_summary' })
    expect(
      validateNightChoice({ reasoning_summary: 'x'.repeat(500), targets: [5] }, request),
    ).toEqual([])
    expect(validateNightChoice({ reasoning_summary: '', targets: [1] }, request)).toEqual([])
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
    roles?: RoleId[]
    discretions?: Partial<GameConfig['discretions']>
    d14?: number
    choose?: (request: ContestantRequest) => ContestantChoice
    discretion?: (...args: Parameters<Ports['discretion']>) => Promise<DiscretionChoice>
    act?: (request: ContestantRequest) => ContestantChoice
  } = {},
) {
  const config = {
    ...CONFIG,
    discretions: { ...CONFIG.discretions, ...options.discretions },
    seatCount: options.roles?.length ?? options.seats?.length ?? 5,
  }
  const events: GameEvent[] = [{ seq: 1, type: 'game.created', ...config }]
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
    config,
    log: events,
    rng: createRng(CONFIG.seed),
    commit,
    discretion: async (id, candidates, context: DiscretionContext, requestSeq) => {
      discretionCalls.push(id)
      const source: DiscretionSource = config.discretions[id]
      expect(events.find((event) => event.seq === requestSeq)).toMatchObject({
        type: 'discretion.requested',
        source,
      })
      if (options.discretion)
        return { choice: await options.discretion(id, candidates, context, requestSeq) }
      if (id === 'D1') {
        expect(candidates).toEqual({
          type: 'setup',
          sample: sample(createRng(CONFIG.seed), config.seatCount),
        })
        return { choice: options.roles ?? ORDER }
      }
      if ((id === 'D10' || id === 'D11') && Array.isArray(candidates)) {
        return {
          choice: {
            alignment: id === 'D10' ? 'evil' : 'good',
            role: id === 'D10' ? 'spy' : 'recluse',
          },
        }
      }
      if (id === 'D2' && Array.isArray(candidates)) {
        const role = candidates.find(
          (candidate) =>
            candidate === 'slayer' || candidate === 'soldier' || candidate === 'virgin',
        )
        if (typeof role !== 'string') throw new Error('Missing passive Drunk fixture identity')
        return { choice: role }
      }
      if (id === 'D8' && Array.isArray(candidates) && candidates[0] !== undefined)
        return { choice: candidates[0] }
      expect(candidates).toEqual([3, 4])
      return { choice: options.d14 ?? 4 }
    },
    askContestants: (batch) => {
      const choices = batch.map((request) => {
        let choice: ContestantChoice
        if (options.act) {
          if (request.day > 8) throw new Error('Role scenario did not finish within its script')
          if (request.tool === 'night_choice') requests.push(structuredClone(request))
          choice = options.act(request)
        } else if (request.tool === 'nominate') {
          choice = options.choose?.(request) ?? { reasoning_summary: 'Pass', nominee: null }
        } else if (request.tool === 'speak') {
          choice =
            request.kind === 'free'
              ? { reasoning_summary: 'Pass', speech: null, slayer_target: null }
              : (options.choose?.(request) ?? {
                  reasoning_summary: 'Explain',
                  speech: 'My argument.',
                  slayer_target: null,
                })
        } else if (request.tool === 'vote') {
          choice = options.choose?.(request) ?? { reasoning_summary: 'Vote', raise_hand: false }
        } else if (request.tool === 'night_choice') {
          requests.push(structuredClone(request))
          if (request.role !== 'imp' && options.choose) choice = options.choose(request)
          else {
            const target = targets[calls++]
            if (target === undefined) throw new Error('Script exhausted')
            choice = {
              reasoning_summary: `Choose ${String(target)}`,
              targets: [target],
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
          if (typeof event.content.result === 'object' && 'role' in event.content.result)
            expect(text).toContain(ROLES[event.content.result.role].name[language])
        }
      }
    }
  }
  for (const prefix of prefixes) expect(prefix.memory).toEqual(fold(events.slice(0, prefix.length)))
  return { events, state: memory, requests, discretionCalls }
}

describe('storyteller context at the rules seam', () => {
  it.each([false, true])(
    'accepts reordered registration and information object keys when poisoned=%s',
    async (poisoned) => {
      const seats = seatsFor(['washerwoman', 'chef', 'soldier', 'spy', 'imp'])
      if (seats[0]) seats[0].poisoned = poisoned
      const { events } = await game([4, 5], {
        seats,
        discretion: (id) =>
          Promise.resolve(
            id === 'D10' ? { role: 'spy', alignment: 'evil' } : { role: 'soldier', seats: [2, 3] },
          ),
      })
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'ability.resolved',
          role: 'washerwoman',
          deviated: false,
          result: poisoned ? { seats: [2, 3], role: 'chef' } : { seats: [2, 3], role: 'soldier' },
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'told',
          seat: 1,
          kind: 'ability',
          content: { role: 'washerwoman', result: { seats: [2, 3], role: 'soldier' } },
        }),
      )
    },
  )
  it('combines matching D1/seating sources and separates a mixed-source permutation', async () => {
    const combined = await game([5, 4])
    expect(combined.discretionCalls).not.toContain('seating')
    const roles = ORDER.toReversed()
    const split = await game([], {
      discretions: { D1: 'storyteller', seating: 'manual' },
      discretion: (id, candidates) => {
        if (id === 'D1') return Promise.resolve(ORDER)
        expect(id).toBe('seating')
        expect(candidates).toMatchObject({ type: 'seating', roles: ORDER })
        return Promise.resolve(roles)
      },
      act: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: 'Self', targets: [request.seat] }
          : passAction(request),
    })
    expect(
      split.events
        .filter((event) => event.type === 'discretion.requested')
        .map((event) => ({ id: event.discretion, source: event.source })),
    ).toEqual([
      { id: 'D1', source: 'storyteller' },
      { id: 'seating', source: 'manual' },
    ])
    expect(split.events.find((event) => event.type === 'grimoire.set')).toMatchObject({
      seats: roles.map((role) => ({ role })),
    })
    expect(
      discretionRequest(
        'en',
        'seating',
        { type: 'seating', roles: ORDER, sample: roles },
        fold([]),
        5,
      ),
    ).toContain('do not replace any character')
  })

  it.each(['zh', 'en'] as const)(
    'projects spoken content and adopted storyteller decisions, but not contestant decisions in %s',
    async (language) => {
      const { events } = await game([5, 4])
      const append = (event: GameEventInput) => events.push({ ...event, seq: events.length + 1 })
      append({
        type: 'contestant.decision',
        seat: 1,
        request: { tool: 'speak', seat: 1, kind: 'free', day: 1 },
        raw: { reasoning_summary: 'HIDDEN_THOUGHT', speech: 'HIDDEN_UNSELECTED' },
        model: 'HIDDEN_MODEL',
        usage: null,
        durationMs: 1,
        attempt: 1,
        validation: { ok: true },
      })
      append({ type: 'whisper.proposed', seat: 1, round: 1, members: [123456] })
      append({ type: 'whisper.ranked', seat: 1, round: 1, ranking: [987654] })
      append({
        type: 'whisper.speech',
        seat: 1,
        members: [1, 2],
        round: 1,
        roomId: 'actual',
        speech: 'ACTUAL_WHISPER',
        decision: 0,
      })
      append({ type: 'public.speech', seat: 2, kind: 'free', speech: 'ACTUAL_PUBLIC', decision: 0 })
      append({
        type: 'storyteller.decision',
        discretion: 'D12',
        request: {},
        raw: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'decide',
                      arguments: '{"reasoning_summary":"FAILED_REASON","answer":"yes"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        model: 'HIDDEN_STORYTELLER_MODEL',
        usage: null,
        durationMs: 1,
        attempt: 1,
        validation: { ok: false, errors: [{ code: 'invalid_arguments' }] },
      })
      append({
        type: 'storyteller.decision',
        discretion: 'D12',
        request: {},
        raw: {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'decide',
                      arguments: '{"reasoning_summary":"PRIOR_REASON","answer":true}',
                    },
                  },
                ],
              },
            },
          ],
        },
        model: 'HIDDEN_STORYTELLER_MODEL',
        usage: null,
        durationMs: 1,
        attempt: 2,
        validation: { ok: true },
      })
      const context = {
        ...fold(events),
        discretion: { seat: 1, role: 'mayor' as const, truth: [false] },
      }
      const prompt = buildStorytellerPrompt(
        { ...CONFIG, language },
        events,
        'D12',
        [false, true],
        context,
      )
      const user = prompt.messages[1].content
      for (const visible of ['ACTUAL_WHISPER', 'ACTUAL_PUBLIC', 'PRIOR_REASON', '123456'])
        expect(user).toContain(visible)
      for (const hidden of [
        'HIDDEN_THOUGHT',
        'HIDDEN_UNSELECTED',
        'FAILED_REASON',
        'HIDDEN_MODEL',
        'HIDDEN_STORYTELLER_MODEL',
        '987654',
      ])
        expect(user).not.toContain(hidden)
      const headings =
        language === 'zh'
          ? ['# 时间线', '# 当前魔典', '# 本次裁量']
          : ['# Timeline', '# Current Grimoire', '# This decision']
      expect(headings.map((heading) => user.indexOf(heading))).toEqual(
        headings.map((heading) => user.indexOf(heading)).toSorted((a, b) => a - b),
      )
      expect(prompt.messages[0].content).not.toContain(
        language === 'zh' ? '官方建议（不是硬约束）' : 'Official advice (not hard constraints)',
      )
      expect(user).toContain(
        language === 'zh' ? '官方建议（不是硬约束）' : 'Official advice (not hard constraints)',
      )
    },
  )

  it('maps each decide output form to a canonical legal candidate and rejects extra fields', () => {
    const cases: {
      id: Parameters<Ports['discretion']>[0]
      choice: DiscretionChoice
      args: Record<string, unknown>
    }[] = [
      { id: 'D2', choice: 'chef', args: { roles: ['chef'] } },
      { id: 'D3', choice: 3, args: { seats: [3] } },
      {
        id: 'D4',
        choice: { seats: [2, 3], role: 'chef' },
        args: { seats: [3, 2], roles: ['chef'] },
      },
      { id: 'D5', choice: 0, args: { number: 0 } },
      { id: 'D6', choice: { seats: [2, 3], role: 'spy' }, args: { seats: [2, 3], roles: ['spy'] } },
      { id: 'D7', choice: ['chef', 'monk', 'butler'], args: { roles: ['butler', 'monk', 'chef'] } },
      { id: 'D8', choice: { target: 2, role: 'drunk' }, args: { seats: [2], roles: ['drunk'] } },
      { id: 'D8', choice: true, args: { answer: true } },
      { id: 'D8', choice: 2, args: { number: 2 } },
      {
        id: 'D10',
        choice: { alignment: 'good', role: 'chef' },
        args: { alignment: 'good', roles: ['chef'] },
      },
      {
        id: 'D11',
        choice: { alignment: 'evil', role: 'imp' },
        args: { alignment: 'evil', roles: ['imp'] },
      },
      { id: 'D12', choice: false, args: { answer: false } },
      { id: 'D13', choice: 3, args: { seats: [3] } },
      { id: 'D14', choice: 4, args: { seats: [4] } },
    ]
    for (const { id, choice, args } of cases) {
      expect(
        parseStorytellerChoice({ reasoning_summary: 'Legal', ...args }, id, [choice], 5),
      ).toEqual({
        ok: true,
        choice,
      })
      expect(
        parseStorytellerChoice(
          { reasoning_summary: 'Illegal', ...args, number: 99 },
          id,
          [choice],
          5,
        ),
      ).toMatchObject({ ok: false })
    }
  })
})

describe('evil team setup through the rules seam', () => {
  it.each([5, 6, 7, 10, 15])(
    'gives only %i-player eligible evil seats first-night team information and three absent good bluffs',
    async (count) => {
      const roles = sample(createRng(29), count)
      const initial = seatsFor(roles)
      const { events, state } = await game([], {
        roles,
        discretion: (id, candidates) => {
          if (id === 'D1') return Promise.resolve(roles)
          if (!Array.isArray(candidates) || candidates[0] === undefined)
            throw new Error('Missing candidate')
          return Promise.resolve(candidates[0])
        },
        act: (request) => {
          if (request.tool !== 'night_choice') return passAction(request)
          const targets =
            request.role === 'imp' || request.role === 'poisoner'
              ? [request.seat]
              : request.role === 'monk'
                ? [
                    initial.find((seat) => seat.alignment === 'good' && seat.seat !== request.seat)
                      ?.seat ?? 1,
                  ]
                : request.targets
                    .filter((seat) => request.role !== 'butler' || seat !== request.seat)
                    .slice(0, request.role === 'fortuneteller' ? 2 : 1)
          return { reasoning_summary: '', targets }
        },
      })
      const dawn = events.findIndex((event) => event.type === 'dawn.announced')
      for (const language of ['zh', 'en'] as const) {
        const prompt = buildContestantPrompt({
          events: events.slice(0, dawn + 1),
          seat: count,
          language,
          request: { tool: 'speak', seat: count, day: 1, kind: 'free' },
        })
        expect(prompt.messages[0]?.content).toContain(
          language === 'en'
            ? `Exactly ${String(count)} contestant models`
            : `本局 ${String(count)} 名玩家`,
        )
        expect(prompt.messages.at(-1)?.content).toContain(
          language === 'en' ? `- Seat ${String(count)}: alive` : `- ${String(count)} 号：存活`,
        )
        expect(prompt.messages.at(-1)?.content).toContain(
          language === 'en'
            ? `${String(count)} alive; voting threshold ${String(Math.ceil(count / 2))}`
            : `存活 ${String(count)} 人；投票门槛 ${String(Math.ceil(count / 2))}`,
        )
      }
      const team = events.filter(
        (event) =>
          event.type === 'told' && (event.kind === 'minion-info' || event.kind === 'demon-info'),
      )
      const d7 = events.find(
        (event) => event.type === 'discretion.requested' && event.discretion === 'D7',
      )
      if (count < 7) {
        expect(team).toEqual([])
        expect(d7).toBeUndefined()
        expect(state.bluffs).toEqual([])
        return
      }
      expect(d7).toBeDefined()
      if (d7?.type !== 'discretion.requested' || !Array.isArray(d7.candidates))
        throw new Error('Missing D7 candidates')
      const absentGood = Object.values(ROLES).filter(
        (role) => role.alignment === 'good' && !roles.includes(role.id),
      )
      expect(d7.candidates).toHaveLength(
        (absentGood.length * (absentGood.length - 1) * (absentGood.length - 2)) / 6,
      )
      for (const candidate of d7.candidates as RoleId[][]) {
        expect(new Set(candidate).size).toBe(3)
        for (const role of candidate) {
          expect(ROLES[role].alignment).toBe('good')
          expect(roles).not.toContain(role)
        }
      }
      expect(state.bluffs).toHaveLength(3)
      const evil = initial.filter((seat) => seat.alignment === 'evil')
      expect(team).toHaveLength(evil.length)
      const firstNight = events.find(
        (event) => event.type === 'phase.started' && event.phase === 'first-night',
      )
      expect(d7.seq).toBeLessThan(firstNight?.seq ?? 0)
      for (const registration of events.filter(
        (event) =>
          event.type === 'discretion.requested' &&
          (event.discretion === 'D10' || event.discretion === 'D11'),
      ))
        expect(registration.seq).toBeGreaterThan(d7.seq)
      const firstAction = events.find((event) => event.type === 'night.choice')
      for (const event of team) {
        expect(event.seq).toBeGreaterThan(firstNight?.seq ?? Infinity)
        expect(event.seq).toBeLessThan(firstAction?.seq ?? Infinity)
        if (event.type !== 'told' || !('seats' in event.content))
          throw new Error('Missing team information')
        expect(event.content.seats).toEqual(
          evil.filter((seat) => seat.seat !== event.seat).map((seat) => seat.seat),
        )
        if (event.kind === 'demon-info') expect(event.content.bluffs).toEqual(state.bluffs)
        expect(project([event], 'public')).toEqual([])
        for (const seat of initial)
          expect(project([event], `seat:${String(seat.seat)}` as Observer)).toEqual(
            seat.seat === event.seat ? [event] : [],
          )
      }
    },
  )
})

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
            ? { reasoning_summary: 'Probe', targets: [...targets] }
            : request.tool === 'nominate'
              ? { reasoning_summary: 'Pass', nominee: null }
              : { reasoning_summary: 'Vote', raise_hand: false },
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
                reasoning_summary: 'Nominate once',
                nominee:
                  request.day === 1 && request.seat === 1 && request.nominees.length === 5
                    ? 2
                    : null,
              }
            : request.tool === 'speak'
              ? { reasoning_summary: 'Explain', speech: 'Execute this seat.', slayer_target: null }
              : { reasoning_summary: 'Execute', raise_hand: true },
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
  it('Undertaker gets no information when an already-dead seat is executed', async () => {
    const seats = seatsFor(['undertaker', 'chef', 'soldier', 'scarletwoman', 'imp'])
    if (seats[1]) seats[1].alive = false
    const { events } = await game([4, 5], {
      seats,
      choose: (request) =>
        request.tool === 'nominate'
          ? {
              reasoning_summary: 'Execute the corpse once',
              nominee:
                request.day === 1 && request.seat === 1 && request.nominees.length === 5 ? 2 : null,
            }
          : request.tool === 'speak'
            ? { reasoning_summary: '', speech: 'Execute this seat.', slayer_target: null }
            : { reasoning_summary: '', raise_hand: true },
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'execution', seat: 2 }))
    expect(
      events.filter((event) => event.type === 'ability.resolved' && event.role === 'undertaker'),
    ).toEqual([])
    expect(
      events.filter(
        (event) =>
          event.type === 'told' && event.kind === 'ability' && event.content.role === 'undertaker',
      ),
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
                reasoning_summary: 'Nominate once',
                nominee:
                  request.day === 1 && request.seat === 1 && request.nominees.length === 5
                    ? 5
                    : null,
              }
            : request.tool === 'night_choice'
              ? { reasoning_summary: 'Probe', targets: request.day === 1 ? [3, 4] : targets }
              : request.tool === 'speak'
                ? {
                    reasoning_summary: 'Explain',
                    speech: 'Execute the Demon.',
                    slayer_target: null,
                  }
                : { reasoning_summary: 'Execute', raise_hand: true },
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
            ? { reasoning_summary: 'Inspect', targets: [target] }
            : { reasoning_summary: 'Pass', nominee: null },
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
              reasoning_summary: 'Nominate',
              nominee:
                request.day === 1 && request.seat === 2 && request.nominees.length === 5 ? 1 : null,
            }
          : request.tool === 'speak'
            ? { reasoning_summary: 'Explain', speech: 'Execute.', slayer_target: null }
            : { reasoning_summary: 'Vote', raise_hand: true },
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
      expect(validateNightChoice({ reasoning_summary: 'Probe', targets }, request)).toContainEqual({
        code: 'invalid_targets',
      })
    expect(validateNightChoice({ reasoning_summary: 'Probe', targets: [1, 5] }, request)).toEqual(
      [],
    )
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
            reasoning_summary: 'Nominate',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 1 && request.seat === 3 && request.nominees.includes(4)
                  ? 4
                  : null,
          }
        }
        if (request.tool === 'vote')
          return { reasoning_summary: 'Vote', raise_hand: request.seat <= 3 }
        return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
            reasoning_summary: 'Execute the demon',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(5) ? 5 : null,
          }
        if (request.tool === 'vote') return { reasoning_summary: 'Execute', raise_hand: true }
        return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
            reasoning_summary: 'Nominate',
            nominee:
              request.day === 2 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 2 && request.seat === 3 && request.nominees.includes(3)
                  ? 3
                  : null,
          }
        if (request.tool === 'vote')
          return { reasoning_summary: 'Use my vote', raise_hand: request.seat === 2 }
        return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
            reasoning_summary: 'Nominate',
            nominee:
              request.day === 1 && request.seat === 1 && request.nominees.includes(2)
                ? 2
                : request.day === 1 && request.seat === 3 && request.nominees.includes(4)
                  ? 4
                  : null,
          }
        if (request.tool === 'speak' && request.kind === 'nomination') round++
        if (request.tool === 'vote')
          return { reasoning_summary: 'Vote', raise_hand: request.seat <= (round === 1 ? 2 : 3) }
        return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
              reasoning_summary: 'Repeat target',
              nominee: request.seat === 1 || request.seat === 3 ? 2 : null,
            }
          if (request.tool === 'vote') return { reasoning_summary: 'Abstain', raise_hand: false }
          return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
            ? { reasoning_summary: 'Nominate', nominee: request.seat === 1 ? 2 : null }
            : {
                reasoning_summary: 'Explain',
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
            reasoning_summary: 'Nominate',
            nominee:
              request.day === 2 && request.seat === 1 && request.nominees.includes(5) ? 5 : null,
          }
        if (request.tool === 'vote') return { reasoning_summary: 'Execute', raise_hand: true }
        return { reasoning_summary: 'Explain', speech: 'My argument.', slayer_target: null }
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
      'contestant.decision',
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
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [3] }
          : passAction(request),
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
      { seq: 9, type: 'game.ended', winner: 'good', reason: 'all_demons_dead' },
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
            return Promise.resolve(batch.map(() => ({ reasoning_summary: 'Pass', nominee: null })))
          batches.push(batch.map((request) => request.seat))
          return Promise.resolve(
            batch.map((request) => ({
              reasoning_summary: 'Join the discussion',
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
          return Promise.resolve(batch.map(() => ({ reasoning_summary: 'Pass', nominee: null })))
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
        reasoning_summary: 'Can still contribute after death',
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
          reasoning_summary: 'Claim a shot',
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
          reasoning_summary: 'A private proposal',
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
    const choice = { reasoning_summary: '', speech: 'I shoot.', slayer_target: 5 }
    expect(validateSpeechChoice(choice, request)).toEqual([])
    expect(validateSpeechChoice({ ...choice, slayer_target: 15 }, request, 15)).toEqual([])
    expect(validateContestantChoice({ ...choice, slayer_target: 10 }, request, 10)).toEqual([])
    expect(validateSpeechChoice({ ...choice, slayer_target: 16 }, request, 15)).toEqual([
      { code: 'invalid_slayer_target' },
    ])
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
          reasoning_summary: 'Meet',
          members: request.seat === 1 ? [3, 2] : request.seat === 2 ? [1, 3] : null,
        }
      if (request.tool === 'rank_whispers')
        return { reasoning_summary: 'Accept', ranking: request.rooms.map((room) => room.id) }
      return { reasoning_summary: 'Pass', speech: null, slayer_target: null }
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
    expect(project(events, 'storyteller').some((event) => event.type === 'whisper.ranked')).toBe(
      false,
    )
  })
})

describe('whisper allocation and allowances', () => {
  it('uses the whole membership rank sum before assigning disjoint rooms, without shrinking rooms', async () => {
    const { events } = await whispers((request) => {
      if (request.tool === 'propose_whisper')
        return {
          reasoning_summary: '',
          members:
            request.round === 1
              ? (({ 1: [2, 3], 2: [4], 3: [5] } as Record<number, number[]>)[request.seat] ?? null)
              : null,
        }
      if (request.tool === 'rank_whispers')
        return {
          reasoning_summary: '',
          ranking:
            ({ 1: [1], 2: [2, 1], 3: [3, 1], 4: [2], 5: [3] } as Record<number, number[]>)[
              request.seat
            ] ?? [],
        }
      return { reasoning_summary: '', speech: null, slayer_target: null }
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
              reasoning_summary: '',
              members:
                request.round === 1
                  ? (({ 1: [2], 2: [3], 3: [1] } as Record<number, number[]>)[request.seat] ?? null)
                  : null,
            }
          if (request.tool === 'rank_whispers')
            return {
              reasoning_summary: '',
              ranking:
                ({ 1: [1, 3], 2: [2, 1], 3: [3, 2] } as Record<number, number[]>)[request.seat] ??
                [],
            }
          return { reasoning_summary: '', speech: null, slayer_target: null }
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
          return { reasoning_summary: '', members: request.seat === 1 ? [2, 3] : null }
        if (request.tool === 'rank_whispers')
          return { reasoning_summary: '', ranking: request.seat === 3 ? [] : [1] }
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
            reasoning_summary: '',
            members: request.seat === 1 ? [2] : request.seat === 3 ? [4] : null,
          }
        if (request.tool === 'rank_whispers')
          return {
            reasoning_summary: '',
            ranking:
              request.round === 1 && request.seat === 4 ? [] : request.rooms.map((room) => room.id),
          }
        return {
          reasoning_summary: '',
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
          reasoning_summary: '',
          members: request.seat === 1 ? [2] : request.seat === 3 ? [4] : null,
        }
      if (request.tool === 'rank_whispers')
        return { reasoning_summary: '', ranking: request.rooms.map((room) => room.id) }
      if (request.tool !== 'speak' || !request.room) throw new Error('Expected room speech')
      if (request.seat === 1) await otherRoomStarted
      if (request.seat === 3) release?.()
      return {
        reasoning_summary: '',
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
      expect(validateContestantChoice({ reasoning_summary: '', members }, proposal)).toContainEqual(
        {
          code: 'invalid_whisper_members',
        },
      )
    for (const members of [null, [2], [3, 2]])
      expect(validateContestantChoice({ reasoning_summary: '', members }, proposal)).toEqual([])
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
      expect(
        validateContestantChoice({ reasoning_summary: '', ranking: value }, ranking),
      ).toContainEqual({
        code: 'invalid_whisper_ranking',
      })
    for (const value of [[], [9], [9, 7]])
      expect(validateContestantChoice({ reasoning_summary: '', ranking: value }, ranking)).toEqual(
        [],
      )
    expect(
      validateSpeechChoice(
        { reasoning_summary: '', speech: 'A private shot.', slayer_target: 2 },
        { tool: 'speak', seat: 1, day: 1, kind: 'whisper' },
      ),
    ).toContainEqual({ code: 'invalid_slayer_target' })
    expect(
      validateSpeechChoice(
        { reasoning_summary: '', speech: null, slayer_target: null },
        { tool: 'speak', seat: 1, day: 1, kind: 'whisper' },
      ),
    ).toEqual([])
  })

  it('ends without another proposal batch when everyone exhausts their allowance', async () => {
    const { events, requests } = await whispers((request) => {
      if (request.tool === 'propose_whisper')
        return { reasoning_summary: '', members: request.seat === 1 ? [2, 3, 4, 5] : null }
      if (request.tool === 'rank_whispers') return { reasoning_summary: '', ranking: [1] }
      return { reasoning_summary: '', speech: null, slayer_target: null }
    })
    expect(events.filter((event) => event.type === 'whisper.room.opened')).toHaveLength(1)
    expect(requests.filter((request) => request.tool === 'propose_whisper')).toHaveLength(5)
  })
})

function passAction(request: ContestantRequest): ContestantChoice {
  switch (request.tool) {
    case 'night_choice':
      return { reasoning_summary: '', targets: [5] }
    case 'speak':
      return {
        reasoning_summary: '',
        speech: request.kind === 'free' ? null : 'Argument',
        slayer_target: null,
      }
    case 'nominate':
      return { reasoning_summary: '', nominee: null }
    case 'vote':
      return { reasoning_summary: '', raise_hand: false }
    case 'propose_whisper':
      return { reasoning_summary: '', members: null }
    case 'rank_whispers':
      return { reasoning_summary: '', ranking: [] }
  }
}

describe('protection and daytime triggers', () => {
  it('Monk skips first night, excludes self, protects Imp suicide, and expires next night', async () => {
    const { events, requests } = await game([], {
      seats: seatsFor(['monk', 'chef', 'soldier', 'scarletwoman', 'imp']),
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning_summary: '',
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
            ? { reasoning_summary: '', targets: [request.day === 2 ? 1 : request.seat] }
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
            reasoning_summary: '',
            nominee:
              request.nominees.includes(4) && request.seat === 2
                ? 4
                : !request.nominees.includes(4) && request.seat === 3
                  ? 1
                  : null,
          }
        if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
        if (request.tool === 'night_choice')
          return { reasoning_summary: '', targets: [request.seat] }
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
          return {
            reasoning_summary: '',
            speech: 'I shoot.',
            slayer_target: request.day === 1 ? 5 : 4,
          }
        if (request.tool === 'night_choice')
          return { reasoning_summary: '', targets: [request.day === 2 ? 2 : request.seat] }
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
          return { reasoning_summary: '', targets: [request.role === 'butler' ? 5 : request.seat] }
        if (
          request.tool === 'nominate' &&
          request.day === 1 &&
          request.seat === 2 &&
          request.nominees.includes(3)
        )
          return { reasoning_summary: '', nominee: 3 }
        if (request.tool === 'vote') {
          votes.push(request)
          return { reasoning_summary: '', raise_hand: request.seat !== 5 }
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
          ? { reasoning_summary: '', targets: [request.seat] }
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
            return { reasoning_summary: '', nominee: 2 }
          if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
          return request.tool === 'night_choice'
            ? { reasoning_summary: '', targets: [request.seat] }
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
          { reasoning_summary: '', targets: [1] },
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
                reasoning_summary: '',
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
            return { reasoning_summary: '', nominee: 1 }
          if (request.tool === 'night_choice')
            return { reasoning_summary: '', targets: [request.seat] }
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
              reasoning_summary: '',
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
            return { reasoning_summary: '', targets: [request.day === 2 ? 2 : request.seat] }
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
              reasoning_summary: '',
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
            return { reasoning_summary: '', nominee: 2 }
          if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
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
            return {
              reasoning_summary: '',
              targets: [request.role === 'butler' ? 3 : request.seat],
            }
          if (
            request.tool === 'nominate' &&
            request.day === 1 &&
            request.seat === 2 &&
            request.nominees.includes(3)
          )
            return { reasoning_summary: '', nominee: 3 }
          if (request.tool === 'vote')
            return { reasoning_summary: '', raise_hand: request.seat === 1 }
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
          return { reasoning_summary: '', targets: [request.role === 'monk' ? 5 : 3] }
        if (
          request.tool === 'speak' &&
          request.kind === 'free' &&
          request.day === 2 &&
          request.seat === 1
        )
          return { reasoning_summary: '', speech: 'Shoot', slayer_target: 5 }
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
              reasoning_summary: '',
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
          return { reasoning_summary: '', nominee: 1 }
        if (request.tool === 'night_choice')
          return { reasoning_summary: '', targets: [request.day === 2 ? 3 : request.seat] }
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
          ? { reasoning_summary: '', targets: [request.seat] }
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
          reasoning_summary: '',
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
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [2] }
          : passAction(request),
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
              expect(candidates).toHaveLength(
                role === 'washerwoman' ? 78 : role === 'librarian' ? 25 : 24,
              )
              if (role === 'librarian') expect(candidates).toContain(0)
              else expect(candidates).not.toContain(0)
              for (const candidate of candidates as (number | { seats: number[] })[])
                if (typeof candidate !== 'number') expect(candidate.seats).not.toContain(1)
            }
            if (role === 'undertaker' || role === 'ravenkeeper') expect(candidates).toHaveLength(22)
            return Promise.resolve(answer)
          },
          act: (request) => {
            if (request.tool === 'night_choice')
              return {
                reasoning_summary: '',
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
              return { reasoning_summary: '', nominee: 3 }
            if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
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
                reasoning_summary: '',
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
        if (request.tool === 'night_choice') return { reasoning_summary: '', targets: [4] }
        if (request.tool === 'nominate' && request.seat === 2 && request.nominees.includes(5))
          return { reasoning_summary: '', nominee: 5 }
        if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
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
              reasoning_summary: '',
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
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [1] }
          : passAction(request),
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

describe('fixed registration and remaining Outsiders', () => {
  it('resolves D10 then D11 after D2/D3 with independent alignment and role, once for the whole game', async () => {
    const { events, state, discretionCalls } = await game([2, 1, 4], {
      seats: seatsFor(['spy', 'recluse', 'fortuneteller', 'drunk', 'imp']),
      choose: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [2, 4] }
          : passAction(request),
      discretion: (id, candidates) => {
        if (id === 'D2') return Promise.resolve('soldier')
        if (id === 'D3') return Promise.resolve(3)
        expect(id === 'D10' || id === 'D11').toBe(true)
        expect(Array.isArray(candidates)).toBe(true)
        const roles =
          id === 'D10'
            ? [
                'spy',
                ...Object.values(ROLES)
                  .filter((role) => role.alignment === 'good')
                  .map((role) => role.id),
              ]
            : [
                'recluse',
                ...Object.values(ROLES)
                  .filter((role) => role.alignment === 'evil')
                  .map((role) => role.id),
              ]
        expect(candidates).toHaveLength(id === 'D10' ? 36 : 12)
        for (const role of roles) {
          expect(candidates).toContainEqual({ alignment: 'good', role })
          expect(candidates).toContainEqual({ alignment: 'evil', role })
        }
        return Promise.resolve(
          id === 'D10' ? { alignment: 'evil', role: 'saint' } : { alignment: 'good', role: 'imp' },
        )
      },
    })
    expect(discretionCalls).toEqual(['D2', 'D3', 'D10', 'D11'])
    expect(state.seats[0]).toMatchObject({
      role: 'spy',
      alignment: 'evil',
      alive: false,
      registeredRole: 'saint',
      registeredAlignment: 'evil',
    })
    expect(state.seats[1]).toMatchObject({
      role: 'recluse',
      alignment: 'good',
      alive: false,
      registeredRole: 'imp',
      registeredAlignment: 'good',
    })
    const registration = events.findLast((event) => event.type === 'grimoire.set')
    const firstNight = events.find((event) => event.type === 'phase.started')
    expect(registration?.seq).toBeLessThan(firstNight?.seq ?? 0)
    expect(events.filter((event) => event.type === 'told' && event.kind === 'ability')).toEqual([
      expect.objectContaining({ content: { role: 'fortuneteller', result: true } }),
      expect.objectContaining({ content: { role: 'fortuneteller', result: true } }),
      expect.objectContaining({ content: { role: 'fortuneteller', result: true } }),
    ])
  })
})

describe('Spy grimoire information', () => {
  it('tells the full true grimoire every living night even while poisoned, without D8 or contestant calls', async () => {
    const seats = seatsFor(['spy', 'fortuneteller', 'soldier', 'scarletwoman', 'imp'])
    if (seats[0]) {
      seats[0].poisoned = true
      seats[0].registeredRole = 'drunk'
      seats[0].registeredAlignment = 'good'
    }
    const { events, requests, discretionCalls } = await game([2, 4, 1], {
      seats,
      choose: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [1, 3] }
          : passAction(request),
      discretion: (id) => {
        expect(id).toBe('D3')
        return Promise.resolve(2)
      },
    })
    const tells = events.filter((event) => event.type === 'told' && event.kind === 'grimoire')
    expect(tells).toHaveLength(3)
    for (const told of tells) {
      const prefix = events.filter((event) => event.seq < told.seq)
      const truth = fold(prefix)
      expect(told.content).toEqual({ seats: truth.seats, redHerring: 2, bluffs: [] })
      expect(prefix.at(-1)).toMatchObject({
        type: 'ability.resolved',
        seat: 1,
        role: 'spy',
        result: told.content,
        deviated: false,
      })
      for (const language of ['zh', 'en'] as const) {
        const text = renderEvent(told, language, 'seat:1')
        expect(text).toContain(ROLES.spy.name[language])
        expect(text).toContain(language === 'zh' ? '干扰项' : 'red herring')
      }
      expect(project([told], 'seat:2')).toEqual([])
      expect(project([told], 'public')).toEqual([])
    }
    expect(tells[0]).toMatchObject({
      content: { seats: [expect.objectContaining({ poisoned: true }), ...seats.slice(1)] },
    })
    expect(discretionCalls).toEqual(['D3'])
    expect(requests.some((request) => request.role === 'spy')).toBe(false)
  })
})

describe('Saint execution', () => {
  it.each(['functioning', 'poisoned', 'already-dead', 'night-death', 'simultaneous-good'] as const)(
    'checks actual execution death and good-win precedence: %s',
    async (mode) => {
      const seats = seatsFor(['chef', 'saint', 'soldier', 'scarletwoman', 'imp']).map((seat) => ({
        ...seat,
        poisoned: seat.seat === 2 && mode === 'poisoned',
        alive:
          !(seat.seat === 2 && mode === 'already-dead') &&
          !(seat.seat === 5 && mode === 'simultaneous-good'),
      }))
      const { events } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'nominate' && mode !== 'night-death')
            return {
              reasoning_summary: '',
              nominee:
                request.day === 1 && request.seat === 1 && request.nominees.includes(2) ? 2 : null,
            }
          if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
          if (request.tool === 'night_choice')
            return {
              reasoning_summary: '',
              targets: [request.day === 2 && mode === 'night-death' ? 2 : request.seat],
            }
          return passAction(request)
        },
      })
      const end = events.at(-1)
      expect(end).toMatchObject({
        type: 'game.ended',
        winner: mode === 'functioning' ? 'evil' : 'good',
        reason: mode === 'functioning' ? 'saint_executed' : 'all_demons_dead',
      })
      if (mode === 'functioning' || mode === 'simultaneous-good')
        expect(events.at(-2)).toMatchObject({ type: 'execution', seat: 2 })
      else
        expect(events.some((event) => event.type === 'phase.started' && event.day === 2)).toBe(true)
      if (end?.type !== 'game.ended') throw new Error('Missing Saint ending')
      for (const language of ['zh', 'en'] as const)
        expect(renderEvent(end, language, 'public')).not.toContain('saint_executed')
    },
  )
})

describe('fixed registration across every §6.2 probe', () => {
  for (const [probe, target, registration, healthy, poisoned] of [
    [
      'washerwoman',
      'spy',
      'mayor',
      { seats: [2, 3], role: 'mayor' },
      { seats: [2, 3], role: 'soldier' },
    ],
    ['librarian', 'spy', 'saint', { seats: [2, 3], role: 'saint' }, 0],
    ['librarian', 'recluse', 'imp', 0, { seats: [2, 3], role: 'recluse' }],
    ['investigator', 'spy', 'chef', 0, { seats: [2, 3], role: 'spy' }],
    ['investigator', 'recluse', 'poisoner', { seats: [2, 3], role: 'poisoner' }, 0],
  ] as const) {
    it.each([false, true])(
      `${probe} detects fixed ${target} role, unless poisoned=%s`,
      async (impaired) => {
        const seats = seatsFor([probe, target, 'soldier', 'virgin', 'imp'])
        if (seats[1])
          Object.assign(seats[1], {
            registeredRole: registration,
            registeredAlignment: ROLES[target].alignment,
            poisoned: impaired,
          })
        const expected = impaired ? poisoned : healthy
        const { events, discretionCalls } = await game([2, 4, 5], {
          seats,
          discretion: (_id, candidates) => {
            expect(candidates).toContainEqual(expected)
            return Promise.resolve(expected === 0 ? 0 : { ...expected, seats: [...expected.seats] })
          },
        })
        expect(
          events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
        ).toMatchObject({
          result: expected,
          deviated: false,
        })
        if (expected === 0) expect(discretionCalls).toEqual([])
      },
    )
  }

  it.each([false, true])(
    'Chef uses fixed alignment independently of role, unless poisoned=%s',
    async (impaired) => {
      const seats = seatsFor(['chef', 'spy', 'recluse', 'saint', 'imp'])
      if (seats[1])
        Object.assign(seats[1], {
          registeredRole: 'mayor',
          registeredAlignment: 'evil',
          poisoned: impaired,
        })
      if (seats[2])
        Object.assign(seats[2], {
          registeredRole: 'poisoner',
          registeredAlignment: 'evil',
          poisoned: impaired,
        })
      const { events } = await game([2, 3, 4], { seats })
      expect(
        events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
      ).toMatchObject({ result: impaired ? 0 : 1 })
    },
  )

  it.each([false, true])(
    'Empath uses fixed Spy alignment, unless poisoned=%s',
    async (impaired) => {
      const seats = seatsFor(['empath', 'spy', 'soldier', 'virgin', 'imp'])
      if (seats[1])
        Object.assign(seats[1], {
          registeredRole: 'mayor',
          registeredAlignment: 'good',
          poisoned: impaired,
        })
      const { events } = await game([2, 4, 5], { seats })
      expect(
        events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
      ).toMatchObject({ result: impaired ? 2 : 1 })
      expect(
        events.filter((event) => event.type === 'ability.resolved' && event.seat === 1).slice(1),
      ).toEqual([expect.objectContaining({ result: 1 }), expect.objectContaining({ result: 1 })])
    },
  )

  it.each([false, true])(
    'Fortune Teller detects dead registered Demon Recluse, and poison temporarily restores truth: %s',
    async (impaired) => {
      const seats = seatsFor(['fortuneteller', 'recluse', 'soldier', 'virgin', 'imp'])
      if (seats[1])
        Object.assign(seats[1], {
          registeredRole: 'imp',
          registeredAlignment: 'good',
          poisoned: impaired,
        })
      const { events } = await game([2, 4, 5], {
        seats,
        discretion: () => Promise.resolve(1),
        choose: (request) =>
          request.tool === 'night_choice'
            ? { reasoning_summary: '', targets: [2, 3] }
            : passAction(request),
      })
      expect(
        events
          .filter((event) => event.type === 'ability.resolved' && event.seat === 1)
          .map((event) => event.type === 'ability.resolved' && event.result),
      ).toEqual([!impaired, true, true])
    },
  )

  it.each(['spy', 'recluse'] as const)(
    'Undertaker sees the dead %s fixed role, never its registered ability',
    async (role) => {
      const seats = seatsFor(['undertaker', role, 'soldier', 'virgin', 'imp'])
      const registeredRole = role === 'spy' ? 'saint' : 'imp'
      if (seats[1]) Object.assign(seats[1], { registeredRole, registeredAlignment: 'good' })
      const { events } = await game([4, 5], {
        seats,
        choose: (request) => {
          if (request.tool === 'nominate')
            return {
              reasoning_summary: '',
              nominee:
                request.day === 1 && request.seat === 1 && request.nominees.includes(2) ? 2 : null,
            }
          if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
          return passAction(request)
        },
      })
      expect(
        events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
      ).toMatchObject({ result: { target: 2, role: registeredRole } })
      expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
      expect(events.filter((event) => event.type === 'role.changed')).toEqual([])
    },
  )

  for (const role of ['spy', 'recluse'] as const) {
    it.each([false, true])(
      `Ravenkeeper sees ${role} fixed role unless poisoned=%s`,
      async (impaired) => {
        const seats = seatsFor([
          'ravenkeeper',
          role,
          'soldier',
          impaired ? 'poisoner' : 'virgin',
          'imp',
        ])
        const registration = role === 'spy' ? 'mayor' : 'imp'
        if (seats[1])
          Object.assign(seats[1], { registeredRole: registration, registeredAlignment: 'good' })
        const { events } = await game([1, 2, 4], {
          seats,
          choose: (request) =>
            request.tool === 'night_choice'
              ? { reasoning_summary: '', targets: [2] }
              : passAction(request),
        })
        expect(
          events.find((event) => event.type === 'ability.resolved' && event.seat === 1),
        ).toMatchObject({ result: { target: 2, role: impaired ? role : registration } })
      },
    )
  }

  it.each([false, true])(
    'D16 uses fixed Spy role for Virgin and spends her first nomination, poisoned=%s',
    async (impaired) => {
      const seats = seatsFor(['virgin', 'spy', 'soldier', 'saint', 'imp'])
      if (seats[1])
        Object.assign(seats[1], {
          registeredRole: 'mayor',
          registeredAlignment: 'evil',
          poisoned: impaired,
        })
      const { events, discretionCalls } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'nominate')
            return {
              reasoning_summary: '',
              nominee:
                request.day === 1 && request.seat === 2 && request.nominees.includes(1) ? 1 : null,
            }
          if (request.tool === 'night_choice')
            return {
              reasoning_summary: '',
              targets: [request.day === 2 ? 2 : request.day === 3 ? 4 : request.seat],
            }
          return passAction(request)
        },
      })
      expect(events.filter((event) => event.type === 'virgin.triggered')).toHaveLength(
        impaired ? 0 : 1,
      )
      expect(events.filter((event) => event.type === 'execution')).toEqual(
        impaired ? [] : [expect.objectContaining({ seat: 2 })],
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'status.changed',
          seat: 1,
          status: 'abilityUsed',
          value: true,
        }),
      )
      expect(discretionCalls).toEqual([])
    },
  )

  it.each([false, true])(
    'D17 kills only functioning registered Demon Recluse, without succession or ending the game, poisoned=%s',
    async (impaired) => {
      const seats = seatsFor(['slayer', 'recluse', 'soldier', 'scarletwoman', 'imp'])
      if (seats[1])
        Object.assign(seats[1], {
          registeredRole: 'imp',
          registeredAlignment: 'good',
          poisoned: impaired,
        })
      const { events, discretionCalls } = await game([], {
        seats,
        act: (request) => {
          if (
            request.tool === 'speak' &&
            request.kind === 'free' &&
            request.day === 1 &&
            request.seat === 1
          )
            return { reasoning_summary: '', speech: 'Shoot the Recluse', slayer_target: 2 }
          if (request.tool === 'night_choice')
            return {
              reasoning_summary: '',
              targets: [request.day === 2 ? 4 : request.day === 3 ? 2 : request.seat],
            }
          return passAction(request)
        },
      })
      const shot = events.findIndex((event) => event.type === 'slayer.resolved')
      expect(events[shot]).toMatchObject({ target: 2, died: !impaired })
      expect(events[shot + 1]?.type).not.toBe('game.ended')
      expect(events.filter((event) => event.type === 'role.changed')).toEqual([])
      expect(discretionCalls).toEqual([])
      expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
    },
  )
})

describe('registration never changes real roles or setup', () => {
  it('a Spy registered good Saint remains a true Minion heir, then registers as its actual new Imp role', async () => {
    const seats = seatsFor(['fortuneteller', 'spy', 'slayer', 'virgin', 'imp'])
    if (seats[1]) Object.assign(seats[1], { registeredRole: 'saint', registeredAlignment: 'good' })
    const { events } = await game([], {
      seats,
      discretion: () => Promise.resolve(1),
      act: (request) => {
        if (request.tool === 'night_choice')
          return {
            reasoning_summary: '',
            targets: request.role === 'fortuneteller' ? [2, 4] : [request.seat],
          }
        if (
          request.tool === 'speak' &&
          request.kind === 'free' &&
          request.day === 2 &&
          request.seat === 3
        )
          return { reasoning_summary: '', speech: 'Shoot the new Imp', slayer_target: 2 }
        return passAction(request)
      },
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'role.changed', seat: 2, from: 'spy', to: 'imp' }),
    )
    expect(
      events
        .filter((event) => event.type === 'ability.resolved' && event.role === 'fortuneteller')
        .map((event) => event.type === 'ability.resolved' && event.result),
    ).toEqual([false, true])
    expect(
      events.filter((event) => event.type === 'told' && event.kind === 'grimoire'),
    ).toHaveLength(1)
    expect(events.slice(-2)).toEqual([
      expect.objectContaining({ type: 'slayer.resolved', target: 2, died: true }),
      expect.objectContaining({ type: 'game.ended', winner: 'good' }),
    ])
  })

  it.each(['poisoner', 'imp'] as const)(
    'a living Recluse registered %s is never an heir or a surviving true Demon',
    async (registeredRole) => {
      const seats = seatsFor(['recluse', 'chef', 'soldier', 'virgin', 'imp'])
      if (seats[0]) Object.assign(seats[0], { registeredRole, registeredAlignment: 'evil' })
      const { events } = await game([5], { seats })
      expect(events.filter((event) => event.type === 'role.changed')).toEqual([])
      expect(events.at(-1)).toMatchObject({
        type: 'game.ended',
        winner: 'good',
        reason: 'all_demons_dead',
      })
    },
  )

  it('D1 tells the Spy its real identity before fixed registration, not its chosen good role', async () => {
    const { events } = await game([4, 2, 3], {
      discretion: (id) => {
        if (id === 'D1') return Promise.resolve(['chef', 'slayer', 'virgin', 'spy', 'imp'])
        expect(id).toBe('D10')
        return Promise.resolve({ alignment: 'good', role: 'saint' })
      },
    })
    expect(
      events.filter((event) => event.type === 'told' && event.kind === 'role' && event.seat === 4),
    ).toEqual([expect.objectContaining({ content: { role: 'spy' } })])
    expect(fold(events).seats[3]).toMatchObject({
      role: 'spy',
      alignment: 'evil',
      registeredRole: 'saint',
      registeredAlignment: 'good',
    })
  })

  it('Baron setup admits Butler and Drunk, and Baron death never removes Outsiders', async () => {
    const { events, state, discretionCalls } = await game([4, 2, 1], {
      discretion: (id) => {
        if (id === 'D1') return Promise.resolve(['ravenkeeper', 'butler', 'drunk', 'baron', 'imp'])
        expect(id).toBe('D2')
        return Promise.resolve('soldier')
      },
      choose: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [5] }
          : passAction(request),
    })
    expect(discretionCalls).toEqual(['D1', 'D2'])
    expect(
      state.seats.filter((seat) => ROLES[seat.role].type === 'outsider').map((seat) => seat.role),
    ).toEqual(['butler', 'drunk'])
    expect(state.seats[3]).toMatchObject({ role: 'baron', alive: false })
    expect(state.seats[2]).toMatchObject({ role: 'drunk', believedRole: 'soldier' })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'status.changed', seat: 2, status: 'master', value: 5 }),
    )
  })

  it.each([
    ['spy', { alignment: 'good', role: 'imp' }],
    ['recluse', { alignment: 'evil', role: 'saint' }],
    ['spy', { alignment: 'good' }],
    ['recluse', { role: 'imp' }],
  ] as const)('rejects illegal %s setup registration %j', async (role, choice) => {
    await expect(
      game([], {
        seats: seatsFor([role, 'soldier', 'slayer', 'virgin', 'imp']),
        discretion: () => Promise.resolve(choice as Registration),
      }),
    ).rejects.toThrow(/Invalid D1[01] choice/)
  })
})

describe('D1 guarantees a legal Washerwoman truth', () => {
  it('rejects the sole-Townsfolk Washerwoman setup and never samples it', () => {
    expect(validate(['washerwoman', 'recluse', 'saint', 'baron', 'imp'])).toEqual([
      { code: 'no_washerwoman_truth' },
    ])
    expect(validate(['washerwoman', 'slayer', 'soldier', 'spy', 'imp'])).toEqual([])
    for (let seed = 0; seed < 1000; seed++) {
      const roles = sample(createRng(seed))
      expect(validate(roles)).toEqual([])
      expect(roles.includes('baron') && roles.includes('washerwoman')).toBe(false)
    }
  })
  it('still gives D8 to a Drunk who believes Washerwoman in a Baron setup', async () => {
    const seats = seatsFor(['soldier', 'drunk', 'saint', 'baron', 'imp'])
    if (seats[1]) seats[1].believedRole = 'washerwoman'
    const { events } = await game([4, 3, 2], {
      seats,
      discretion: (id, candidates) => {
        expect(id).toBe('D8')
        expect(candidates).toContainEqual({ seats: [1, 3], role: 'washerwoman' })
        return Promise.resolve({ seats: [1, 3], role: 'washerwoman' })
      },
    })
    expect(
      events.find((event) => event.type === 'told' && event.kind === 'ability' && event.seat === 2),
    ).toMatchObject({
      content: { role: 'washerwoman', result: { seats: [1, 3], role: 'washerwoman' } },
    })
  })
})

describe('succession interaction boundaries', () => {
  it('forces Scarlet Woman over multiple true Minions at five and gives the heir no same-night action', async () => {
    const seats = seatsFor(['recluse', 'spy', 'baron', 'scarletwoman', 'imp'])
    if (seats[0])
      Object.assign(seats[0], { registeredRole: 'poisoner', registeredAlignment: 'evil' })
    if (seats[1]) Object.assign(seats[1], { registeredRole: 'saint', registeredAlignment: 'good' })
    const { events, requests, discretionCalls } = await game([], {
      seats,
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning_summary: '',
              targets: [request.day === 2 ? 5 : request.day === 3 ? 2 : 1],
            }
          : passAction(request),
    })
    expect(discretionCalls).toEqual([])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([
      expect.objectContaining({ seat: 4, from: 'scarletwoman', to: 'imp' }),
    ])
    expect(requests.map((request) => [request.seat, request.day, request.role])).toEqual([
      [5, 2, 'imp'],
      [4, 3, 'imp'],
      [4, 4, 'imp'],
    ])
    const death = events.find((event) => event.type === 'night.death' && event.seat === 5)
    const dawn = events.find((event) => event.type === 'dawn.announced' && event.day === 2)
    expect(dawn).toMatchObject({ deaths: [5] })
    expect(project(death ? [death] : [], 'public')).toEqual([])
    expect(
      project(events, 'seat:1').filter((event) => event.type === 'told' && event.kind === 'imp'),
    ).toEqual([])
  })

  it('D14 excludes a dead Minion and registered Recluse but includes a good-registering Spy', async () => {
    const seats = seatsFor(['recluse', 'spy', 'baron', 'scarletwoman', 'imp'])
    if (seats[0])
      Object.assign(seats[0], { registeredRole: 'poisoner', registeredAlignment: 'evil' })
    if (seats[1]) Object.assign(seats[1], { registeredRole: 'saint', registeredAlignment: 'good' })
    if (seats[2]) seats[2].alive = false
    const { events, requests, discretionCalls } = await game([], {
      seats,
      discretion: (id, candidates) => {
        expect(id).toBe('D14')
        expect(candidates).toEqual([2, 4])
        return Promise.resolve(2)
      },
      act: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [request.day === 2 ? 5 : 1] }
          : passAction(request),
    })
    expect(discretionCalls).toEqual(['D14'])
    expect(events.filter((event) => event.type === 'role.changed')).toEqual([
      expect.objectContaining({ seat: 2, from: 'spy', to: 'imp' }),
    ])
    expect(requests.map((request) => [request.seat, request.day])).toEqual([
      [5, 2],
      [2, 3],
    ])
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'evil', reason: 'two_alive' })
  })

  it('a poisoned Scarlet Woman loses mandatory priority but remains a legal D14 heir with poison retained', async () => {
    const { events, requests, discretionCalls } = await game([], {
      seats: seatsFor(['chef', 'soldier', 'poisoner', 'scarletwoman', 'imp']),
      discretion: (id, candidates) => {
        expect(id).toBe('D14')
        expect(candidates).toEqual([3, 4])
        return Promise.resolve(4)
      },
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning_summary: '',
              targets: [request.role === 'poisoner' ? (request.day <= 2 ? 4 : 2) : request.seat],
            }
          : passAction(request),
    })
    expect(discretionCalls).toEqual(['D14'])
    const change = events.findIndex((event) => event.type === 'role.changed' && event.seat === 4)
    expect(fold(events.slice(0, change + 1)).seats[3]).toMatchObject({
      role: 'imp',
      poisoned: true,
      alive: true,
    })
    const dawn = events.findIndex((event) => event.type === 'dawn.announced' && event.day === 2)
    expect(fold(events.slice(0, dawn + 1)).seats[3]?.poisoned).toBe(true)
    const nextNight = events.findIndex(
      (event) => event.type === 'phase.started' && event.day === 3 && event.phase === 'night',
    )
    expect(fold(events.slice(0, nextNight + 1)).seats[3]?.poisoned).toBe(false)
    expect(
      requests
        .filter((request) => request.role === 'imp')
        .map((request) => [request.seat, request.day]),
    ).toEqual([
      [5, 2],
      [4, 3],
      [3, 4],
    ])
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })

  it('Poisoner transformation clears poison before the same-night Empath action and stops Poisoner actions', async () => {
    const { events, requests, discretionCalls } = await game([], {
      seats: seatsFor(['empath', 'chef', 'poisoner', 'slayer', 'imp']),
      discretion: (id) => {
        expect(id).toBe('D8')
        return Promise.resolve(2)
      },
      act: (request) => {
        if (request.tool === 'night_choice')
          return {
            reasoning_summary: '',
            targets: [request.role === 'poisoner' ? 1 : request.seat],
          }
        if (
          request.tool === 'speak' &&
          request.kind === 'free' &&
          request.day === 2 &&
          request.seat === 4
        )
          return { reasoning_summary: '', speech: 'Shoot the new Imp', slayer_target: 3 }
        return passAction(request)
      },
    })
    const change = events.findIndex((event) => event.type === 'role.changed')
    expect(events.slice(change, change + 4)).toEqual([
      expect.objectContaining({ type: 'role.changed', seat: 3, from: 'poisoner', to: 'imp' }),
      expect.objectContaining({
        type: 'status.changed',
        seat: 1,
        status: 'poisoned',
        value: false,
      }),
      expect.objectContaining({ type: 'told', seat: 3, kind: 'imp' }),
      expect.objectContaining({ type: 'ability.resolved', seat: 1, result: 0, deviated: false }),
    ])
    expect(discretionCalls).toEqual(['D8'])
    expect(
      requests.filter((request) => request.role === 'poisoner').map((request) => request.day),
    ).toEqual([1, 2])
    expect(
      requests
        .filter((request) => request.role === 'imp')
        .map((request) => [request.seat, request.day]),
    ).toEqual([[5, 2]])
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good' })
  })
})

describe('remaining research interaction scenarios', () => {
  it.each(['butler', 'recluse', 'saint', 'imp'] as const)(
    '%s nomination of Virgin votes normally and spends her ability before a Townsfolk nominates',
    async (role) => {
      const seats = seatsFor([
        'virgin',
        'slayer',
        'soldier',
        role === 'imp' ? 'scarletwoman' : role,
        'imp',
      ])
      if (role === 'recluse' && seats[3])
        Object.assign(seats[3], { registeredRole: 'recluse', registeredAlignment: 'good' })
      const { events } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'nominate')
            return {
              reasoning_summary: '',
              nominee:
                request.day <= 2 &&
                request.seat === (request.day === 1 ? (role === 'imp' ? 5 : 4) : 2) &&
                request.nominees.includes(1)
                  ? 1
                  : null,
            }
          if (request.tool === 'night_choice')
            return {
              reasoning_summary: '',
              targets: [request.role === 'butler' ? 5 : request.day === 2 ? 4 : request.seat],
            }
          return passAction(request)
        },
      })
      expect(events.filter((event) => event.type === 'nomination')).toHaveLength(2)
      expect(events.filter((event) => event.type === 'vote')).toHaveLength(10)
      expect(
        events.filter((event) => event.type === 'execution' || event.type === 'virgin.triggered'),
      ).toEqual([])
      expect(
        events.filter((event) => event.type === 'status.changed' && event.status === 'abilityUsed'),
      ).toEqual([expect.objectContaining({ seat: 1, value: true })])
    },
  )

  it('dead seats cannot nominate Virgin and her ability remains for the next living Townsfolk nomination', async () => {
    const seats = seatsFor(['virgin', 'chef', 'soldier', 'scarletwoman', 'imp'])
    if (seats[1]) seats[1].alive = false
    const nominators: number[] = []
    const { events } = await game([], {
      seats,
      act: (request) => {
        if (request.tool === 'nominate') {
          nominators.push(request.seat)
          return {
            reasoning_summary: '',
            nominee:
              request.day === 2 && request.seat === 3 && request.nominees.includes(1) ? 1 : null,
          }
        }
        if (request.tool === 'night_choice')
          return { reasoning_summary: '', targets: [request.day === 2 ? 2 : request.seat] }
        return passAction(request)
      },
    })
    expect(nominators).not.toContain(2)
    expect(events.filter((event) => event.type === 'virgin.triggered')).toEqual([
      expect.objectContaining({ nominator: 3 }),
    ])
    expect(events.filter((event) => event.type === 'execution')).toEqual([
      expect.objectContaining({ seat: 3 }),
    ])
  })

  it('Soldier still dies to execution nominated by the Demon', async () => {
    const { events } = await game([4, 5], {
      choose: (request) => {
        if (request.tool === 'nominate')
          return {
            reasoning_summary: '',
            nominee:
              request.day === 1 && request.seat === 5 && request.nominees.includes(1) ? 1 : null,
          }
        if (request.tool === 'vote') return { reasoning_summary: '', raise_hand: true }
        return passAction(request)
      },
    })
    expect(events.filter((event) => event.type === 'execution')).toEqual([
      expect.objectContaining({ seat: 1 }),
    ])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'nomination', nominator: 5, nominee: 1 }),
    )
  })

  it.each(['tie', 'execution'] as const)(
    'three-living Mayor resolves %s at day end before another night',
    async (mode) => {
      const seats = seatsFor(['mayor', 'chef', 'soldier', 'scarletwoman', 'imp']).map((seat) => ({
        ...seat,
        alive: [1, 2, 5].includes(seat.seat),
      }))
      const { events } = await game([], {
        seats,
        act: (request) => {
          if (request.tool === 'nominate')
            return {
              reasoning_summary: '',
              nominee:
                request.seat === 1 && request.nominees.includes(2)
                  ? 2
                  : mode === 'tie' && request.seat === 5 && request.nominees.includes(1)
                    ? 1
                    : null,
            }
          if (request.tool === 'vote')
            return { reasoning_summary: '', raise_hand: [1, 2, 5].includes(request.seat) }
          return passAction(request)
        },
      })
      expect(events.filter((event) => event.type === 'vote.tallied')).toHaveLength(
        mode === 'tie' ? 2 : 1,
      )
      expect(events.filter((event) => event.type === 'execution')).toHaveLength(
        mode === 'tie' ? 0 : 1,
      )
      expect(events.at(-1)).toMatchObject({
        type: 'game.ended',
        winner: mode === 'tie' ? 'good' : 'evil',
        reason: mode === 'tie' ? 'mayor' : 'two_alive',
      })
      expect(events.some((event) => event.type === 'phase.started' && event.day === 2)).toBe(false)
    },
  )

  it.each([1, 2])(
    'Fortune Teller keeps good seat %s as its red herring, including self or a dead Drunk',
    async (redHerring) => {
      const seats = seatsFor(['fortuneteller', 'drunk', 'soldier', 'scarletwoman', 'imp'])
      if (seats[1]) seats[1].believedRole = 'slayer'
      const { events, state, discretionCalls } = await game([2, 4, 5], {
        seats,
        discretion: (id, candidates) => {
          expect(id).toBe('D3')
          expect(candidates).toEqual([1, 2, 3])
          return Promise.resolve(redHerring)
        },
        choose: (request) =>
          request.tool === 'night_choice'
            ? { reasoning_summary: '', targets: [1, 2] }
            : passAction(request),
      })
      expect(discretionCalls).toEqual(['D3'])
      expect(state.redHerring).toBe(redHerring)
      expect(
        events.filter(
          (event) => event.type === 'ability.resolved' && event.role === 'fortuneteller',
        ),
      ).toEqual([
        expect.objectContaining({ result: true }),
        expect.objectContaining({ result: true }),
        expect.objectContaining({ result: true }),
      ])
    },
  )

  it('Chef counts two adjacent evil pairs through a dead Minion, rather than three evil players', async () => {
    const seats = seatsFor(['chef', 'poisoner', 'scarletwoman', 'imp', 'soldier'])
    if (seats[2]) seats[2].alive = false
    const { events } = await game([], {
      seats,
      act: (request) =>
        request.tool === 'night_choice'
          ? {
              reasoning_summary: '',
              targets: [request.role === 'poisoner' ? 2 : request.day === 2 ? 2 : request.seat],
            }
          : passAction(request),
    })
    expect(
      events.filter((event) => event.type === 'ability.resolved' && event.role === 'chef'),
    ).toEqual([expect.objectContaining({ result: 2, deviated: false })])
  })
  it('a Drunk who believes Mayor dies to the Imp without redirect discretion', async () => {
    const seats = seatsFor(['drunk', 'chef', 'soldier', 'scarletwoman', 'imp'])
    if (seats[0]) seats[0].believedRole = 'mayor'
    const { events, discretionCalls } = await game([1, 4, 5], { seats })
    expect(discretionCalls).toEqual([])
    expect(events.find((event) => event.type === 'night.death')).toMatchObject({ seat: 1 })
    expect(
      events.find((event) => event.type === 'ability.resolved' && event.role === 'imp'),
    ).toMatchObject({ result: { target: 1, outcome: 'killed' } })
  })
  it('a final-three Mayor facing Poisoner and Imp remains poisoned for the day-end win check', async () => {
    const seats = seatsFor(['mayor', 'chef', 'soldier', 'poisoner', 'imp']).map((seat) => ({
      ...seat,
      alive: [1, 4, 5].includes(seat.seat),
    }))
    const { events } = await game([], {
      seats,
      act: (request) =>
        request.tool === 'night_choice'
          ? { reasoning_summary: '', targets: [request.role === 'poisoner' ? 1 : 4] }
          : passAction(request),
    })
    const clear = events.findIndex(
      (event) => event.type === 'status.changed' && event.status === 'poisoned' && !event.value,
    )
    expect(fold(events.slice(0, clear)).seats[0]?.poisoned).toBe(true)
    expect(events.find((event) => event.type === 'phase.started' && event.day === 2)).toMatchObject(
      { phase: 'night' },
    )
    expect(events.at(-1)).toMatchObject({ type: 'game.ended', winner: 'evil', reason: 'two_alive' })
  })
})
