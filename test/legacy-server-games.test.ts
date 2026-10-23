import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $fetch, setup, startServer, stopServer } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { GameEvent } from '../shared/types/game'
import type { Preset, Provider } from '../shared/types/models'
import type { GameSummary } from '../shared/types/game-view'
import { startFakeProvider } from './fake-provider'

const dbPath = join(mkdtempSync(join(tmpdir(), 'clocktower-games-')), 'app.db')
const legacyDb = new Database(dbPath)
legacyDb.exec(`
  CREATE TABLE providers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, baseUrl TEXT NOT NULL,
    apiKeyEnv TEXT NOT NULL, timeoutSec INTEGER NOT NULL, maxConcurrency INTEGER NOT NULL
  );
  CREATE TABLE presets (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    providerId INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model TEXT NOT NULL, forceToolChoice INTEGER NOT NULL, extraBody TEXT NOT NULL
  );
  INSERT INTO providers VALUES (41, 'Existing provider', 'http://127.0.0.1:1/v1',
    'CLOCKTOWER_GAME_KEY', 300, 5);
  INSERT INTO presets VALUES (73, 'Existing preset', 41, 'existing-model', 1, '{}');
`)
legacyDb.close()

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  server: true,
  browser: false,
  // Tracing externals takes ~45s on Windows (nuxt/nuxt#34753); tests run against the repo's node_modules anyway.
  nuxtConfig: { nitro: { externals: { trace: false } } },
  env: {
    NUXT_DB_PATH: dbPath,
    CLOCKTOWER_GAME_KEY: 'game-test-secret',
  },
})

const randomDiscretions = {
  D1: 'random',
  seating: 'random',
  D2: 'random',
  D3: 'random',
  D4: 'random',
  D5: 'random',
  D6: 'random',
  D7: 'random',
  D8: 'random',
  D10: 'random',
  D11: 'random',
  D12: 'random',
  D13: 'random',
  D14: 'random',
} as const

async function preset(
  apiKeyEnv: string,
  baseUrl = 'http://127.0.0.1:1/v1',
  timeoutSec = 300,
  maxConcurrency = 5,
) {
  const provider = await $fetch<{ id: number }>('/api/providers', {
    method: 'POST',
    body: { name: 'Game provider', baseUrl, apiKeyEnv, timeoutSec, maxConcurrency },
  })
  return $fetch<{ id: number; providerId: number }>('/api/presets', {
    method: 'POST',
    body: {
      name: 'Game preset',
      providerId: provider.id,
      model: 'fake-model',
      forceToolChoice: true,
    },
  })
}

describe('legacy server SQLite games', () => {
  it('preserves existing provider and preset relationships when upgrading an unversioned database', async () => {
    expect(await $fetch<Provider[]>('/api/providers')).toContainEqual(
      expect.objectContaining({ id: 41, name: 'Existing provider', apiKeySet: true }),
    )
    expect(await $fetch<Preset[]>('/api/presets')).toContainEqual(
      expect.objectContaining({
        id: 73,
        providerId: 41,
        name: 'Existing preset',
        model: 'existing-model',
      }),
    )
  })

  it('never reuses a deleted provider ID and preserves preset cascade deletion after upgrade', async () => {
    const original = await preset('CLOCKTOWER_GAME_KEY')
    await $fetch(`/api/providers/${String(original.providerId)}`, { method: 'DELETE' })
    expect(await $fetch<Preset[]>('/api/presets')).not.toContainEqual(
      expect.objectContaining({ id: original.id }),
    )
    const replacement = await $fetch<Provider>('/api/providers', {
      method: 'POST',
      body: {
        name: 'Replacement provider',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKeyEnv: 'CLOCKTOWER_GAME_KEY',
      },
    })
    expect(replacement.id).toBeGreaterThan(original.providerId)
  })

  it('marks unfinished games aborted once on process restart while preserving terminal games', async () => {
    const fake = await startFakeProvider()
    try {
      fake.script({ kind: 'hang' }, { kind: 'hang' })
      const model = await preset('CLOCKTOWER_GAME_KEY', fake.baseUrl, 300, 1)
      const open = () =>
        $fetch<GameSummary>('/api/games', {
          method: 'POST',
          body: {
            discretions: randomDiscretions,
            presets: Array.from({ length: 5 }, () => model.id),
            language: 'en',
            whisperLimit: 0,
          },
        })
      const finished = await open()
      await $fetch(`/api/games/${finished.id}/abort`, { method: 'POST' })
      const unfinished = await open()
      await expect.poll(() => fake.requests.some((request) => !request.closed)).toBe(true)
      await stopServer()
      await startServer()
      const list = await $fetch<GameSummary[]>('/api/games')
      expect(list.find((game) => game.id === unfinished.id)).toMatchObject({
        status: 'aborted',
        reason: 'process_restart',
      })
      expect(list.find((game) => game.id === finished.id)).toMatchObject({
        status: 'aborted',
        reason: 'human',
      })
      await stopServer()
      await startServer()
      const events = await $fetch<GameEvent[]>(`/api/games/${unfinished.id}/events`)
      expect(events.filter((event) => event.type === 'game.aborted')).toEqual([
        expect.objectContaining({ reason: 'process_restart' }),
      ])
      expect(fake.requests.filter((request) => !request.closed)).toHaveLength(0)
    } finally {
      await fake.close()
    }
  })
})
