import { z } from 'zod'
import type { GameEvent } from '../types/game'

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: null
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

const completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        tool_calls: z
          .array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) }))
          .optional(),
      }),
    }),
  ),
})
const accepted = z.object({ ok: z.literal(true) })

export function firstToolCall(raw: unknown): { name: string; arguments: string } | undefined {
  const parsed = completion.safeParse(raw)
  return parsed.success ? parsed.data.choices[0]?.message.tool_calls?.[0]?.function : undefined
}

/** Whether a decision attempt passed validation, i.e. its tool call is the decision's answer. */
export function isAccepted(decision: { validation: unknown }): boolean {
  return accepted.safeParse(decision.validation).success
}

/** Seqs of accepted contestant decisions that took effect; the rest are e.g. unselected speeches. */
export function adoptedDecisions(events: readonly GameEvent[]): Set<number> {
  const pending = new Map<string, number>()
  const adopted = new Set<number>()
  for (const event of events) {
    if (event.type === 'contestant.decision') {
      if (isAccepted(event)) pending.set(`${event.request.tool}:${String(event.seat)}`, event.seq)
      continue
    }
    if ('decision' in event && event.decision) {
      adopted.add(event.decision)
      continue
    }
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
    if (!action) continue
    const key = `${String(action[0])}:${String(action[1])}`
    const decision = pending.get(key)
    if (decision !== undefined) adopted.add(decision)
    pending.delete(key)
  }
  return adopted
}
