import type { Language, ValidationError } from '../types/game'

const ERRORS: Record<ValidationError['code'], { zh: string; en: string }> = {
  invalid_seat_count: {
    zh: '座位数不符合本局要求。',
    en: 'The seat count does not match this game.',
  },
  duplicate_role: { zh: '角色不得重复。', en: 'Characters must not repeat.' },
  invalid_role_counts: {
    zh: '各类型角色人数不符合配置。',
    en: 'Character type counts do not match the setup.',
  },
  no_washerwoman_truth: {
    zh: '洗衣妇之外必须有可被探测为镇民的座位，否则没有合法首夜信息。',
    en: 'The Washerwoman needs another detectable Townsfolk to receive legal first-night information.',
  },
  invalid_demon: { zh: '必须恰有一个小恶魔。', en: 'There must be exactly one Imp.' },
  unsupported_role: {
    zh: '包含本局不支持的角色。',
    en: 'A character is not supported in this game.',
  },
  invalid_targets: {
    zh: '目标数量、座位号或重复目标不符合上面的合法范围。',
    en: 'The target count, seat numbers or duplicate targets violate the legal range above.',
  },
  invalid_reasoning: { zh: 'reasoning 必须是字符串。', en: 'reasoning must be a string.' },
  invalid_memo: {
    zh: 'memo 必须是最多 2000 字的字符串。',
    en: 'memo must be a string of at most 2000 characters.',
  },
  invalid_nominee: {
    zh: 'nominee 必须是今天尚未被提名的合法座位号，或 null（pass）。',
    en: 'nominee must be a legal seat not yet nominated today, or null to pass.',
  },
  invalid_vote: {
    zh: 'raise_hand 必须是布尔值；死者投票标记已用时只能为 false。',
    en: 'raise_hand must be boolean; a spent dead vote token permits only false.',
  },
  invalid_speech: {
    zh: 'speech 必须是字符串或 null；提名理由和辩护必须非空。',
    en: 'speech must be a string or null; nomination reasons and defence must be nonempty.',
  },
  invalid_slayer_target: {
    zh: '猎手开枪目标只能附在非空公聊发言上，且必须是合法座位号。',
    en: 'A Slayer target must be a legal seat number attached to a nonempty public speech.',
  },
  invalid_whisper_members: {
    zh: 'members 必须为 null，或至少一个可邀请座位；不能包含自己、重复座位或次数用完的座位。',
    en: 'members must be null or at least one eligible invitee, without yourself, duplicates or exhausted seats.',
  },
  invalid_whisper_ranking: {
    zh: 'ranking 只能包含列出的房间编号，不能重复，可以为空。',
    en: 'ranking may contain only listed room numbers, without duplicates; an empty array is allowed.',
  },
  invalid_response: {
    zh: '响应必须包含 choices[0].message 及工具调用。',
    en: 'The response must contain choices[0].message and a tool call.',
  },
  no_tool_call: {
    zh: '未提交工具调用；请调用请求中指定的工具。',
    en: 'No tool call was submitted; call the tool specified in the request.',
  },
  multiple_tool_calls: {
    zh: '每次只能提交一个工具调用。',
    en: 'Submit exactly one tool call per attempt.',
  },
  unknown_tool: {
    zh: '工具不存在；请使用上面提供的工具。',
    en: 'The tool is unknown; use one of the tools provided above.',
  },
  wrong_tool: {
    zh: '调用了错误的工具；请调用本次请求指定的工具。',
    en: 'The wrong tool was called; call the tool specified in this request.',
  },
  invalid_arguments_json: {
    zh: '工具参数不是合法的 JSON。',
    en: 'The tool arguments are not valid JSON.',
  },
  invalid_arguments: {
    zh: '工具字段不符合 schema：请检查必填字段、类型、合法座位号和 memo 的 2000 字限制，不得添加额外字段。',
    en: 'Tool fields violate the schema: check required fields, types, legal seat numbers and the 2000-character memo limit; do not add extra fields.',
  },
}

export function invalidAttemptSuffix(
  language: Language,
  attempt: number,
  maxAttempts: number,
  calls: { name: string; arguments: string }[],
  errors: ValidationError[],
): string {
  const zh = language === 'zh'
  const previous = calls.length
    ? calls.map((call) => `${call.name}\n${call.arguments}`).join('\n\n')
    : zh
      ? '（没有工具调用）'
      : '(no tool call)'
  return [
    zh
      ? `上次提交无效（第 ${String(attempt)} 次尝试，最多 ${String(maxAttempts)} 次）`
      : `Previous submission invalid (attempt ${String(attempt)} of at most ${String(maxAttempts)})`,
    `${zh ? '上次工具与参数原文' : 'Previous tool and verbatim arguments'}:\n${previous}`,
    ...errors.map((error) => ERRORS[error.code][language]),
    zh ? '请按上面的请求重新调用。' : 'Call the tool again according to the request above.',
  ].join('\n')
}
