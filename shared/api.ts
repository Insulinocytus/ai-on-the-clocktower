import type { DiscretionId, DiscretionSource, DiscretionValue, GameConfig, Lang, Seat, Alignment } from './rules/types'

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKeyEnv: string
  timeoutSec: number
  maxConcurrency: number
  keySet: boolean
}
export type ProviderInput = Omit<Provider, 'id' | 'keySet' | 'timeoutSec' | 'maxConcurrency'> & { timeoutSec?: number; maxConcurrency?: number }

export interface Preset {
  id: string
  name: string
  providerId: string
  model: string
  forceToolChoice: boolean
  extraBody: Record<string, unknown>
}
export type PresetInput = Omit<Preset, 'id'>

export interface PresetTestResult {
  ok: boolean
  toolCall: { name: string; arguments: unknown } | null
  error: string | null
  raw: unknown
  durationMs: number
}

export type GameStatus = 'running' | 'awaiting_manual' | 'ended' | 'aborted'

export interface GameSummary {
  id: string
  createdAt: string
  seatCount: number
  language: Lang
  status: GameStatus
  winner: Alignment | null
  abortReason: 'model_failure' | 'human' | 'restart' | 'engine_error' | null
  abortDetail: string | null
  pending: { seq: number; discretion: DiscretionId } | null
  replayable: boolean
  seatPresetNames: string[]
}

export interface CreateGameBody {
  seatCount: number
  seats: string[]
  storytellerPresetId: string | null
  sources: Record<DiscretionId, DiscretionSource>
  maxSpeeches: number
  whisperRooms: number
  language: Lang
}
export interface CreateGameResponse { id: string }
export interface ApiError { error: string; message?: string; missing?: string[] }

export interface GameDetail { summary: GameSummary; config: GameConfig }

export interface DiscretionSubmit { value: DiscretionValue }
export interface DiscretionConflict { error: 'conflict'; value: DiscretionValue | null }

export type ObserverParam = 'spectator' | 'storyteller' | 'public' | `seat:${Seat}`
