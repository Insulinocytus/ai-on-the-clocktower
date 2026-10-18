import type { ValidationError } from '../../shared/rules/types'

export type ChatMessage = { role: 'system' | 'user'; content: string }
export type OpenAITool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type RetryNote = { attempt: number; call: { tool: string; args: unknown } | null; error: ValidationError }
