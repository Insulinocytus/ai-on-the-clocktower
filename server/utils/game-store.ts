import type { GameEvent, GameEventInput } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import { useDb } from './db'

export const LOG_VERSION = 2

type Listener = (event: GameEvent) => void
const listeners = new Map<string, Set<Listener>>()

export function gameEvents(id: string, after = 0): GameEvent[] {
  return useDb()
    .prepare<[string, number], { body: string }>(
      'SELECT body FROM game_events WHERE gameId = ? AND seq > ? ORDER BY seq',
    )
    .all(id, after)
    .map(({ body }) => JSON.parse(body) as GameEvent)
}

export function getGame(id: string): GameSummary {
  const row = useDb()
    .prepare<[string], { id: string; createdAt: string }>('SELECT * FROM games WHERE id = ?')
    .get(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  const events = gameEvents(id)
  const config = events[0]
  if (config?.type !== 'game.created') throw new Error('Game has no creation event')
  const terminal = events.findLast(
    (event) => event.type === 'game.ended' || event.type === 'game.aborted',
  )
  const pending = events.findLast(
    (event) => event.type === 'discretion.requested' && event.source === 'manual',
  )
  const waiting =
    pending &&
    !events.some((event) => event.type === 'discretion.resolved' && event.seq > pending.seq)
  const paused = events.findLast(
    (event) => event.type === 'game.paused' || event.type === 'game.resumed',
  )
  const status =
    terminal?.type === 'game.ended'
      ? 'ended'
      : terminal?.type === 'game.aborted'
        ? 'aborted'
        : paused?.type === 'game.paused'
          ? 'paused'
          : waiting
            ? 'waiting'
            : 'running'
  return {
    ...row,
    config,
    status,
    ...(terminal && 'reason' in terminal ? { reason: terminal.reason } : {}),
    replayable: config.logVersion === LOG_VERSION,
  }
}

export function listGames(): GameSummary[] {
  return useDb()
    .prepare<[], { id: string }>('SELECT id FROM games ORDER BY createdAt DESC, id')
    .all()
    .map(({ id }) => getGame(id))
}

export function insertGame(id: string): void {
  useDb()
    .prepare('INSERT INTO games (id, createdAt) VALUES (?, ?)')
    .run(id, new Date().toISOString())
}

export function appendGameEvent(id: string, input: GameEventInput, seq: number): GameEvent {
  const event = { ...input, seq }
  useDb()
    .prepare('INSERT INTO game_events (gameId, seq, body) VALUES (?, ?, ?)')
    .run(id, seq, JSON.stringify(event))
  for (const listener of listeners.get(id) ?? []) listener(event)
  return event
}

export function abortUnfinishedGames(): void {
  const games = useDb().prepare<[], { id: string }>('SELECT id FROM games').all()
  for (const { id } of games) {
    const events = gameEvents(id)
    if (!events.some((event) => event.type === 'game.ended' || event.type === 'game.aborted'))
      appendGameEvent(id, { type: 'game.aborted', reason: 'process_restart' }, events.length + 1)
  }
}

export function subscribeGame(id: string, listener: Listener): () => void {
  let subscribers = listeners.get(id)
  if (!subscribers) {
    subscribers = new Set()
    listeners.set(id, subscribers)
  }
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (subscribers.size === 0) listeners.delete(id)
  }
}
