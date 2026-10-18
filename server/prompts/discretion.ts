import { ROLES, SETUP_COUNTS } from '../../shared/rules/roles'
import { DISCRETION_TEXT as DISCRETION } from '../../shared/rules/discretions'
import type { DiscretionAsk, DiscretionValue, GameConfig, Lang } from '../../shared/rules/types'

type Field = keyof DiscretionValue
const FIELDS: Field[] = ['roles', 'alignment', 'answer', 'number', 'seats']

function describeDomain(values: unknown[]): unknown {
  if (values.length === 1) return { equals: values[0] }
  if (values.every((v): v is (string | number)[] => Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number'))) {
    const count = values[0]!.length
    const domain = [...new Set(values.flat())]
    let combinations = 1
    for (let k = 1; k <= count; k++) combinations = combinations * (domain.length - k + 1) / k
    const unique = new Set(values.map(v => JSON.stringify([...v].sort())))
    if (count > 0 && values.every(v => v.length === count && new Set(v).size === count) && unique.size === combinations) {
      return { choose: count, from: domain, distinct: true, order: 'irrelevant' }
    }
  }
  return { oneOf: values }
}

// Factor equal suffixes so hundreds of seat-pair × role candidates remain an exact, small relation.
function describeRelation(values: DiscretionValue[], fields: Field[]): unknown {
  const [field, ...rest] = fields
  if (!field) return {}
  const groups = new Map<string, { suffix: unknown; values: unknown[] }>()
  const byValue = new Map<string, DiscretionValue[]>()
  for (const value of values) {
    const key = JSON.stringify(value[field]) ?? 'absent'
    const rows = byValue.get(key) ?? []
    rows.push(value)
    byValue.set(key, rows)
  }
  for (const rows of byValue.values()) {
    const suffix = describeRelation(rows, rest)
    const key = JSON.stringify(suffix)
    const group = groups.get(key) ?? { suffix, values: [] }
    group.values.push(rows[0]![field] ?? { absent: true })
    groups.set(key, group)
  }
  const alternatives = [...groups.values()].map(g => ({ [field]: describeDomain(g.values), remaining: g.suffix }))
  return alternatives.length === 1 ? alternatives[0] : { oneOf: alternatives }
}

export function discretionRequest(ask: DiscretionAsk, config: GameConfig): string {
  const lang = config.language
  const zh = lang === 'zh'
  const [name, meaning, advice] = DISCRETION[ask.discretion][lang]
  const [t, o, m] = SETUP_COUNTS[config.seatCount]!
  let legal: string
  if (ask.candidates.kind === 'setup') {
    legal = zh
      ? `roles 按座位顺序填 ${config.seatCount} 个不同角色：${t} 镇民、${o} 外来者、${m} 爪牙、1 小恶魔；有男爵则 ${t - 2} 镇民、${o + 2} 外来者。酒鬼占外来者名额。`
      : `roles: ${config.seatCount} distinct characters in seat order: ${t} Townsfolk, ${o} Outsiders, ${m} Minions, 1 Imp; with Baron: ${t - 2} Townsfolk and ${o + 2} Outsiders. Drunk takes an Outsider slot.`
  } else if (ask.candidates.kind === 'seating') {
    legal = (zh ? 'roles 必须是以下角色的全排列，按座位顺序填写：' : 'roles must be a permutation of these characters, in seat order: ') + JSON.stringify(ask.candidates.roles)
  } else {
    const values = ask.candidates.values
    legal = JSON.stringify(describeRelation(values, FIELDS.filter(f => values.some(v => v[f] !== undefined))))
  }
  const context = [
    ask.context.subject === undefined ? '' : (zh ? `对象：${ask.context.subject} 号。` : `Subject: Seat ${ask.context.subject}.`),
    ask.context.ability === undefined ? '' : (zh ? `作为能力：${ROLES.find(r => r.id === ask.context.ability)!.name[lang]}。` : `Acting ability: ${ROLES.find(r => r.id === ask.context.ability)!.name[lang]}.`),
    zh ? `真实情况：${ask.context.truth === undefined ? '本项没有单一信息真值；参照当前魔典。' : JSON.stringify(ask.context.truth)}` : `Truth: ${ask.context.truth === undefined ? 'No single information value applies; consult the current Grimoire.' : JSON.stringify(ask.context.truth)}`,
  ].filter(Boolean).join('\n')
  const fields = ask.discretion === 'D1' || ask.discretion === 'seating' ? ['roles'] : ask.context.fields
  return zh
    ? `# 本次裁量：${ask.discretion} ${name}\n${meaning}\n${context}\n合法范围（结构化值域，oneOf 表示任选一支，remaining 为同一组合的其余字段）：${legal}\n官方软建议：${advice}\n只填写 reasoning 与 ${fields.join('、')}，其余字段省略。请调用 decide`
    : `# This discretion: ${ask.discretion} ${name}\n${meaning}\n${context}\nLegal candidates (structural domains; choose one oneOf branch, with its remaining fields): ${legal}\nOfficial soft advice: ${advice}\nFill only reasoning and ${fields.join(', ')}; omit other fields. Call decide`
}
