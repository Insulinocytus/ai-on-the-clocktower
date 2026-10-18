import type { Lang, ValidationCode, ValidationError } from '../../shared/rules/types'
import type { RetryNote } from './types'

const ERRORS: Record<ValidationCode, { zh: string; en: string }> = {
  no_tool_call: { zh: '没有收到工具调用；必须调用本次请求指定的一个工具。', en: 'No tool call was returned; call exactly the tool requested.' },
  wrong_tool: { zh: '调用的工具与本次请求不符。', en: 'The called tool does not match this request.' },
  bad_json: { zh: '工具参数不是合法的 JSON 对象。', en: 'Tool arguments must be a valid JSON object.' },
  missing_field: { zh: '缺少必填字段。', en: 'A required field is missing.' },
  bad_type: { zh: '字段类型或取值不符合工具定义。', en: 'A field has the wrong type or a value outside its schema.' },
  unknown_field: { zh: '包含工具定义中不存在的字段。', en: 'An argument field is not defined by this tool.' },
  memo_too_long: { zh: 'memo 超过 2000 字，请整份改写到上限以内。', en: 'memo exceeds 2000 characters; rewrite the whole memo within that limit.' },
  seat_out_of_range: { zh: '座位必须是本局 1 到人数之间的整数。', en: 'Seats must be integers from 1 through this game’s seat count.' },
  speech_required: { zh: '提名理由和辩护不能 pass，speech 必须是非空字符串。', en: 'Nomination reasons and defences cannot pass; speech must be a nonempty string.' },
  slayer_not_allowed: { zh: 'slayer_target 只能在公聊且 speech 非空时填写，否则必须为 null。', en: 'slayer_target is only allowed during public discussion with nonempty speech; otherwise use null.' },
  members_empty: { zh: 'members 至少包含一名其他玩家，或填 null 表示不私聊。', en: 'members must contain at least one other player, or be null to decline whispering.' },
  members_include_self: { zh: 'members 不能包含自己；自己会自动加入。', en: 'Do not include yourself in members; you join automatically.' },
  members_duplicate: { zh: 'members 不能有重复座位。', en: 'members must not contain duplicate seats.' },
  member_unavailable: { zh: '只能邀请本次请求列出的、仍有私聊次数的座位。', en: 'Invite only eligible seats listed in this request that still have whisper rooms left.' },
  rank_unknown_room: { zh: 'ranking 只能使用本次候选房间的编号。', en: 'ranking may contain only room numbers from this request’s candidates.' },
  rank_duplicate: { zh: 'ranking 不能重复排列同一个房间。', en: 'ranking must not contain the same room more than once.' },
  nominee_not_eligible: { zh: 'nominee 必须是本次请求列出的可提名座位，或 null。', en: 'nominee must be an eligible seat listed in this request, or null.' },
  vote_token_used: { zh: '你已死亡且投票标记已用掉，raise_hand 只能为 false。', en: 'You are dead and your vote token is used; raise_hand must be false.' },
  target_count: { zh: 'targets 的数量必须符合本次请求，且不能重复。', en: 'targets must have the requested count without duplicates.' },
  target_self: { zh: '本次能力不能选择自己。', en: 'You may not choose yourself for this ability.' },
  not_a_candidate: { zh: '裁量的字段或组合不在本次合法候选范围内。', en: 'The decision’s fields or combination are not among this request’s legal candidates.' },
  invalid_setup: { zh: '角色配置不合法：须符合人数配置及男爵修正，角色不得重复，恶魔只能为小恶魔。', en: 'Invalid setup: obey the player-count distribution and Baron adjustment, use unique characters and the Imp as the only Demon.' },
}

export function validationMessage(error: ValidationError, lang: Lang): string {
  return ERRORS[error.code][lang] + (error.field ? ` [${error.field}]` : '') + (error.detail ? ` ${error.detail}` : '')
}

export function retrySegment(retry: RetryNote, lang: Lang): string {
  const raw = retry.call ? `${retry.call.tool}\n${typeof retry.call.args === 'string' ? retry.call.args : JSON.stringify(retry.call.args)}` : (lang === 'zh' ? '（无工具调用）' : '(no tool call)')
  return lang === 'zh'
    ? `\n\n# 上次提交无效（第 ${retry.attempt} 次尝试，最多 3 次）\n上次调用的工具与参数原文：\n${raw}\n错误：${validationMessage(retry.error, lang)}\n请按上面的请求重新调用。`
    : `\n\n# Last submission invalid (attempt ${retry.attempt} of 3)\nPrevious tool and raw arguments:\n${raw}\nError: ${validationMessage(retry.error, lang)}\nCall the requested tool again.`
}
