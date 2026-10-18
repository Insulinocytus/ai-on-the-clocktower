import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Provider, ProviderInput, Preset, PresetInput, GameSummary } from '../../shared/api'
import { LOG_VERSION, type GameConfig, type GameEvent, type EventBody } from '../../shared/rules/types'

let connection: Database.Database | undefined
export function db(): Database.Database {
  if (connection) return connection
  const dir = process.env.DATA_DIR ?? '.data'
  mkdirSync(dir, { recursive: true })
  connection = new Database(join(dir, 'app.db'))
  connection.pragma('journal_mode = WAL')
  connection.exec(`
    CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, log_version INTEGER NOT NULL, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (game_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(game_id, seq));
    PRAGMA user_version = 1;
  `)
  return connection
}

type JsonRow = { data: string }
type GameRow = { id: string; created_at: string; log_version: number; config: string }
export function providers(): Provider[] {
  return (db().prepare('SELECT data FROM providers ORDER BY rowid').all() as JsonRow[]).map(row => {
    const stored = JSON.parse(row.data) as Omit<Provider, 'keySet'>
    return { ...stored, keySet: Boolean(process.env[stored.apiKeyEnv]) }
  })
}
export function provider(id: string): Provider | undefined { return providers().find(p => p.id === id) }
export function saveProvider(input: ProviderInput, id: string = randomUUID()): Provider {
  const stored = { id, ...input, timeoutSec: input.timeoutSec ?? 300, maxConcurrency: input.maxConcurrency ?? 5 }
  db().prepare('INSERT INTO providers (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(stored))
  return { ...stored, keySet: Boolean(process.env[stored.apiKeyEnv]) }
}
export function presets(): Preset[] { return (db().prepare('SELECT data FROM presets ORDER BY rowid').all() as JsonRow[]).map(row => JSON.parse(row.data) as Preset) }
export function preset(id: string): Preset | undefined { return presets().find(p => p.id === id) }
export function savePreset(input: PresetInput, id: string = randomUUID()): Preset {
  const value = { id, ...input }
  db().prepare('INSERT INTO presets (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(value))
  return value
}
export function removeModel(kind: 'providers' | 'presets', id: string): void { db().prepare(`DELETE FROM ${kind} WHERE id=?`).run(id) }
export function createGame(config: GameConfig): string {
  const id = randomUUID()
  db().prepare('INSERT INTO games (id,created_at,log_version,config) VALUES (?,?,?,?)').run(id, new Date().toISOString(), config.logVersion, JSON.stringify(config))
  return id
}
export function game(id: string): { config: GameConfig; row: GameRow } | undefined {
  const row = db().prepare('SELECT * FROM games WHERE id=?').get(id) as GameRow | undefined
  return row ? { config: JSON.parse(row.config) as GameConfig, row } : undefined
}
export function events(id: string, after = 0): GameEvent[] {
  return (db().prepare('SELECT data FROM events WHERE game_id=? AND seq>? ORDER BY seq').all(id, after) as JsonRow[]).map(row => JSON.parse(row.data) as GameEvent)
}
const subscribers = new Map<string, Set<(event: GameEvent) => void>>()
export function subscribe(id: string, listener: (event: GameEvent) => void): () => void {
  let listeners = subscribers.get(id)
  if (!listeners) subscribers.set(id, listeners = new Set())
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(id) }
}
export function append(id: string, seq: number, body: EventBody): GameEvent {
  const event = { ...body, seq }
  db().prepare('INSERT INTO events (game_id,seq,type,data) VALUES (?,?,?,?)').run(id, seq, body.type, JSON.stringify(event))
  for (const listener of subscribers.get(id) ?? []) listener(event)
  return event
}
export function summary(row: GameRow): GameSummary {
  const config = JSON.parse(row.config) as GameConfig
  const log = events(row.id)
  const ended = log.find(e => e.type === 'game.ended')
  const aborted = log.find(e => e.type === 'game.aborted')
  const resolved = new Set(log.filter(e => e.type === 'discretion.resolved').map(e => e.requestSeq))
  const pending = log.findLast(e => e.type === 'discretion.requested' && e.source === 'manual' && !resolved.has(e.seq))
  return {
    id: row.id, createdAt: row.created_at, seatCount: config.seatCount, language: config.language,
    status: ended ? 'ended' : aborted ? 'aborted' : pending ? 'awaiting_manual' : 'running',
    winner: ended?.type === 'game.ended' ? ended.winner : null,
    abortReason: aborted?.type === 'game.aborted' ? aborted.reason : null,
    abortDetail: aborted?.type === 'game.aborted' ? aborted.detail : null,
    pending: !ended && !aborted && pending?.type === 'discretion.requested' ? { seq: pending.seq, discretion: pending.discretion } : null,
    replayable: row.log_version === LOG_VERSION, seatPresetNames: config.seats.map(p => p.name),
  }
}
export function games(): GameSummary[] { return (db().prepare('SELECT * FROM games ORDER BY created_at DESC, rowid DESC').all() as GameRow[]).map(summary) }
export function cleanupRestart(): void {
  for (const item of games()) {
    if (item.status === 'running' || item.status === 'awaiting_manual') {
      const log = events(item.id)
      append(item.id, (log.at(-1)?.seq ?? 0) + 1, { type: 'game.aborted', reason: 'restart', detail: 'Process restarted' })
    }
  }
}
