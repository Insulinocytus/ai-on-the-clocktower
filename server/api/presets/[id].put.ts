import { idParam, presetInput, updatePreset } from '../../utils/models'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (params) => idParam.parse(params))
  return updatePreset(id, await readValidatedBody(event, (body) => presetInput.parse(body)))
})
