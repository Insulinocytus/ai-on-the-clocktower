import { visibleTo } from '#shared/game/rules'
import type { GameEvent } from '#shared/types/game'
import { gameEvents, getGame, subscribeGame } from '../../../utils/game-store'
import { eventsQuery, gameParams } from '../../../utils/game-query'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (value) => gameParams.parse(value))
  const query = await getValidatedQuery(event, (value) => eventsQuery.parse(value))
  const lastId = getHeader(event, 'last-event-id')
  const after = lastId === undefined ? query.after : eventsQuery.parse({ after: lastId }).after
  if (!getGame(id).compatible)
    throw createError({ statusCode: 409, statusMessage: 'Incompatible engine version' })
  const stream = createEventStream(event)
  let cursor = after
  const push = (entry: GameEvent) => {
    if (entry.seq <= cursor) return
    cursor = entry.seq
    if (visibleTo(entry, query.observer))
      void stream
        .push({ id: String(entry.seq), data: JSON.stringify(entry) })
        .catch(() => stream.close())
  }
  const unsubscribe = subscribeGame(id, push)
  stream.onClosed(unsubscribe)
  for (const entry of gameEvents(id, after)) push(entry)
  // A ready event flushes headers even when the observer has no visible backlog.
  void stream.push({ event: 'ready', data: String(cursor) }).catch(() => stream.close())
  return stream.send()
})
