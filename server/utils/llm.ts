import type { PresetSnapshot } from '../../shared/rules/types'
import type { ChatMessage, OpenAITool } from '../prompts'
import { provider } from './db'

export class CallError extends Error {
  constructor(public kind: 'http' | 'timeout' | 'network', message: string, public status?: number, public retryAfterMs?: number, public raw: unknown = null) { super(message) }
}
interface Waiter { signal: AbortSignal; resolve: (release: () => void) => void; reject: (reason: unknown) => void; cancelled: () => void }
interface Queue { active: number; waiting: Waiter[] }
const queues = new Map<string, Queue>()
function drain(id: string, queue: Queue): void {
  while (queue.waiting.length && queue.active < (provider(id)?.maxConcurrency ?? 1)) {
    const next = queue.waiting.shift()!
    next.signal.removeEventListener('abort', next.cancelled)
    if (next.signal.aborted) { next.reject(next.signal.reason); continue }
    queue.active++
    let released = false
    next.resolve(() => {
      if (released) return
      released = true
      queue.active--
      drain(id, queue)
      if (!queue.active && !queue.waiting.length) queues.delete(id)
    })
  }
}
function acquire(id: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  let queue = queues.get(id)
  if (!queue) queues.set(id, queue = { active: 0, waiting: [] })
  const current = queue
  const { promise, resolve, reject } = Promise.withResolvers<() => void>()
  const waiter: Waiter = { signal, resolve, reject, cancelled: () => {
    const index = current.waiting.indexOf(waiter)
    if (index >= 0) current.waiting.splice(index, 1)
    reject(signal.reason)
    drain(id, current)
    if (!current.active && !current.waiting.length) queues.delete(id)
  } }
  current.waiting.push(waiter)
  signal.addEventListener('abort', waiter.cancelled, { once: true })
  drain(id, current)
  return promise
}
export function refreshConcurrency(id: string): void {
  const queue = queues.get(id)
  if (queue) drain(id, queue)
}
export function requestBody(preset: PresetSnapshot, messages: ChatMessage[], tools: OpenAITool[], expected: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...preset.extraBody, model: preset.model, messages, tools,
    ...(preset.forceToolChoice ? { tool_choice: { type: 'function', function: { name: expected } } } : {}),
  }
  delete body.temperature
  delete body.stream_options
  body.stream = false
  return body
}
export interface RawCall { tool: string; rawArgs: string; args: unknown }
export function parseTool(raw: unknown): RawCall | null {
  if (!raw || typeof raw !== 'object' || !('choices' in raw) || !Array.isArray(raw.choices)) return null
  const first: unknown = raw.choices[0]
  if (!first || typeof first !== 'object' || !('message' in first)) return null
  const message = first.message
  if (!message || typeof message !== 'object' || !('tool_calls' in message) || !Array.isArray(message.tool_calls)) return null
  const tool: unknown = message.tool_calls[0]
  if (!tool || typeof tool !== 'object' || !('function' in tool)) return null
  const fn = tool.function
  if (!fn || typeof fn !== 'object' || !('name' in fn) || typeof fn.name !== 'string' || !('arguments' in fn)) return null
  const rawArgs = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments)
  let args: unknown = rawArgs
  try { args = JSON.parse(rawArgs) } catch { /* Validator reports malformed arguments. */ }
  return { tool: fn.name, rawArgs, args }
}
export async function callModel(preset: PresetSnapshot, body: Record<string, unknown>, signal: AbortSignal): Promise<{ raw: unknown; durationMs: number }> {
  const release = await acquire(preset.providerId, signal)
  const start = performance.now()
  const config = provider(preset.providerId)
  const timeoutMs = process.env.LLM_TIMEOUT_MS === undefined ? (config?.timeoutSec ?? 300) * 1000 : Number(process.env.LLM_TIMEOUT_MS)
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)))
  try {
    if (!config) throw new CallError('network', 'Provider was deleted')
    const key = process.env[config.apiKeyEnv]
    if (!key) throw new CallError('network', `Missing environment variable: ${config.apiKeyEnv}`)
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, timeout]),
    })
    const text = await response.text()
    let raw: unknown = text
    try { raw = JSON.parse(text) } catch { /* Keep the complete body even for malformed responses. */ }
    if (!response.ok) {
      const header = response.headers.get('retry-after')
      let retryAfterMs: number | undefined
      if (header && (response.status === 429 || response.status >= 500)) {
        const seconds = Number(header)
        const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
        if (Number.isFinite(value)) retryAfterMs = Math.max(0, value)
      }
      throw new CallError('http', `HTTP ${response.status}: ${text}`, response.status, retryAfterMs, raw)
    }
    return { raw, durationMs: performance.now() - start }
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof CallError) throw error
    if (timeout.aborted) throw new CallError('timeout', `Model call timed out after ${timeoutMs}ms`)
    throw new CallError('network', error instanceof Error ? error.message : String(error))
  } finally { release() }
}
export function backoff(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const cancelled = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancelled); resolve() }, ms)
  signal.addEventListener('abort', cancelled, { once: true })
  return promise
}
