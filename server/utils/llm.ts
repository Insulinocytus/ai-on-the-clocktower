import type { Tool } from './tools'

/** Everything needed to address one model: provider connection plus preset call parameters. */
export interface LlmTarget {
  baseUrl: string
  apiKeyEnv: string
  timeoutSec: number
  model: string
  forceToolChoice: boolean
  extraBody: Record<string, unknown>
}

export interface ChatRequest {
  messages: { role: 'system' | 'user'; content: string }[]
  tools: Tool[]
  /** The tool the request asks for; forced via `tool_choice` when the preset allows it. */
  tool: string
}

/** A call that produced no usable completion: missing key, network error, timeout, non-2xx or non-JSON body. */
export class LlmCallError extends Error {
  constructor(
    message: string,
    /** Raw response body, when there was one. */
    readonly body?: string,
  ) {
    super(message)
  }
}

/** One OpenAI-compatible Chat Completions call with tools; resolves to the whole raw response. */
export async function chatCompletion(
  target: LlmTarget,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const apiKey = process.env[target.apiKeyEnv]
  if (!apiKey) throw new LlmCallError(`Environment variable ${target.apiKeyEnv} is not set`)

  // Core request fields and preset policies take precedence over extra_body.
  const body: Record<string, unknown> = {
    ...target.extraBody,
    model: target.model,
    messages: request.messages,
    tools: request.tools,
    ...(target.forceToolChoice && {
      tool_choice: { type: 'function', function: { name: request.tool } },
    }),
  }
  delete body.temperature
  if (!target.forceToolChoice) delete body.tool_choice
  const timeout = AbortSignal.timeout(target.timeoutSec * 1000)
  let status: number
  let retryAfter: string | null
  let text: string
  try {
    const res = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    status = res.status
    retryAfter = res.headers.get('retry-after')
    text = await res.text()
  } catch (error) {
    signal?.throwIfAborted()
    if (timeout.aborted) throw new LlmCallError(`Timed out after ${String(target.timeoutSec)}s`)
    throw new LlmCallError(
      `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (status < 200 || status >= 300) {
    const hint = retryAfter === null ? '' : ` (Retry-After: ${retryAfter})`
    throw new LlmCallError(`HTTP ${String(status)}${hint}`, text)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new LlmCallError('Response body is not JSON', text)
  }
}
