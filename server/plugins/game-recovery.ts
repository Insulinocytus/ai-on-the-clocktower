import { abortUnfinishedGames } from '../utils/game-store'

export default defineNitroPlugin(() => {
  abortUnfinishedGames()
})
