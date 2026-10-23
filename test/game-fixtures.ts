import { createPreset, createProvider } from '../app/api'

export async function preset(
  apiKey: string,
  baseUrl = 'http://127.0.0.1:1/v1',
  timeoutSec = 300,
  maxConcurrency = 5,
) {
  const provider = await createProvider({
    name: 'Game provider',
    baseUrl,
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
