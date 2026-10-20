import { z } from 'zod'
import type { GameEvent } from '../types/game'
import type { ChannelBlock } from './channels'
import { firstToolArguments } from './tool-calls'

type Decision = Extract<GameEvent, { type: 'contestant.decision' | 'storyteller.decision' }>
const argumentsShape = z.object({
  reasoning: z.string(),
  speech: z.string().nullable().optional(),
  nominee: z.number().nullable().optional(),
})
const validation = z.object({ ok: z.literal(true) })

function decisionArguments(event: Decision) {
  const text = firstToolArguments(event.raw)
  if (!text) return undefined
  try {
    const args = argumentsShape.safeParse(JSON.parse(text) as unknown)
    return args.success ? args.data : undefined
  } catch {
    return undefined
  }
}

export interface SpectatorRow {
  event: GameEvent
  decision?: Decision
  reasoning?: string
  speech?: string | null
  nominee?: number | null
  losing: boolean
  falseInfo: boolean
  falseReason?: Extract<GameEvent, { type: 'ability.resolved' }>['reason']
}

// Input is the observer's projected prefix, never the future or another audience's log.
export function spectatorRows(events: readonly GameEvent[], losing: boolean): SpectatorRow[] {
  const decisions = new Map<number, Decision>()
  const pending = new Map<string, Decision>()
  const adopted = new Map<number, Decision>()
  const used = new Set<number>()
  const resolutions = new Map<number, Extract<GameEvent, { type: 'ability.resolved' }>>()
  const falseInformation = new Map<
    number,
    Extract<GameEvent, { type: 'ability.resolved' }>['reason']
  >()

  for (const event of events) {
    if (event.type === 'contestant.decision' || event.type === 'storyteller.decision') {
      decisions.set(event.seq, event)
      if (event.type === 'contestant.decision' && validation.safeParse(event.validation).success)
        pending.set(`${event.request.tool}:${String(event.seat)}`, event)
      continue
    }
    let decision: Decision | undefined
    if ('decision' in event && event.decision) decision = decisions.get(event.decision)
    else {
      const action =
        event.type === 'night.choice'
          ? ['night_choice', event.seat]
          : event.type === 'nomination'
            ? ['nominate', event.nominator]
            : event.type === 'vote'
              ? ['vote', event.seat]
              : event.type === 'whisper.proposed'
                ? ['propose_whisper', event.seat]
                : event.type === 'whisper.ranked'
                  ? ['rank_whispers', event.seat]
                  : undefined
      if (action) {
        const key = `${String(action[0])}:${String(action[1])}`
        decision = pending.get(key)
        pending.delete(key)
      }
    }
    if (decision) {
      adopted.set(event.seq, decision)
      used.add(decision.seq)
    }
    if (event.type === 'ability.resolved') resolutions.set(event.seat, event)
    if (event.type === 'told' && event.kind === 'ability') {
      const resolution = resolutions.get(event.seat)
      if (resolution?.deviated) falseInformation.set(event.seq, resolution.reason)
      resolutions.delete(event.seat)
    }
  }

  return events.flatMap((event): SpectatorRow[] => {
    if (event.type === 'storyteller.decision') return []
    const rejected = event.type === 'contestant.decision'
    if (rejected && (!losing || used.has(event.seq))) return []
    const decision = rejected ? event : adopted.get(event.seq)
    const args = decision ? decisionArguments(decision) : undefined
    return [
      {
        event,
        decision,
        reasoning: args?.reasoning,
        speech: rejected ? args?.speech : undefined,
        nominee: rejected ? args?.nominee : undefined,
        losing: rejected,
        falseInfo: falseInformation.has(event.seq),
        falseReason: falseInformation.get(event.seq),
      },
    ]
  })
}

function involvesSeat(event: GameEvent, seat: number): boolean {
  if ('seat' in event && event.seat === seat) return true
  if ('target' in event && event.target === seat) return true
  if ('targets' in event && event.targets.includes(seat)) return true
  if ('nominator' in event && event.nominator === seat) return true
  if ('nominee' in event && event.nominee === seat) return true
  if (event.type === 'dawn.announced') return event.deaths.includes(seat)
  if (event.type === 'public.speech') return event.slayerTarget === seat
  if (event.type === 'ability.resolved' && typeof event.result === 'object') {
    if ('redHerring' in event.result) return false
    return 'target' in event.result
      ? event.result.target === seat
      : event.result.seats.includes(seat)
  }
  if (event.type === 'whisper.proposed') return event.members?.includes(seat) ?? false
  return false
}

export function seatFootprint<T extends ChannelBlock>(
  blocks: readonly T[],
  seat: number,
  end: number,
): T[] {
  return blocks.flatMap((block) => {
    const events = block.events.filter((event) => event.seq <= end && involvesSeat(event, seat))
    return events.length ? [{ ...block, events }] : []
  })
}
