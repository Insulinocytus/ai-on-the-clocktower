import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  apiKeyEnv TEXT NOT NULL,
  timeoutSec INTEGER NOT NULL,
  maxConcurrency INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  const database = new Database(path)
  database.pragma('journal_mode = WAL')
  if (database.pragma('user_version', { simple: true }) === 0) {
    database.pragma('foreign_keys = OFF')
    database.transaction(() => {
      const legacy = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'providers'")
        .get()
      if (legacy)
        database.exec(`
          ALTER TABLE presets RENAME TO presets_legacy;
          ALTER TABLE providers RENAME TO providers_legacy;
        `)
      database.exec(SCHEMA)
      if (legacy)
        database.exec(`
          INSERT INTO providers (id, name, baseUrl, apiKeyEnv, timeoutSec, maxConcurrency)
            SELECT id, name, baseUrl, apiKeyEnv, timeoutSec, maxConcurrency FROM providers_legacy;
          INSERT INTO presets (id, name, providerId, model, forceToolChoice, extraBody)
            SELECT id, name, providerId, model, forceToolChoice, extraBody FROM presets_legacy;
          DROP TABLE presets_legacy;
          DROP TABLE providers_legacy;
        `)
      database.pragma('user_version = 1')
    })()
  }
  database.pragma('foreign_keys = ON')
  db = database
  return database
}
