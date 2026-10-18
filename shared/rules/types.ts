export const LOG_VERSION = 1

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

export type Phase = 'first_night' | 'night' | 'dawn' | 'whisper' | 'public' | 'nomination'

export type DiscretionId =
  | 'D1' | 'seating' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8'
  | 'D10' | 'D11' | 'D12' | 'D13' | 'D14'
export const DISCRETION_IDS: readonly DiscretionId[] = [
  'D1', 'seating', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D10', 'D11', 'D12', 'D13', 'D14',
]
export type DiscretionSource = 'random' | 'storyteller' | 'manual'

export interface DiscretionValue {
  seats?: Seat[]
  roles?: RoleId[]
  number?: number
  answer?: boolean
  alignment?: Alignment
}

export type AbilityInfo = DiscretionValue

export type DiscretionCandidates =
  | { kind: 'list'; values: DiscretionValue[] }
  | { kind: 'setup'; seatCount: number }
  | { kind: 'seating'; roles: RoleId[] }

export interface DiscretionContext {
  subject?: Seat
  ability?: RoleId
  truth?: DiscretionValue
  fields: (keyof DiscretionValue)[]
}

export interface DiscretionAsk {
  discretion: DiscretionId
  candidates: DiscretionCandidates
  context: DiscretionContext
}

export type ToolName = 'speak' | 'propose_whisper' | 'rank_whispers' | 'nominate' | 'vote' | 'night_choice'
export const TOOL_NAMES: readonly ToolName[] = ['speak', 'propose_whisper', 'rank_whispers', 'nominate', 'vote', 'night_choice']

export type SpeakContext =
  | { where: 'whisper'; round: number; room: string; members: Seat[] }
  | { where: 'public' }
  | { where: 'nomination_reason'; nominee: Seat }
  | { where: 'defense'; nominator: Seat }

export type ContestantRequest =
  | { kind: 'speak'; context: SpeakContext; remaining: number }
  | { kind: 'propose_whisper'; round: number; remaining: number; eligible: Seat[] }
  | { kind: 'rank_whispers'; round: number; rooms: { room: number; members: Seat[] }[] }
  | { kind: 'nominate'; eligible: Seat[] }
  | { kind: 'vote'; nominator: Seat; nominee: Seat; votes: { seat: Seat; raised: boolean }[]; threshold: number; dead: boolean }
  | { kind: 'night_choice'; as: RoleId; count: number; allowSelf: boolean }

export const TOOL_FOR_REQUEST: Readonly<Record<ContestantRequest['kind'], ToolName>> = {
  speak: 'speak',
  propose_whisper: 'propose_whisper',
  rank_whispers: 'rank_whispers',
  nominate: 'nominate',
  vote: 'vote',
  night_choice: 'night_choice',
}

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

export type ValidationCode =
  | 'no_tool_call' | 'wrong_tool' | 'bad_json' | 'missing_field' | 'bad_type' | 'unknown_field'
  | 'memo_too_long' | 'seat_out_of_range'
  | 'speech_required' | 'slayer_not_allowed'
  | 'members_empty' | 'members_include_self' | 'members_duplicate' | 'member_unavailable'
  | 'rank_unknown_room' | 'rank_duplicate'
  | 'nominee_not_eligible'
  | 'vote_token_used'
  | 'target_count' | 'target_self'
  | 'not_a_candidate' | 'invalid_setup'
export interface ValidationError { code: ValidationCode; field?: string; detail?: string }

export interface ContestantAsk { seat: Seat; request: ContestantRequest }
export interface ContestantAnswer { seat: Seat; call: ToolCall; decisionSeq: number }

export type StatusKind = 'poisoned' | 'protected' | 'ability_used' | 'vote_token_used' | 'master'

export interface Registration { alignment: Alignment; role: RoleId }

export interface SeatTruth {
  seat: Seat
  role: RoleId
  alignment: Alignment
  alive: boolean
  poisonedBy: Seat | null
  protectedBy: Seat | null
  masterOf: Seat | null
  abilityUsed: boolean
  voteTokenUsed: boolean
}

export interface Grimoire {
  seatCount: number
  seats: SeatTruth[]
  drunkBelieves: RoleId | null
  redHerring: Seat | null
  spyRegisters: Registration | null
  recluseRegisters: Registration | null
  bluffs: RoleId[]
  day: number
  phase: Phase | null
}

export interface PublicState {
  seatCount: number
  day: number
  phase: Phase | null
  alive: boolean[]
  voteTokenUsed: boolean[]
  nominatorsToday: Seat[]
  nomineesToday: Seat[]
  aboutToDie: { seat: Seat; votes: number } | null
  ended: { winner: Alignment; reason: EndReason } | null
}

export type EndReason = 'demon_dead' | 'two_alive' | 'saint_executed' | 'mayor_win'

export type DeathCause = 'demon' | 'execution' | 'slayer' | 'virgin'

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
  seats: PresetSnapshot[]
  storyteller: PresetSnapshot | null
  sources: Record<DiscretionId, DiscretionSource>
  maxSpeeches: number
  whisperRooms: number
  language: Lang
  seed: string
  logVersion: number
  promptVersion: string
}

export interface DecisionRecord {
  params: Record<string, unknown>
  response: unknown
  model: string
  usage: unknown
  durationMs: number
  attempt: number
  outcome:
    | { ok: true; call: { tool: string; args: Record<string, unknown> } }
    | { ok: false; errorKind: 'timeout' | 'http' | 'network' | 'invalid'; status?: number; error: string; validation?: ValidationError; call?: { tool: string; args: unknown } }
}

export type TellKind = 'role' | 'minion_info' | 'demon_info' | 'ability' | 'spy_grimoire' | 'became_imp'

export type EventBody =
  | { type: 'game.created'; config: GameConfig }
  | { type: 'phase.started'; day: number; phase: Phase }
  | { type: 'game.ended'; winner: Alignment; reason: EndReason }
  | { type: 'game.aborted'; reason: 'model_failure' | 'human' | 'restart' | 'engine_error'; detail: string; seat?: Seat; discretion?: DiscretionId }
  | ({ type: 'contestant.decision'; seat: Seat; request: ContestantRequest } & DecisionRecord)
  | ({ type: 'storyteller.decision'; discretion: DiscretionId; requestSeq: number } & DecisionRecord)
  | { type: 'discretion.requested'; discretion: DiscretionId; candidates: DiscretionCandidates; context: DiscretionContext; source: DiscretionSource }
  | { type: 'discretion.resolved'; requestSeq: number; discretion: DiscretionId; value: DiscretionValue; source: DiscretionSource; decisionSeq: number | null }
  | {
      type: 'grimoire.set'
      seats?: { seat: Seat; role: RoleId; alignment: Alignment }[]
      drunkBelieves?: RoleId | null
      redHerring?: Seat | null
      spyRegisters?: Registration | null
      recluseRegisters?: Registration | null
      bluffs?: RoleId[]
    }
  | { type: 'status.changed'; seat: Seat; status: StatusKind; on: boolean; source?: Seat }
  | { type: 'role.changed'; seat: Seat; from: RoleId; to: RoleId; alignment: Alignment }
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
  | { type: 'told'; seat: Seat; kind: 'role'; role: RoleId }
  | { type: 'told'; seat: Seat; kind: 'minion_info'; demon: Seat; minions: Seat[] }
  | { type: 'told'; seat: Seat; kind: 'demon_info'; minions: Seat[]; bluffs: RoleId[] }
  | { type: 'told'; seat: Seat; kind: 'ability'; ability: RoleId; value: AbilityInfo }
  | { type: 'told'; seat: Seat; kind: 'spy_grimoire'; grimoire: Grimoire }
  | { type: 'told'; seat: Seat; kind: 'became_imp' }
  | { type: 'seat.memo.updated'; seat: Seat; text: string }
  | { type: 'night.choice'; seat: Seat; as: RoleId; targets: Seat[]; decisionSeq: number | null }
  | { type: 'dawn.announced'; deaths: Seat[] }
  | { type: 'whisper.proposed'; round: number; rooms: { members: Seat[]; proposers: Seat[] }[] }
  | { type: 'whisper.candidates'; round: number; seat: Seat; rooms: { room: number; members: Seat[] }[] }
  | { type: 'whisper.ranked'; round: number; seat: Seat; ranking: number[] }
  | { type: 'whisper.room.opened'; round: number; room: string; members: Seat[] }
  | { type: 'whisper.speech'; round: number; room: string; members: Seat[]; seat: Seat; text: string; decisionSeq: number }
  | { type: 'whisper.room.closed'; round: number; room: string; members: Seat[] }
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

export type Observer =
  | { kind: 'spectator' }
  | { kind: 'storyteller' }
  | { kind: 'seat'; seat: Seat }
  | { kind: 'public' }

export interface Rng {
  next(): number
  int(n: number): number
  pick<T>(xs: readonly T[]): T
  shuffle<T>(xs: readonly T[]): T[]
}

export interface Ports {
  commit(event: EventBody): number
  askContestants(asks: ContestantAsk[]): Promise<ContestantAnswer[]>
  discretion(ask: DiscretionAsk): Promise<DiscretionValue>
  rng: Rng
}

export class GameAbortedError extends Error {
  constructor(message = 'game aborted') {
    super(message)
    this.name = 'GameAbortedError'
  }
}
