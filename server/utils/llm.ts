import type { ChatMessage } from '#shared/game/tool-calls'
import type { Tool } from './tools'
import { getProvider } from './models'

/** Everything needed to address one model: provider connection plus preset call parameters. */
export interface LlmTarget {
  providerId: number
  baseUrl: string
  apiKeyEnv: string
  timeoutSec: number
  model: string
  forceToolChoice: boolean
  extraBody: Record<string, unknown>
}

export interface ChatRequest {
  messages: ChatMessage[]
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
    readonly kind:
      'network' | 'timeout' | 'http' | 'invalid_response' | 'missing_credentials' = 'network',
    readonly retryAfter?: string,
  ) {
    super(message)
  }
}

interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  cancel: () => void
}
interface ProviderQueue {
  active: number
  waiting: Waiter[]
}
const providerQueues = new Map<number, ProviderQueue>()

function drainProvider(id: number, queue: ProviderQueue): void {
  while (queue.waiting.length) {
    const provider = getProvider(id)
    if (provider && queue.active >= provider.maxConcurrency) break
    const waiter = queue.waiting.shift()
    if (!waiter) break
    waiter.signal?.removeEventListener('abort', waiter.cancel)
    if (!provider) {
      waiter.reject(new LlmCallError('Provider not found'))
      continue
    }
    queue.active++
    waiter.resolve(() => {
      queue.active--
      drainProvider(id, queue)
    })
  }
  if (queue.active === 0 && queue.waiting.length === 0) providerQueues.delete(id)
}

function acquireProvider(id: number, signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  let queue = providerQueues.get(id)
  if (!queue) {
    queue = { active: 0, waiting: [] }
    providerQueues.set(id, queue)
  }
  const pending = Promise.withResolvers<() => void>()
  const waiter: Waiter = {
    resolve: pending.resolve,
    reject: pending.reject,
    signal,
    cancel() {
      const index = queue.waiting.indexOf(waiter)
      if (index !== -1) queue.waiting.splice(index, 1)
      pending.reject(signal?.reason)
      drainProvider(id, queue)
    },
  }
  queue.waiting.push(waiter)
  signal?.addEventListener('abort', waiter.cancel, { once: true })
  drainProvider(id, queue)
  return pending.promise
}

/** One OpenAI-compatible Chat Completions call with tools; resolves to the whole raw response. */
export async function chatCompletion(
  target: LlmTarget,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const release = await acquireProvider(target.providerId, signal)
  try {
    signal?.throwIfAborted()
    return await complete(target, request, signal)
  } finally {
    release()
  }
}

async function complete(
  target: LlmTarget,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const apiKey = process.env[target.apiKeyEnv]
  if (!apiKey)
    throw new LlmCallError(
      `Environment variable ${target.apiKeyEnv} is not set`,
      undefined,
      'missing_credentials',
    )

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
    if (timeout.aborted)
      throw new LlmCallError(`Timed out after ${String(target.timeoutSec)}s`, undefined, 'timeout')
    throw new LlmCallError(
      `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (status < 200 || status >= 300) {
    const hint = retryAfter === null ? '' : ` (Retry-After: ${retryAfter})`
    throw new LlmCallError(`HTTP ${String(status)}${hint}`, text, 'http', retryAfter ?? undefined)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new LlmCallError('Response body is not JSON', text, 'invalid_response')
  }
}
