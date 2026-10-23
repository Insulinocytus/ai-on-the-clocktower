import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
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
} from '#shared/types/game'
import {
  createRng,
  DISCRETION_IDS,
  runGame,
  validateContestantChoice,
  validateDiscretionChoice,
} from '#shared/game/rules'
import type { ChatMessage } from '#shared/game/tool-calls'
import { buildContestantPrompt } from '#shared/prompts/contestant'
import { invalidAttemptSuffix } from '#shared/prompts/retry'
import { buildStorytellerPrompt, parseStorytellerChoice } from '#shared/prompts/storyteller'
import { getPreset, getProvider } from './models'
import { chatCompletion, LlmCallError } from './llm'
import { checkToolCall, contestantTools, storytellerTools, type Tool } from '#shared/game/tools'
import { appendGameEvent, insertGame, getGame, gameEvents, LOG_VERSION } from './game-store'

export const gameInput = z.object({
  presets: z.array(z.int()).min(5).max(15),
  language: z.enum(['zh', 'en']),
  speechLimit: z.int().min(1).default(10),
  whisperLimit: z.int().min(0).default(3),
  discretions: z
    .partialRecord(z.enum(DISCRETION_IDS), z.enum(['random', 'storyteller', 'manual']))
    .default({}),
  storyteller: z.int().nullable().optional(),
})

interface Runner {
  controller: AbortController
  log: GameEvent[]
  commit: (event: GameEventInput) => GameEvent
  lastManual?: { seq: number; choice: DiscretionChoice }
  /** Shared by every decision paused since the last resume; one retry releases them all. */
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
const usageShape = z.looseObject({ usage: z.unknown().optional() })
const MAX_ATTEMPTS = 5
const RETRY_BACKOFF_MS = 250

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
  runner.commit({ type: 'game.paused', ...actor, error })
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

export function resumeGame(id: string) {
  const game = getGame(id)
  const runner = runners.get(id)
  if (game.status !== 'paused' || !runner?.paused)
    throw createError({ statusCode: 409, statusMessage: 'Game is not paused' })
  const { resolve } = runner.paused
  runner.paused = undefined
  runner.commit({ type: 'game.resumed' })
  resolve(undefined)
  return getGame(id)
}

export function abortGame(id: string) {
  const game = getGame(id)
  if (game.status === 'ended' || game.status === 'aborted') return game
  const runner = runners.get(id)
  if (!runner) throw createError({ statusCode: 409, statusMessage: 'Game runner is unavailable' })
  runner.commit({ type: 'game.aborted', reason: 'human' })
  return getGame(id)
}

export function submitManualDiscretion(id: string, seq: number, choice: unknown) {
  const game = getGame(id)
  const runner = runners.get(id)
  const pending = runner?.pending.get(seq)
  if (!runner || runner.controller.signal.aborted || !pending) {
    const log = runner?.log ?? gameEvents(id)
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
    throw createError({
      statusCode: 409,
      statusMessage: 'Manual discretion is no longer pending',
      data: {
        ...(runner?.lastManual?.seq === seq
          ? { choice: runner.lastManual.choice }
          : resolved?.type === 'discretion.resolved'
            ? { choice: resolved.choice }
            : {}),
        status: game.status,
      },
    })
  }
  const errors = validateDiscretionChoice(choice, pending.candidates, pending.seatCount)
  if (errors.length)
    throw createError({
      statusCode: 409,
      statusMessage: 'Illegal discretion choice',
      data: { errors },
    })
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

export function createGame(input: z.infer<typeof gameInput>) {
  const seats = input.presets.map((id, index) => ({ ...getPreset(id), seat: index + 1 }))
  const discretions = Object.fromEntries(
    DISCRETION_IDS.map((id) => [id, input.discretions[id] ?? 'manual']),
  ) as GameConfig['discretions']
  const needsStoryteller = Object.values(discretions).includes('storyteller')
  if (needsStoryteller && !input.storyteller)
    throw createError({ statusCode: 400, statusMessage: 'Storyteller preset is required' })
  const storyteller = needsStoryteller && input.storyteller ? getPreset(input.storyteller) : null
  const providers = [...seats, ...(storyteller ? [storyteller] : [])].map((seat) => {
    const provider = getProvider(seat.providerId)
    if (!provider) throw createError({ statusCode: 400, statusMessage: 'Provider not found' })
    return provider
  })
  const missing = [
    ...new Set(
      providers
        .filter((provider) => !process.env[provider.apiKeyEnv])
        .map((provider) => provider.apiKeyEnv),
    ),
  ]
  if (missing.length)
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider credentials are missing',
      data: { missing },
    })
  const config: GameConfig = {
    seatCount: seats.length,
    seats,
    storyteller,
    discretions,
    speechLimit: input.speechLimit,
    whisperLimit: input.whisperLimit,
    language: input.language,
    seed: randomBytes(4).readUInt32LE(),
    logVersion: LOG_VERSION,
  }
  const id = randomUUID()
  const runner: Runner = {
    controller: new AbortController(),
    log: [],
    pending: new Map(),
    commit(event) {
      runner.controller.signal.throwIfAborted()
      if (event.type === 'game.ended' || event.type === 'game.aborted') runner.controller.abort()
      const stored = appendGameEvent(id, event, runner.log.length + 1)
      runner.log.push(stored)
      return stored
    },
  }
  insertGame(id)
  runners.set(id, runner)
  const commit = runner.commit
  commit({ type: 'game.created', ...config })
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
    const provider = getProvider(model.providerId)
    if (!provider) throw new Error('Provider not found')
    let limit = MAX_ATTEMPTS
    for (let attempt = 1; ; attempt++) {
      const start = performance.now()
      let raw: unknown
      try {
        raw = await chatCompletion(
          {
            ...provider,
            ...model,
            extraBody: JSON.parse(model.extraBody) as Record<string, unknown>,
          },
          { ...prompt, tools, tool },
          runner.controller.signal,
        )
      } catch (error) {
        runner.controller.signal.throwIfAborted()
        const message = error instanceof Error ? error.message : String(error)
        commit({
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
          await delay(retryDelay(error, roundAttempt), undefined, {
            signal: runner.controller.signal,
          })
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
      const decision = commit({
        ...metadata,
        raw,
        model: model.model,
        usage: usage.success ? (usage.data.usage ?? null) : null,
        durationMs: performance.now() - start,
        attempt,
        validation: { ok: valid, errors },
      })
      if (parsed.ok) return { choice: parsed.choice, decision: decision.seq }
      if (attempt === limit) {
        await pause(runner, actor, JSON.stringify(errors))
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
    commit,
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
        case 'manual':
          return waitForManual(runner, requestSeq, candidates, config.seatCount)
      }
    },
  }
  void runGame(ports)
    .catch((error: unknown) => {
      if (runner.controller.signal.aborted) return
      commit({
        type: 'game.aborted',
        reason: 'engine_error',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      runner.controller.abort()
      runners.delete(id)
    })
  return getGame(id)
}
