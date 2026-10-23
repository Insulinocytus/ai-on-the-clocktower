import type { ChatMessage } from '../../shared/game/tool-calls'
import type { Tool } from '../../shared/game/tools'
import type { Provider } from './index'
import { inTransaction, requestResult } from './storage'

export interface LlmTarget {
  providerId: number
  baseUrl: string
  apiKey: string
  timeoutSec: number
  model: string
  forceToolChoice: boolean
  extraBody: Record<string, unknown>
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools: Tool[]
  tool: string
}

export class LlmCallError extends Error {
  constructor(
    message: string,
    readonly body?: string,
    readonly kind: 'network' | 'timeout' | 'http' | 'invalid_response' = 'network',
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
  draining: boolean
}
const providerQueues = new Map<number, ProviderQueue>()

async function drainProvider(id: number, queue: ProviderQueue): Promise<void> {
  if (queue.draining) return
  if (queue.waiting.length === 0) {
    if (queue.active === 0) providerQueues.delete(id)
    return
  }
  queue.draining = true
  try {
    const provider = await inTransaction('providers', 'readonly', (transaction) =>
      requestResult(
        transaction.objectStore('providers').get(id) as IDBRequest<Provider | undefined>,
      ),
    )
    while (queue.waiting.length) {
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
        void drainProvider(id, queue)
      })
    }
  } catch (error) {
    for (const waiter of queue.waiting.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.cancel)
      waiter.reject(error)
    }
  } finally {
    queue.draining = false
    if (queue.active === 0 && queue.waiting.length === 0) providerQueues.delete(id)
  }
}

function acquireProvider(id: number, signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  let queue = providerQueues.get(id)
  if (!queue) {
    queue = { active: 0, waiting: [], draining: false }
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
      void drainProvider(id, queue)
    },
  }
  queue.waiting.push(waiter)
  signal?.addEventListener('abort', waiter.cancel, { once: true })
  void drainProvider(id, queue)
  return pending.promise
}

export async function chatCompletion(
  target: LlmTarget,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const release = await acquireProvider(target.providerId, signal)
  try {
    signal?.throwIfAborted()
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
    let response: Response
    let text: string
    try {
      response = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}` },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      text = await response.text()
    } catch (error) {
      signal?.throwIfAborted()
      if (timeout.aborted) {
        throw new LlmCallError(
          `Timed out after ${String(target.timeoutSec)}s`,
          undefined,
          'timeout',
        )
      }
      throw new LlmCallError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after')
      const hint = retryAfter === null ? '' : ` (Retry-After: ${retryAfter})`
      throw new LlmCallError(
        `HTTP ${String(response.status)}${hint}`,
        text,
        'http',
        retryAfter ?? undefined,
      )
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new LlmCallError('Response body is not JSON', text, 'invalid_response')
    }
  } finally {
    release()
  }
}
