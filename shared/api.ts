// HTTP API contract between Nitro routes (server/api/**) and the UI. All routes are under /api.
import type { DiscretionId, DiscretionSource, DiscretionValue, GameConfig, Lang, Seat, Alignment } from './rules/types'

// ── Providers ──  GET/POST /api/providers, PUT/DELETE /api/providers/:id
export interface Provider {
  id: string
  name: string
  baseUrl: string
  /** Name of the env var holding the API key; the key itself never enters the DB or the UI. */
  apiKeyEnv: string
  timeoutSec: number // default 300
  maxConcurrency: number // default 5
  /** Whether process.env[apiKeyEnv] is set and non-empty. */
  keySet: boolean
}
export type ProviderInput = Omit<Provider, 'id' | 'keySet' | 'timeoutSec' | 'maxConcurrency'> & { timeoutSec?: number; maxConcurrency?: number }

// ── Model presets ──  GET/POST /api/presets, PUT/DELETE /api/presets/:id, POST /api/presets/:id/test
export interface Preset {
  id: string
  name: string
  providerId: string
  model: string
  /** Send tool_choice forcing the expected tool. */
  forceToolChoice: boolean
  /** Merged into the request body (reasoning switches, max_tokens, provider.require_parameters…). */
  extraBody: Record<string, unknown>
}
export type PresetInput = Omit<Preset, 'id'>

export interface PresetTestResult {
  ok: boolean
  /** Parsed tool call when one was returned. */
  toolCall: { name: string; arguments: unknown } | null
  error: string | null
  raw: unknown
  durationMs: number
}

// ── Games ──
export type GameStatus = 'running' | 'awaiting_manual' | 'ended' | 'aborted'

/** GET /api/games → GameSummary[] (newest first). Status is derived from the log. */
export interface GameSummary {
  id: string
  createdAt: string // ISO
  seatCount: number
  language: Lang
  status: GameStatus
  winner: Alignment | null
  abortReason: 'model_failure' | 'human' | 'restart' | 'engine_error' | null
  abortDetail: string | null
  /** Present when status = awaiting_manual. */
  pending: { seq: number; discretion: DiscretionId } | null
  /** false when the stored log version ≠ LOG_VERSION. */
  replayable: boolean
  /** Preset names per seat (index seat-1). */
  seatPresetNames: string[]
}

/** POST /api/games body. 400 { error: 'missing_env', missing: string[] } when provider env vars are absent. */
export interface CreateGameBody {
  seatCount: number // 5..15
  seats: string[] // preset id per seat (index seat-1)
  storytellerPresetId: string | null // required iff some source is 'storyteller'
  sources: Record<DiscretionId, DiscretionSource>
  maxSpeeches: number // ≥ 1, default 10
  whisperRooms: number // ≥ 0, default 3
  language: Lang
}
export interface CreateGameResponse { id: string }
export interface ApiError { error: string; message?: string; missing?: string[] }

/** GET /api/games/:id → summary + the game.created config (used for "new game from template"). */
export interface GameDetail { summary: GameSummary; config: GameConfig }

/**
 * GET /api/games/:id/events?observer=<spectator|storyteller|seat:N|public>&after=<seq>
 *   - Accept: application/json → GameEvent[] with seq > after, filtered by audience.
 *   - Accept: text/event-stream → SSE; each message `id: <seq>`, `data: <GameEvent JSON>`;
 *     resumes from Last-Event-ID or `after`. Client subscribes first, then backfills via JSON and dedupes by seq.
 *
 * POST /api/games/:id/discretions/:seq  body { value: DiscretionValue }
 *   200 { ok: true } | 400 { error: 'not_a_candidate' } | 409 { error: 'conflict', value: DiscretionValue | null }
 *
 * POST /api/games/:id/abort → 200 { ok: true } | 409 { error: 'finished' }
 */
export interface DiscretionSubmit { value: DiscretionValue }
export interface DiscretionConflict { error: 'conflict'; value: DiscretionValue | null }

export type ObserverParam = 'spectator' | 'storyteller' | 'public' | `seat:${Seat}`
