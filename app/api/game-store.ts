import type { GameEvent, GameEventInput, Observer } from '../../shared/types/game'
import type { GameSummary } from '../../shared/types/game-view'
import { project, visibleTo } from '../../shared/game/rules'
import { ENGINE_VERSION } from '../../shared/game/version'
import { inTransaction, requestResult } from './storage'
import { z } from 'zod'
import { hasGameRunner } from './game-runner'

interface GameRow {
  id: string
  createdAt: string
}
interface StoredEvent {
  gameId: string
  seq: number
  event: GameEvent
}
type Listener = (event: GameEvent) => void
const listeners = new Map<string, Set<Listener>>()
const idInput = z.uuid()
const eventsInput = z.object({
  observer: z.string().regex(/^(spectator|storyteller|public|seat:([1-9]|1[0-5]))$/),
  after: z.int().nonnegative(),
})

export async function storedGameEvents(id: string, after = 0): Promise<GameEvent[]> {
  return inTransaction('gameEvents', 'readonly', async (transaction) => {
    const rows = await requestResult(
      transaction
        .objectStore('gameEvents')
        .getAll(IDBKeyRange.bound([id, after], [id, Infinity], true)) as IDBRequest<StoredEvent[]>,
    )
    return rows.map(({ event }) => event)
  })
}

export async function getGame(id: string): Promise<GameSummary> {
  idInput.parse(id)
  const row = await inTransaction('games', 'readonly', (transaction) =>
    requestResult(transaction.objectStore('games').get(id) as IDBRequest<GameRow | undefined>),
  )
  if (!row) throw new Error('Game not found')
  const events = await storedGameEvents(id)
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
        : !hasGameRunner(id) || paused?.type === 'game.paused'
          ? 'paused'
          : waiting
            ? 'waiting'
            : 'running'
  return {
    ...row,
    config,
    status,
    ...(terminal && 'reason' in terminal ? { reason: terminal.reason } : {}),
    compatible: config.engineVersion === ENGINE_VERSION,
  }
}

export async function listGames(): Promise<GameSummary[]> {
  const rows = await inTransaction('games', 'readonly', (transaction) =>
    requestResult(transaction.objectStore('games').getAll() as IDBRequest<GameRow[]>),
  )
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  return Promise.all(rows.map((row) => getGame(row.id)))
}

export async function insertGame(
  id: string,
  config: GameEventInput & { type: 'game.created' },
): Promise<GameEvent> {
  const event: GameEvent = { ...config, seq: 1 }
  await inTransaction(['games', 'gameEvents'], 'readwrite', async (transaction) => {
    await requestResult(
      transaction.objectStore('games').add({ id, createdAt: new Date().toISOString() }),
    )
    await requestResult(transaction.objectStore('gameEvents').add({ gameId: id, seq: 1, event }))
  })
  return event
}

export async function appendGameEvent(id: string, event: GameEvent): Promise<void> {
  await inTransaction('gameEvents', 'readwrite', async (transaction) => {
    await requestResult(
      transaction.objectStore('gameEvents').add({ gameId: id, seq: event.seq, event }),
    )
  })
  for (const listener of listeners.get(id) ?? []) listener(event)
}

export async function gameEvents(
  id: string,
  observer: Observer = 'spectator',
  after = 0,
): Promise<GameEvent[]> {
  eventsInput.parse({ observer, after })
  if (!(await getGame(id)).compatible) throw new Error('Incompatible engine version')
  return project(await storedGameEvents(id, after), observer)
}

export function subscribeGame(
  id: string,
  observer: Observer,
  after: number,
  listener: Listener,
  onError: (error: unknown) => void,
): () => void {
  eventsInput.parse({ observer, after })
  idInput.parse(id)
  const buffered: GameEvent[] = []
  let catchingUp = true
  let cursor = after
  let cancelled = false
  const deliver = (event: GameEvent) => {
    if (cancelled) return
    if (event.seq <= cursor) return
    cursor = event.seq
    if (visibleTo(event, observer)) listener(structuredClone(event))
  }
  const receive = (event: GameEvent) => {
    if (catchingUp) buffered.push(event)
    else deliver(event)
  }
  let subscribers = listeners.get(id)
  if (!subscribers) {
    subscribers = new Set()
    listeners.set(id, subscribers)
  }
  subscribers.add(receive)
  const unsubscribe = () => {
    subscribers.delete(receive)
    cancelled = true
    if (subscribers.size === 0 && listeners.get(id) === subscribers) listeners.delete(id)
  }
  void (async () => {
    if (!(await getGame(id)).compatible) throw new Error('Incompatible engine version')
    for (const event of await storedGameEvents(id, after)) deliver(event)
    for (const event of buffered) deliver(event)
    catchingUp = false
  })().catch((error: unknown) => {
    if (cancelled) return
    unsubscribe()
    onError(error)
  })
  return unsubscribe
}
