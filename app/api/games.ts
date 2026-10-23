import { z } from 'zod'
import { DISCRETION_IDS } from '../../shared/game/rules'
import { ENGINE_VERSION } from '../../shared/game/version'
import type { GameConfig } from '../../shared/types/game'
import type { Preset } from '../../shared/types/models'
import { getGame, insertGame } from './game-store'
import { startGameRunner } from './game-runner'
import { inTransaction, requestResult } from './storage'

const gameInput = z.object({
  presets: z.array(z.int()).min(5).max(15),
  language: z.enum(['zh', 'en']),
  speechLimit: z.int().min(1).default(10),
  whisperLimit: z.int().min(0).default(3),
  discretions: z
    .partialRecord(z.enum(DISCRETION_IDS), z.enum(['random', 'storyteller', 'manual']))
    .default({}),
  storyteller: z.int().nullable().optional(),
})

export async function createGame(value: unknown) {
  const input = gameInput.parse(value)
  const discretions = Object.fromEntries(
    DISCRETION_IDS.map((id) => [id, input.discretions[id] ?? 'manual']),
  ) as GameConfig['discretions']
  const needsStoryteller = Object.values(discretions).includes('storyteller')
  if (needsStoryteller && !input.storyteller) throw new Error('Storyteller preset is required')
  const { seats, storyteller } = await inTransaction(
    ['presets', 'providers'],
    'readonly',
    async (transaction) => {
      async function preset(id: number): Promise<Preset> {
        const model = await requestResult(
          transaction.objectStore('presets').get(id) as IDBRequest<Preset | undefined>,
        )
        if (!model) throw new Error('Not found')
        if (!(await requestResult(transaction.objectStore('providers').getKey(model.providerId))))
          throw new Error('Provider not found')
        return model
      }
      const seats = await Promise.all(
        input.presets.map(async (id, index) => ({ ...(await preset(id)), seat: index + 1 })),
      )
      const storyteller =
        needsStoryteller && input.storyteller ? await preset(input.storyteller) : null
      return { seats, storyteller }
    },
  )
  const config: GameConfig = {
    seatCount: seats.length,
    seats,
    storyteller,
    discretions,
    speechLimit: input.speechLimit,
    whisperLimit: input.whisperLimit,
    language: input.language,
    seed: Math.floor(Math.random() * 2 ** 32),
    engineVersion: ENGINE_VERSION,
  }
  const id = crypto.randomUUID()
  const creation = await insertGame(id, { type: 'game.created', ...config })
  startGameRunner(id, config, creation)
  return getGame(id)
}
