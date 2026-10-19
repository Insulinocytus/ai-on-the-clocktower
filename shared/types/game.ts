import type { Preset } from './models'

export const MEMO_MAX_LENGTH = 2000

export type GameEndReason = 'all_demons_dead' | 'two_alive' | 'mayor' | 'saint_executed'
export type GameAbortReason = 'model_call_failed' | 'engine_error' | 'human' | 'process_restart'
export type GameReason = GameEndReason | GameAbortReason

export type Language = 'en' | 'zh'
export type Alignment = 'good' | 'evil'
export type RoleType = 'townsfolk' | 'outsider' | 'minion' | 'demon'
export type RoleId =
  | 'washerwoman'
  | 'librarian'
  | 'investigator'
  | 'chef'
  | 'empath'
  | 'fortuneteller'
  | 'undertaker'
  | 'monk'
  | 'ravenkeeper'
  | 'virgin'
  | 'slayer'
  | 'soldier'
  | 'mayor'
  | 'butler'
  | 'drunk'
  | 'recluse'
  | 'saint'
  | 'poisoner'
  | 'spy'
  | 'scarletwoman'
  | 'baron'
  | 'imp'
export type Observer = 'spectator' | 'storyteller' | 'public' | `seat:${number}`
type Phase = 'first-night' | 'night' | 'dawn' | 'whisper' | 'public' | 'nomination'
export type DiscretionId =
  | 'D1'
  | 'seating'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8'
  | 'D10'
  | 'D11'
  | 'D12'
  | 'D13'
  | 'D14'
export type DiscretionSource = 'random' | 'storyteller' | 'manual'
interface ModelSnapshot extends Preset {
  seat?: number
}
export interface GameConfig {
  seatCount: number
  seats: ModelSnapshot[]
  storyteller: ModelSnapshot | null
  discretions: Record<DiscretionId, DiscretionSource>
  speechLimit: number
  whisperLimit: number
  language: Language
  seed: number
  logVersion: number
  promptVersion: number
}
export interface NightRequest {
  tool: 'night_choice'
  seat: number
  role: RoleId
  day: number
  targets: number[]
}
interface NightChoice {
  reasoning: string
  targets: number[]
  memo?: string
}
export interface SpeechRequest {
  tool: 'speak'
  seat: number
  day: number
  kind: 'free' | 'whisper' | 'nomination' | 'defense'
  remaining?: number
  nominator?: number
  nominee?: number
  room?: { round: number; id: string; members: number[] }
}
export interface SpeechChoice {
  reasoning: string
  speech: string | null
  slayer_target: number | null
  memo?: string
  decision?: number
}
interface NominationRequest {
  tool: 'nominate'
  seat: number
  day: number
  nominees: number[]
}
interface NominationChoice {
  reasoning: string
  nominee: number | null
  memo?: string
}
interface VoteRequest {
  tool: 'vote'
  seat: number
  day: number
  nominator: number
  nominee: number
  votes: { seat: number; raiseHand: boolean }[]
  threshold: number
  highestVoteCount: number
  canRaiseHand: boolean
  master?: number | null
}
interface VoteChoice {
  reasoning: string
  raise_hand: boolean
  memo?: string
}
interface WhisperRoom {
  id: number
  members: number[]
}
interface WhisperProposalRequest {
  tool: 'propose_whisper'
  seat: number
  day: number
  round: number
  remaining: number
  eligible: number[]
}
interface WhisperProposalChoice {
  reasoning: string
  members: number[] | null
  memo?: string
}
interface WhisperRankingRequest {
  tool: 'rank_whispers'
  seat: number
  day: number
  round: number
  rooms: WhisperRoom[]
}
interface WhisperRankingChoice {
  reasoning: string
  ranking: number[]
  memo?: string
}
export type ContestantRequest =
  | NightRequest
  | SpeechRequest
  | NominationRequest
  | VoteRequest
  | WhisperProposalRequest
  | WhisperRankingRequest
export type ContestantChoice =
  | NightChoice
  | SpeechChoice
  | NominationChoice
  | VoteChoice
  | WhisperProposalChoice
  | WhisperRankingChoice
type ValidationCode =
  | 'invalid_seat_count'
  | 'duplicate_role'
  | 'invalid_role_counts'
  | 'no_washerwoman_truth'
  | 'invalid_demon'
  | 'unsupported_role'
  | 'invalid_targets'
  | 'invalid_reasoning'
  | 'invalid_memo'
  | 'invalid_nominee'
  | 'invalid_vote'
  | 'invalid_speech'
  | 'invalid_slayer_target'
  | 'invalid_whisper_members'
  | 'invalid_whisper_ranking'
  | 'invalid_response'
  | 'no_tool_call'
  | 'multiple_tool_calls'
  | 'unknown_tool'
  | 'wrong_tool'
  | 'invalid_arguments_json'
  | 'invalid_arguments'
  | 'invalid_discretion'
export interface ValidationError {
  code: ValidationCode
}
export interface SeatState {
  seat: number
  role: RoleId
  alignment: Alignment
  alive: boolean
  poisoned: boolean
  protected: boolean
  abilityUsed: boolean
  voteUsed: boolean
  master: number | null
  believedRole?: RoleId
  registeredRole?: RoleId
  registeredAlignment?: Alignment
}
interface PublicSeat {
  seat: number
  alive: boolean
  voteUsed: boolean
}
export interface PublicState {
  seq: number
  day: number
  phase: Phase | null
  seats: PublicSeat[]
  nominators: number[]
  nominees: number[]
  aboutToBeExecuted: number | null
  highestVoteCount: number
  winner: Alignment | null
}
export interface Grimoire {
  seq: number
  day: number
  phase: Phase | null
  seats: SeatState[]
  redHerring: number | null
  bluffs: RoleId[]
  winner: Alignment | null
  ended: boolean
  aborted: boolean
  executedToday: number | null
}
export interface PairInformation {
  seats: number[]
  role: RoleId
}
export type InformationResult =
  | number
  | boolean
  | PairInformation
  | { target: number; role: RoleId }
  | (Pick<Grimoire, 'seats' | 'redHerring'> & { bluffs?: RoleId[] })
type Event<T extends string, P> = { seq: number; type: T } & P
export type GameEvent =
  | Event<'game.created', GameConfig>
  | Event<'phase.started', { day: number; phase: Phase }>
  | Event<'game.ended', { winner: Alignment; reason: GameEndReason }>
  | Event<
      'game.aborted',
      {
        reason: GameAbortReason
        seat?: number
        discretion?: DiscretionId
        error?: unknown
        details?: unknown
      }
    >
  | Event<
      'contestant.decision',
      {
        seat: number
        request: ContestantRequest
        raw: unknown
        model: string
        usage: unknown
        durationMs: number
        attempt: number
        validation: unknown
      }
    >
  | Event<
      'storyteller.decision',
      {
        discretion: DiscretionId
        request: unknown
        raw: unknown
        model: string
        usage: unknown
        durationMs: number
        attempt: number
        validation: unknown
      }
    >
  | Event<
      'discretion.requested',
      {
        discretion: DiscretionId
        candidates: DiscretionCandidates
        source: DiscretionSource
        context?: DiscretionDetails
      }
    >
  | Event<
      'discretion.resolved',
      { discretion: DiscretionId; choice: unknown; source: DiscretionSource; decision?: number }
    >
  | Event<'grimoire.set', { seats: SeatState[]; redHerring?: number | null; bluffs?: RoleId[] }>
  | Event<
      'status.changed',
      {
        seat: number
        status: 'poisoned' | 'protected' | 'abilityUsed' | 'voteUsed' | 'master'
        value: boolean | number | null
      }
    >
  | Event<'role.changed', { seat: number; from: RoleId; to: RoleId }>
  | Event<
      'ability.resolved',
      {
        seat: number
        role: RoleId
        result:
          | InformationResult
          | { target: number; outcome: 'killed' | 'dead' | 'soldier' | 'protected' | 'inactive' }
        deviated: boolean
        reason?: 'drunk' | 'poisoned'
      }
    >
  | Event<'night.death', { seat: number; cause: string }>
  | Event<
      'told',
      {
        seat: number
        kind: 'role' | 'ability' | 'imp'
        content: { role: RoleId; result?: InformationResult }
      }
    >
  | Event<
      'told',
      {
        seat: number
        kind: 'minion-info' | 'demon-info'
        content: { seats: number[]; bluffs?: RoleId[] }
      }
    >
  | Event<
      'told',
      {
        seat: number
        kind: 'grimoire'
        content: Pick<Grimoire, 'seats' | 'redHerring'> & { bluffs?: RoleId[] }
      }
    >
  | Event<'seat.memo.updated', { seat: number; memo: string }>
  | Event<'night.choice', { seat: number; role: RoleId; targets: number[] }>
  | Event<'dawn.announced', { day: number; deaths: number[] }>
  | Event<'whisper.proposed', { seat: number; round: number; members: number[] | null }>
  | Event<
      'whisper.candidates',
      { seat: number; round: number; rooms: { id: number; members: number[] }[] }
    >
  | Event<'whisper.ranked', { seat: number; round: number; ranking: number[] }>
  | Event<'whisper.room.opened', { round: number; roomId: string; members: number[] }>
  | Event<
      'whisper.speech',
      {
        round: number
        roomId: string
        members: number[]
        seat: number
        speech: string
        decision: number
      }
    >
  | Event<'whisper.room.closed', { round: number; roomId: string; members: number[] }>
  | Event<
      'public.speech',
      {
        seat: number
        speech: string
        kind: 'free' | 'nomination' | 'defense'
        slayerTarget?: number
        decision: number
      }
    >
  | Event<'slayer.resolved', { seat: number; target: number; died: boolean }>
  | Event<'nomination', { nominator: number; nominee: number }>
  | Event<'virgin.triggered', { nominator: number }>
  | Event<'vote', { seat: number; raiseHand: boolean; voteUsed: boolean }>
  | Event<
      'vote.tallied',
      { nominee: number; votes: number; threshold: number; aboutToBeExecuted: boolean }
    >
  | Event<'execution', { seat: number }>
export type GameEventInput = GameEvent extends infer E
  ? E extends GameEvent
    ? Omit<E, 'seq'>
    : never
  : never
export interface Registration {
  alignment: Alignment
  role: RoleId
}
export type DiscretionChoice = RoleId[] | RoleId | InformationResult | Registration
export type DiscretionCandidates =
  | { type: 'setup'; sample: RoleId[] }
  | { type: 'seating'; roles: RoleId[]; sample: RoleId[] }
  | DiscretionChoice[]
export interface DiscretionDetails {
  seat?: number
  role?: RoleId
  truth?: InformationResult[]
  reason?: 'drunk' | 'poisoned'
}
export interface DiscretionContext extends Grimoire {
  discretion?: DiscretionDetails
}
export interface Ports {
  config: GameConfig
  log: readonly GameEvent[]
  commit(event: GameEventInput): GameEvent | Promise<GameEvent>
  askContestants(batch: ContestantRequest[]): Promise<ContestantChoice[]>
  discretion(
    id: DiscretionId,
    candidates: DiscretionCandidates,
    context: DiscretionContext,
    requestSeq: number,
  ): Promise<{ choice: DiscretionChoice; decision?: number }>
  rng(): number
}
