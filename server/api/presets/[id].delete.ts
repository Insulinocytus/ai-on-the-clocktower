import { deletePreset, idParam } from '../../utils/models'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (params) => idParam.parse(params))
  deletePreset(id)
  setResponseStatus(event, 204)
})
