import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import {
  abortGame,
  createGame,
  gameEvents,
  getGame,
  listGames,
  resetGameRunnersForTest,
  resumeGame,
  subscribeGame,
  submitManualDiscretion,
} from '../app/api'
import { DISCRETION_IDS } from '../shared/game/rules'
import type { GameEvent } from '../shared/types/game'
import { inTransaction, requestResult } from '../app/api/storage'
import { preset } from './game-fixtures'

const subscriptionError = (error: unknown) => {
  throw error
}
it('creates a persisted game and waits for manual discretion before human termination', async () => {
  const model = await preset('secret')
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
  const model = await preset('secret')
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
    unsubscribe.push(
      subscribeGame(game.id, 'spectator', 1, (event) => all.push(event), subscriptionError),
    )
    await expect.poll(() => all).toEqual(history.slice(1))
    unsubscribe.push(
      subscribeGame(game.id, 'seat:1', 1, (event) => seat.push(event), subscriptionError),
    )
    unsubscribe.push(
      subscribeGame(game.id, 'public', 1, (event) => publicEvents.push(event), subscriptionError),
    )
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
  const model = await preset('secret')
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
  const failed = vi.fn<(error: unknown) => void>()
  const unsubscribe = subscribeGame(game.id, 'spectator', 0, vi.fn(), failed)
  await expect
    .poll(() => failed.mock.calls[0]?.[0])
    .toEqual(new Error('Incompatible engine version'))
  unsubscribe()
})

it('restores the same manual wait after a refresh without rewriting history', async () => {
  const model = await preset('secret')
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  const before = await gameEvents(game.id)
  const request = before.find((event) => event.type === 'discretion.requested')
  if (!request) throw new Error('Missing manual request')
  await resetGameRunnersForTest()
  expect(await getGame(game.id)).toMatchObject({ status: 'paused' })
  await resumeGame(game.id)
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  expect(await gameEvents(game.id)).toEqual(before)
  await submitManualDiscretion(game.id, request.seq, [
    'chef',
    'empath',
    'fortuneteller',
    'poisoner',
    'imp',
  ])
  await expect
    .poll(async () =>
      (await gameEvents(game.id)).some((event) => event.type === 'discretion.resolved'),
    )
    .toBe(true)
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  const resolvedHistory = await gameEvents(game.id)
  await resetGameRunnersForTest()
  await resumeGame(game.id)
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  expect(await gameEvents(game.id)).toEqual(resolvedHistory)
  await resetGameRunnersForTest()
  expect(await abortGame(game.id)).toMatchObject({ status: 'aborted', reason: 'human' })
})

it.each(['event', 'version'] as const)(
  'rejects %s divergence instead of running an incompatible history',
  async (change) => {
    const model = await preset('secret')
    const game = await createGame({
      presets: Array.from({ length: 5 }, () => model.id),
      language: 'en',
    })
    await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
    await resetGameRunnersForTest()
    const before = await gameEvents(game.id)
    const original = before[change === 'version' ? 0 : 1]
    if (!original) throw new Error('Missing replay event')
    const modified =
      change === 'version' ? { ...original, engineVersion: -1 } : { ...original, discretion: 'D2' }
    await inTransaction('gameEvents', 'readwrite', async (transaction) => {
      await requestResult(
        transaction
          .objectStore('gameEvents')
          .put({ gameId: game.id, seq: original.seq, event: modified }),
      )
    })
    if (change === 'version') {
      await expect(resumeGame(game.id)).rejects.toThrow('Incompatible engine version')
      expect(await getGame(game.id)).toMatchObject({ status: 'paused', compatible: false })
      await abortGame(game.id)
    } else {
      await resumeGame(game.id)
      await expect.poll(async () => (await getGame(game.id)).status).toBe('aborted')
      const after = await gameEvents(game.id)
      expect(after.slice(0, before.length)).toEqual(
        before.map((event) => (event.seq === original.seq ? modified : event)),
      )
      expect(after.at(-1)).toMatchObject({
        type: 'game.aborted',
        reason: 'engine_error',
        error: expect.stringContaining('Replay divergence at seq 2') as unknown,
      })
    }
  },
)

it('starts only one runner when a page-closed game is resumed twice concurrently', async () => {
  const model = await preset('secret')
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  await resetGameRunnersForTest()
  const before = await gameEvents(game.id)
  try {
    await Promise.all([resumeGame(game.id), resumeGame(game.id)])
    expect(await getGame(game.id)).toMatchObject({ status: 'waiting' })
    expect(await gameEvents(game.id)).toEqual(before)
  } finally {
    await abortGame(game.id)
  }
})

it('appends human termination after the full history when aborted during recovery', async () => {
  const model = await preset('secret')
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  await expect.poll(async () => (await getGame(game.id)).status).toBe('waiting')
  const setup = (await gameEvents(game.id)).find((event) => event.type === 'discretion.requested')
  if (!setup) throw new Error('Missing setup request')
  await submitManualDiscretion(game.id, setup.seq, [
    'chef',
    'empath',
    'fortuneteller',
    'poisoner',
    'imp',
  ])
  await expect
    .poll(async () =>
      (await gameEvents(game.id)).some(
        (event) => event.type === 'discretion.requested' && event.discretion === 'D3',
      ),
    )
    .toBe(true)
  await resetGameRunnersForTest()
  const before = await gameEvents(game.id)
  let recovered = false
  const resuming = resumeGame(game.id).then(() => {
    recovered = true
  })
  while ((await getGame(game.id)).status === 'paused') {
    /* Wait for runner acquisition. */
  }
  expect(recovered).toBe(false)
  expect(await abortGame(game.id)).toMatchObject({ status: 'aborted', reason: 'human' })
  await resuming
  const after = await gameEvents(game.id)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.slice(before.length)).toEqual([
    { type: 'game.aborted', reason: 'human', seq: before.length + 1 },
  ])
})

it('returns subscription cancellation immediately and cancels pending history delivery', async () => {
  const model = await preset('secret')
  const game = await createGame({
    presets: Array.from({ length: 5 }, () => model.id),
    language: 'en',
  })
  const received = vi.fn()
  const unsubscribe = subscribeGame(game.id, 'spectator', 0, received, subscriptionError)
  expect(unsubscribe).toBeTypeOf('function')
  unsubscribe()
  await abortGame(game.id)
  expect(received).not.toHaveBeenCalled()
})
