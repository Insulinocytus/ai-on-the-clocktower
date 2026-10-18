import { deleteProvider, idParam } from '../../utils/models'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (params) => idParam.parse(params))
  deleteProvider(id)
  setResponseStatus(event, 204)
})
