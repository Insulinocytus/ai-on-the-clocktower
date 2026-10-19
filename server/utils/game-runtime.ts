import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  GameConfig,
  GameEvent,
  GameEventInput,
  NightChoice,
  NightRequest,
  Ports,
} from '#shared/types/game'
import { createRng, runGame, validateNightChoice } from '#shared/game/rules'
import { PROMPT_VERSION, buildContestantPrompt } from '#shared/prompts/contestant'
import { getPreset, getProvider } from './models'
import { chatCompletion, LlmCallError } from './llm'
import { checkToolCall, contestantTools } from './tools'
import { appendGameEvent, insertGame, getGame, LOG_VERSION } from './game-store'

// shortcut: five seats only; lift alongside the full role pool and demon succession ticket.
export const gameInput = z.object({
  presets: z.array(z.int()).length(5),
  language: z.enum(['zh', 'en']),
})

interface Runner {
  controller: AbortController
  log: GameEvent[]
}
const runners = new Map<string, Runner>()
const usageShape = z.looseObject({ usage: z.unknown().optional() })

class ContestantFailure extends Error {
  constructor(
    readonly seat: number,
    message: string,
  ) {
    super(message)
  }
}

export function createGame(input: z.infer<typeof gameInput>) {
  const seats = input.presets.map((id, index) => ({ ...getPreset(id), seat: index + 1 }))
  const providers = seats.map((seat) => {
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
  // shortcut: random-only discretion; replace the dispatcher when manual/model discretion is added.
  const config: GameConfig = {
    seatCount: 5,
    seats,
    storyteller: null,
    discretions: {
      D1: 'random',
      seating: 'random',
      D2: 'random',
      D3: 'random',
      D4: 'random',
      D5: 'random',
      D6: 'random',
      D7: 'random',
      D8: 'random',
      D10: 'random',
      D11: 'random',
      D12: 'random',
      D13: 'random',
      D14: 'random',
    },
    speechLimit: 10,
    whisperLimit: 3,
    language: input.language,
    seed: randomBytes(4).readUInt32LE(),
    logVersion: LOG_VERSION,
    promptVersion: PROMPT_VERSION,
  }
  const id = randomUUID()
  const runner: Runner = { controller: new AbortController(), log: [] }
  insertGame(id)
  runners.set(id, runner)
  const commit = (event: GameEventInput): GameEvent => {
    runner.controller.signal.throwIfAborted()
    const stored = appendGameEvent(id, event, runner.log.length + 1)
    runner.log.push(stored)
    return stored
  }
  commit({ type: 'game.created', ...config })
  const rng = createRng(config.seed)
  const tools = contestantTools(config.language, config.seatCount)

  async function ask(request: NightRequest, events: readonly GameEvent[]): Promise<NightChoice> {
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
    const start = performance.now()
    let raw: unknown
    try {
      raw = await chatCompletion(
        { ...provider, ...seat, extraBody: JSON.parse(seat.extraBody) as Record<string, unknown> },
        { ...prompt, tools, tool: 'night_choice' },
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
        attempt: 1,
        validation: { ok: false, code: 'call_failed', error: message },
      })
      throw new ContestantFailure(request.seat, message)
    }
    const toolCheck = checkToolCall(raw, tools, 'night_choice')
    const errors = toolCheck.ok
      ? validateNightChoice(toolCheck.arguments, request)
      : [{ code: 'invalid_tool_call', error: toolCheck.error }]
    const valid = errors.length === 0
    const usage = usageShape.safeParse(raw)
    commit({
      type: 'contestant.decision',
      seat: request.seat,
      request,
      raw,
      model: seat.model,
      usage: usage.success ? (usage.data.usage ?? null) : null,
      durationMs: performance.now() - start,
      attempt: 1,
      validation: { ok: valid, errors },
    })
    if (!valid || !toolCheck.ok) throw new ContestantFailure(request.seat, JSON.stringify(errors))
    return toolCheck.arguments as NightChoice
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
    discretion: (_discretion, candidates) => {
      const choice = Array.isArray(candidates)
        ? candidates[Math.floor(rng() * candidates.length)]
        : candidates.sample
      if (choice === undefined) throw new Error('Discretion has no candidates')
      return Promise.resolve(choice)
    },
  }
  // shortcut: no retries; the retry ticket replaces first-failure termination.
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
