import { gameParams } from '../../../utils/game-query'
import { resumeGame } from '../../../utils/game-runtime'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (value) => gameParams.parse(value))
  return resumeGame(id)
})
