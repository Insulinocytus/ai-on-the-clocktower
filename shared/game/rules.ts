import type {
  Alignment,
  ContestantRequest,
  SpeechRequest,
  GameEvent,
  GameEventInput,
  Grimoire,
  NightRequest,
  Observer,
  Ports,
  PublicState,
  RoleId,
  SeatState,
  ValidationError,
} from '../types/game'
import { ROLES } from './roles'

// shortcut: five seats and five roles only; remove with full-role setup and demon succession ticket.
const ROLE_POOL: readonly RoleId[] = ['soldier', 'chef', 'empath', 'scarletwoman', 'imp']

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
  const roles = [...ROLE_POOL]
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
          event.phase === 'first-night' || event.phase === 'night' ? null : state.executedToday,
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
    choice.targets.length !== 1 ||
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

function validateSpeechChoice(value: unknown, request: SpeechRequest): ValidationError[] {
  const choice =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const errors: ValidationError[] = []
  if (typeof choice.reasoning !== 'string') errors.push({ code: 'invalid_reasoning' })
  if (typeof choice.speech !== 'string' || choice.speech.trim().length === 0)
    errors.push({ code: 'invalid_speech' })
  if (choice.slayer_target !== null || request.kind === 'free')
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
    const result = winner(state)
    if (result) await commit({ type: 'game.ended', ...result })
  }

  const handlers: Partial<Record<RoleId, (seat: SeatState) => Promise<void>>> = {
    chef: async (seat) => {
      let result = 0
      for (let index = 0; index < state.seats.length; index++) {
        const current = state.seats[index]
        const next = state.seats[(index + 1) % state.seats.length]
        if (current?.alignment === 'evil' && next?.alignment === 'evil') result++
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
      const result = neighbors.filter((neighbor) => neighbor?.alignment === 'evil').length
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
      const request: NightRequest = {
        tool: 'night_choice',
        seat: seat.seat,
        role: 'imp',
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
      if (state.ended || state.aborted) return
      await commit({ type: 'night.choice', seat: seat.seat, role: 'imp', targets: choice.targets })
      const target = state.seats.find((player) => player.seat === choice.targets[0])
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

  // shortcut: conversations are added by the public discussion and whisper tickets.
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
