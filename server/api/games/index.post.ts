import { createGame, gameInput } from '../../utils/game-runtime'

export default defineEventHandler(async (event) =>
  createGame(await readValidatedBody(event, (body) => gameInput.parse(body))),
)
