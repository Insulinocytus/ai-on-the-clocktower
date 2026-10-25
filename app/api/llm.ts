import type { ChatMessage } from '../../shared/game/tool-calls'
import type { Tool } from '../../shared/game/tools'
import type { ApiFormat } from '../../shared/types/models'
import { requireModelRecord } from './index'

export interface LlmTarget {
  providerId: number
  baseUrl: string
  apiFormat: ApiFormat
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
    const provider = await requireModelRecord(
      'providers',
      id,
      undefined,
      () => new LlmCallError('Provider not found'),
    )
    while (queue.waiting.length) {
      if (queue.active >= provider.maxConcurrency) break
      const waiter = queue.waiting.shift()
      if (!waiter) break
      waiter.signal?.removeEventListener('abort', waiter.cancel)
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

const PATHS: Record<ApiFormat, string> = {
  openai_completions: '/chat/completions',
  openai_responses: '/responses',
  anthropic_messages: '/v1/messages',
}

function responsesInput(message: ChatMessage): unknown[] {
  switch (message.role) {
    case 'assistant':
      return message.tool_calls.map(({ id, function: fn }) => ({
        type: 'function_call',
        call_id: id,
        ...fn,
      }))
    case 'tool':
      return [
        { type: 'function_call_output', call_id: message.tool_call_id, output: message.content },
      ]
    case 'system':
    case 'user':
      return [message]
  }
}

/** Anthropic turns must alternate, so consecutive same-role messages merge into one turn. */
function anthropicMessages(messages: ChatMessage[]) {
  const turns: { role: 'user' | 'assistant'; content: object[] }[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const content =
      message.role === 'assistant'
        ? message.tool_calls.map(({ id, function: fn }) => ({
            type: 'tool_use',
            id,
            name: fn.name,
            input: JSON.parse(fn.arguments) as unknown,
          }))
        : message.role === 'tool'
          ? [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }]
          : [{ type: 'text', text: message.content }]
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const last = turns.at(-1)
    if (last?.role === role) last.content.push(...content)
    else turns.push({ role, content })
  }
  return turns
}

/** Core fields override `extraBody`; format defaults (`store`, `max_tokens`) yield to it. */
function requestBody(target: LlmTarget, { messages, tools, tool }: ChatRequest) {
  switch (target.apiFormat) {
    case 'openai_completions':
      return {
        ...target.extraBody,
        model: target.model,
        messages,
        tools,
        ...(target.forceToolChoice && {
          tool_choice: { type: 'function', function: { name: tool } },
        }),
      }
    case 'openai_responses':
      return {
        store: false,
        ...target.extraBody,
        model: target.model,
        input: messages.flatMap(responsesInput),
        tools: tools.map(({ function: fn }) => ({ type: 'function', ...fn, strict: false })),
        ...(target.forceToolChoice && { tool_choice: { type: 'function', name: tool } }),
      }
    case 'anthropic_messages':
      return {
        max_tokens: 16000,
        ...target.extraBody,
        model: target.model,
        system: messages.flatMap((m) => (m.role === 'system' ? [m.content] : [])).join('\n\n'),
        messages: anthropicMessages(messages),
        tools: tools.map(({ function: { parameters, ...fn } }) => ({
          ...fn,
          input_schema: parameters,
        })),
        ...(target.forceToolChoice && { tool_choice: { type: 'tool', name: tool } }),
      }
  }
}

export async function callLlm(
  target: LlmTarget,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const release = await acquireProvider(target.providerId, signal)
  try {
    signal?.throwIfAborted()
    const body: Record<string, unknown> = requestBody(target, request)
    delete body.temperature
    if (!target.forceToolChoice) delete body.tool_choice
    const timeout = AbortSignal.timeout(target.timeoutSec * 1000)
    let response: Response
    let text: string
    try {
      response = await fetch(`${target.baseUrl.replace(/\/+$/, '')}${PATHS[target.apiFormat]}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(target.apiFormat === 'anthropic_messages'
            ? {
                'x-api-key': target.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
              }
            : { authorization: `Bearer ${target.apiKey}` }),
        },
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
