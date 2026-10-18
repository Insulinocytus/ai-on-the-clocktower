import { defineEventHandler, readBody, getQuery, getHeader, setResponseStatus, createEventStream, type H3Event } from 'h3'
import { randomUUID } from 'node:crypto'
import type { ProviderInput, PresetInput, PresetTestResult } from '../../shared/api'
import { DISCRETION_IDS, LOG_VERSION, type DiscretionSource, type DiscretionId, type GameConfig, type GameEvent, type PresetSnapshot, type DiscretionValue } from '../../shared/rules/types'
import { canSee, parseObserver, validateToolCall } from '../../shared/rules'
import { buildTestCallMessages, contestantTools, PROMPT_VERSION } from '../prompts'
import * as store from '../utils/db'
import { callModel, CallError, parseTool, refreshConcurrency, requestBody } from '../utils/llm'
import { runners, startGame } from '../utils/runtime'

class InputError extends Error { constructor(readonly code: string, message = code, readonly status = 400, readonly extra: Record<string, unknown> = {}) { super(message) } }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('invalid_input')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new InputError('invalid_input')
  return value.trim()
}
function integer(value: unknown, fallback: number, minimum: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new InputError('invalid_input')
  return value
}
function snapshot(id: unknown): PresetSnapshot {
  const preset = store.preset(text(id))
  if (!preset) throw new InputError('preset_not_found')
  const { id: presetId, ...rest } = preset
  return { presetId, ...rest }
}
function createConfig(input: Record<string, unknown>): GameConfig {
  const seatCount = integer(input.seatCount, 0, 5)
  if (seatCount > 15 || !Array.isArray(input.seats) || input.seats.length !== seatCount) throw new InputError('invalid_seats')
  const seats = input.seats.map(snapshot)
  const rawSources = object(input.sources)
  const sources = {} as Record<DiscretionId, DiscretionSource>
  for (const id of DISCRETION_IDS) {
    const source = rawSources[id]
    if (source !== 'random' && source !== 'manual' && source !== 'storyteller') throw new InputError('invalid_sources')
    sources[id] = source
  }
  const needsStoryteller = Object.values(sources).includes('storyteller')
  if (needsStoryteller !== (input.storytellerPresetId !== null && input.storytellerPresetId !== undefined)) throw new InputError('invalid_storyteller')
  const storyteller = needsStoryteller ? snapshot(input.storytellerPresetId) : null
  if (input.language !== 'zh' && input.language !== 'en') throw new InputError('invalid_language')
  const missing = new Set<string>()
  for (const preset of storyteller ? [...seats, storyteller] : seats) {
    const provider = store.provider(preset.providerId)
    if (!provider) throw new InputError('provider_not_found')
    if (!provider.keySet) missing.add(provider.apiKeyEnv)
  }
  if (missing.size) throw new InputError('missing_env', 'Missing provider environment variables', 400, { missing: [...missing] })
  return { seatCount, seats, storyteller, sources, maxSpeeches: integer(input.maxSpeeches, 10, 1), whisperRooms: integer(input.whisperRooms, 3, 0), language: input.language, seed: randomUUID(), logVersion: LOG_VERSION, promptVersion: PROMPT_VERSION }
}

async function route(event: H3Event): Promise<unknown> {
  const parts = event.path.split('?')[0]!.split('/').filter(Boolean).slice(1)
  const [resource, id, action, seqText] = parts
  const method = event.method
  if (resource === 'providers' && parts.length <= 2) {
    if (method === 'GET' && !id) return store.providers()
    if (id && !store.provider(id)) throw new InputError('not_found', 'Provider not found', 404)
    if (method === 'DELETE' && id) { store.removeModel('providers', id); return { ok: true } }
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const input = object(await readBody<unknown>(event))
      const baseUrl = text(input.baseUrl)
      let url: URL
      try { url = new URL(baseUrl) } catch { throw new InputError('invalid_url') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new InputError('invalid_url')
      const apiKeyEnv = text(input.apiKeyEnv)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new InputError('invalid_env_name')
      const value: ProviderInput = { name: text(input.name), baseUrl: baseUrl.replace(/\/+$/, ''), apiKeyEnv, timeoutSec: integer(input.timeoutSec, 300, 1), maxConcurrency: integer(input.maxConcurrency, 5, 1) }
      const saved = id ? store.saveProvider(value, id) : store.saveProvider(value)
      refreshConcurrency(saved.id)
      return saved
    }
  }
  if (resource === 'presets' && parts.length <= 3) {
    if (method === 'GET' && !id) return store.presets()
    const preset = id ? store.preset(id) : undefined
    if (id && !preset) throw new InputError('not_found', 'Preset not found', 404)
    if (method === 'DELETE' && id && !action) { store.removeModel('presets', id); return { ok: true } }
    if ((method === 'POST' && !id) || (method === 'PUT' && id && !action)) {
      const input = object(await readBody<unknown>(event))
      const providerId = text(input.providerId)
      if (!store.provider(providerId)) throw new InputError('provider_not_found')
      if (typeof input.forceToolChoice !== 'boolean') throw new InputError('invalid_input')
      const value: PresetInput = { name: text(input.name), providerId, model: text(input.model), forceToolChoice: input.forceToolChoice, extraBody: object(input.extraBody) }
      return id ? store.savePreset(value, id) : store.savePreset(value)
    }
    if (method === 'POST' && action === 'test' && preset) {
      const input = object((await readBody<unknown>(event)) ?? {})
      const language = input.language ?? 'en'
      if (language !== 'en' && language !== 'zh') throw new InputError('invalid_language')
      const provider = store.provider(preset.providerId)
      if (!provider) throw new InputError('provider_not_found')
      if (!provider.keySet) throw new InputError('missing_env', 'Missing provider environment variables', 400, { missing: [provider.apiKeyEnv] })
      const controller = new AbortController()
      const cancelled = () => { if (!event.node.res.writableEnded) controller.abort() }
      event.node.res.once('close', cancelled)
      const started = performance.now()
      try {
        const saved = snapshot(preset.id)
        const result = await callModel(saved, requestBody(saved, buildTestCallMessages(language), contestantTools(5, language), 'speak'), controller.signal)
        const call = parseTool(result.raw)
        const validation = call ? validateToolCall({ kind: 'speak', context: { where: 'public' }, remaining: 1 }, 1, 5, call.tool, call.rawArgs, { voteTokenUsed: false }) : null
        return { ok: validation?.ok ?? false, toolCall: call ? { name: call.tool, arguments: call.args } : null, error: !call ? 'no_tool_call' : validation && !validation.ok ? validation.error.code : null, raw: result.raw, durationMs: result.durationMs } satisfies PresetTestResult
      } catch (error) {
        if (!(error instanceof CallError)) throw error
        return { ok: false, toolCall: null, error: error.message, raw: error.raw, durationMs: performance.now() - started } satisfies PresetTestResult
      } finally { event.node.res.removeListener('close', cancelled) }
    }
  }
  if (resource === 'games') {
    if (method === 'GET' && !id) return store.games()
    if (method === 'POST' && !id) {
      const config = createConfig(object(await readBody<unknown>(event)))
      const gameId = store.createGame(config)
      startGame(gameId, config)
      return { id: gameId }
    }
    const game = id ? store.game(id) : undefined
    if (!id || !game) throw new InputError('not_found', 'Game not found', 404)
    if (method === 'GET' && !action) return { summary: store.summary(game.row), config: game.config }
    if (method === 'POST' && action === 'abort') {
      const runner = runners.get(id)
      if (!runner || runner.controller.signal.aborted) throw new InputError('finished', 'Game already finished', 409)
      runner.abort({ type: 'game.aborted', reason: 'human', detail: 'Aborted by spectator' })
      return { ok: true }
    }
    if (method === 'POST' && action === 'discretions' && seqText) {
      const seq = Number(seqText)
      if (!Number.isSafeInteger(seq) || seq < 1) throw new InputError('invalid_seq')
      const input = object(await readBody<unknown>(event))
      const value = object(input.value) as DiscretionValue
      const result = runners.get(id)?.submit(seq, value) ?? 'conflict'
      if (result === 'invalid') throw new InputError('not_a_candidate')
      if (result === 'conflict') {
        const resolved = store.events(id).find(e => e.type === 'discretion.resolved' && e.requestSeq === seq)
        throw new InputError('conflict', 'Discretion already resolved or stale', 409, { value: resolved?.type === 'discretion.resolved' ? resolved.value : null })
      }
      return { ok: true }
    }
    if (method === 'GET' && action === 'events') {
      const query = getQuery(event)
      const observer = parseObserver(typeof query.observer === 'string' ? query.observer : 'spectator')
      if (!observer || (observer.kind === 'seat' && observer.seat > game.config.seatCount)) throw new InputError('invalid_observer')
      const after = Math.max(Number(query.after ?? 0), Number(getHeader(event, 'last-event-id') ?? 0))
      if (!Number.isSafeInteger(after) || after < 0) throw new InputError('invalid_seq')
      if (!(getHeader(event, 'accept') ?? '').includes('text/event-stream')) return store.events(id, after).filter(e => canSee(e, observer))
      const stream = createEventStream(event)
      let cursor = after
      const push = (item: GameEvent) => {
        if (item.seq <= cursor) return
        cursor = item.seq
        if (canSee(item, observer)) void stream.push({ id: String(item.seq), data: JSON.stringify(item) }).catch(() => { unsubscribe() })
      }
      const unsubscribe = store.subscribe(id, push)
      stream.onClosed(unsubscribe)
      for (const item of store.events(id, after)) push(item)
      return stream.send()
    }
  }
  throw new InputError('not_found', 'Route not found', 404)
}
export default defineEventHandler(async event => {
  try { return await route(event) }
  catch (error) {
    if (!(error instanceof InputError)) throw error
    setResponseStatus(event, error.status)
    return { error: error.code, message: error.message, ...error.extra }
  }
})
