import type {
  Alignment,
  ContestantRequest,
  GameEvent,
  GameEventInput,
  Grimoire,
  NightRequest,
  Observer,
  PairInformation,
  Ports,
  PublicState,
  RoleId,
  SeatState,
  SpeechChoice,
  SpeechRequest,
  ValidationError,
} from '../types/game'
import { ROLES } from './roles'

// shortcut: five seats and implemented roles only; lift with full-role setup and demon succession.
const ROLE_POOL: readonly RoleId[] = [
  'soldier',
  'chef',
  'empath',
  'washerwoman',
  'librarian',
  'investigator',
  'fortuneteller',
  'undertaker',
  'ravenkeeper',
  'scarletwoman',
  'imp',
]

export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function validate(roles: readonly string[]): ValidationError[] {
  const errors: ValidationError[] = []
  if (roles.length !== 5) errors.push({ code: 'invalid_seat_count' })
  if (new Set(roles).size !== roles.length) errors.push({ code: 'duplicate_role' })
  if (roles.some((role) => !ROLE_POOL.some((allowed) => allowed === role))) {
    errors.push({ code: 'unsupported_role' })
  }
  const types = roles.map((role) =>
    Object.hasOwn(ROLES, role) ? ROLES[role as RoleId].type : undefined,
  )
  if (roles.filter((role) => role === 'imp').length !== 1) errors.push({ code: 'invalid_demon' })
  if (
    types.filter((type) => type === 'townsfolk').length !== 3 ||
    types.filter((type) => type === 'outsider').length !== 0 ||
    types.filter((type) => type === 'minion').length !== 1 ||
    types.filter((type) => type === 'demon').length !== 1
  ) {
    errors.push({ code: 'invalid_role_counts' })
  }
  return errors
}

export function sample(rng: () => number): RoleId[] {
  const townsfolk = ROLE_POOL.filter((role) => ROLES[role].type === 'townsfolk')
  const roles: RoleId[] = ['scarletwoman', 'imp']
  for (let index = 0; index < 3; index++) {
    const [role] = townsfolk.splice(Math.floor(rng() * townsfolk.length), 1)
    if (role) roles.push(role)
  }
  for (let index = roles.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1))
    const role = roles[index]
    const replacement = roles[other]
    if (role !== undefined && replacement !== undefined) {
      roles[index] = replacement
      roles[other] = role
    }
  }
  return roles
}

type Audience = 'public' | 'seat' | 'room' | 'storyteller' | 'spectator'
const AUDIENCES: Record<GameEvent['type'], Audience> = {
  'game.created': 'spectator',
  'phase.started': 'public',
  'game.ended': 'public',
  'game.aborted': 'spectator',
  'contestant.decision': 'spectator',
  'storyteller.decision': 'storyteller',
  'discretion.requested': 'storyteller',
  'discretion.resolved': 'storyteller',
  'grimoire.set': 'storyteller',
  'status.changed': 'storyteller',
  'role.changed': 'storyteller',
  'ability.resolved': 'storyteller',
  'night.death': 'storyteller',
  told: 'seat',
  'seat.memo.updated': 'seat',
  'night.choice': 'seat',
  'dawn.announced': 'public',
  'whisper.proposed': 'spectator',
  'whisper.candidates': 'seat',
  'whisper.ranked': 'spectator',
  'whisper.room.opened': 'public',
  'whisper.speech': 'room',
  'whisper.room.closed': 'room',
  'public.speech': 'public',
  'slayer.resolved': 'public',
  nomination: 'public',
  'virgin.triggered': 'public',
  vote: 'public',
  'vote.tallied': 'public',
  execution: 'public',
}

export function visibleTo(
  event: { type: string; seat?: number; members?: readonly number[] | null },
  observer: Observer,
): boolean {
  if (observer === 'spectator') return true
  const audience = Object.hasOwn(AUDIENCES, event.type)
    ? AUDIENCES[event.type as GameEvent['type']]
    : 'spectator'
  if (audience === 'spectator') return false
  if (observer === 'storyteller' || audience === 'public') return true
  if (observer === 'public' || audience === 'storyteller') return false
  const match = /^seat:([1-9]\d*)$/.exec(observer)
  if (!match) return false
  const seat = Number(match[1])
  return audience === 'room' ? (event.members?.includes(seat) ?? false) : event.seat === seat
}

export function project(events: readonly GameEvent[], observer: Observer): GameEvent[] {
  return events.filter((event) => visibleTo(event, observer))
}

export function apply(state: Grimoire, event: GameEvent): Grimoire {
  const next = { ...state, seq: event.seq }
  switch (event.type) {
    case 'grimoire.set':
      return {
        ...next,
        seats: event.seats.map((seat) => ({ ...seat })),
        redHerring: event.redHerring ?? null,
      }
    case 'phase.started':
      return {
        ...next,
        day: event.day,
        phase: event.phase,
        executedToday:
          event.phase === 'first-night' || event.phase === 'dawn' ? null : state.executedToday,
      }
    case 'status.changed':
      return {
        ...next,
        seats: state.seats.map((seat) => {
          if (seat.seat !== event.seat) return seat
          if (event.status === 'master')
            return { ...seat, master: typeof event.value === 'number' ? event.value : null }
          return { ...seat, [event.status]: event.value === true }
        }),
      }
    case 'role.changed':
      return {
        ...next,
        seats: state.seats.map((seat) =>
          seat.seat === event.seat
            ? { ...seat, role: event.to, alignment: ROLES[event.to].alignment }
            : seat,
        ),
      }
    case 'night.death':
    case 'execution':
      return {
        ...next,
        executedToday: event.type === 'execution' ? event.seat : state.executedToday,
        seats: state.seats.map((seat) =>
          seat.seat === event.seat ? { ...seat, alive: false } : seat,
        ),
      }
    case 'slayer.resolved':
      return event.died
        ? {
            ...next,
            seats: state.seats.map((seat) =>
              seat.seat === event.target ? { ...seat, alive: false } : seat,
            ),
          }
        : next
    case 'vote':
      return event.voteUsed
        ? {
            ...next,
            seats: state.seats.map((seat) =>
              seat.seat === event.seat ? { ...seat, voteUsed: true } : seat,
            ),
          }
        : next
    case 'game.ended':
      return { ...next, winner: event.winner, ended: true }
    case 'game.aborted':
      return { ...next, aborted: true }
    case 'game.created':
    case 'contestant.decision':
    case 'storyteller.decision':
    case 'discretion.requested':
    case 'discretion.resolved':
    case 'ability.resolved':
    case 'told':
    case 'seat.memo.updated':
    case 'night.choice':
    case 'dawn.announced':
    case 'whisper.proposed':
    case 'whisper.candidates':
    case 'whisper.ranked':
    case 'whisper.room.opened':
    case 'whisper.speech':
    case 'whisper.room.closed':
    case 'public.speech':
    case 'nomination':
    case 'virgin.triggered':
    case 'vote.tallied':
      return next
  }
}

export function fold(events: readonly GameEvent[]): Grimoire {
  return events.reduce(apply, {
    seq: 0,
    day: 0,
    phase: null,
    seats: [],
    redHerring: null,
    winner: null,
    ended: false,
    aborted: false,
    executedToday: null,
  })
}

export function foldPublic(events: readonly GameEvent[], seatCount = 5): PublicState {
  // shortcut: public setup has five seats until configurable player counts ship.
  let state: PublicState = {
    seq: 0,
    day: 0,
    phase: null,
    seats: Array.from({ length: seatCount }, (_, index) => ({
      seat: index + 1,
      alive: true,
      voteUsed: false,
    })),
    nominators: [],
    nominees: [],
    aboutToBeExecuted: null,
    highestVoteCount: 0,
    winner: null,
  }
  for (const event of events) {
    if (!visibleTo(event, 'public')) continue
    state = { ...state, seq: event.seq }
    switch (event.type) {
      case 'phase.started':
        state = { ...state, day: event.day, phase: event.phase }
        if (event.phase === 'dawn')
          state = {
            ...state,
            nominators: [],
            nominees: [],
            aboutToBeExecuted: null,
            highestVoteCount: 0,
          }
        break
      case 'dawn.announced':
        state = {
          ...state,
          day: event.day,
          seats: state.seats.map((seat) =>
            event.deaths.includes(seat.seat) ? { ...seat, alive: false } : seat,
          ),
        }
        break
      case 'execution':
        state = {
          ...state,
          aboutToBeExecuted: null,
          seats: state.seats.map((seat) =>
            seat.seat === event.seat ? { ...seat, alive: false } : seat,
          ),
        }
        break
      case 'slayer.resolved':
        if (event.died)
          state = {
            ...state,
            seats: state.seats.map((seat) =>
              seat.seat === event.target ? { ...seat, alive: false } : seat,
            ),
          }
        break
      case 'nomination':
        state = {
          ...state,
          nominators: [...state.nominators, event.nominator],
          nominees: [...state.nominees, event.nominee],
        }
        break
      case 'vote':
        if (event.voteUsed)
          state = {
            ...state,
            seats: state.seats.map((seat) =>
              seat.seat === event.seat ? { ...seat, voteUsed: true } : seat,
            ),
          }
        break
      case 'vote.tallied':
        if (event.aboutToBeExecuted)
          state = { ...state, aboutToBeExecuted: event.nominee, highestVoteCount: event.votes }
        else if (event.votes >= event.threshold && event.votes === state.highestVoteCount)
          state = { ...state, aboutToBeExecuted: null }
        state = { ...state, highestVoteCount: Math.max(state.highestVoteCount, event.votes) }
        break
      case 'game.ended':
        state = { ...state, winner: event.winner }
        break
      case 'game.created':
      case 'game.aborted':
      case 'contestant.decision':
      case 'storyteller.decision':
      case 'discretion.requested':
      case 'discretion.resolved':
      case 'grimoire.set':
      case 'status.changed':
      case 'role.changed':
      case 'ability.resolved':
      case 'night.death':
      case 'told':
      case 'seat.memo.updated':
      case 'night.choice':
      case 'whisper.proposed':
      case 'whisper.candidates':
      case 'whisper.ranked':
      case 'whisper.room.opened':
      case 'whisper.speech':
      case 'whisper.room.closed':
      case 'public.speech':
      case 'virgin.triggered':
        break
    }
  }
  return state
}

export function validateNightChoice(value: unknown, request: NightRequest): ValidationError[] {
  const choice =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const errors: ValidationError[] = []
  if (typeof choice.reasoning !== 'string') errors.push({ code: 'invalid_reasoning' })
  if (
    !Array.isArray(choice.targets) ||
    choice.targets.length !== (request.role === 'fortuneteller' ? 2 : 1) ||
    new Set(choice.targets).size !== choice.targets.length ||
    !choice.targets.every(
      (target: unknown) =>
        typeof target === 'number' && Number.isInteger(target) && request.targets.includes(target),
    )
  ) {
    errors.push({ code: 'invalid_targets' })
  }
  if (choice.memo !== undefined && (typeof choice.memo !== 'string' || choice.memo.length > 2000))
    errors.push({ code: 'invalid_memo' })
  return errors
}

export function validateSpeechChoice(value: unknown, request: SpeechRequest): ValidationError[] {
  const choice =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const errors: ValidationError[] = []
  if (typeof choice.reasoning !== 'string') errors.push({ code: 'invalid_reasoning' })
  if (
    (choice.speech !== null && typeof choice.speech !== 'string') ||
    (request.kind !== 'free' &&
      request.kind !== 'whisper' &&
      (typeof choice.speech !== 'string' || choice.speech.trim().length === 0))
  )
    errors.push({ code: 'invalid_speech' })
  if (
    choice.slayer_target !== null &&
    (request.kind !== 'free' ||
      typeof choice.speech !== 'string' ||
      choice.speech.trim().length === 0 ||
      typeof choice.slayer_target !== 'number' ||
      !Number.isInteger(choice.slayer_target) ||
      choice.slayer_target < 1 ||
      choice.slayer_target > 5)
  )
    errors.push({ code: 'invalid_slayer_target' })
  if (choice.memo !== undefined && (typeof choice.memo !== 'string' || choice.memo.length > 2000))
    errors.push({ code: 'invalid_memo' })
  return errors
}

export function validateContestantChoice(
  value: unknown,
  request: ContestantRequest,
): ValidationError[] {
  if (request.tool === 'night_choice') return validateNightChoice(value, request)
  if (request.tool === 'speak') return validateSpeechChoice(value, request)
  const choice =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const errors: ValidationError[] = []
  if (typeof choice.reasoning !== 'string') errors.push({ code: 'invalid_reasoning' })
  if (choice.memo !== undefined && (typeof choice.memo !== 'string' || choice.memo.length > 2000))
    errors.push({ code: 'invalid_memo' })
  if (request.tool === 'nominate') {
    if (
      choice.nominee !== null &&
      (typeof choice.nominee !== 'number' || !request.nominees.includes(choice.nominee))
    )
      errors.push({ code: 'invalid_nominee' })
  } else if (request.tool === 'propose_whisper') {
    if (
      choice.members !== null &&
      (!Array.isArray(choice.members) ||
        choice.members.length === 0 ||
        new Set(choice.members).size !== choice.members.length ||
        !choice.members.every(
          (seat: unknown) =>
            typeof seat === 'number' && seat !== request.seat && request.eligible.includes(seat),
        ))
    )
      errors.push({ code: 'invalid_whisper_members' })
  } else if (request.tool === 'rank_whispers') {
    if (
      !Array.isArray(choice.ranking) ||
      new Set(choice.ranking).size !== choice.ranking.length ||
      !choice.ranking.every((id: unknown) => request.rooms.some((room) => room.id === id))
    )
      errors.push({ code: 'invalid_whisper_ranking' })
  } else if (
    typeof choice.raise_hand !== 'boolean' ||
    (!request.canRaiseHand && choice.raise_hand)
  ) {
    errors.push({ code: 'invalid_vote' })
  }
  return errors
}
export function winner(state: Grimoire): { winner: Alignment; reason: string } | null {
  if (!state.seats.some((seat) => seat.alive && ROLES[seat.role].type === 'demon')) {
    return { winner: 'good', reason: 'all_demons_dead' }
  }
  if (state.seats.filter((seat) => seat.alive).length <= 2)
    return { winner: 'evil', reason: 'two_alive' }
  return null
}

function registeredAlignment(seat: SeatState): Alignment {
  return seat.alignment
}

function registeredRole(seat: SeatState): RoleId {
  return seat.role
}

export async function runGame(ports: Ports): Promise<Grimoire> {
  let state = fold(ports.log)
  const stopped = () => state.ended || state.aborted
  const commit = async (input: GameEventInput) => {
    const event = await ports.commit(input)
    state = apply(state, event)
  }
  if (stopped()) return state
  if (state.seats.length === 0) {
    const candidates = { type: 'setup' as const, sample: sample(() => ports.rng()) }
    await commit({ type: 'discretion.requested', discretion: 'D1', candidates, source: 'random' })
    const choice = await ports.discretion('D1', candidates, state)
    if (!Array.isArray(choice) || validate(choice).length !== 0) throw new Error('Invalid D1 setup')
    await commit({ type: 'discretion.resolved', discretion: 'D1', choice, source: 'random' })
    await commit({
      type: 'grimoire.set',
      seats: choice.map((role, index) => ({
        seat: index + 1,
        role,
        alignment: ROLES[role].alignment,
        alive: true,
        poisoned: false,
        protected: false,
        abilityUsed: false,
        voteUsed: false,
        master: null,
      })),
    })
    for (const seat of state.seats)
      await commit({ type: 'told', seat: seat.seat, kind: 'role', content: { role: seat.role } })
  }

  if (state.redHerring === null && state.seats.some((seat) => seat.role === 'fortuneteller')) {
    const candidates = state.seats
      .filter((seat) => seat.alignment === 'good')
      .map((seat) => seat.seat)
    let choice = candidates[0]
    if (choice === undefined) throw new Error('No good Fortune Teller red herring')
    if (candidates.length > 1) {
      await commit({ type: 'discretion.requested', discretion: 'D3', candidates, source: 'random' })
      const selected = await ports.discretion('D3', candidates, state)
      if (typeof selected !== 'number' || !candidates.includes(selected))
        throw new Error('Invalid D3 red herring')
      choice = selected
      await commit({ type: 'discretion.resolved', discretion: 'D3', choice, source: 'random' })
    }
    await commit({ type: 'grimoire.set', seats: state.seats, redHerring: choice })
  }

  const nightChoice = async (seat: SeatState): Promise<number[]> => {
    const request: NightRequest = {
      tool: 'night_choice',
      seat: seat.seat,
      role: seat.believedRole ?? seat.role,
      day: state.day,
      targets: state.seats.map((player) => player.seat),
    }
    const choices = await ports.askContestants([request])
    const choice = choices[0]
    if (
      choices.length !== 1 ||
      !choice ||
      !('targets' in choice) ||
      validateNightChoice(choice, request).length !== 0
    )
      throw new Error('Invalid night choice from ports')
    for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
    if (!stopped())
      await commit({
        type: 'night.choice',
        seat: seat.seat,
        role: request.role,
        targets: choice.targets,
      })
    return choice.targets
  }

  const kill = async (target: SeatState, cause: 'imp' | 'imp_suicide' | 'execution') => {
    if (!target.alive && cause !== 'execution') return
    const aliveBeforeDeath = state.seats.filter((seat) => seat.alive).length
    await commit(
      cause === 'execution'
        ? { type: 'execution', seat: target.seat }
        : { type: 'night.death', seat: target.seat, cause },
    )
    if (!target.alive) return
    if (ROLES[target.role].type === 'demon') {
      let successor =
        aliveBeforeDeath >= 5
          ? state.seats.find((seat) => seat.alive && seat.role === 'scarletwoman' && !seat.poisoned)
          : undefined
      if (!successor && cause === 'imp_suicide') {
        const candidates = state.seats
          .filter((seat) => seat.alive && ROLES[seat.role].type === 'minion')
          .map((seat) => seat.seat)
        let selected = candidates[0]
        if (candidates.length > 1) {
          await commit({
            type: 'discretion.requested',
            discretion: 'D14',
            candidates,
            source: 'random',
          })
          const choice = await ports.discretion('D14', candidates, state)
          if (typeof choice !== 'number' || !candidates.includes(choice))
            throw new Error('Invalid D14 successor')
          selected = choice
          await commit({ type: 'discretion.resolved', discretion: 'D14', choice, source: 'random' })
        }
        successor = state.seats.find((seat) => seat.seat === selected)
      }
      if (successor) {
        await commit({
          type: 'role.changed',
          seat: successor.seat,
          from: successor.role,
          to: 'imp',
        })
        await commit({ type: 'told', seat: successor.seat, kind: 'imp', content: { role: 'imp' } })
      }
    }
    if (cause !== 'execution' && (target.believedRole ?? target.role) === 'ravenkeeper') {
      const targets = await nightChoice(target)
      if (stopped()) return
      const selected = state.seats.find((player) => player.seat === targets[0])
      if (!selected) throw new Error('Ravenkeeper target does not exist')
      const result = { target: selected.seat, role: registeredRole(selected) }
      await commit({
        type: 'ability.resolved',
        seat: target.seat,
        role: target.role,
        result,
        deviated: false,
      })
      await commit({
        type: 'told',
        seat: target.seat,
        kind: 'ability',
        content: { role: 'ravenkeeper', result },
      })
    }
    const result = winner(state)
    if (result) await commit({ type: 'game.ended', ...result })
  }

  const firstInformation = async (
    seat: SeatState,
    discretion: 'D4' | 'D5' | 'D6',
    type: 'townsfolk' | 'outsider' | 'minion',
  ) => {
    const others = state.seats.filter((player) => player.seat !== seat.seat)
    const candidates: (number | PairInformation)[] = []
    for (let left = 0; left < others.length; left++) {
      for (let right = left + 1; right < others.length; right++) {
        const a = others[left]
        const b = others[right]
        if (!a || !b) throw new Error('Missing information candidate seat')
        for (const role of new Set([registeredRole(a), registeredRole(b)])) {
          if (ROLES[role].type === type) candidates.push({ seats: [a.seat, b.seat], role })
        }
      }
    }
    if (candidates.length === 0 && type !== 'townsfolk') candidates.push(0)
    let result = candidates[0]
    if (result === undefined) throw new Error('Information has no legal candidates')
    if (candidates.length > 1) {
      await commit({ type: 'discretion.requested', discretion, candidates, source: 'random' })
      const choice = await ports.discretion(discretion, candidates, state)
      result = candidates.find((candidate) => JSON.stringify(candidate) === JSON.stringify(choice))
      if (result === undefined) throw new Error(`Invalid ${discretion} information`)
      await commit({ type: 'discretion.resolved', discretion, choice: result, source: 'random' })
    }
    await commit({
      type: 'ability.resolved',
      seat: seat.seat,
      role: seat.role,
      result,
      deviated: false,
    })
    await commit({
      type: 'told',
      seat: seat.seat,
      kind: 'ability',
      content: { role: seat.role, result },
    })
  }

  const handlers: Partial<Record<RoleId, (seat: SeatState) => Promise<void>>> = {
    washerwoman: (seat) => firstInformation(seat, 'D4', 'townsfolk'),
    librarian: (seat) => firstInformation(seat, 'D5', 'outsider'),
    investigator: (seat) => firstInformation(seat, 'D6', 'minion'),
    fortuneteller: async (seat) => {
      const targets = await nightChoice(seat)
      if (stopped()) return
      const result = state.seats.some(
        (player) =>
          targets.includes(player.seat) &&
          (ROLES[registeredRole(player)].type === 'demon' || player.seat === state.redHerring),
      )
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'fortuneteller',
        result,
        deviated: false,
      })
      await commit({
        type: 'told',
        seat: seat.seat,
        kind: 'ability',
        content: { role: 'fortuneteller', result },
      })
    },
    undertaker: async (seat) => {
      const target = state.seats.find((player) => player.seat === state.executedToday)
      if (!target) return
      const result = { target: target.seat, role: registeredRole(target) }
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'undertaker',
        result,
        deviated: false,
      })
      await commit({
        type: 'told',
        seat: seat.seat,
        kind: 'ability',
        content: { role: 'undertaker', result },
      })
    },
    chef: async (seat) => {
      let result = 0
      for (let index = 0; index < state.seats.length; index++) {
        const current = state.seats[index]
        const next = state.seats[(index + 1) % state.seats.length]
        if (
          current &&
          next &&
          registeredAlignment(current) === 'evil' &&
          registeredAlignment(next) === 'evil'
        )
          result++
      }
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'chef',
        result,
        deviated: false,
      })
      await commit({
        type: 'told',
        seat: seat.seat,
        kind: 'ability',
        content: { role: 'chef', result },
      })
    },
    empath: async (seat) => {
      const alive = state.seats.filter((player) => player.alive)
      const index = alive.findIndex((player) => player.seat === seat.seat)
      const neighbors = [
        alive[(index + alive.length - 1) % alive.length],
        alive[(index + 1) % alive.length],
      ]
      const result = neighbors.filter(
        (neighbor) => neighbor && registeredAlignment(neighbor) === 'evil',
      ).length
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'empath',
        result,
        deviated: false,
      })
      await commit({
        type: 'told',
        seat: seat.seat,
        kind: 'ability',
        content: { role: 'empath', result },
      })
    },
    imp: async (seat) => {
      const targets = await nightChoice(seat)
      if (stopped()) return
      const target = state.seats.find((player) => player.seat === targets[0])
      if (!target) throw new Error('Night target does not exist')
      const outcome = seat.poisoned
        ? 'inactive'
        : !target.alive
          ? 'dead'
          : target.protected
            ? 'protected'
            : target.role === 'soldier' && !target.poisoned
              ? 'soldier'
              : 'killed'
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'imp',
        result: { target: target.seat, outcome },
        deviated: false,
      })
      if (outcome === 'killed')
        await kill(target, target.seat === seat.seat ? 'imp_suicide' : 'imp')
    },
  }

  const conversation = async (members: number[], room?: SpeechRequest['room']) => {
    const day = state.day
    const remaining = new Map(members.map((seat) => [seat, ports.config.speechLimit]))
    let lastSpeaker: number | null = null
    while (!stopped()) {
      const batch: SpeechRequest[] = members.flatMap((seat) => {
        const allowance = remaining.get(seat) ?? 0
        return seat !== lastSpeaker && allowance > 0
          ? [
              {
                tool: 'speak',
                seat,
                day,
                kind: room ? 'whisper' : 'free',
                remaining: allowance,
                ...(room && { room }),
              },
            ]
          : []
      })
      if (!batch.length) break
      const choices = await ports.askContestants(batch)
      if (
        choices.length !== batch.length ||
        choices.some((choice, index) => {
          const request = batch[index]
          return !request || validateSpeechChoice(choice, request).length !== 0
        })
      )
        throw new Error('Invalid speech choice from ports')
      for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
      if (stopped()) break
      const offers = batch.flatMap((request, index) => {
        const choice = choices[index] as SpeechChoice
        return choice.speech === null ? [] : [{ request, choice, speech: choice.speech }]
      })
      if (!offers.length) break
      const highest = Math.max(...offers.map(({ request }) => request.remaining ?? 0))
      const candidates = offers.filter(({ request }) => request.remaining === highest)
      const selected =
        candidates.length === 1
          ? candidates[0]
          : candidates[Math.floor(ports.rng() * candidates.length)]
      if (!selected) throw new Error('No speech selected')
      const { request, choice, speech } = selected
      await commit(
        room
          ? {
              type: 'whisper.speech',
              round: room.round,
              roomId: room.id,
              members,
              seat: request.seat,
              speech,
              decision: choice.decision ?? 0,
            }
          : {
              type: 'public.speech',
              seat: request.seat,
              speech,
              kind: 'free',
              ...(choice.slayer_target !== null && { slayerTarget: choice.slayer_target }),
              decision: choice.decision ?? 0,
            },
      )
      remaining.set(request.seat, (request.remaining ?? 0) - 1)
      lastSpeaker = request.seat
      // shortcut: real Slayer shots arrive with daytime role abilities; this role pool only has fake shots.
      if (!room && choice.slayer_target !== null)
        await commit({
          type: 'slayer.resolved',
          seat: request.seat,
          target: choice.slayer_target,
          died: false,
        })
    }
  }

  const whisperPhase = async () => {
    const remaining = new Map(state.seats.map((seat) => [seat.seat, ports.config.whisperLimit]))
    for (let round = 1; !stopped(); round++) {
      const eligible = state.seats
        .map((seat) => seat.seat)
        .filter((seat) => (remaining.get(seat) ?? 0) > 0)
      if (!eligible.length) break
      const proposals: ContestantRequest[] = eligible.map((seat) => ({
        tool: 'propose_whisper',
        seat,
        day: state.day,
        round,
        remaining: remaining.get(seat) ?? 0,
        eligible,
      }))
      const choices =
        eligible.length > 1
          ? await ports.askContestants(proposals)
          : [{ reasoning: '', members: null }]
      for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
      if (stopped()) return
      if (
        choices.length !== proposals.length ||
        choices.some(
          (choice, index) =>
            !proposals[index] || validateContestantChoice(choice, proposals[index]).length,
        )
      )
        throw new Error('Invalid whisper proposal from ports')
      const rooms: { id: number; members: number[] }[] = []
      for (const [index, choice] of choices.entries()) {
        const request = proposals[index]
        if (!request || !('members' in choice)) throw new Error('Missing whisper proposal')
        const members =
          choice.members === null ? null : [request.seat, ...choice.members].sort((a, b) => a - b)
        await commit({ type: 'whisper.proposed', seat: request.seat, round, members })
        if (members && !rooms.some((room) => room.members.join(',') === members.join(',')))
          rooms.push({ id: rooms.length + 1, members })
      }
      const rankings: ContestantRequest[] = []
      for (const seat of state.seats) {
        const candidates = rooms.filter((room) => room.members.includes(seat.seat))
        await commit({ type: 'whisper.candidates', seat: seat.seat, round, rooms: candidates })
        if (candidates.length)
          rankings.push({
            tool: 'rank_whispers',
            seat: seat.seat,
            day: state.day,
            round,
            rooms: candidates,
          })
        else await commit({ type: 'whisper.ranked', seat: seat.seat, round, ranking: [] })
      }
      const ranked = rankings.length ? await ports.askContestants(rankings) : []
      for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
      if (stopped()) return
      if (
        ranked.length !== rankings.length ||
        ranked.some(
          (choice, index) =>
            !rankings[index] || validateContestantChoice(choice, rankings[index]).length,
        )
      )
        throw new Error('Invalid whisper ranking from ports')
      const bySeat = new Map<number, number[]>()
      for (const [index, choice] of ranked.entries()) {
        const request = rankings[index]
        if (!request || !('ranking' in choice)) throw new Error('Missing whisper ranking')
        bySeat.set(request.seat, choice.ranking)
        await commit({ type: 'whisper.ranked', seat: request.seat, round, ranking: choice.ranking })
      }
      const accepted = rooms
        .filter((room) => room.members.every((seat) => bySeat.get(seat)?.includes(room.id)))
        .map((room) => ({
          ...room,
          score: room.members.reduce(
            (sum, seat) => sum + (bySeat.get(seat)?.indexOf(room.id) ?? 0) + 1,
            0,
          ),
          tie: ports.rng(),
        }))
        .sort((a, b) => a.score - b.score || a.tie - b.tie)
      const assigned = new Set<number>()
      const opened = accepted.filter((room) => {
        if (room.members.some((seat) => assigned.has(seat))) return false
        for (const seat of room.members) assigned.add(seat)
        return true
      })
      if (!opened.length) break
      for (const room of opened) {
        for (const seat of room.members) remaining.set(seat, (remaining.get(seat) ?? 0) - 1)
        await commit({
          type: 'whisper.room.opened',
          round,
          roomId: `${String(state.day)}:${String(round)}:${String(room.id)}`,
          members: room.members,
        })
      }
      await Promise.all(
        opened.map(async (room) => {
          const roomId = `${String(state.day)}:${String(round)}:${String(room.id)}`
          await conversation(room.members, { round, id: roomId, members: room.members })
          if (!stopped())
            await commit({ type: 'whisper.room.closed', round, roomId, members: room.members })
        }),
      )
    }
  }

  for (let day = 1; !stopped(); day++) {
    await commit({ type: 'phase.started', day, phase: day === 1 ? 'first-night' : 'night' })
    const nightStart = state.seq
    const order = day === 1 ? 'firstNight' : 'otherNight'
    const actors = state.seats
      .filter((seat) => handlers[seat.role] && ROLES[seat.role][order] !== null)
      .sort((a, b) => (ROLES[a.role][order] ?? 0) - (ROLES[b.role][order] ?? 0))
    for (const actor of actors) {
      const seat = state.seats.find((player) => player.seat === actor.seat)
      if (seat?.alive) await handlers[seat.role]?.(seat)
      if (stopped()) return state
    }
    const deaths = ports.log.flatMap((event) =>
      event.seq > nightStart && event.type === 'night.death' ? [event.seat] : [],
    )
    await commit({ type: 'phase.started', day, phase: 'dawn' })
    await commit({ type: 'dawn.announced', day, deaths })
    if (ports.config.whisperLimit > 0) {
      await commit({ type: 'phase.started', day, phase: 'whisper' })
      await whisperPhase()
      if (stopped()) return state
    }
    await commit({ type: 'phase.started', day, phase: 'public' })
    await conversation(state.seats.map((seat) => seat.seat))
    await commit({ type: 'phase.started', day, phase: 'nomination' })
    for (;;) {
      const publicState = foldPublic(ports.log, ports.config.seatCount)
      const nominees = state.seats
        .map((seat) => seat.seat)
        .filter((seat) => !publicState.nominees.includes(seat))
      const batch: ContestantRequest[] = state.seats
        .filter((seat) => seat.alive && !publicState.nominators.includes(seat.seat))
        .map((seat) => ({ tool: 'nominate', seat: seat.seat, day, nominees }))
      if (batch.length === 0 || nominees.length === 0) break
      const choices = await ports.askContestants(batch)
      for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
      if (stopped()) return state
      if (
        choices.length !== batch.length ||
        choices.some(
          (choice, index) =>
            !batch[index] || validateContestantChoice(choice, batch[index]).length !== 0,
        )
      )
        throw new Error('Invalid nomination from ports')
      const submitted = choices.flatMap((choice, index) =>
        'nominee' in choice && choice.nominee !== null
          ? [{ nominator: batch[index]?.seat, nominee: choice.nominee }]
          : [],
      )
      if (submitted.length === 0) break
      const selected = submitted[Math.floor(ports.rng() * submitted.length)]
      if (selected?.nominator === undefined) throw new Error('Missing nomination')
      const { nominator, nominee } = selected
      await commit({ type: 'nomination', nominator, nominee })
      for (const [seat, kind] of [
        [nominator, 'nomination'],
        [nominee, 'defense'],
      ] as const) {
        const request: SpeechRequest = { tool: 'speak', seat, day, kind, nominator, nominee }
        const speeches = await ports.askContestants([request])
        for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
        if (stopped()) return state
        const speech = speeches[0]
        if (
          speeches.length !== 1 ||
          !speech ||
          !('speech' in speech) ||
          typeof speech.speech !== 'string' ||
          validateSpeechChoice(speech, request).length !== 0
        )
          throw new Error('Invalid nomination speech from ports')
        const decision =
          speech.decision ??
          ports.log.findLast((event) => event.type === 'contestant.decision' && event.seat === seat)
            ?.seq
        if (decision === undefined) throw new Error('Missing speech decision')
        await commit({ type: 'public.speech', seat, kind, speech: speech.speech, decision })
      }
      const votes: { seat: number; raiseHand: boolean }[] = []
      const threshold = Math.ceil(state.seats.filter((seat) => seat.alive).length / 2)
      for (let offset = 0; offset < state.seats.length; offset++) {
        const seatNumber = ((nominee + offset) % state.seats.length) + 1
        const voter = state.seats.find((seat) => seat.seat === seatNumber)
        if (!voter) throw new Error('Missing voter')
        const canRaiseHand = voter.alive || !voter.voteUsed
        const request: ContestantRequest = {
          tool: 'vote',
          seat: voter.seat,
          day,
          nominator,
          nominee,
          votes: [...votes],
          threshold,
          highestVoteCount: publicState.highestVoteCount,
          canRaiseHand,
        }
        let raiseHand = false
        if (canRaiseHand) {
          const choices = await ports.askContestants([request])
          for (const event of ports.log) if (event.seq > state.seq) state = apply(state, event)
          if (stopped()) return state
          const choice = choices[0]
          if (
            choices.length !== 1 ||
            !choice ||
            !('raise_hand' in choice) ||
            validateContestantChoice(choice, request).length !== 0
          )
            throw new Error('Invalid vote from ports')
          raiseHand = choice.raise_hand
        }
        votes.push({ seat: voter.seat, raiseHand })
        await commit({
          type: 'vote',
          seat: voter.seat,
          raiseHand,
          voteUsed: !voter.alive && raiseHand,
        })
      }
      const count = votes.filter((vote) => vote.raiseHand).length
      await commit({
        type: 'vote.tallied',
        nominee,
        votes: count,
        threshold,
        aboutToBeExecuted: count >= threshold && count > publicState.highestVoteCount,
      })
    }
    const candidate = foldPublic(ports.log, ports.config.seatCount).aboutToBeExecuted
    if (candidate !== null) {
      const target = state.seats.find((seat) => seat.seat === candidate)
      if (!target) throw new Error('Missing execution candidate')
      await kill(target, 'execution')
      if (stopped()) return state
    }
    const result = winner(state)
    if (result) await commit({ type: 'game.ended', ...result })
  }
  return state
}
