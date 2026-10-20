import { z } from 'zod'
import { gameParams } from '../../../../utils/game-query'
import { submitManualDiscretion } from '../../../../utils/game-runtime'

const params = gameParams.extend({ seq: z.coerce.number().int().positive() })
const input = z.object({ choice: z.unknown() })

export default defineEventHandler(async (event) => {
  const { id, seq } = await getValidatedRouterParams(event, (value) => params.parse(value))
  const { choice } = await readValidatedBody(event, (value) => input.parse(value))
  return submitManualDiscretion(id, seq, choice)
})
