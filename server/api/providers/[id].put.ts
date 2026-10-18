import { idParam, providerInput, updateProvider } from '../../utils/models'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (params) => idParam.parse(params))
  return updateProvider(id, await readValidatedBody(event, (body) => providerInput.parse(body)))
})
