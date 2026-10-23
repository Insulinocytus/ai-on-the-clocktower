import { project } from '#shared/game/rules'
import { gameEvents, getGame } from '../../../utils/game-store'
import { eventsQuery, gameParams } from '../../../utils/game-query'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (value) => gameParams.parse(value))
  const { after, observer } = await getValidatedQuery(event, (value) => eventsQuery.parse(value))
  const game = getGame(id)
  if (!game.compatible)
    throw createError({ statusCode: 409, statusMessage: 'Incompatible engine version' })
  return project(gameEvents(id, after), observer)
})
