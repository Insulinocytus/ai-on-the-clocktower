// Shared contract between the rules module, runtime, prompts, templates and UI.
// Pure types + a few constants; no I/O. Terminology follows GLOSSARY.md.

/** Bump when the event schema changes incompatibly; games with another version are not replayable. */
export const LOG_VERSION = 1

/** Seats are numbered 1..N clockwise. */
export type Seat = number
export type Lang = 'zh' | 'en'
export type Alignment = 'good' | 'evil'
export type RoleType = 'townsfolk' | 'outsider' | 'minion' | 'demon'
export type RoleId =
  | 'washerwoman' | 'librarian' | 'investigator' | 'chef' | 'empath' | 'fortuneteller' | 'undertaker'
  | 'monk' | 'ravenkeeper' | 'virgin' | 'slayer' | 'soldier' | 'mayor'
  | 'butler' | 'drunk' | 'recluse' | 'saint'
  | 'poisoner' | 'spy' | 'scarletwoman' | 'baron'
  | 'imp'

/** first_night is day 1's night; night N (N ≥ 2) precedes day N. dawn/whisper/public/nomination belong to day N. */
export type Phase = 'first_night' | 'night' | 'dawn' | 'whisper' | 'public' | 'nomination'

// ───────────────────────── Discretion ─────────────────────────

/** The 14 configurable discretion items. `seating` (分座) is configured separately from D1. */
export type DiscretionId =
  | 'D1' | 'seating' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8'
  | 'D10' | 'D11' | 'D12' | 'D13' | 'D14'
export const DISCRETION_IDS: readonly DiscretionId[] = [
  'D1', 'seating', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D10', 'D11', 'D12', 'D13', 'D14',
]
export type DiscretionSource = 'random' | 'storyteller' | 'manual'

/**
 * One value of a discretion / one piece of ability information. Same shape as the storyteller `decide` tool
 * (minus `reasoning`). Which fields are used depends on the discretion:
 * - D1 / seating: `roles` = role per seat, in seat order (length N). When D1 and seating have the same source,
 *   only D1 is asked and its order is the seating; otherwise D1 is asked first and `seating` reorders it.
 * - D2: `roles` = [believed townsfolk]
 * - D3: `seats` = [red herring]
 * - D4 / D5 / D6: `seats` = [a, b] (ascending), `roles` = [shown role]; librarian "zero outsiders": `seats` = [], `roles` = []
 * - D7: `roles` = 3 bluffs (sorted by ROLES order)
 * - D8: the ability's info shape (see AbilityInfo)
 * - D10 / D11: `alignment` + `roles` = [registered role]
 * - D12: `answer` (true = the Mayor's death bounces)
 * - D13 / D14: `seats` = [seat]
 */
export interface DiscretionValue {
  seats?: Seat[]
  roles?: RoleId[]
  number?: number
  answer?: boolean
  alignment?: Alignment
}

/**
 * Ability information, as told to a seat or computed as truth. Same shape as DiscretionValue:
 * - washerwoman / librarian / investigator: `seats` = [a, b], `roles` = [role]; librarian zero: `seats` = [], `roles` = []
 * - chef / empath: `number`
 * - fortuneteller: `answer` (true = yes, a Demon)
 * - undertaker: `roles` = [role]
 * - ravenkeeper: `seats` = [target], `roles` = [role]
 */
export type AbilityInfo = DiscretionValue

export type DiscretionCandidates =
  /** Explicitly enumerated legal values (D2–D14). Single candidate ⇒ resolved without asking. */
  | { kind: 'list'; values: DiscretionValue[] }
  /** D1: any `roles` (length seatCount, seat order) passing validateSetup. */
  | { kind: 'setup'; seatCount: number }
  /** seating: `roles` must be a permutation of these roles. */
  | { kind: 'seating'; roles: RoleId[] }

export interface DiscretionContext {
  /** Seat the discretion is about (e.g. the informed seat for D4–D6/D8, the Mayor for D12). */
  subject?: Seat
  /** For D8: the ability being faked/answered (the believed role). */
  ability?: RoleId
  /** The true value, when one exists (D8: truth; D4–D6: n/a). */
  truth?: DiscretionValue
  /** Which `decide` fields the storyteller model must fill. */
  fields: (keyof DiscretionValue)[]
}

export interface DiscretionAsk {
  discretion: DiscretionId
  candidates: DiscretionCandidates
  context: DiscretionContext
}

// ───────────────────────── Contestant requests & tools ─────────────────────────

export type ToolName = 'speak' | 'propose_whisper' | 'rank_whispers' | 'nominate' | 'vote' | 'night_choice'
export const TOOL_NAMES: readonly ToolName[] = ['speak', 'propose_whisper', 'rank_whispers', 'nominate', 'vote', 'night_choice']

export type SpeakContext =
  | { where: 'whisper'; round: number; room: string; members: Seat[] }
  | { where: 'public' }
  | { where: 'nomination_reason'; nominee: Seat }
  | { where: 'defense'; nominator: Seat }

/** Everything the engine asks a contestant. Pure data: prompts render it, rules validate against it. */
export type ContestantRequest =
  /** `remaining` = speeches left in this conversation (after this one if chosen); for reason/defense always 1. */
  | { kind: 'speak'; context: SpeakContext; remaining: number }
  /** `eligible` = other seats that still have whisper rooms left; `remaining` = this seat's rooms left. */
  | { kind: 'propose_whisper'; round: number; remaining: number; eligible: Seat[] }
  | { kind: 'rank_whispers'; round: number; rooms: { room: number; members: Seat[] }[] }
  /** `eligible` = seats not yet nominated today. */
  | { kind: 'nominate'; eligible: Seat[] }
  /** Votes so far in clockwise order starting after the nominee; `threshold` = votes needed for "about to die" now. */
  | { kind: 'vote'; nominator: Seat; nominee: Seat; votes: { seat: Seat; raised: boolean }[]; threshold: number; dead: boolean }
  /** `as` = the role the seat believes it is; `count` targets; `allowSelf`. Dead seats may be chosen. */
  | { kind: 'night_choice'; as: RoleId; count: number; allowSelf: boolean }

export const TOOL_FOR_REQUEST: Readonly<Record<ContestantRequest['kind'], ToolName>> = {
  speak: 'speak',
  propose_whisper: 'propose_whisper',
  rank_whispers: 'rank_whispers',
  nominate: 'nominate',
  vote: 'vote',
  night_choice: 'night_choice',
}

/** Tool arguments after parsing. Every tool: `reasoning` first, optional `memo` (≤ 2000 chars) last. */
export interface ToolArgsBase { reasoning: string; memo?: string }
export interface SpeakArgs extends ToolArgsBase { speech: string | null; slayer_target: Seat | null }
export interface ProposeWhisperArgs extends ToolArgsBase { members: Seat[] | null }
export interface RankWhispersArgs extends ToolArgsBase { ranking: number[] }
export interface NominateArgs extends ToolArgsBase { nominee: Seat | null }
export interface VoteArgs extends ToolArgsBase { raise_hand: boolean }
export interface NightChoiceArgs extends ToolArgsBase { targets: Seat[] }
export interface ToolArgsByName {
  speak: SpeakArgs
  propose_whisper: ProposeWhisperArgs
  rank_whispers: RankWhispersArgs
  nominate: NominateArgs
  vote: VoteArgs
  night_choice: NightChoiceArgs
}
export type ToolCall = { [K in ToolName]: { tool: K; args: ToolArgsByName[K] } }[ToolName]

export const MEMO_MAX_LENGTH = 2000

/**
 * Structured validation error codes (rendered to text in the game language by the prompts module).
 * Shape errors and semantic errors share one list.
 */
export type ValidationCode =
  | 'no_tool_call' | 'wrong_tool' | 'bad_json' | 'missing_field' | 'bad_type' | 'unknown_field'
  | 'memo_too_long' | 'seat_out_of_range'
  | 'speech_required' | 'slayer_not_allowed'
  | 'members_empty' | 'members_include_self' | 'members_duplicate' | 'member_unavailable'
  | 'rank_unknown_room' | 'rank_duplicate'
  | 'nominee_not_eligible'
  | 'vote_token_used'
  | 'target_count' | 'target_self'
  /** storyteller `decide`: value not among legal candidates / wrong fields. */
  | 'not_a_candidate' | 'invalid_setup'
export interface ValidationError { code: ValidationCode; field?: string; detail?: string }

export interface ContestantAsk { seat: Seat; request: ContestantRequest }
export interface ContestantAnswer { seat: Seat; call: ToolCall; decisionSeq: number }

// ───────────────────────── Grimoire & public state ─────────────────────────

export type StatusKind = 'poisoned' | 'protected' | 'ability_used' | 'vote_token_used' | 'master'

export interface Registration { alignment: Alignment; role: RoleId }

export interface SeatTruth {
  seat: Seat
  role: RoleId
  alignment: Alignment
  alive: boolean
  /** Active statuses; `poisoned`/`protected`/`master` record the seat that caused them. */
  poisonedBy: Seat | null
  protectedBy: Seat | null
  /** Seat whose master this seat is (set on the master, value = butler seat). */
  masterOf: Seat | null
  abilityUsed: boolean
  voteTokenUsed: boolean
}

/** Result of folding the whole log (storyteller truth). */
export interface Grimoire {
  seatCount: number
  /** Index seat-1. Empty until the setup `grimoire.set` is applied. */
  seats: SeatTruth[]
  drunkBelieves: RoleId | null
  redHerring: Seat | null
  spyRegisters: Registration | null
  recluseRegisters: Registration | null
  bluffs: RoleId[]
  day: number
  phase: Phase | null
}

/** Result of folding only public events. */
export interface PublicState {
  seatCount: number
  day: number
  phase: Phase | null
  alive: boolean[] // index seat-1
  voteTokenUsed: boolean[] // index seat-1 (dead seats' single vote)
  nominatorsToday: Seat[]
  nomineesToday: Seat[]
  aboutToDie: { seat: Seat; votes: number } | null
  ended: { winner: Alignment; reason: EndReason } | null
}

export type EndReason = 'demon_dead' | 'two_alive' | 'saint_executed' | 'mayor_win'

export type DeathCause = 'demon' | 'execution' | 'slayer' | 'virgin'

// ───────────────────────── Events ─────────────────────────

export interface PresetSnapshot {
  presetId: string
  name: string
  model: string
  providerId: string
  forceToolChoice: boolean
  extraBody: Record<string, unknown>
}

export interface GameConfig {
  seatCount: number
  /** Index seat-1. */
  seats: PresetSnapshot[]
  storyteller: PresetSnapshot | null
  sources: Record<DiscretionId, DiscretionSource>
  /** Per seat per conversation speech cap (≥ 1, default 10). */
  maxSpeeches: number
  /** Per seat per whisper phase rooms (≥ 0, default 3; 0 skips the whisper phase). */
  whisperRooms: number
  language: Lang
  seed: string
  logVersion: number
  promptVersion: string
}

/** Model-call record shared by contestant.decision / storyteller.decision. */
export interface DecisionRecord {
  /** Request parameters without `messages` (model, tools omitted, tool_choice, extra_body…). */
  params: Record<string, unknown>
  /** Whole raw response body (or null on transport failure). */
  response: unknown
  model: string
  usage: unknown
  durationMs: number
  /** 1..3 */
  attempt: number
  outcome:
    | { ok: true; call: { tool: string; args: Record<string, unknown> } }
    | { ok: false; errorKind: 'timeout' | 'http' | 'network' | 'invalid'; status?: number; error: string; validation?: ValidationError; call?: { tool: string; args: unknown } }
}

export type TellKind = 'role' | 'minion_info' | 'demon_info' | 'ability' | 'spy_grimoire' | 'became_imp'

export type EventBody =
  // game
  | { type: 'game.created'; config: GameConfig }
  | { type: 'phase.started'; day: number; phase: Phase }
  | { type: 'game.ended'; winner: Alignment; reason: EndReason }
  | { type: 'game.aborted'; reason: 'model_failure' | 'human' | 'restart' | 'engine_error'; detail: string; seat?: Seat; discretion?: DiscretionId }
  // model calls
  | ({ type: 'contestant.decision'; seat: Seat; request: ContestantRequest } & DecisionRecord)
  | ({ type: 'storyteller.decision'; discretion: DiscretionId; requestSeq: number } & DecisionRecord)
  // discretion
  | { type: 'discretion.requested'; discretion: DiscretionId; candidates: DiscretionCandidates; context: DiscretionContext; source: DiscretionSource }
  | { type: 'discretion.resolved'; requestSeq: number; discretion: DiscretionId; value: DiscretionValue; source: DiscretionSource; decisionSeq: number | null }
  // truth (patch: absent fields unchanged)
  | {
      type: 'grimoire.set'
      seats?: { seat: Seat; role: RoleId; alignment: Alignment }[]
      drunkBelieves?: RoleId | null
      redHerring?: Seat | null
      spyRegisters?: Registration | null
      recluseRegisters?: Registration | null
      bluffs?: RoleId[]
    }
  /** `source` = seat that caused it (poisoner, monk, butler for master). For master, `seat` is the master. */
  | { type: 'status.changed'; seat: Seat; status: StatusKind; on: boolean; source?: Seat }
  | { type: 'role.changed'; seat: Seat; from: RoleId; to: RoleId; alignment: Alignment }
  /**
   * `role` = actual role, `as` = role acted as (believed role for the Drunk); `effective` = ability functioning;
   * `result` = true result (truth) when the ability yields info; `told` present when info was told.
   */
  | {
      type: 'ability.resolved'
      seat: Seat
      role: RoleId
      as: RoleId
      effective: boolean
      targets?: Seat[]
      result?: AbilityInfo
      told?: { value: AbilityInfo; deviates: boolean; reason?: 'drunk' | 'poisoned' | 'register' }
    }
  | { type: 'night.death'; seat: Seat; cause: DeathCause }
  // told (audience: that seat)
  | { type: 'told'; seat: Seat; kind: 'role'; role: RoleId }
  | { type: 'told'; seat: Seat; kind: 'minion_info'; demon: Seat; minions: Seat[] }
  | { type: 'told'; seat: Seat; kind: 'demon_info'; minions: Seat[]; bluffs: RoleId[] }
  | { type: 'told'; seat: Seat; kind: 'ability'; ability: RoleId; value: AbilityInfo }
  | { type: 'told'; seat: Seat; kind: 'spy_grimoire'; grimoire: Grimoire }
  | { type: 'told'; seat: Seat; kind: 'became_imp' }
  // memo
  | { type: 'seat.memo.updated'; seat: Seat; text: string }
  // night
  | { type: 'night.choice'; seat: Seat; as: RoleId; targets: Seat[]; decisionSeq: number | null }
  | { type: 'dawn.announced'; deaths: Seat[] }
  // whispers (round counts from 1 within a day; `room` in candidates is a per-round number, room instance ids are strings)
  | { type: 'whisper.proposed'; round: number; rooms: { members: Seat[]; proposers: Seat[] }[] }
  | { type: 'whisper.candidates'; round: number; seat: Seat; rooms: { room: number; members: Seat[] }[] }
  | { type: 'whisper.ranked'; round: number; seat: Seat; ranking: number[] }
  | { type: 'whisper.room.opened'; round: number; room: string; members: Seat[] }
  | { type: 'whisper.speech'; round: number; room: string; members: Seat[]; seat: Seat; text: string; decisionSeq: number }
  | { type: 'whisper.room.closed'; round: number; room: string; members: Seat[] }
  // day
  | { type: 'public.speech'; seat: Seat; text: string; kind: 'free' | 'nomination_reason' | 'defense'; slayerTarget?: Seat; decisionSeq: number }
  | { type: 'slayer.resolved'; seat: Seat; target: Seat; died: boolean }
  | { type: 'nomination'; nominator: Seat; nominee: Seat }
  | { type: 'virgin.triggered'; nominator: Seat }
  | { type: 'vote'; seat: Seat; raised: boolean; tokenUsed: boolean; decisionSeq: number | null }
  | { type: 'vote.tallied'; nominee: Seat; votes: number; threshold: number; aboutToDie: boolean }
  | { type: 'execution'; seat: Seat }

export type EventType = EventBody['type']
export type GameEvent = EventBody & { seq: number }
export type EventOf<T extends EventType> = Extract<GameEvent, { type: T }>

// ───────────────────────── Observers ─────────────────────────

export type Observer =
  | { kind: 'spectator' }
  | { kind: 'storyteller' }
  | { kind: 'seat'; seat: Seat }
  | { kind: 'public' }

// ───────────────────────── Engine ports ─────────────────────────

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). */
  int(n: number): number
  pick<T>(xs: readonly T[]): T
  shuffle<T>(xs: readonly T[]): T[]
}

export interface Ports {
  /** Persist one event; the runtime assigns `seq` and returns it. */
  commit(event: EventBody): number
  /**
   * Ask a batch of seats at once (same-seq projection). Resolves when every seat has a validated answer.
   * The runtime writes contestant.decision (+ seat.memo.updated) events and handles retries; on exhaustion
   * it aborts the game and this promise rejects with GameAbortedError.
   */
  askContestants(asks: ContestantAsk[]): Promise<ContestantAnswer[]>
  /**
   * Resolve one discretion with ≥ 2 candidates (the engine resolves single candidates itself, writing nothing).
   * The runtime writes discretion.requested → [storyteller.decision…] → discretion.resolved and returns the value.
   */
  discretion(ask: DiscretionAsk): Promise<DiscretionValue>
  rng: Rng
}

export class GameAbortedError extends Error {
  constructor(message = 'game aborted') {
    super(message)
    this.name = 'GameAbortedError'
  }
}
