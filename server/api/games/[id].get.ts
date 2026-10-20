import { gameParams } from '../../utils/game-query'
import { getGame } from '../../utils/game-store'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (value) => gameParams.parse(value))
  return getGame(id)
})
