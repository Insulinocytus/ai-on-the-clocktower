import { z } from 'zod'
import type { GameEvent } from '../types/game'

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: null
      tool_calls: { id: string; type: 'function'; function: ToolCall }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

interface ToolCall {
  name: string
  arguments: string
}

const call = z.object({ name: z.string(), arguments: z.string() })
const completionsResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ tool_calls: z.array(z.object({ function: call })).nullish() }),
      }),
    )
    .min(1),
})
const responsesResponse = z.object({ output: z.array(z.unknown()) })
const responsesCall = call.extend({ type: z.literal('function_call') })
const messagesResponse = z.object({ content: z.array(z.unknown()) })
const messagesCall = z.object({ type: z.literal('tool_use'), name: z.string(), input: z.unknown() })
const accepted = z.object({ ok: z.literal(true) })
const passArguments = z.object({ speech: z.null() }).or(z.object({ nominee: z.null() }))

/**
 * Tool calls in a raw provider response of any API format, recognised by shape; undefined when
 * the shape is none of them.
 */
export function toolCalls(raw: unknown): ToolCall[] | undefined {
  const completions = completionsResponse.safeParse(raw)
  if (completions.success)
    return (completions.data.choices[0]?.message.tool_calls ?? []).map((c) => c.function)
  const responses = responsesResponse.safeParse(raw)
  if (responses.success)
    return responses.data.output.flatMap((item) => {
      const parsed = responsesCall.safeParse(item)
      return parsed.success ? [{ name: parsed.data.name, arguments: parsed.data.arguments }] : []
    })
  const messages = messagesResponse.safeParse(raw)
  if (messages.success)
    return messages.data.content.flatMap((block) => {
      const parsed = messagesCall.safeParse(block)
      return parsed.success
        ? [{ name: parsed.data.name, arguments: JSON.stringify(parsed.data.input ?? null) }]
        : []
    })
  return undefined
}

export function firstToolCall(raw: unknown): ToolCall | undefined {
  return toolCalls(raw)?.[0]
}

/** Whether a decision attempt passed validation, i.e. its tool call is the decision's answer. */
export function isAccepted(decision: { validation: unknown }): boolean {
  return accepted.safeParse(decision.validation).success
}

function isPass(raw: unknown): boolean {
  const text = firstToolCall(raw)?.arguments
  if (!text) return false
  try {
    return passArguments.safeParse(JSON.parse(text)).success
  } catch {
    return false
  }
}

/**
 * Seqs of decisions that took effect, passes included; the rest are unselected speeches or
 * nominations and attempts that failed validation.
 */
export function adoptedDecisions(events: readonly GameEvent[]): Set<number> {
  const pending = new Map<string, number>()
  const adopted = new Set<number>()
  for (const event of events) {
    if (event.type === 'contestant.decision') {
      if (!isAccepted(event)) continue
      if (isPass(event.raw)) adopted.add(event.seq)
      else pending.set(`${event.request.tool}:${String(event.seat)}`, event.seq)
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
