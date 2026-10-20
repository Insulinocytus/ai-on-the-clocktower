import { renderEvent } from '../event-templates'
import { ROLES } from '../game/roles'
import { project, setupCounts, validateDiscretionChoice } from '../game/rules'
import { firstToolCall } from '../game/tool-calls'
import type {
  DiscretionCandidates,
  DiscretionChoice,
  DiscretionContext,
  DiscretionId,
  GameConfig,
  GameEvent,
  Language,
  ValidationError,
} from '../types/game'
import { rulesBlock } from './rules'

function fields(choice: DiscretionChoice, id: DiscretionId): Record<string, unknown> {
  if (Array.isArray(choice)) return { roles: choice }
  if (typeof choice === 'string') return { roles: [choice] }
  if (typeof choice === 'boolean') return { answer: choice }
  if (typeof choice === 'number')
    return ['D3', 'D13', 'D14'].includes(id) ? { seats: [choice] } : { number: choice }
  if ('alignment' in choice) return { roles: [choice.role], alignment: choice.alignment }
  if ('role' in choice)
    return { seats: 'target' in choice ? [choice.target] : choice.seats, roles: [choice.role] }
  throw new Error('Unsupported discretion candidate')
}

export function parseStorytellerChoice(
  value: unknown,
  id: DiscretionId,
  candidates: DiscretionCandidates,
  seatCount: number,
): { ok: true; choice: DiscretionChoice } | { ok: false; errors: ValidationError[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, errors: [{ code: 'invalid_discretion' }] }
  const args = value as Record<string, unknown>
  if (!Array.isArray(candidates)) {
    if (Object.keys(args).some((key) => key !== 'reasoning_summary' && key !== 'roles'))
      return { ok: false, errors: [{ code: 'invalid_discretion' }] }
    const errors = validateDiscretionChoice(args.roles, candidates, seatCount)
    return errors.length
      ? { ok: false, errors }
      : { ok: true, choice: args.roles as DiscretionChoice }
  }
  const keys = Object.keys(args)
    .filter((key) => key !== 'reasoning_summary')
    .sort()
  for (const choice of candidates) {
    const expected = fields(choice, id)
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(expected).sort())) continue
    if (
      keys.every((key) => {
        const actual = args[key]
        const wanted = expected[key]
        return (
          JSON.stringify(Array.isArray(actual) ? actual.toSorted() : actual) ===
          JSON.stringify(Array.isArray(wanted) ? wanted.toSorted() : wanted)
        )
      })
    )
      return { ok: true, choice }
  }
  return { ok: false, errors: [{ code: 'invalid_discretion' }] }
}

const ADVICE: Partial<Record<DiscretionId, { zh: string; en: string }>> = {
  D1: {
    zh: '选择能互动的有趣角色，避免信息强到没有悬念。',
    en: 'Choose interesting interacting characters; avoid making information so strong that no suspense remains.',
  },
  D3: {
    zh: '5–6 人小局建议常让占卜师自己当干扰项，以给他更多信息。',
    en: 'In 5–6 player games, often make the Fortune Teller their own red herring to give them more information.',
  },
  D7: {
    zh: '建议两个镇民加一个外来者；这是建议，不是硬约束。',
    en: 'Prefer two Townsfolk and one Outsider; this is advice, not a hard constraint.',
  },
  D8: {
    zh: '可以且通常应该给假信息，尽量误导该玩家、配合邪恶方已公开的伪装，但必须像真的，不得明显暴露醉酒或中毒。也允许给真信息。',
    en: 'You may and usually should give false information, misleading the player and fitting publicly claimed evil bluffs, but make it plausible and do not reveal drunkenness or poison. Truthful information is also legal.',
  },
  D10: {
    zh: '选择最有趣的结果；不要为传信息改魔典。阵营与角色分别独立决定，开局固定，整局不变。',
    en: 'Choose the most interesting result; do not change the Grimoire to communicate information. Alignment and character are independent and fixed for the whole game.',
  },
  D11: {
    zh: '不要滥用被当作；阵营与角色分别独立决定，开局固定，整局不变。',
    en: 'Do not overuse registration; alignment and character are independent and fixed for the whole game.',
  },
  D12: {
    zh: '尽量保留镇长到最后一天，除非全场压倒性相信他是镇长；不要直接决定胜负。',
    en: 'Try to keep the Mayor until the final day unless the table overwhelmingly believes the claim; do not settle the winner directly.',
  },
  D13: {
    zh: '不要通过替死直接决定胜负；选死者、有效士兵或受保护者导致无人死亡的选法不宜频繁用。替死算小恶魔击杀，会触发守鸦人。',
    en: 'Do not settle the winner directly. Use no-death options (dead players, working Soldier or protected players) sparingly. Replacement death counts as an Imp kill and wakes a Ravenkeeper.',
  },
  D14: {
    zh: '只选存活的真爪牙，不包括仅被当作爪牙的陌客；红唇女郎强制继位已由代码处理。',
    en: 'Choose only a real living Minion, never a Recluse merely registering as one; mandatory Scarlet Woman succession is handled by code.',
  },
}

const PURPOSE: Record<DiscretionId, { zh: string; en: string }> = {
  D1: {
    zh: '选择本局角色；与分座同来源时一并按座位排列，不同来源时之后另行分座。',
    en: 'Choose the characters; assign them in seat order when seating uses the same source, otherwise seating follows separately.',
  },
  seating: {
    zh: '把已选角色排列到座位，不得更换角色。',
    en: 'Permute the selected characters into seat order; do not replace any character.',
  },
  D2: {
    zh: '选择酒鬼以为自己是哪个未在场的镇民。',
    en: 'Choose the absent Townsfolk the Drunk believes they are.',
  },
  D3: {
    zh: '选择占卜师固定的善良干扰项，可选占卜师本人。',
    en: 'Choose the Fortune Teller’s fixed good red herring, possibly the Fortune Teller themself.',
  },
  D4: {
    zh: '为洗衣妇选择两名其他玩家与一张镇民牌，至少一人被当作该角色。',
    en: 'Choose two other players and one Townsfolk card for the Washerwoman; at least one registers as that character.',
  },
  D5: {
    zh: '为图书管理员选择两名其他玩家与一张外来者牌，至少一人被当作该角色；没有可探测外来者时给 0。',
    en: 'Choose two other players and one Outsider card for the Librarian; at least one registers as that character. Give 0 when no Outsider is detectable.',
  },
  D6: {
    zh: '为调查员选择两名其他玩家与一张爪牙牌，至少一人被当作该角色；没有可探测爪牙时给 0。',
    en: 'Choose two other players and one Minion card for the Investigator; at least one registers as that character. Give 0 when no Minion is detectable.',
  },
  D7: {
    zh: '选择三个不同的未在场善良角色给恶魔作伪装。',
    en: 'Choose three distinct absent good characters as Demon bluffs.',
  },
  D8: {
    zh: '为指定的醉酒或中毒座位选择符合其以为角色输出形式的信息；可以真也可以假。',
    en: 'Choose information matching the perceived character’s output for the specified drunk or poisoned seat; it may be true or false.',
  },
  D10: {
    zh: '设定间谍整局固定的被当作阵营与角色。',
    en: 'Set the Spy’s fixed registration alignment and character.',
  },
  D11: {
    zh: '设定陌客整局固定的被当作阵营与角色。',
    en: 'Set the Recluse’s fixed registration alignment and character.',
  },
  D12: {
    zh: '能力有效且未受保护的镇长将被小恶魔杀死，决定是否替死。',
    en: 'A working, unprotected Mayor is about to be killed by the Imp; decide whether to redirect.',
  },
  D13: {
    zh: '选择除镇长外的替死对象；受保护者、有效士兵或死者使当夜无人死亡。',
    en: 'Choose a replacement other than the Mayor; a protected player, working Soldier or dead player causes no death.',
  },
  D14: {
    zh: '小恶魔自杀成功且没有强制继位，选择存活的真爪牙继位。',
    en: 'After an Imp self-kill without mandatory succession, choose a real living Minion to inherit.',
  },
}

export function discretionRequest(
  language: Language,
  id: DiscretionId,
  candidates: DiscretionCandidates,
  context: DiscretionContext,
  seatCount: number,
): string {
  const zh = language === 'zh'
  const lines = [zh ? `# 本次裁量：${id}` : `# This decision: ${id}`]
  lines.push(PURPOSE[id][language])
  if (!Array.isArray(candidates)) {
    const counts = setupCounts(seatCount)
    lines.push(
      candidates.type === 'seating'
        ? zh
          ? `将这些角色各用一次分配到座位：${candidates.roles.join('、')}。`
          : `Assign exactly these characters once each to the seats: ${candidates.roles.join(', ')}.`
        : zh
          ? `选择 ${String(seatCount)} 个不同角色：${String(counts.townsfolk)} 镇民、${String(counts.outsiders)} 外来者、${String(counts.minions)} 爪牙、1 小恶魔。男爵在场时少 2 镇民、多 2 外来者。酒鬼占外来者名额，以为的镇民之后另定且不在场。洗衣妇不能是唯一镇民。`
          : `Choose ${String(seatCount)} distinct characters: ${String(counts.townsfolk)} Townsfolk, ${String(counts.outsiders)} Outsiders, ${String(counts.minions)} Minions and 1 Imp. A Baron replaces 2 Townsfolk with 2 Outsiders. The Drunk takes an Outsider slot; their absent believed Townsfolk is chosen later. The Washerwoman cannot be the sole Townsfolk.`,
    )
    if (candidates.type === 'setup') {
      const groups = [
        ['townsfolk', '镇民', 'Townsfolk'],
        ['outsider', '外来者', 'Outsiders'],
        ['minion', '爪牙', 'Minions'],
        ['demon', '恶魔', 'Demon'],
      ] as const
      const ids = groups.map(([type, chinese, english]) => {
        const roles = Object.values(ROLES).filter((role) => role.type === type)
        return zh
          ? `${chinese}：${roles.map((role) => `${role.id}（${role.name.zh}）`).join('、')}`
          : `${english}: ${roles.map((role) => `${role.id} (${role.name.en})`).join(', ')}`
      })
      lines.push(
        zh
          ? `roles 只能填以下角色 id：${ids.join('；')}。`
          : `roles accepts only these character ids: ${ids.join('; ')}.`,
      )
    }
    lines.push(
      zh
        ? `roles 按座位顺序填 ${String(seatCount)} 个角色。`
        : `Put ${String(seatCount)} characters in roles, in seat order.`,
    )
  } else {
    const shapes = new Map<string, Record<string, unknown>[]>()
    for (const choice of candidates) {
      const value = fields(choice, id)
      const key = Object.keys(value).sort().join('+')
      const group = shapes.get(key) ?? []
      group.push(value)
      shapes.set(key, group)
    }
    for (const [shape, values] of shapes) {
      const domain: Record<string, unknown> = {}
      for (const key of Object.keys(values[0] ?? {})) {
        const items = values.map((value) => value[key])
        const flattened = items.flatMap((item) =>
          Array.isArray(item) ? (item as unknown[]) : [item],
        )
        domain[key] = {
          values: [...new Set(flattened)],
          ...(Array.isArray(items[0]) && { count: items[0].length, distinct: true }),
        }
      }
      lines.push(
        `${zh ? '填写字段及值域' : 'Fields and domains'} (${shape}): ${JSON.stringify(domain)}`,
      )
    }
    if (
      ['D4', 'D5', 'D6'].includes(id) ||
      (id === 'D8' &&
        ['washerwoman', 'librarian', 'investigator'].includes(context.discretion?.role ?? ''))
    )
      lines.push(
        zh
          ? 'seats 两人不同且不含接收者。能力有效时的信息须至少一人被当作 roles 中的角色；D8 不要求匹配真值。number=0 是单独的输出形式，只能在上面列出时用。'
          : 'The two seats must differ and exclude the recipient. Working information requires at least one to register as the character in roles; D8 need not match truth. number=0 is a separate output form, legal only when listed above.',
      )
    if (id === 'D12')
      lines.push(
        zh
          ? 'answer=false 镇长正常死亡；true 则随后决定替死对象。'
          : 'answer=false means normal Mayor death; true asks for a replacement next.',
      )
  }
  const detail = context.discretion
  if (detail) lines.push(`${zh ? '对象与真值' : 'Recipient and truth'}: ${JSON.stringify(detail)}`)
  const advice = ADVICE[id]
  if (advice)
    lines.push(
      `${zh ? '官方建议（不是硬约束）' : 'Official advice (not hard constraints)'}: ${advice[language]}`,
    )
  lines.push(
    zh
      ? 'reasoning_summary 必填，用一两句话概括你这次的思考；只填上述要求的字段，不要填其他字段。请调用 decide。'
      : 'reasoning_summary is required: one or two sentences summarising your thinking. Fill only the fields requested above; omit all others. Call decide.',
  )
  return lines.join('\n')
}

export function buildStorytellerPrompt(
  config: GameConfig,
  events: readonly GameEvent[],
  id: DiscretionId,
  candidates: DiscretionCandidates,
  context: DiscretionContext,
): { messages: [{ role: 'system'; content: string }, { role: 'user'; content: string }] } {
  const language = config.language
  const zh = language === 'zh'
  const projected = project(events, 'storyteller')
  const lines: string[] = []
  for (const event of projected) {
    if (event.type === 'contestant.decision' || event.type === 'discretion.requested') continue
    lines.push(renderEvent(event, language, 'storyteller'))
    if (event.type === 'storyteller.decision') {
      const args = firstToolCall(event.raw)?.arguments
      if (args) lines.push(args)
    }
  }
  const grimoire = renderEvent(
    {
      seq: context.seq,
      type: 'grimoire.set',
      seats: context.seats,
      redHerring: context.redHerring,
      bluffs: context.bluffs,
    },
    language,
    'storyteller',
  )
  const principles = zh
    ? '你是说书人，掌握魔典。程序负责流程、计票与能力真值，你不在场上发言，只选择本次允许的一项裁量。让游戏好玩、势均力敌，双方有机会，悬念尽量留到最后几天；参考本次请求的官方建议，不用裁量直接决定胜负，假信息必须像真的且不暴露醉酒或中毒。每次调用 decide。'
    : "You are the Storyteller and hold the Grimoire. Code owns game flow, votes and true ability results; you never speak at the table and choose only the one permitted discretion requested now. Make the game fun and close, give both sides a chance and preserve suspense into the last days. Follow the current request's official advice, never settle the winner directly, and make false information plausible without revealing drunkenness or poison. Call decide."
  return {
    messages: [
      {
        role: 'system',
        content: `${rulesBlock(language, config.speechLimit, config.whisperLimit, config.seatCount)}\n\n${principles}`,
      },
      {
        role: 'user',
        content: [
          `${zh ? '# 时间线' : '# Timeline'}\n${lines.join('\n')}`,
          `${zh ? '# 当前魔典' : '# Current Grimoire'}\n${grimoire}`,
          discretionRequest(language, id, candidates, context, config.seatCount),
        ].join('\n\n'),
      },
    ],
  }
}
