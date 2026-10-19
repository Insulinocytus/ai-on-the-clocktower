import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

// shortcut: CREATE IF NOT EXISTS only; switch to versioned migrations (PRAGMA user_version) on the first schema change.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  apiKeyEnv TEXT NOT NULL,
  timeoutSec INTEGER NOT NULL,
  maxConcurrency INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  providerId INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  forceToolChoice INTEGER NOT NULL,
  extraBody TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_events (
  gameId TEXT NOT NULL REFERENCES games(id),
  seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (gameId, seq)
);
`

let db: Database.Database | undefined

export function useDb(): Database.Database {
  if (db) return db
  const path = useRuntimeConfig().dbPath
  mkdirSync(dirname(path), { recursive: true })
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
