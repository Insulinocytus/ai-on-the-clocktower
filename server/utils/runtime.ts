import {
  GameAbortedError, TOOL_FOR_REQUEST, type ContestantAnswer, type ContestantAsk, type DecisionRecord,
  type DiscretionAsk, type DiscretionValue, type EventBody, type GameConfig, type GameEvent,
  type PresetSnapshot, type ValidationError,
} from '../../shared/rules/types'
import { createRng } from '../../shared/rules/rng'
import { foldGrimoire, isCandidate, project, sampleSetup, validateDecide, validateToolCall } from '../../shared/rules'
import { runGame } from '../../shared/rules/game'
import {
  buildContestantMessages, buildStorytellerMessages, contestantTools, storytellerTools,
  type ChatMessage, type OpenAITool, type RetryNote,
} from '../prompts'
import { append, events } from './db'
import { backoff, callModel, CallError, parseTool, requestBody, type RawCall } from './llm'

interface Pending { ask: DiscretionAsk; resolve: (value: DiscretionValue) => void; reject: (reason: unknown) => void }
export const runners = new Map<string, Runner>()
class Runner {
  readonly controller = new AbortController()
  readonly log: GameEvent[]
  readonly pending = new Map<number, Pending>()
  readonly rng
  private finished = false
  constructor(readonly id: string, readonly config: GameConfig) {
    this.log = events(id)
    this.rng = createRng(config.seed)
  }
  commit = (body: EventBody): number => {
    this.controller.signal.throwIfAborted()
    const event = append(this.id, (this.log.at(-1)?.seq ?? 0) + 1, body)
    this.log.push(event)
    if (body.type === 'game.ended') this.cancel()
    return event.seq
  }
  private cancel(): void {
    this.finished = true
    this.controller.abort(new GameAbortedError())
    for (const waiter of this.pending.values()) waiter.reject(new GameAbortedError())
    this.pending.clear()
  }
  abort(body: Extract<EventBody, { type: 'game.aborted' }>): void {
    if (this.finished) return
    this.cancel()
    this.log.push(append(this.id, (this.log.at(-1)?.seq ?? 0) + 1, body))
  }
  private async decision<T>(input: {
    preset: PresetSnapshot; tools: OpenAITool[]; expected: string;
    messages: (retry?: RetryNote) => ChatMessage[];
    validate: (call: RawCall) => { ok: true; value: T; args: Record<string, unknown> } | { ok: false; error: ValidationError };
    event: { type: 'contestant.decision'; seat: number; request: ContestantAsk['request'] } | { type: 'storyteller.decision'; discretion: DiscretionAsk['discretion']; requestSeq: number };
  }): Promise<{ value: T; seq: number }> {
    let retry: RetryNote | undefined
    let body = requestBody(input.preset, input.messages(), input.tools, input.expected)
    const { messages: _messages, tools: _tools, ...params } = body
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.controller.signal.throwIfAborted()
      const start = performance.now()
      let raw: unknown = null
      let durationMs = 0
      let outcome: DecisionRecord['outcome']
      let value: T | undefined
      let valid = false
      let wait = 0
      try {
        const result = await callModel(input.preset, body, this.controller.signal)
        raw = result.raw
        durationMs = result.durationMs
        this.controller.signal.throwIfAborted()
        const call = parseTool(raw)
        const checked = call ? input.validate(call) : { ok: false as const, error: { code: 'no_tool_call' as const } }
        if (checked.ok && call) {
          value = checked.value
          valid = true
          outcome = { ok: true, call: { tool: call.tool, args: checked.args } }
        } else {
          const error = checked.ok ? { code: 'no_tool_call' as const } : checked.error
          outcome = { ok: false, errorKind: 'invalid', error: error.code, validation: error, ...(call ? { call: { tool: call.tool, args: call.args } } : {}) }
          retry = { attempt, call: call ? { tool: call.tool, args: call.rawArgs } : null, error }
          body = requestBody(input.preset, input.messages(retry), input.tools, input.expected)
        }
      } catch (error) {
        if (this.controller.signal.aborted) throw new GameAbortedError()
        if (!(error instanceof CallError)) throw error
        raw = error.raw
        durationMs = performance.now() - start
        outcome = { ok: false, errorKind: error.kind, error: error.message, ...(error.status ? { status: error.status } : {}) }
        wait = error.retryAfterMs ?? Number(process.env.LLM_BACKOFF_BASE_MS ?? 500) * 2 ** (attempt - 1)
      }
      this.controller.signal.throwIfAborted()
      const usage = raw && typeof raw === 'object' && 'usage' in raw ? raw.usage : null
      const seq = this.commit({ ...input.event, params, response: raw, model: input.preset.model, usage, durationMs, attempt, outcome })
      if (valid && outcome.ok) {
        if (input.event.type === 'contestant.decision' && typeof outcome.call.args.memo === 'string') {
          this.commit({ type: 'seat.memo.updated', seat: input.event.seat, text: outcome.call.args.memo })
        }
        return { value: value as T, seq }
      }
      if (attempt === 3) {
        this.abort({ type: 'game.aborted', reason: 'model_failure', detail: outcome.ok ? '' : outcome.error,
          ...(input.event.type === 'contestant.decision' ? { seat: input.event.seat } : { discretion: input.event.discretion }) })
        throw new GameAbortedError()
      }
      if (wait > 0) await backoff(wait, this.controller.signal)
    }
    throw new GameAbortedError()
  }
  askContestants = async (asks: ContestantAsk[]): Promise<ContestantAnswer[]> => {
    this.controller.signal.throwIfAborted()
    const snapshot = this.log.slice()
    const truth = foldGrimoire(snapshot)
    const tools = contestantTools(this.config.seatCount, this.config.language)
    const prepared = asks.map(ask => {
      const projection = project(snapshot, { kind: 'seat', seat: ask.seat })
      const build = (retry?: RetryNote) => buildContestantMessages({ config: this.config, seat: ask.seat, events: projection, request: ask.request, ...(retry ? { retry } : {}) })
      return { ask, build, initial: build() }
    })
    return Promise.all(prepared.map(async ({ ask, build, initial }) => {
      const voteTokenUsed = truth.seats[ask.seat - 1]?.voteTokenUsed ?? false
      const preset = this.config.seats[ask.seat - 1]!
      const result = await this.decision({
        preset, tools, expected: TOOL_FOR_REQUEST[ask.request.kind], messages: retry => retry ? build(retry) : initial,
        event: { type: 'contestant.decision', seat: ask.seat, request: ask.request },
        validate: call => {
          const result = validateToolCall(ask.request, ask.seat, this.config.seatCount, call.tool, call.rawArgs, { voteTokenUsed })
          return result.ok ? { ok: true, value: result.call, args: { ...result.call.args } } : result
        },
      })
      return { seat: ask.seat, call: result.value, decisionSeq: result.seq }
    }))
  }
  discretion = async (ask: DiscretionAsk): Promise<DiscretionValue> => {
    this.controller.signal.throwIfAborted()
    if (ask.candidates.kind === 'list' && ask.candidates.values.length === 1) return ask.candidates.values[0]!
    const source = this.config.sources[ask.discretion]
    const seq = this.commit({ type: 'discretion.requested', ...ask, source })
    let value: DiscretionValue
    let decisionSeq: number | null = null
    if (source === 'manual') {
      const deferred = Promise.withResolvers<DiscretionValue>()
      this.pending.set(seq, { ask, resolve: deferred.resolve, reject: deferred.reject })
      return deferred.promise
    }
    if (source === 'random') {
      if (ask.candidates.kind === 'setup') value = { roles: sampleSetup(this.config.seatCount, this.rng) }
      else if (ask.candidates.kind === 'seating') value = { roles: this.rng.shuffle(ask.candidates.roles) }
      else {
        const candidates = ask.candidates.values
        const no = candidates.filter(c => c.answer === false || c.seats?.length === 0)
        const yes = candidates.filter(c => !no.includes(c))
        value = (ask.discretion === 'D12' || ask.discretion === 'D13') && no.length && yes.length
          ? this.rng.pick(this.rng.int(2) ? yes : no) : this.rng.pick(candidates)
      }
    } else {
      if (!this.config.storyteller) throw new Error('Missing storyteller preset')
      const projection = project(this.log.slice(), { kind: 'storyteller' })
      const result = await this.decision({
        preset: this.config.storyteller, tools: storytellerTools(this.config.seatCount, this.config.language), expected: 'decide',
        messages: retry => buildStorytellerMessages({ config: this.config, events: projection, ask, ...(retry ? { retry } : {}) }),
        event: { type: 'storyteller.decision', discretion: ask.discretion, requestSeq: seq },
        validate: call => {
          if (call.tool !== 'decide') return { ok: false, error: { code: 'wrong_tool' } }
          const result = validateDecide(ask, this.config.seatCount, call.rawArgs)
          return result.ok ? { ok: true, value: result.value, args: { reasoning: result.reasoning, ...result.value } } : result
        },
      })
      value = result.value
      decisionSeq = result.seq
    }
    this.commit({ type: 'discretion.resolved', requestSeq: seq, discretion: ask.discretion, value, source, decisionSeq })
    return value
  }
  submit(seq: number, value: DiscretionValue): 'ok' | 'invalid' | 'conflict' {
    const pending = this.pending.get(seq)
    if (!pending || this.finished) return 'conflict'
    if (!isCandidate(pending.ask.candidates, value, this.config.seatCount)) return 'invalid'
    this.pending.delete(seq)
    this.commit({ type: 'discretion.resolved', requestSeq: seq, discretion: pending.ask.discretion, value, source: 'manual', decisionSeq: null })
    pending.resolve(value)
    return 'ok'
  }
}
export function startGame(id: string, config: GameConfig): void {
  const runner = new Runner(id, config)
  runners.set(id, runner)
  runner.commit({ type: 'game.created', config })
  void runGame(config, runner).catch((error: unknown) => {
    if (!runner.controller.signal.aborted) runner.abort({ type: 'game.aborted', reason: 'engine_error', detail: error instanceof Error ? error.message : String(error) })
  }).finally(() => { runners.delete(id) })
}
