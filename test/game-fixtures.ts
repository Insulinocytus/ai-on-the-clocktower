import { createPreset, createProvider } from '../app/api'
import type { ApiFormat } from '../shared/types/models'

export async function preset(
  apiKey: string,
  baseUrl = 'http://127.0.0.1:1/v1',
  timeoutSec = 300,
  maxConcurrency = 5,
  apiFormat: ApiFormat = 'openai_completions',
) {
  const provider = await createProvider({
    name: 'Game provider',
    baseUrl,
    apiFormat,
    apiKey,
    timeoutSec,
    maxConcurrency,
  })
  return createPreset({
    name: 'Game preset',
    providerId: provider.id,
    model: 'fake-model',
    forceToolChoice: true,
  })
}
