import { Ajv } from 'ajv'
import { z } from 'zod'

export type Lang = 'zh' | 'en'

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, object>
      required: string[]
      additionalProperties: false
    }
  }
}

const TEXT = {
  zh: {
    reasoning: '你的内心推理。',
    memo: '可选。填写则用它整份替换你的备忘录；不填则备忘录不变。',
    speak: '说一句话或 pass。私聊、公聊、提名理由、辩护都用这个工具。',
    speech: '你要说出口的话；null 表示 pass。',
    slayer: '公开声称以猎手能力开枪的目标座位。只在公聊且 speech 不为空时可以填写，否则为 null。',
    propose: '提议本轮的私聊房间。',
    members: '你邀请的座位（不含你自己，你会自动加入）；null 表示本轮不私聊。',
    rank: '给包含你的候选私聊房间排序。',
    ranking: '按意愿从高到低排列的房间编号；没排进去的房间就是不去。',
    nominate: '提名一名玩家，或本轮不提名。',
    nominee: '被提名的座位；null 表示不提名。',
    vote: '对当前提名投票。',
    raise: 'true 表示举手（赞成处决），false 表示不举手。',
    night: '夜里被唤醒时选择目标。',
    targets: '选择的座位，数量按请求要求。',
  },
  en: {
    reasoning: 'Your inner reasoning.',
    memo: 'Optional. If given, it replaces your whole memo; if left out, your memo stays the same.',
    speak:
      'Say one line or pass. Used for whispers, public discussion, nomination reasons and defences.',
    speech: 'What you say out loud; null to pass.',
    slayer:
      'Target seat for a public Slayer shot. Only allowed in public discussion with a non-null speech; otherwise null.',
    propose: "Propose this round's whisper room.",
    members:
      'Seats you invite (not yourself; you join automatically); null to not whisper this round.',
    rank: 'Rank the candidate whisper rooms that include you.',
    ranking: "Room numbers from most to least wanted; rooms left out are rooms you won't join.",
    nominate: 'Nominate a player, or nominate nobody this round.',
    nominee: 'Seat to nominate; null for nobody.',
    vote: 'Vote on the current nomination.',
    raise: 'true to raise your hand (vote to execute), false not to.',
    night: 'Choose targets when woken at night.',
    targets: 'Chosen seats, as many as the request says.',
  },
} satisfies Record<Lang, Record<string, string>>

/** The six contestant tools, fixed for a whole game: `reasoning` first, optional `memo` last, seats as integer enums 1..N. */
export function contestantTools(lang: Lang, seatCount: number): Tool[] {
  const t = TEXT[lang]
  const seats = Array.from({ length: seatCount }, (_, i) => i + 1)
  const seat = { type: 'integer', enum: seats }
  const seatOrNull = { type: ['integer', 'null'], enum: [...seats, null] }
  const tool = (
    name: string,
    description: string,
    props: Record<string, object>,
    required: string[],
  ): Tool => ({
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          reasoning: { type: 'string', description: t.reasoning },
          ...props,
          memo: { type: 'string', maxLength: 2000, description: t.memo },
        },
        required: ['reasoning', ...required],
        additionalProperties: false,
      },
    },
  })
  return [
    tool(
      'speak',
      t.speak,
      {
        speech: { type: ['string', 'null'], description: t.speech },
        slayer_target: { ...seatOrNull, description: t.slayer },
      },
      ['speech', 'slayer_target'],
    ),
    tool(
      'propose_whisper',
      t.propose,
      { members: { type: ['array', 'null'], items: seat, description: t.members } },
      ['members'],
    ),
    tool(
      'rank_whispers',
      t.rank,
      { ranking: { type: 'array', items: { type: 'integer' }, description: t.ranking } },
      ['ranking'],
    ),
    tool('nominate', t.nominate, { nominee: { ...seatOrNull, description: t.nominee } }, [
      'nominee',
    ]),
    tool('vote', t.vote, { raise_hand: { type: 'boolean', description: t.raise } }, ['raise_hand']),
    tool(
      'night_choice',
      t.night,
      { targets: { type: 'array', items: seat, description: t.targets } },
      ['targets'],
    ),
  ]
}

const ajv = new Ajv({ allowUnionTypes: true })

const completionShape = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          tool_calls: z
            .array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) }))
            .nullish(),
        }),
      }),
    )
    .min(1),
})

export type ToolCallCheck =
  { ok: true; name: string; arguments: unknown } | { ok: false; error: string }

/** Checks that a raw Chat Completions response holds exactly one call to one of `tools`, with schema-valid arguments. */
export function checkToolCall(response: unknown, tools: Tool[]): ToolCallCheck {
  const parsed = completionShape.safeParse(response)
  if (!parsed.success) return { ok: false, error: 'Response has no choices[0].message' }
  const calls = parsed.data.choices[0]?.message.tool_calls ?? []
  const [call] = calls
  if (!call) return { ok: false, error: 'No tool call' }
  if (calls.length > 1) {
    return { ok: false, error: `Expected one tool call, got ${String(calls.length)}` }
  }
  const { name } = call.function
  const tool = tools.find((t) => t.function.name === name)
  if (!tool) return { ok: false, error: `Unknown tool "${name}"` }
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return { ok: false, error: `Arguments of ${name} are not valid JSON` }
  }
  const validate = ajv.compile(tool.function.parameters)
  if (!validate(args)) {
    return {
      ok: false,
      error: `${name}: ${ajv.errorsText(validate.errors, { dataVar: 'arguments' })}`,
    }
  }
  return { ok: true, name, arguments: args }
}
