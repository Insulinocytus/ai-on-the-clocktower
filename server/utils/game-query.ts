import { z } from 'zod'
import type { Observer } from '#shared/types/game'

export const gameParams = z.object({ id: z.uuid() })
export const eventsQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  observer: z
    .enum(['spectator', 'storyteller', 'public', 'seat:1', 'seat:2', 'seat:3', 'seat:4', 'seat:5'])
    .default('spectator')
    .transform((value): Observer => value),
})
