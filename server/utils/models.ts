import { z } from 'zod'
import type { Preset, Provider } from '#shared/types/models'
import { useDb } from './db'

export const idParam = z.object({ id: z.coerce.number().int() })

export const providerInput = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }),
  apiKeyEnv: z.string().regex(/^[A-Za-z_]\w*$/, 'Must be an environment variable name'),
  timeoutSec: z.int().positive().default(300),
  maxConcurrency: z.int().positive().default(5),
})

type ProviderInput = z.infer<typeof providerInput>
type ProviderRow = ProviderInput & { id: number }

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

export const presetInput = z.object({
  name: z.string().trim().min(1),
  providerId: z.int(),
  model: z.string().trim().min(1),
  forceToolChoice: z.boolean().default(false),
  extraBody: z
    .string()
    .default('{}')
    .refine(isJsonObject, { message: 'extraBody must be a JSON object' }),
})

type PresetInput = z.infer<typeof presetInput>
type PresetParams = Omit<PresetInput, 'forceToolChoice'> & { forceToolChoice: 0 | 1 }
type PresetRow = PresetParams & { id: number }

// The key itself never leaves the process: callers only learn whether it is set.
const providerView = (row: ProviderRow): Provider => ({
  ...row,
  apiKeySet: Boolean(process.env[row.apiKeyEnv]),
})
const presetView = (row: PresetRow): Preset => ({
  ...row,
  forceToolChoice: row.forceToolChoice === 1,
})
const presetParams = (input: PresetInput): PresetParams => ({
  ...input,
  forceToolChoice: input.forceToolChoice ? 1 : 0,
})

function notFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

export function listProviders() {
  return useDb()
    .prepare<[], ProviderRow>('SELECT * FROM providers ORDER BY id')
    .all()
    .map(providerView)
}

export function getProvider(id: number): ProviderRow | undefined {
  return useDb().prepare<[number], ProviderRow>('SELECT * FROM providers WHERE id = ?').get(id)
}

export function createProvider(input: ProviderInput) {
  const row = useDb()
    .prepare<ProviderInput, ProviderRow>(
      `INSERT INTO providers (name, baseUrl, apiKeyEnv, timeoutSec, maxConcurrency)
       VALUES (@name, @baseUrl, @apiKeyEnv, @timeoutSec, @maxConcurrency) RETURNING *`,
    )
    .get(input)
  return providerView(row ?? notFound())
}

export function updateProvider(id: number, input: ProviderInput) {
  const row = useDb()
    .prepare<ProviderRow, ProviderRow>(
      `UPDATE providers SET name = @name, baseUrl = @baseUrl, apiKeyEnv = @apiKeyEnv,
       timeoutSec = @timeoutSec, maxConcurrency = @maxConcurrency WHERE id = @id RETURNING *`,
    )
    .get({ ...input, id })
  return providerView(row ?? notFound())
}

export function deleteProvider(id: number): void {
  if (useDb().prepare('DELETE FROM providers WHERE id = ?').run(id).changes === 0) notFound()
}

function assertProviderExists(providerId: number): void {
  if (!getProvider(providerId)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Provider ${String(providerId)} does not exist`,
    })
  }
}

export function listPresets() {
  return useDb().prepare<[], PresetRow>('SELECT * FROM presets ORDER BY id').all().map(presetView)
}

export function getPreset(id: number) {
  const row = useDb().prepare<[number], PresetRow>('SELECT * FROM presets WHERE id = ?').get(id)
  return presetView(row ?? notFound())
}

export function createPreset(input: PresetInput) {
  assertProviderExists(input.providerId)
  const row = useDb()
    .prepare<PresetParams, PresetRow>(
      `INSERT INTO presets (name, providerId, model, forceToolChoice, extraBody)
       VALUES (@name, @providerId, @model, @forceToolChoice, @extraBody) RETURNING *`,
    )
    .get(presetParams(input))
  return presetView(row ?? notFound())
}

export function updatePreset(id: number, input: PresetInput) {
  assertProviderExists(input.providerId)
  const row = useDb()
    .prepare<PresetRow, PresetRow>(
      `UPDATE presets SET name = @name, providerId = @providerId, model = @model,
       forceToolChoice = @forceToolChoice, extraBody = @extraBody WHERE id = @id RETURNING *`,
    )
    .get({ ...presetParams(input), id })
  return presetView(row ?? notFound())
}

export function deletePreset(id: number): void {
  if (useDb().prepare('DELETE FROM presets WHERE id = ?').run(id).changes === 0) notFound()
}
