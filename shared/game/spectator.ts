import { z } from 'zod'
import type { GameEvent } from '../types/game'
import type { ChannelBlock } from './channels'
import { adoptedDecisions, firstToolCall, isAccepted } from './tool-calls'

type Decision = Extract<GameEvent, { type: 'contestant.decision' | 'storyteller.decision' }>
const argumentsShape = z.object({
  reasoning_summary: z.string().optional(),
  speech: z.string().nullable().optional(),
  nominee: z.number().nullable().optional(),
})

function decisionArguments(event: Decision) {
  const text = firstToolCall(event.raw)?.arguments
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
  reasoningSummary?: string
  speech?: string | null
  nominee?: number | null
  losing: boolean
  falseInfo: boolean
  falseReason?: Extract<GameEvent, { type: 'ability.resolved' }>['reason']
}

// Input is the observer's projected prefix, never the future or another audience's log.
export function spectatorRows(events: readonly GameEvent[], losing: boolean): SpectatorRow[] {
  const used = adoptedDecisions(events)
  const resolutions = new Map<number, Extract<GameEvent, { type: 'ability.resolved' }>>()
  const falseInformation = new Map<
    number,
    Extract<GameEvent, { type: 'ability.resolved' }>['reason']
  >()

  for (const event of events) {
    if (event.type === 'ability.resolved') resolutions.set(event.seat, event)
    if (event.type === 'told' && event.kind === 'ability') {
      const resolution = resolutions.get(event.seat)
      if (resolution?.deviated) falseInformation.set(event.seq, resolution.reason)
      resolutions.delete(event.seat)
    }
  }

  return events.flatMap((event): SpectatorRow[] => {
    const row = { event, losing: false, falseInfo: falseInformation.has(event.seq) }
    if (event.type === 'storyteller.decision') {
      if (!isAccepted(event)) return []
      return [{ ...row, reasoningSummary: decisionArguments(event)?.reasoning_summary }]
    }
    if (event.type !== 'contestant.decision')
      return [{ ...row, falseReason: falseInformation.get(event.seq) }]
    const args = decisionArguments(event)
    if (used.has(event.seq)) return [{ ...row, reasoningSummary: args?.reasoning_summary }]
    if (!losing) return []
    return [
      {
        ...row,
        reasoningSummary: args?.reasoning_summary,
        speech: args?.speech,
        nominee: args?.nominee,
        losing: true,
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
