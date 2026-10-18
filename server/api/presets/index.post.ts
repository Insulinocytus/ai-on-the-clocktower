import { createPreset, presetInput } from '../../utils/models'

export default defineEventHandler(async (event) =>
  createPreset(await readValidatedBody(event, (body) => presetInput.parse(body))),
)
