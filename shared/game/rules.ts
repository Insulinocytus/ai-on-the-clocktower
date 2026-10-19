import type {
  Alignment,
  ContestantRequest,
  DiscretionCandidates,
  DiscretionChoice,
  DiscretionDetails,
  DiscretionId,
  GameEvent,
  GameEventInput,
  Grimoire,
  InformationResult,
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

const ROLE_POOL = Object.values(ROLES).map((role) => role.id)
export const DISCRETION_IDS = [
  'D1',
  'seating',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'D8',
  'D10',
  'D11',
  'D12',
  'D13',
  'D14',
] as const

export function validateDiscretionChoice(
  choice: unknown,
  candidates: DiscretionCandidates,
  seatCount: number,
): ValidationError[] {
  if (Array.isArray(candidates))
    return candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(choice))
      ? []
      : [{ code: 'invalid_discretion' }]
  if (!Array.isArray(choice) || !choice.every((role: unknown) => typeof role === 'string'))
    return [{ code: 'invalid_discretion' }]
  if (choice.length !== seatCount) return [{ code: 'invalid_seat_count' }]
  const errors = validate(choice)
  if (
    candidates.type === 'seating' &&
    (choice.length !== candidates.roles.length ||
      !candidates.roles.every((role) => choice.includes(role)))
  )
    errors.push({ code: 'invalid_discretion' })
  return errors
}

export function setupCounts(seatCount: number) {
  if (!Number.isInteger(seatCount) || seatCount < 5 || seatCount > 15)
    throw new Error('Invalid seat count')
  const minions = Math.max(1, Math.floor((seatCount - 4) / 3))
  const townsfolk = seatCount < 7 ? 3 : 2 * minions + 3
  return { townsfolk, outsiders: seatCount - townsfolk - minions - 1, minions }
}

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
  if (roles.length < 5 || roles.length > 15) errors.push({ code: 'invalid_seat_count' })
  if (new Set(roles).size !== roles.length) errors.push({ code: 'duplicate_role' })
  if (roles.some((role) => !ROLE_POOL.some((allowed) => allowed === role))) {
    errors.push({ code: 'unsupported_role' })
  }
  const types = roles.map((role) =>
    Object.hasOwn(ROLES, role) ? ROLES[role as RoleId].type : undefined,
  )
  if (roles.filter((role) => role === 'imp').length !== 1) errors.push({ code: 'invalid_demon' })
  const counts = roles.length >= 5 && roles.length <= 15 ? setupCounts(roles.length) : null
  const baron = roles.includes('baron') ? 2 : 0
  if (
    !counts ||
    types.filter((type) => type === 'townsfolk').length !== counts.townsfolk - baron ||
    types.filter((type) => type === 'outsider').length !== counts.outsiders + baron ||
    types.filter((type) => type === 'minion').length !== counts.minions ||
    types.filter((type) => type === 'demon').length !== 1
  ) {
    errors.push({ code: 'invalid_role_counts' })
  }
  // Both D4 seats exclude the recipient, so a sole Townsfolk Washerwoman has no legal truth.
  if (roles.includes('washerwoman') && types.filter((type) => type === 'townsfolk').length === 1)
    errors.push({ code: 'no_washerwoman_truth' })
  return errors
}

export function sample(rng: () => number, seatCount = 5): RoleId[] {
  const counts = setupCounts(seatCount)
  const minions = ROLE_POOL.filter((role) => ROLES[role].type === 'minion')
  const roles: RoleId[] = ['imp']
  for (let index = 0; index < counts.minions; index++) {
    const [role] = minions.splice(Math.floor(rng() * minions.length), 1)
    if (role) roles.push(role)
  }
  const baron = roles.includes('baron') ? 2 : 0
  const townsfolk = ROLE_POOL.filter(
    (role) =>
      ROLES[role].type === 'townsfolk' &&
      (counts.townsfolk - baron !== 1 || role !== 'washerwoman'),
  )
  const outsiders = ROLE_POOL.filter((role) => ROLES[role].type === 'outsider')
  for (const [pool, count] of [
    [townsfolk, counts.townsfolk - baron],
    [outsiders, counts.outsiders + baron],
  ] as const) {
    for (let index = 0; index < count; index++) {
      const [role] = pool.splice(Math.floor(rng() * pool.length), 1)
      if (role) roles.push(role)
    }
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
        bluffs: event.bluffs ?? state.bluffs,
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
    bluffs: [],
    winner: null,
    ended: false,
    aborted: false,
    executedToday: null,
  })
}

export function foldPublic(events: readonly GameEvent[], seatCount = 5): PublicState {
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
        typeof target === 'number' &&
        Number.isInteger(target) &&
        request.targets.includes(target) &&
        ((request.role !== 'monk' && request.role !== 'butler') || target !== request.seat),
    )
  ) {
    errors.push({ code: 'invalid_targets' })
  }
  if (choice.memo !== undefined && (typeof choice.memo !== 'string' || choice.memo.length > 2000))
    errors.push({ code: 'invalid_memo' })
  return errors
}

export function validateSpeechChoice(
  value: unknown,
  request: SpeechRequest,
  seatCount = 5,
): ValidationError[] {
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
      choice.slayer_target > seatCount)
  )
    errors.push({ code: 'invalid_slayer_target' })
  if (choice.memo !== undefined && (typeof choice.memo !== 'string' || choice.memo.length > 2000))
    errors.push({ code: 'invalid_memo' })
  return errors
}

export function validateContestantChoice(
  value: unknown,
  request: ContestantRequest,
  seatCount = 5,
): ValidationError[] {
  if (request.tool === 'night_choice') return validateNightChoice(value, request)
  if (request.tool === 'speak') return validateSpeechChoice(value, request, seatCount)
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
export function winner(
  state: Grimoire,
  endOfDay = false,
): { winner: Alignment; reason: string } | null {
  if (!state.seats.some((seat) => seat.alive && ROLES[seat.role].type === 'demon')) {
    return { winner: 'good', reason: 'all_demons_dead' }
  }
  if (
    endOfDay &&
    state.executedToday === null &&
    state.seats.filter((seat) => seat.alive).length === 3 &&
    state.seats.some((seat) => seat.alive && seat.role === 'mayor' && functioning(seat))
  )
    return { winner: 'good', reason: 'mayor' }
  if (state.seats.filter((seat) => seat.alive).length <= 2)
    return { winner: 'evil', reason: 'two_alive' }
  return null
}

function functioning(seat: SeatState): boolean {
  return seat.role !== 'drunk' && !seat.poisoned
}

function registeredAlignment(seat: SeatState): Alignment {
  return functioning(seat) && (seat.role === 'spy' || seat.role === 'recluse')
    ? (seat.registeredAlignment ?? seat.alignment)
    : seat.alignment
}

function registeredRole(seat: SeatState): RoleId {
  return functioning(seat) && (seat.role === 'spy' || seat.role === 'recluse')
    ? (seat.registeredRole ?? seat.role)
    : seat.role
}

export async function runGame(ports: Ports): Promise<Grimoire> {
  let state = fold(ports.log)
  let executionDeath: number | null = null
  const stopped = () => state.ended || state.aborted
  const commit = async (input: GameEventInput) => {
    const event = await ports.commit(input)
    state = apply(state, event)
  }
  const discretion = async (
    id: DiscretionId,
    candidates: DiscretionCandidates,
    context?: DiscretionDetails,
  ): Promise<DiscretionChoice> => {
    if (Array.isArray(candidates) && candidates.length === 1 && candidates[0] !== undefined)
      return candidates[0]
    const source = ports.config.discretions[id]
    const requested = await ports.commit({
      type: 'discretion.requested',
      discretion: id,
      candidates,
      source,
      ...(context && { context }),
    })
    state = apply(state, requested)
    const result = await ports.discretion(
      id,
      candidates,
      { ...state, discretion: context },
      requested.seq,
    )
    if (validateDiscretionChoice(result.choice, candidates, ports.config.seatCount).length)
      throw new Error(`Invalid ${id} choice`)
    await commit({ type: 'discretion.resolved', discretion: id, ...result, source })
    return result.choice
  }
  if (stopped()) return state
  const newSetup = state.seats.length === 0
  if (state.seats.length === 0) {
    const candidates = {
      type: 'setup' as const,
      sample: sample(() => ports.rng(), ports.config.seatCount),
    }
    let choice = await discretion('D1', candidates)
    if (
      !Array.isArray(choice) ||
      !choice.every((role): role is RoleId => typeof role === 'string') ||
      choice.length !== ports.config.seatCount ||
      validate(choice).length !== 0
    )
      throw new Error('Invalid D1 setup')
    if (ports.config.discretions.seating !== ports.config.discretions.D1) {
      const roles = choice
      const shuffled = roles.slice()
      for (let index = shuffled.length - 1; index > 0; index--) {
        const other = Math.floor(ports.rng() * (index + 1))
        const role = shuffled[index]
        const replacement = shuffled[other]
        if (role !== undefined && replacement !== undefined) {
          shuffled[index] = replacement
          shuffled[other] = role
        }
      }
      const seated = await discretion('seating', { type: 'seating', roles, sample: shuffled })
      if (
        !Array.isArray(seated) ||
        !seated.every((role): role is RoleId => typeof role === 'string')
      )
        throw new Error('Invalid seating')
      choice = seated
    }
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
  }
  for (const drunk of state.seats.filter((seat) => seat.role === 'drunk' && !seat.believedRole)) {
    const candidates = Object.values(ROLES)
      .filter(
        (role) => role.type === 'townsfolk' && !state.seats.some((seat) => seat.role === role.id),
      )
      .map((role) => role.id)
    let choice = candidates[0]
    if (!choice) throw new Error('No absent Townsfolk for Drunk')
    if (candidates.length > 1) {
      const selected = await discretion('D2', candidates)
      if (typeof selected !== 'string' || !candidates.includes(selected))
        throw new Error('Invalid D2 identity')
      choice = selected
    }
    await commit({
      type: 'grimoire.set',
      seats: state.seats.map((seat) =>
        seat.seat === drunk.seat ? { ...seat, believedRole: choice } : seat,
      ),
      redHerring: state.redHerring,
    })
    if (!newSetup)
      await commit({ type: 'told', seat: drunk.seat, kind: 'role', content: { role: choice } })
  }
  if (newSetup)
    for (const seat of state.seats)
      await commit({
        type: 'told',
        seat: seat.seat,
        kind: 'role',
        content: { role: seat.believedRole ?? seat.role },
      })

  if (state.redHerring === null && state.seats.some((seat) => seat.role === 'fortuneteller')) {
    const candidates = state.seats
      .filter((seat) => seat.alignment === 'good')
      .map((seat) => seat.seat)
    let choice = candidates[0]
    if (choice === undefined) throw new Error('No good Fortune Teller red herring')
    if (candidates.length > 1) {
      const selected = await discretion('D3', candidates)
      if (typeof selected !== 'number' || !candidates.includes(selected))
        throw new Error('Invalid D3 red herring')
      choice = selected
    }
    await commit({ type: 'grimoire.set', seats: state.seats, redHerring: choice })
  }
  if (ports.config.seatCount >= 7 && state.bluffs.length === 0) {
    const absent = Object.values(ROLES)
      .filter(
        (role) => role.alignment === 'good' && !state.seats.some((seat) => seat.role === role.id),
      )
      .map((role) => role.id)
    const candidates: RoleId[][] = []
    for (let first = 0; first < absent.length; first++)
      for (let second = first + 1; second < absent.length; second++)
        for (let third = second + 1; third < absent.length; third++) {
          const a = absent[first]
          const b = absent[second]
          const c = absent[third]
          if (a && b && c) candidates.push([a, b, c])
        }
    let choice = candidates[0]
    if (!choice) throw new Error('No legal Demon bluffs')
    if (candidates.length > 1) {
      const selected = await discretion('D7', candidates)
      const legal = candidates.find(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(selected),
      )
      if (!legal) throw new Error('Invalid D7 bluffs')
      choice = legal
    }
    await commit({
      type: 'grimoire.set',
      seats: state.seats,
      redHerring: state.redHerring,
      bluffs: choice,
    })
  }
  for (const role of ['spy', 'recluse'] as const) {
    const seat = state.seats.find((player) => player.role === role)
    if (!seat || (seat.registeredRole && seat.registeredAlignment)) continue
    const id = role === 'spy' ? 'D10' : 'D11'
    const roles = Object.values(ROLES).filter(
      (candidate) => candidate.id === role || candidate.alignment !== ROLES[role].alignment,
    )
    const candidates = (['good', 'evil'] as const).flatMap((alignment) =>
      roles.map((candidate) => ({ alignment, role: candidate.id })),
    )
    const selected = await discretion(id, candidates, { seat: seat.seat, role })
    const choice = candidates.find(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(selected),
    )
    if (!choice) throw new Error(`Invalid ${id} registration`)
    await commit({
      type: 'grimoire.set',
      seats: state.seats.map((player) =>
        player.seat === seat.seat
          ? { ...player, registeredRole: choice.role, registeredAlignment: choice.alignment }
          : player,
      ),
      redHerring: state.redHerring,
    })
  }

  const nightChoice = async (seat: SeatState): Promise<number[]> => {
    const role = seat.believedRole ?? seat.role
    const request: NightRequest = {
      tool: 'night_choice',
      seat: seat.seat,
      role,
      day: state.day,
      targets: state.seats
        .filter((player) => (role !== 'monk' && role !== 'butler') || player.seat !== seat.seat)
        .map((player) => player.seat),
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

  const information = async (
    seat: SeatState,
    result: InformationResult,
    candidates: InformationResult[],
    truths: InformationResult[] = [result],
  ) => {
    let told = result
    if (!functioning(seat)) {
      const first = candidates[0]
      if (first === undefined) throw new Error('Information has no D8 candidates')
      told = first
      if (candidates.length > 1) {
        const choice = await discretion('D8', candidates, {
          seat: seat.seat,
          role: seat.believedRole ?? seat.role,
          truth: truths,
          reason: seat.role === 'drunk' ? 'drunk' : 'poisoned',
        })
        const selected = candidates.find(
          (candidate) => JSON.stringify(candidate) === JSON.stringify(choice),
        )
        if (selected === undefined) throw new Error('Invalid D8 information')
        told = selected
      }
    }
    await commit({
      type: 'ability.resolved',
      seat: seat.seat,
      role: seat.role,
      result,
      deviated: !truths.some((truth) => JSON.stringify(truth) === JSON.stringify(told)),
      ...(!functioning(seat) && { reason: seat.role === 'drunk' ? 'drunk' : 'poisoned' }),
    })
    await commit({
      type: 'told',
      seat: seat.seat,
      kind: 'ability',
      content: { role: seat.believedRole ?? seat.role, result: told },
    })
  }

  const clearPoison = async () => {
    for (const seat of state.seats)
      if (seat.poisoned)
        await commit({ type: 'status.changed', seat: seat.seat, status: 'poisoned', value: false })
  }

  const kill = async (
    target: SeatState,
    cause: 'imp' | 'imp_suicide' | 'execution' | 'slayer',
    shooter?: number,
  ) => {
    if (!target.alive && cause !== 'execution') return
    const aliveBeforeDeath = state.seats.filter((seat) => seat.alive).length
    if (cause === 'slayer') {
      if (shooter === undefined) throw new Error('Missing Slayer shooter')
      await commit({ type: 'slayer.resolved', seat: shooter, target: target.seat, died: true })
    } else {
      await commit(
        cause === 'execution'
          ? { type: 'execution', seat: target.seat }
          : { type: 'night.death', seat: target.seat, cause },
      )
    }
    if (!target.alive) return
    if (cause === 'execution') executionDeath = target.seat
    if (ROLES[target.role].type === 'demon') {
      let successor =
        aliveBeforeDeath >= 5
          ? state.seats.find(
              (seat) => seat.alive && seat.role === 'scarletwoman' && functioning(seat),
            )
          : undefined
      if (!successor && cause === 'imp_suicide') {
        const candidates = state.seats
          .filter((seat) => seat.alive && ROLES[seat.role].type === 'minion')
          .map((seat) => seat.seat)
        let selected = candidates[0]
        if (candidates.length > 1) {
          const choice = await discretion('D14', candidates, {
            seat: target.seat,
            role: target.role,
          })
          if (typeof choice !== 'number' || !candidates.includes(choice))
            throw new Error('Invalid D14 successor')
          selected = choice
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
        if (successor.role === 'poisoner') await clearPoison()
        await commit({ type: 'told', seat: successor.seat, kind: 'imp', content: { role: 'imp' } })
      }
    }
    if (target.role === 'poisoner') await clearPoison()
    if (
      (cause === 'imp' || cause === 'imp_suicide') &&
      (target.believedRole ?? target.role) === 'ravenkeeper'
    ) {
      const targets = await nightChoice(target)
      if (stopped()) return
      const selected = state.seats.find((player) => player.seat === targets[0])
      if (!selected) throw new Error('Ravenkeeper target does not exist')
      const result = { target: selected.seat, role: registeredRole(selected) }
      await information(
        target,
        result,
        Object.values(ROLES).map((role) => ({ target: selected.seat, role: role.id })),
      )
    }
    const result = winner(state)
    if (
      cause === 'execution' &&
      target.role === 'saint' &&
      functioning(target) &&
      result?.winner !== 'good'
    )
      await commit({ type: 'game.ended', winner: 'evil', reason: 'saint_executed' })
    else if (result) await commit({ type: 'game.ended', ...result })
  }

  const firstInformation = async (
    seat: SeatState,
    id: 'D4' | 'D5' | 'D6',
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
    if (functioning(seat) && candidates.length > 1) {
      const choice = await discretion(id, candidates, {
        seat: seat.seat,
        role: seat.believedRole ?? seat.role,
        truth: candidates,
      })
      result = candidates.find((candidate) => JSON.stringify(candidate) === JSON.stringify(choice))
      if (result === undefined) throw new Error(`Invalid ${id} information`)
    }
    const impaired: InformationResult[] = []
    if (!functioning(seat)) {
      for (let left = 0; left < others.length; left++) {
        for (let right = left + 1; right < others.length; right++) {
          const a = others[left]
          const b = others[right]
          if (!a || !b) throw new Error('Missing information candidate seat')
          for (const role of Object.values(ROLES)) {
            if (role.type === type) impaired.push({ seats: [a.seat, b.seat], role: role.id })
          }
        }
      }
      if (type === 'outsider') impaired.push(0)
    }
    await information(seat, result, impaired, candidates)
  }

  const handlers: Partial<Record<RoleId, (seat: SeatState) => Promise<void>>> = {
    spy: async (seat) => {
      const result = { seats: state.seats, redHerring: state.redHerring, bluffs: state.bluffs }
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'spy',
        result,
        deviated: false,
      })
      await commit({ type: 'told', seat: seat.seat, kind: 'grimoire', content: result })
    },
    poisoner: async (seat) => {
      const [target] = await nightChoice(seat)
      if (stopped() || target === undefined) return
      const effective = functioning(seat)
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: seat.role,
        result: effective ? target : { target, outcome: 'inactive' },
        deviated: false,
      })
      if (effective)
        await commit({ type: 'status.changed', seat: target, status: 'poisoned', value: true })
    },
    butler: async (seat) => {
      const [target] = await nightChoice(seat)
      if (stopped() || target === undefined) return
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: seat.role,
        result: functioning(seat) ? target : { target, outcome: 'inactive' },
        deviated: false,
      })
      if (functioning(seat))
        await commit({ type: 'status.changed', seat: seat.seat, status: 'master', value: target })
    },
    monk: async (seat) => {
      const [target] = await nightChoice(seat)
      if (stopped() || target === undefined) return
      const effective = functioning(seat)
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: seat.role,
        result: effective ? target : { target, outcome: 'inactive' },
        deviated: false,
      })
      if (effective)
        await commit({ type: 'status.changed', seat: target, status: 'protected', value: true })
    },
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
      await information(seat, result, [false, true])
    },
    undertaker: async (seat) => {
      const target = state.seats.find((player) => player.seat === executionDeath)
      if (!target) return
      const result = { target: target.seat, role: registeredRole(target) }
      await information(
        seat,
        result,
        Object.values(ROLES).map((role) => ({ target: target.seat, role: role.id })),
      )
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
      await information(
        seat,
        result,
        Array.from({ length: state.seats.length + 1 }, (_, index) => index),
      )
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
      await information(seat, result, [0, 1, 2])
    },
    imp: async (seat) => {
      const [selected] = await nightChoice(seat)
      if (stopped()) return
      let target = state.seats.find((player) => player.seat === selected)
      if (!target) throw new Error('Night target does not exist')
      const suicide = target.seat === seat.seat
      const mayorSeat = target.seat
      if (
        functioning(seat) &&
        target.alive &&
        target.role === 'mayor' &&
        functioning(target) &&
        !target.protected
      ) {
        const candidates = [false, true]
        const redirect = await discretion('D12', candidates, {
          seat: mayorSeat,
          role: 'mayor',
          truth: [false],
        })
        if (typeof redirect !== 'boolean') throw new Error('Invalid D12 redirect')
        if (redirect) {
          const candidates = state.seats
            .filter((player) => player.seat !== mayorSeat)
            .map((player) => player.seat)
          const choice = await discretion('D13', candidates, { seat: mayorSeat, role: 'mayor' })
          if (typeof choice !== 'number' || !candidates.includes(choice))
            throw new Error('Invalid D13 substitute')
          target = state.seats.find((player) => player.seat === choice)
          if (!target) throw new Error('Missing Mayor substitute')
        }
      }
      const outcome = !functioning(seat)
        ? 'inactive'
        : !target.alive
          ? 'dead'
          : target.protected
            ? 'protected'
            : target.role === 'soldier' && functioning(target)
              ? 'soldier'
              : 'killed'
      await commit({
        type: 'ability.resolved',
        seat: seat.seat,
        role: 'imp',
        result: { target: target.seat, outcome },
        deviated: false,
      })
      if (outcome === 'killed') await kill(target, suicide ? 'imp_suicide' : 'imp')
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
          return (
            !request || validateSpeechChoice(choice, request, ports.config.seatCount).length !== 0
          )
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
      if (!room && choice.slayer_target !== null) {
        const shooter = state.seats.find((seat) => seat.seat === request.seat)
        const target = state.seats.find((seat) => seat.seat === choice.slayer_target)
        const unused =
          shooter?.alive &&
          (shooter.believedRole ?? shooter.role) === 'slayer' &&
          !shooter.abilityUsed
        if (unused)
          await commit({
            type: 'status.changed',
            seat: shooter.seat,
            status: 'abilityUsed',
            value: true,
          })
        if (
          unused &&
          functioning(shooter) &&
          target?.alive &&
          ROLES[registeredRole(target)].type === 'demon'
        ) {
          await kill(target, 'slayer', shooter.seat)
          if (stopped()) return
        } else {
          await commit({
            type: 'slayer.resolved',
            seat: request.seat,
            target: choice.slayer_target,
            died: false,
          })
        }
      }
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
    if (day === 1 && ports.config.seatCount >= 7) {
      const minions = state.seats.filter((seat) => ROLES[seat.role].type === 'minion')
      const demon = state.seats.find((seat) => seat.role === 'imp')
      if (!demon) throw new Error('Missing initial Demon')
      for (const minion of minions)
        await commit({
          type: 'told',
          seat: minion.seat,
          kind: 'minion-info',
          content: {
            seats: state.seats
              .filter(
                (seat) =>
                  seat.seat !== minion.seat &&
                  (seat.role === 'imp' || ROLES[seat.role].type === 'minion'),
              )
              .map((seat) => seat.seat),
          },
        })
      await commit({
        type: 'told',
        seat: demon.seat,
        kind: 'demon-info',
        content: { seats: minions.map((seat) => seat.seat), bluffs: state.bluffs },
      })
    }
    for (const seat of state.seats)
      if (seat.protected)
        await commit({ type: 'status.changed', seat: seat.seat, status: 'protected', value: false })
    const nightStart = state.seq
    const order = day === 1 ? 'firstNight' : 'otherNight'
    const actors = state.seats
      .filter(
        (seat) =>
          handlers[seat.believedRole ?? seat.role] &&
          ROLES[seat.believedRole ?? seat.role][order] !== null,
      )
      .sort(
        (a, b) =>
          (ROLES[a.believedRole ?? a.role][order] ?? 0) -
          (ROLES[b.believedRole ?? b.role][order] ?? 0),
      )
    for (const actor of actors) {
      const seat = state.seats.find((player) => player.seat === actor.seat)
      if (seat?.alive && (seat.believedRole ?? seat.role) === (actor.believedRole ?? actor.role))
        await handlers[seat.believedRole ?? seat.role]?.(seat)
      if (stopped()) return state
    }
    const deaths = ports.log.flatMap((event) =>
      event.seq > nightStart && event.type === 'night.death' ? [event.seat] : [],
    )
    await commit({ type: 'phase.started', day, phase: 'dawn' })
    executionDeath = null
    await commit({ type: 'dawn.announced', day, deaths })
    if (ports.config.whisperLimit > 0) {
      await commit({ type: 'phase.started', day, phase: 'whisper' })
      await whisperPhase()
      if (stopped()) return state
    }
    await commit({ type: 'phase.started', day, phase: 'public' })
    await conversation(state.seats.map((seat) => seat.seat))
    if (stopped()) return state
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
      const virgin = state.seats.find((seat) => seat.seat === nominee)
      const nominatorSeat = state.seats.find((seat) => seat.seat === nominator)
      if (
        virgin?.alive &&
        (virgin.believedRole ?? virgin.role) === 'virgin' &&
        !virgin.abilityUsed
      ) {
        await commit({
          type: 'status.changed',
          seat: virgin.seat,
          status: 'abilityUsed',
          value: true,
        })
        if (
          functioning(virgin) &&
          nominatorSeat &&
          ROLES[registeredRole(nominatorSeat)].type === 'townsfolk'
        ) {
          await commit({ type: 'virgin.triggered', nominator })
          await kill(nominatorSeat, 'execution')
          if (stopped()) return state
          break
        }
      }
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
          validateSpeechChoice(speech, request, ports.config.seatCount).length !== 0
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
          ...((voter.believedRole ?? voter.role) === 'butler' && { master: voter.master }),
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
    if (candidate !== null && state.executedToday === null) {
      const target = state.seats.find((seat) => seat.seat === candidate)
      if (!target) throw new Error('Missing execution candidate')
      await kill(target, 'execution')
      if (stopped()) return state
    }
    const result = winner(state, true)
    if (result) await commit({ type: 'game.ended', ...result })
    if (!stopped()) await clearPoison()
  }
  return state
}
