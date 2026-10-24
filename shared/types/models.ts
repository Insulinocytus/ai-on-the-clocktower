export const API_FORMATS = ['openai_completions', 'openai_responses', 'anthropic_messages'] as const
export type ApiFormat = (typeof API_FORMATS)[number]

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
