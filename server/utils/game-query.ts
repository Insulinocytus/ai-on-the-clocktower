import { z } from 'zod'
import type { Observer } from '#shared/types/game'

export const gameParams = z.object({ id: z.uuid() })
export const eventsQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  observer: z
    .string()
    .regex(/^(spectator|storyteller|public|seat:([1-9]|1[0-5]))$/)
    .default('spectator')
    .transform((value) => value as Observer),
})
