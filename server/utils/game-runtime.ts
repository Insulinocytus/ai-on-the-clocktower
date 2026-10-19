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
} from '#shared/types/game'
import { createRng, DISCRETION_IDS, runGame, validateContestantChoice } from '#shared/game/rules'
import { PROMPT_VERSION, buildContestantPrompt } from '#shared/prompts/contestant'
import { invalidAttemptSuffix } from '#shared/prompts/retry'
import { getPreset, getProvider } from './models'
import { chatCompletion, LlmCallError } from './llm'
import { checkToolCall, contestantTools } from './tools'
import { appendGameEvent, insertGame, getGame, LOG_VERSION } from './game-store'

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
}
const runners = new Map<string, Runner>()
const usageShape = z.looseObject({ usage: z.unknown().optional() })
const MAX_ATTEMPTS = 3
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

class ContestantFailure extends Error {
  constructor(
    readonly seat: number,
    message: string,
  ) {
    super(message)
  }
}

export function abortGame(id: string) {
  const game = getGame(id)
  if (game.status === 'ended' || game.status === 'aborted') return game
  const runner = runners.get(id)
  if (!runner) throw createError({ statusCode: 409, statusMessage: 'Game runner is unavailable' })
  runner.commit({ type: 'game.aborted', reason: 'human' })
  return getGame(id)
}

export function createGame(input: z.infer<typeof gameInput>) {
  const seats = input.presets.map((id, index) => ({ ...getPreset(id), seat: index + 1 }))
  const discretions = Object.fromEntries(
    DISCRETION_IDS.map((id) => [id, input.discretions[id] ?? 'random']),
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
    promptVersion: PROMPT_VERSION,
  }
  const id = randomUUID()
  const runner: Runner = {
    controller: new AbortController(),
    log: [],
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

  async function ask(
    request: ContestantRequest,
    events: readonly GameEvent[],
  ): Promise<ContestantChoice> {
    const seat = config.seats[request.seat - 1]
    if (!seat) throw new Error('Unknown contestant seat')
    const provider = getProvider(seat.providerId)
    if (!provider) throw new ContestantFailure(request.seat, 'Provider not found')
    const prompt = buildContestantPrompt({
      events,
      seat: request.seat,
      language: config.language,
      request,
    })
    const tool = request.tool
    for (let attempt = 1; ; attempt++) {
      const start = performance.now()
      let raw: unknown
      try {
        raw = await chatCompletion(
          {
            ...provider,
            ...seat,
            extraBody: JSON.parse(seat.extraBody) as Record<string, unknown>,
          },
          { ...prompt, tools, tool },
          runner.controller.signal,
        )
      } catch (error) {
        runner.controller.signal.throwIfAborted()
        const message = error instanceof Error ? error.message : String(error)
        commit({
          type: 'contestant.decision',
          seat: request.seat,
          request,
          raw: error instanceof LlmCallError ? (error.body ?? null) : null,
          model: seat.model,
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
        if (attempt === MAX_ATTEMPTS) throw new ContestantFailure(request.seat, message)
        await delay(retryDelay(error, attempt), undefined, { signal: runner.controller.signal })
        continue
      }
      const toolCheck = checkToolCall(raw, tools, tool)
      const errors = toolCheck.ok
        ? validateContestantChoice(toolCheck.arguments, request, config.seatCount)
        : [{ code: toolCheck.code }]
      const valid = errors.length === 0
      const usage = usageShape.safeParse(raw)
      const decision = commit({
        type: 'contestant.decision',
        seat: request.seat,
        request,
        raw,
        model: seat.model,
        usage: usage.success ? (usage.data.usage ?? null) : null,
        durationMs: performance.now() - start,
        attempt,
        validation: { ok: valid, errors },
      })
      if (valid && toolCheck.ok) {
        const choice = toolCheck.arguments as ContestantChoice
        return { ...choice, decision: decision.seq }
      }
      if (attempt === MAX_ATTEMPTS)
        throw new ContestantFailure(request.seat, JSON.stringify(errors))
      const calls = toolCheck.ok
        ? [{ name: toolCheck.name, arguments: toolCheck.rawArguments }]
        : toolCheck.calls
      prompt.messages[1].content += `\n\n${invalidAttemptSuffix(config.language, attempt, MAX_ATTEMPTS, calls, errors)}`
    }
  }

  const ports: Ports = {
    config,
    log: runner.log,
    commit,
    rng,
    askContestants: async (batch) => {
      const events = runner.log.slice()
      const choices = await Promise.all(batch.map((request) => ask(request, events)))
      for (const [index, choice] of choices.entries()) {
        const request = batch[index]
        if (request && choice.memo !== undefined)
          commit({ type: 'seat.memo.updated', seat: request.seat, memo: choice.memo })
      }
      return choices
    },
    discretion: (id, candidates) => {
      switch (config.discretions[id]) {
        case 'random': {
          const choice = Array.isArray(candidates)
            ? candidates[Math.floor(rng() * candidates.length)]
            : candidates.sample
          if (choice === undefined) throw new Error('Discretion has no candidates')
          return Promise.resolve({ choice })
        }
        case 'storyteller':
        case 'manual':
          throw new Error(`Discretion source ${config.discretions[id]} is not available`)
      }
    },
  }
  void runGame(ports)
    .catch((error: unknown) => {
      if (runner.controller.signal.aborted) return
      commit({
        type: 'game.aborted',
        reason: error instanceof ContestantFailure ? 'model_call_failed' : 'engine_error',
        ...(error instanceof ContestantFailure && { seat: error.seat }),
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      runner.controller.abort()
      runners.delete(id)
    })
  return getGame(id)
}
