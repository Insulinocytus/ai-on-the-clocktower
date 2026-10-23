import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import {
  abortGame,
  createGame,
  createPreset,
  createProvider,
  gameEvents,
  getGame,
  listGames,
  subscribeGame,
  submitManualDiscretion,
} from '../app/api'
import { DISCRETION_IDS } from '../shared/game/rules'
import type { GameEvent } from '../shared/types/game'
import { inTransaction, requestResult } from '../app/api/storage'

it('preserves existing model records while adding game storage to version one', async () => {
  const request = indexedDB.open('ai-on-the-clocktower', 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore('providers', { keyPath: 'id', autoIncrement: true })
    const presets = request.result.createObjectStore('presets', {
      keyPath: 'id',
      autoIncrement: true,
    })
    presets.createIndex('providerId', 'providerId')
  }
  const db = await requestResult(request)
  const transaction = db.transaction(['providers', 'presets'], 'readwrite')
  await requestResult(
    transaction.objectStore('providers').add({
      id: 41,
      name: 'Existing',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'secret',
      timeoutSec: 300,
      maxConcurrency: 5,
    }),
  )
  await requestResult(
    transaction.objectStore('presets').add({
      id: 73,
      name: 'Existing',
      providerId: 41,
      model: 'existing-model',
      forceToolChoice: true,
      extraBody: '{}',
    }),
  )
  db.close()
  const game = await createGame({ presets: [73, 73, 73, 73, 73], language: 'en' })
  expect(game.config.seats).toHaveLength(5)
  for (const [index, seat] of game.config.seats.entries()) {
    expect(seat).toMatchObject({ id: 73, providerId: 41, model: 'existing-model', seat: index + 1 })
  }
  await abortGame(game.id)
})

it('creates a persisted game and waits for manual discretion before human termination', async () => {
  const provider = await createProvider({
    name: 'Game provider',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'secret',
  })
  const model = await createPreset({ name: 'Game model', providerId: provider.id, model: 'test' })
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  try {
    await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
    expect(await listGames()).toContainEqual(
      expect.objectContaining({ id: game.id, compatible: true }),
    )
    expect(await gameEvents(game.id)).toContainEqual(
      expect.objectContaining({ type: 'discretion.requested', discretion: 'D1', source: 'manual' }),
    )
  } finally {
    expect(await abortGame(game.id)).toMatchObject({ status: 'aborted', reason: 'human' })
  }
})

it('backfills after seq and projects new events independently for each subscriber', async () => {
  const provider = await createProvider({
    name: 'Subscriptions',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'secret',
  })
  const model = await createPreset({
    name: 'Subscriptions',
    providerId: provider.id,
    model: 'test',
  })
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
    discretions: {
      ...Object.fromEntries(DISCRETION_IDS.map((id) => [id, 'random'])),
      D1: 'manual',
    },
  })
  const all: GameEvent[] = []
  const seat: GameEvent[] = []
  const publicEvents: GameEvent[] = []
  const unsubscribe: (() => void)[] = []
  try {
    await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
    const history = await gameEvents(game.id)
    const request = history.find((event) => event.type === 'discretion.requested')
    if (!request) throw new Error('Missing manual setup')
    unsubscribe.push(await subscribeGame(game.id, 'spectator', 1, (event) => all.push(event)))
    expect(all).toEqual(history.slice(1))
    unsubscribe.push(await subscribeGame(game.id, 'seat:1', 1, (event) => seat.push(event)))
    unsubscribe.push(await subscribeGame(game.id, 'public', 1, (event) => publicEvents.push(event)))
    expect(seat).not.toContainEqual(expect.objectContaining({ type: 'discretion.requested' }))
    await submitManualDiscretion(game.id, request.seq, [
      'chef',
      'empath',
      'soldier',
      'poisoner',
      'imp',
    ])
    await expect
      .poll(() => all.filter((event) => event.type === 'told' && event.kind === 'role').length)
      .toBe(5)
    expect(seat.filter((event) => event.type === 'told' && event.kind === 'role')).toEqual([
      expect.objectContaining({ type: 'told', seat: 1, kind: 'role' }),
    ])
    expect(publicEvents).not.toContainEqual(expect.objectContaining({ type: 'told' }))
    expect(publicEvents).toContainEqual(expect.objectContaining({ type: 'phase.started' }))
    expect(all.map((event) => event.seq)).toEqual(
      Array.from({ length: all.length }, (_, i) => i + 2),
    )
    for (const cancel of unsubscribe) cancel()
    const count = all.length
    await abortGame(game.id)
    expect(all).toHaveLength(count)
  } finally {
    for (const cancel of unsubscribe) cancel()
    await abortGame(game.id)
  }
})

it('lists incompatible games but refuses both history and subscriptions', async () => {
  const provider = await createProvider({
    name: 'Old engine',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'secret',
  })
  const model = await createPreset({ name: 'Old engine', providerId: provider.id, model: 'test' })
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  await abortGame(game.id)
  const creation = (await gameEvents(game.id))[0]
  if (creation?.type !== 'game.created') throw new Error('Missing creation event')
  await inTransaction('gameEvents', 'readwrite', async (transaction) => {
    await requestResult(
      transaction
        .objectStore('gameEvents')
        .put({ gameId: game.id, seq: 1, event: { ...creation, engineVersion: -1 } }),
    )
  })
  expect(await getGame(game.id)).toMatchObject({ compatible: false })
  expect(await listGames()).toContainEqual(
    expect.objectContaining({ id: game.id, compatible: false }),
  )
  await expect(gameEvents(game.id)).rejects.toThrow('Incompatible engine version')
  await expect(subscribeGame(game.id, 'spectator', 0, vi.fn())).rejects.toThrow(
    'Incompatible engine version',
  )
})
