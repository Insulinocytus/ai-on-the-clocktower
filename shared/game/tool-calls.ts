import { z } from 'zod'

const completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        tool_calls: z.array(z.object({ function: z.object({ arguments: z.string() }) })).optional(),
      }),
    }),
  ),
})

export function firstToolArguments(raw: unknown): string | undefined {
  const parsed = completion.safeParse(raw)
  return parsed.success
    ? parsed.data.choices[0]?.message.tool_calls?.[0]?.function.arguments
    : undefined
}
