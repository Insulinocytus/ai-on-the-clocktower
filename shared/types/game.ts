import type { Preset } from './models'

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
type DiscretionId =
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
type DiscretionSource = 'random' | 'storyteller' | 'manual'
interface ModelSnapshot extends Preset {
  seat?: number
}
export interface GameConfig {
  seatCount: 5
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
  kind: 'free' | 'nomination' | 'defense'
  remaining?: number
  nominator?: number
  nominee?: number
}
interface SpeechChoice {
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
}
interface VoteChoice {
  reasoning: string
  raise_hand: boolean
  memo?: string
}
export type ContestantRequest = NightRequest | SpeechRequest | NominationRequest | VoteRequest
export type ContestantChoice = NightChoice | SpeechChoice | NominationChoice | VoteChoice
type ValidationCode =
  | 'invalid_seat_count'
  | 'duplicate_role'
  | 'invalid_role_counts'
  | 'invalid_demon'
  | 'unsupported_role'
  | 'invalid_targets'
  | 'invalid_reasoning'
  | 'invalid_memo'
  | 'invalid_nominee'
  | 'invalid_vote'
  | 'invalid_speech'
  | 'invalid_slayer_target'
  | 'invalid_response'
  | 'no_tool_call'
  | 'multiple_tool_calls'
  | 'unknown_tool'
  | 'wrong_tool'
  | 'invalid_arguments_json'
  | 'invalid_arguments'
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
  winner: Alignment | null
  ended: boolean
  aborted: boolean
  executedToday: number | null
}
type Event<T extends string, P> = { seq: number; type: T } & P
export type GameEvent =
  | Event<'game.created', GameConfig>
  | Event<'phase.started', { day: number; phase: Phase }>
  | Event<'game.ended', { winner: Alignment; reason: string }>
  | Event<
      'game.aborted',
      {
        reason: string
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
      { discretion: DiscretionId; candidates: unknown; source: DiscretionSource }
    >
  | Event<
      'discretion.resolved',
      { discretion: DiscretionId; choice: unknown; source: DiscretionSource; decision?: number }
    >
  | Event<'grimoire.set', { seats: SeatState[]; redHerring?: number | null }>
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
          | number
          | { target: number; outcome: 'killed' | 'dead' | 'soldier' | 'protected' | 'inactive' }
        deviated: boolean
        reason?: string
      }
    >
  | Event<'night.death', { seat: number; cause: string }>
  | Event<
      'told',
      { seat: number; kind: 'role' | 'ability' | 'imp'; content: { role: RoleId; result?: number } }
    >
  | Event<
      'told',
      {
        seat: number
        kind: 'minion-info' | 'demon-info'
        content: { seats: number[]; bluffs?: RoleId[] }
      }
    >
  | Event<'told', { seat: number; kind: 'grimoire'; content: { seats: SeatState[] } }>
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
export interface Ports {
  config: GameConfig
  log: readonly GameEvent[]
  commit(event: GameEventInput): GameEvent | Promise<GameEvent>
  askContestants(batch: ContestantRequest[]): Promise<ContestantChoice[]>
  discretion(
    id: 'D1' | 'D14',
    candidates: { type: 'setup'; sample: RoleId[] } | number[],
    context: Grimoire,
  ): Promise<RoleId[] | number>
  rng(): number
}
