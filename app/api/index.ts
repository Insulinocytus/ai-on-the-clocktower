import { z } from 'zod'
import { API_FORMATS, type Preset } from '../../shared/types/models'
import { inTransaction, openDatabase, requestResult } from './storage'

export { trialPreset } from './trial'
export { createGame } from './games'
export { getGame, listGames, gameEvents, subscribeGame } from './game-store'
export {
  abortGame,
  resumeGame,
  submitManualDiscretion,
  resetGameRunnersForTest,
  ManualDiscretionConflictError,
} from './game-runner'

export async function initializeApplication(): Promise<void> {
  await openDatabase()
  // Persistence permission is optional; it must not block application startup.
  void navigator.storage.persist().catch(() => false)
}

const providerInput = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }),
  apiFormat: z.enum(API_FORMATS),
  apiKey: z.string().trim().min(1),
  timeoutSec: z.int().positive().default(300),
  maxConcurrency: z.int().positive().default(5),
})

export type Provider = z.infer<typeof providerInput> & { id: number }

const idInput = z.object({ id: z.int() })

interface ModelRecords {
  providers: Provider
  presets: Preset
}

export async function requireModelRecord<Store extends keyof ModelRecords>(
  store: Store,
  id: number,
  transaction?: IDBTransaction,
  missing: string | (() => Error) = store === 'providers' ? 'Provider not found' : 'Not found',
): Promise<ModelRecords[Store]> {
  if (!transaction) {
    return inTransaction(store, 'readonly', (transaction) =>
      requireModelRecord(store, id, transaction, missing),
    )
  }
  const record = await requestResult(
    transaction.objectStore(store).get(id) as IDBRequest<ModelRecords[Store] | undefined>,
  )
  if (!record) throw typeof missing === 'string' ? new Error(missing) : missing()
  return record
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

const presetInput = z.object({
  name: z.string().trim().min(1),
  providerId: z.int(),
  model: z.string().trim().min(1),
  forceToolChoice: z.boolean().default(false),
  extraBody: z
    .string()
    .default('{}')
    .refine(isJsonObject, { message: 'extraBody must be a JSON object' }),
})

export async function createProvider(input: unknown): Promise<Provider> {
  const provider = providerInput.parse(input)
  return inTransaction('providers', 'readwrite', async (transaction) => {
    const id = await requestResult(transaction.objectStore('providers').add(provider))
    return { ...provider, id: Number(id) }
  })
}

export async function listProviders(): Promise<Provider[]> {
  return inTransaction('providers', 'readonly', (transaction) =>
    requestResult(transaction.objectStore('providers').getAll() as IDBRequest<Provider[]>),
  )
}

export async function updateProvider(id: number, input: unknown): Promise<Provider> {
  idInput.parse({ id })
  const provider = { ...providerInput.parse(input), id }
  return inTransaction('providers', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('providers')
    await requireModelRecord('providers', id, transaction, 'Not found')
    await requestResult(store.put(provider))
    return provider
  })
}

export async function deleteProvider(id: number): Promise<void> {
  idInput.parse({ id })
  return inTransaction(['providers', 'presets'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('providers')
    await requireModelRecord('providers', id, transaction, 'Not found')
    const presets = transaction.objectStore('presets')
    const ids = await requestResult<IDBValidKey[]>(presets.index('providerId').getAllKeys(id))
    await Promise.all(ids.map((key) => requestResult(presets.delete(key))))
    await requestResult(store.delete(id))
  })
}

export async function createPreset(input: unknown): Promise<Preset> {
  const preset = presetInput.parse(input)
  return inTransaction(['providers', 'presets'], 'readwrite', async (transaction) => {
    await requireModelRecord(
      'providers',
      preset.providerId,
      transaction,
      `Provider ${String(preset.providerId)} does not exist`,
    )
    const id = await requestResult(transaction.objectStore('presets').add(preset))
    return { ...preset, id: Number(id) }
  })
}

export async function listPresets(): Promise<Preset[]> {
  return inTransaction('presets', 'readonly', (transaction) =>
    requestResult(transaction.objectStore('presets').getAll() as IDBRequest<Preset[]>),
  )
}

export async function updatePreset(id: number, input: unknown): Promise<Preset> {
  idInput.parse({ id })
  const preset = { ...presetInput.parse(input), id }
  return inTransaction(['providers', 'presets'], 'readwrite', async (transaction) => {
    await requireModelRecord(
      'providers',
      preset.providerId,
      transaction,
      `Provider ${String(preset.providerId)} does not exist`,
    )
    const store = transaction.objectStore('presets')
    await requireModelRecord('presets', id, transaction)
    await requestResult(store.put(preset))
    return preset
  })
}

export async function deletePreset(id: number): Promise<void> {
  idInput.parse({ id })
  return inTransaction('presets', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('presets')
    await requireModelRecord('presets', id, transaction)
    await requestResult(store.delete(id))
  })
}
