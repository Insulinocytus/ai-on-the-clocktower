import { z } from 'zod'
import type {
  GameConfig,
  GameEvent,
  GameEventInput,
  ContestantChoice,
  ContestantRequest,
  Ports,
  DiscretionId,
  DiscretionCandidates,
  DiscretionChoice,
  ValidationError,
} from '../../shared/types/game'
import {
  createRng,
  runGame,
  validateContestantChoice,
  validateDiscretionChoice,
} from '../../shared/game/rules'
import type { ChatMessage } from '../../shared/game/tool-calls'
import { buildContestantPrompt } from '../../shared/prompts/contestant'
import { invalidAttemptSuffix } from '../../shared/prompts/retry'
import { buildStorytellerPrompt, parseStorytellerChoice } from '../../shared/prompts/storyteller'
import { requireModelRecord } from './index'
import { callLlm, LlmCallError } from './llm'
import {
  checkToolCall,
  contestantTools,
  storytellerTools,
  type Tool,
} from '../../shared/game/tools'
import { appendGameEvent, getGame, storedGameEvents } from './game-store'

interface Runner {
  controller: AbortController
  log: GameEvent[]
  commit: (event: GameEventInput) => Promise<GameEvent>
  writes: Promise<unknown>
  ready: PromiseWithResolvers<undefined>
  done?: Promise<void>
  lastManual?: { seq: number; choice: DiscretionChoice }
  /** Shared by every decision paused since the last resume; one resume releases them all. */
  paused?: PromiseWithResolvers<undefined>
  pending: Map<
    number,
    {
      candidates: DiscretionCandidates
      seatCount: number
      resolve: (choice: DiscretionChoice) => void
    }
  >
}
const runners = new Map<string, Runner>()

export function hasGameRunner(id: string): boolean {
  return runners.has(id)
}

export async function resetGameRunnersForTest(): Promise<void> {
  const active = [...runners.values()]
  for (const runner of active) runner.controller.abort()
  await Promise.allSettled(
    active.flatMap((runner) => (runner.done ? [runner.writes, runner.done] : [runner.writes])),
  )
  runners.clear()
}
const usageShape = z.looseObject({ usage: z.unknown().optional() })
const MAX_ATTEMPTS = 5
const RETRY_BACKOFF_MS = 250

export class ManualDiscretionConflictError extends Error {
  constructor(readonly data: { status: string; choice?: DiscretionChoice }) {
    super('Manual discretion is no longer pending')
    this.name = 'ManualDiscretionConflictError'
  }
}

class DiscretionValidationError extends Error {
  constructor(readonly data: { errors: ValidationError[] }) {
    super('Illegal discretion choice')
    this.name = 'DiscretionValidationError'
  }
}

function retryDelay(error: unknown, attempt: number): number {
  if (error instanceof LlmCallError && error.retryAfter?.trim()) {
    const seconds = Number(error.retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const date = Date.parse(error.retryAfter)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  return RETRY_BACKOFF_MS * 2 ** (attempt - 1)
}

async function pause(
  runner: Runner,
  actor: { seat: number } | { discretion: DiscretionId },
  error: string,
) {
  await runner.commit({ type: 'game.paused', ...actor, error })
  runner.paused ??= Promise.withResolvers<undefined>()
  const { promise } = runner.paused
  const signal = runner.controller.signal
  const { promise: aborted, reject } = Promise.withResolvers<never>()
  const cancel = () => {
    reject(signal.reason instanceof Error ? signal.reason : new Error('Game aborted'))
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export async function resumeGame(id: string) {
  const game = await getGame(id)
  if (!game.compatible) throw new Error('Incompatible engine version')
  if (game.status !== 'paused') throw new Error('Game is not paused')
  const runner = runners.get(id)
  if (!runner) {
    await startGameRunner(id, game.config, await storedGameEvents(id))
  } else {
    if (!runner.paused) throw new Error('Game is not paused')
    const { resolve } = runner.paused
    runner.paused = undefined
    await runner.commit({ type: 'game.resumed' })
    resolve(undefined)
  }
  return getGame(id)
}

export async function abortGame(id: string) {
  const game = await getGame(id)
  if (game.status === 'ended' || game.status === 'aborted') return game
  const runner = runners.get(id)
  if (runner) await runner.commit({ type: 'game.aborted', reason: 'human' })
  else {
    const events = await storedGameEvents(id)
    await appendGameEvent(id, { type: 'game.aborted', reason: 'human', seq: events.length + 1 })
  }
  return getGame(id)
}

export async function submitManualDiscretion(id: string, seq: number, choice: unknown) {
  const game = await getGame(id)
  const runner = runners.get(id)
  const pending = runner?.pending.get(seq)
  if (!runner || runner.controller.signal.aborted || !pending) {
    const log = runner?.log ?? (await storedGameEvents(id))
    const request = log.find((event) => event.seq === seq && event.type === 'discretion.requested')
    const resolved =
      request?.type === 'discretion.requested'
        ? log.find(
            (event) =>
              event.seq > seq &&
              event.type === 'discretion.resolved' &&
              event.discretion === request.discretion,
          )
        : undefined
    throw new ManualDiscretionConflictError({
      ...(runner?.lastManual?.seq === seq
        ? { choice: runner.lastManual.choice }
        : resolved?.type === 'discretion.resolved'
          ? { choice: resolved.choice as DiscretionChoice }
          : {}),
      status: game.status,
    })
  }
  const errors = validateDiscretionChoice(choice, pending.candidates, pending.seatCount)
  if (errors.length) throw new DiscretionValidationError({ errors })
  choice = z.json().parse(choice)
  runner.pending.delete(seq)
  runner.lastManual = { seq, choice: choice as DiscretionChoice }
  pending.resolve(choice as DiscretionChoice)
  return { choice }
}

function waitForManual(
  runner: Runner,
  seq: number,
  candidates: DiscretionCandidates,
  seatCount: number,
): Promise<{ choice: DiscretionChoice }> {
  const signal = runner.controller.signal
  signal.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<{ choice: DiscretionChoice }>()
  const cancel = () => {
    runner.pending.delete(seq)
    reject(signal.reason instanceof Error ? signal.reason : new Error('Game aborted'))
  }
  signal.addEventListener('abort', cancel, { once: true })
  runner.pending.set(seq, {
    candidates,
    seatCount,
    resolve: (choice) => {
      signal.removeEventListener('abort', cancel)
      resolve({ choice })
    },
  })
  return promise
}

export function startGameRunner(
  id: string,
  config: GameConfig,
  history: GameEvent[],
): Promise<void> {
  const existing = runners.get(id)
  if (existing) return existing.ready.promise
  let cursor = 1
  const runner: Runner = {
    controller: new AbortController(),
    log: history.slice(0, 1),
    pending: new Map(),
    writes: Promise.resolve(),
    ready: Promise.withResolvers<undefined>(),
    commit(event) {
      const write = runner.writes.then(async () => {
        runner.controller.signal.throwIfAborted()
        if (runner.log.length < history.length) runner.log.push(...history.slice(runner.log.length))
        if (event.type === 'game.ended' || event.type === 'game.aborted') runner.controller.abort()
        const stored: GameEvent = { ...event, seq: runner.log.length + 1 }
        await appendGameEvent(id, stored)
        runner.log.push(stored)
        return stored
      })
      runner.writes = write
      return write
    },
  }
  runners.set(id, runner)
  const commit = runner.commit
  const waiting: {
    matches: (event: GameEvent) => boolean
    resolve: (event: GameEvent | undefined) => void
    reject: (error: Error) => void
  }[] = []
  let scheduled: ReturnType<typeof setTimeout> | undefined
  function advance() {
    scheduled = undefined
    if (runner.controller.signal.aborted) return
    let next = history[cursor]
    while (next?.type === 'game.paused' || next?.type === 'game.resumed') {
      runner.log.push(next)
      next = history[++cursor]
    }
    if (!next) {
      for (const pending of waiting.splice(0)) pending.resolve(undefined)
      return
    }
    const index = waiting.findIndex((pending) => pending.matches(next))
    if (index < 0) {
      const error = new Error(
        `Replay divergence at seq ${String(next.seq)}: unexpected ${next.type}`,
      )
      for (const pending of waiting.splice(0)) pending.reject(error)
      return
    }
    const pending = waiting.splice(index, 1)[0]
    if (!pending) throw new Error('Missing recorded operation')
    cursor++
    runner.log.push(next)
    pending.resolve(next)
    if (waiting.length) scheduled = setTimeout(advance, 0)
  }
  function recordedEvent(matches: (event: GameEvent) => boolean): Promise<GameEvent | undefined> {
    runner.controller.signal.throwIfAborted()
    if (cursor >= history.length) return Promise.resolve(undefined)
    const pending = Promise.withResolvers<GameEvent | undefined>()
    waiting.push({ matches, resolve: pending.resolve, reject: pending.reject })
    // Let the released engine continuation consume rng and enqueue its commit before the next turn.
    scheduled ??= setTimeout(advance, 0)
    return pending.promise
  }
  runner.controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(scheduled)
      for (const pending of waiting.splice(0)) pending.reject(new Error('Game aborted'))
    },
    { once: true },
  )
  let continuing: Promise<unknown> | undefined
  async function live() {
    if (cursor < history.length)
      throw new Error(`Replay divergence at seq ${String(cursor + 1)}: unexpected input request`)
    continuing ??=
      runner.log.findLast((event) => event.type === 'game.paused' || event.type === 'game.resumed')
        ?.type === 'game.paused'
        ? commit({ type: 'game.resumed' })
        : Promise.resolve()
    await continuing
    runner.controller.signal.throwIfAborted()
  }
  async function engineCommit(event: GameEventInput): Promise<GameEvent> {
    runner.controller.signal.throwIfAborted()
    const expected = await recordedEvent((entry) => {
      const { seq: _seq, ...input } = entry
      return sameValue(input, event)
    })
    if (expected) {
      return expected
    }
    await live()
    const stored = await commit(event)
    runner.ready.resolve(undefined)
    return stored
  }
  const rng = createRng(config.seed)
  const tools = contestantTools(config.language, config.seatCount)

  async function decide(
    model: NonNullable<GameConfig['storyteller']>,
    metadata:
      | Pick<Extract<GameEvent, { type: 'contestant.decision' }>, 'type' | 'seat' | 'request'>
      | Pick<
          Extract<GameEvent, { type: 'storyteller.decision' }>,
          'type' | 'discretion' | 'request'
        >,
    prompt: { messages: ChatMessage[] },
    tools: Tool[],
    tool: string,
    validateChoice: (
      value: unknown,
    ) =>
      | { ok: true; choice: ContestantChoice | DiscretionChoice }
      | { ok: false; errors: ValidationError[] },
  ) {
    const actor =
      metadata.type === 'contestant.decision'
        ? { seat: metadata.seat }
        : { discretion: metadata.discretion }
    let limit = MAX_ATTEMPTS
    for (let attempt = 1; ; attempt++) {
      const entry = await recordedEvent(
        (event) =>
          event.type === metadata.type &&
          (event.type !== 'contestant.decision' ||
            (metadata.type === 'contestant.decision' && event.seat === metadata.seat)) &&
          (event.type !== 'storyteller.decision' ||
            (metadata.type === 'storyteller.decision' &&
              event.discretion === metadata.discretion)) &&
          sameValue(event.request, metadata.request) &&
          event.attempt === attempt,
      )
      const recorded =
        entry?.type === 'contestant.decision' || entry?.type === 'storyteller.decision'
          ? entry
          : undefined
      const validation = recorded
        ? z.object({ ok: z.boolean(), code: z.string().optional() }).parse(recorded.validation)
        : undefined
      if (validation?.code === 'call_failed') {
        if (attempt === limit) limit += MAX_ATTEMPTS
        continue
      }
      if (!recorded) {
        await live()
        runner.ready.resolve(undefined)
      }
      const provider = recorded
        ? undefined
        : await requireModelRecord('providers', model.providerId)
      const start = performance.now()
      let raw: unknown
      try {
        if (provider) {
          raw = await callLlm(
            {
              ...provider,
              ...model,
              extraBody: JSON.parse(model.extraBody) as Record<string, unknown>,
            },
            { ...prompt, tools, tool },
            runner.controller.signal,
          )
        } else raw = recorded?.raw
      } catch (error) {
        runner.controller.signal.throwIfAborted()
        const message = error instanceof Error ? error.message : String(error)
        await commit({
          ...metadata,
          raw: error instanceof LlmCallError ? (error.body ?? null) : null,
          model: model.model,
          usage: null,
          durationMs: performance.now() - start,
          attempt,
          validation: {
            ok: false,
            code: 'call_failed',
            errorType: error instanceof LlmCallError ? error.kind : 'unknown',
            error: message,
          },
        })
        if (attempt === limit) {
          await pause(runner, actor, message)
          limit += MAX_ATTEMPTS
        } else {
          const roundAttempt = attempt - limit + MAX_ATTEMPTS
          await delay(retryDelay(error, roundAttempt), runner.controller.signal)
        }
        continue
      }
      const toolCheck = checkToolCall(raw, tools, tool)
      const parsed = toolCheck.ok
        ? validateChoice(toolCheck.arguments)
        : {
            ok: false as const,
            errors: [
              { code: toolCheck.code, ...(toolCheck.issues && { issues: toolCheck.issues }) },
            ],
          }
      const errors = parsed.ok ? [] : parsed.errors
      const valid = parsed.ok
      const usage = usageShape.safeParse(raw)
      if (recorded && validation?.ok !== valid)
        throw new Error(
          `Replay divergence at seq ${String(recorded.seq)}: decision validation changed`,
        )
      const decision =
        recorded ??
        (await commit({
          ...metadata,
          raw,
          model: model.model,
          usage: usage.success ? (usage.data.usage ?? null) : null,
          durationMs: performance.now() - start,
          attempt,
          validation: { ok: valid, errors },
        }))
      if (parsed.ok) return { choice: parsed.choice, decision: decision.seq }
      if (attempt === limit) {
        if (!recorded) await pause(runner, actor, JSON.stringify(errors))
        limit += MAX_ATTEMPTS
      }
      const calls = toolCheck.ok
        ? [{ name: toolCheck.name, arguments: toolCheck.rawArguments }]
        : toolCheck.calls
      const last = prompt.messages.at(-1)
      if (last?.role !== 'user') throw new Error('Prompt must end with a user message')
      last.content += `\n\n${invalidAttemptSuffix(config.language, attempt, limit, calls, errors)}`
    }
  }

  async function ask(
    request: ContestantRequest,
    events: readonly GameEvent[],
  ): Promise<ContestantChoice> {
    const model = config.seats[request.seat - 1]
    if (!model) throw new Error('Unknown contestant seat')
    const result = await decide(
      model,
      { type: 'contestant.decision', seat: request.seat, request },
      buildContestantPrompt({ events, seat: request.seat, language: config.language, request }),
      tools,
      request.tool,
      (value) => {
        const errors = validateContestantChoice(value, request, config.seatCount)
        return errors.length
          ? { ok: false, errors }
          : { ok: true, choice: value as ContestantChoice }
      },
    )
    return { ...(result.choice as ContestantChoice), decision: result.decision }
  }

  const discretionTools = storytellerTools(config.language, config.seatCount)

  const ports: Ports = {
    config,
    log: runner.log,
    commit: engineCommit,
    rng,
    askContestants: (batch) => {
      const events = runner.log.slice()
      return Promise.all(batch.map((request) => ask(request, events)))
    },
    discretion: (id, candidates, context, requestSeq) => {
      switch (config.discretions[id]) {
        case 'random': {
          const choice = Array.isArray(candidates)
            ? candidates[Math.floor(rng() * candidates.length)]
            : candidates.sample
          if (choice === undefined) throw new Error('Discretion has no candidates')
          return Promise.resolve({ choice })
        }
        case 'storyteller':
          if (!config.storyteller) throw new Error('Storyteller preset is required')
          return decide(
            config.storyteller,
            { type: 'storyteller.decision', discretion: id, request: { id, candidates, context } },
            buildStorytellerPrompt(config, runner.log, id, candidates, context),
            discretionTools,
            'decide',
            (value) => parseStorytellerChoice(value, id, candidates, config.seatCount),
          ).then((result) => ({
            choice: result.choice as DiscretionChoice,
            decision: result.decision,
          }))
        case 'manual': {
          const resolved = history[cursor]
          if (resolved?.type === 'discretion.resolved' && resolved.discretion === id)
            return Promise.resolve({ choice: resolved.choice as DiscretionChoice })
          return live().then(() => {
            const waiting = waitForManual(runner, requestSeq, candidates, config.seatCount)
            runner.ready.resolve(undefined)
            return waiting
          })
        }
      }
    },
  }
  runner.done = runGame(ports)
    .then(() => undefined)
    .catch(async (error: unknown) => {
      if (runner.controller.signal.aborted) return
      if (runner.log.length < history.length) runner.log.push(...history.slice(runner.log.length))
      await commit({
        type: 'game.aborted',
        reason: 'engine_error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      runner.controller.abort()
      if (runners.get(id) === runner) runners.delete(id)
      runner.ready.resolve(undefined)
    })
  return runner.ready.promise
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.entries(a)
  return (
    left.length === Object.keys(b).length &&
    left.every(
      ([key, value]) =>
        Object.hasOwn(b, key) && sameValue(value, (b as Record<string, unknown>)[key]),
    )
  )
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<undefined>()
  const cancel = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', cancel)
    resolve(undefined)
  }, ms)
  signal.addEventListener('abort', cancel, { once: true })
  return promise
}
