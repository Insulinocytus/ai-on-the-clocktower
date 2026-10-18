import { createProvider, providerInput } from '../../utils/models'

export default defineEventHandler(async (event) =>
  createProvider(await readValidatedBody(event, (body) => providerInput.parse(body))),
)
