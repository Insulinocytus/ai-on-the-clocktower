/** An LLM provider as the API returns it: the credential's value never leaves the server, only whether it is set. */
export interface Provider {
  id: number
  name: string
  baseUrl: string
  /** Name of the environment variable holding the API key. */
  apiKeyEnv: string
  apiKeySet: boolean
  timeoutSec: number
  maxConcurrency: number
}

export interface Preset {
  id: number
  name: string
  providerId: number
  model: string
  forceToolChoice: boolean
  /** Free-form JSON object text, merged into every request body. */
  extraBody: string
}

/** Outcome of a preset trial call; `raw` is the provider's whole response (parsed JSON, or the body text on failure). */
export interface TrialResult {
  valid: boolean
  error?: string
  toolCall?: { name: string; arguments: unknown }
  raw: unknown
}
