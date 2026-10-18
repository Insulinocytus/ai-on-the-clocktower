import { createRng } from '../../../shared/rules/rng'
import { foldGrimoire } from '../../../shared/rules/fold'
import { sampleSetup } from '../../../shared/rules/setup'
import { DISCRETION_IDS, LOG_VERSION } from '../../../shared/rules/types'
import { runGame } from '../../../shared/rules/game'
import type { ContestantAsk, DiscretionAsk, DiscretionValue, EventBody, GameConfig, GameEvent, Grimoire, Ports, RoleId, ToolCall } from '../../../shared/rules/types'

export interface Script {
  roles?: RoleId[]
  seed?: string
  whisperRooms?: number
  maxSpeeches?: number
  answer?: (ask: ContestantAsk, g: Grimoire, events: GameEvent[]) => ToolCall | undefined
  decide?: (ask: DiscretionAsk, g: Grimoire) => DiscretionValue | undefined
  stop?: (event: GameEvent, events: GameEvent[]) => boolean
}

class ScenarioComplete extends Error {}

export function scriptedPorts(script: Script = {}, count = script.roles?.length ?? 5) {
  const rng = createRng(script.seed ?? 'scenario')
  const config: GameConfig = {
    seatCount: count, seats: [], storyteller: null,
    sources: Object.fromEntries(DISCRETION_IDS.map(id => [id, 'random'])) as GameConfig['sources'],
    maxSpeeches: script.maxSpeeches ?? 2, whisperRooms: script.whisperRooms ?? 0,
    language: 'en', seed: script.seed ?? 'scenario', logVersion: LOG_VERSION, promptVersion: 'test',
  }
  const events: GameEvent[] = []
  const asks: ContestantAsk[] = []
  const discretions: DiscretionAsk[] = []
  let stopped = false
  function commit(event: EventBody): number {
    const full = { ...event, seq: events.length + 1 } as GameEvent
    events.push(full)
    if (events.length > 100000) throw new Error('Scenario did not terminate')
    if (script.stop?.(full, events)) {
      stopped = true
      throw new ScenarioComplete()
    }
    return full.seq
  }
  const ports: Ports = {
    rng, commit,
    async discretion(ask) {
      discretions.push(ask)
      const requestSeq = commit({ type: 'discretion.requested', ...ask, source: 'random' })
      const g = foldGrimoire(events)
      const value = script.decide?.(ask, g) ?? (ask.candidates.kind === 'setup' ? { roles: script.roles ?? sampleSetup(count, rng) } : ask.candidates.kind === 'seating' ? { roles: ask.candidates.roles } : rng.pick(ask.candidates.values))
      commit({ type: 'discretion.resolved', requestSeq, discretion: ask.discretion, source: 'random', value, decisionSeq: null })
      return value
    },
    async askContestants(batch) {
      const g = foldGrimoire(events)
      return batch.map(ask => {
        asks.push(ask)
        const request = ask.request
        const call = script.answer?.(ask, g, events) ?? defaultAnswer(ask, g, rng)
        const decisionSeq = commit({ type: 'contestant.decision', seat: ask.seat, request, model: 'script', params: {}, response: call, usage: null, durationMs: 0, attempt: 1, outcome: { ok: true, call: { tool: call.tool, args: { ...call.args } } } })
        return { seat: ask.seat, call, decisionSeq }
      })
    },
  }
  commit({ type: 'game.created', config })
  return {
    config, ports, events, asks, discretions,
    async run() {
      try { await runGame(config, ports) } catch (error) { if (!(error instanceof ScenarioComplete) || !stopped) throw error }
      return foldGrimoire(events)
    },
  }
}

function defaultAnswer(ask: ContestantAsk, g: Grimoire, rng: Ports['rng']): ToolCall {
  const request = ask.request
  switch (request.kind) {
    case 'speak': return { tool: 'speak', args: { reasoning: '', speech: request.context.where === 'nomination_reason' || request.context.where === 'defense' ? 'A reason.' : null, slayer_target: null } }
    case 'propose_whisper': return { tool: 'propose_whisper', args: { reasoning: '', members: null } }
    case 'rank_whispers': return { tool: 'rank_whispers', args: { reasoning: '', ranking: request.rooms.map(room => room.room) } }
    case 'nominate': return { tool: 'nominate', args: { reasoning: '', nominee: rng.next() < 0.25 ? null : rng.pick(request.eligible) } }
    case 'vote': return { tool: 'vote', args: { reasoning: '', raise_hand: rng.next() < 0.7 } }
    case 'night_choice': {
      const targets = rng.shuffle(g.seats.filter(player => request.allowSelf || player.seat !== ask.seat).map(player => player.seat)).slice(0, request.count)
      return { tool: 'night_choice', args: { reasoning: '', targets } }
    }
  }
}

export const passNomination: ToolCall = { tool: 'nominate', args: { reasoning: '', nominee: null } }
export function choice(...targets: number[]): ToolCall { return { tool: 'night_choice', args: { reasoning: '', targets } } }
export function say(speech: string | null, slayer_target: number | null = null): ToolCall { return { tool: 'speak', args: { reasoning: '', speech, slayer_target } } }
export function nominate(nominee: number | null): ToolCall { return { tool: 'nominate', args: { reasoning: '', nominee } } }
export function vote(raise_hand: boolean): ToolCall { return { tool: 'vote', args: { reasoning: '', raise_hand } } }
