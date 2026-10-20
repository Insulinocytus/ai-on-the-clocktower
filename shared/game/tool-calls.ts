import { z } from 'zod'

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
