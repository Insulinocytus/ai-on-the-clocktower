import { ROLE_BY_ID } from '../rules/roles'
import type {
  AbilityInfo, Alignment, DiscretionValue, EventOf, GameEvent, Grimoire, Lang,
  Phase, Registration, RoleId, Seat,
} from '../rules/types'

export type Person = 'seat' | 'storyteller' | 'spectator'
export interface RenderOptions { lang: Lang; person: Person; self?: Seat }

export function roleName(id: RoleId, lang: Lang): string {
  return ROLE_BY_ID[id].name[lang]
}

export function seatLabel(seat: Seat, lang: Lang, self?: Seat): string {
  return seat === self ? (lang === 'zh' ? '你' : 'you') : (lang === 'zh' ? `${seat} 号` : `Seat ${seat}`)
}

export function phaseLabel(phase: Phase, day: number, lang: Lang): string {
  if (phase === 'first_night') return lang === 'zh' ? '首夜' : 'Night 1 (first night)'
  if (phase === 'night') return lang === 'zh' ? `第 ${day} 夜` : `Night ${day}`
  const names = {
    dawn: { zh: '黎明', en: 'Dawn' },
    whisper: { zh: '私聊阶段', en: 'Whisper phase' },
    public: { zh: '公聊阶段', en: 'Public discussion' },
    nomination: { zh: '提名阶段', en: 'Nominations' },
  }
  return lang === 'zh' ? `第 ${day} 天 · ${names[phase].zh}` : `Day ${day} · ${names[phase].en}`
}

function seatsLabel(seats: readonly Seat[], lang: Lang, self?: Seat): string {
  return seats.length ? seats.map(s => seatLabel(s, lang, self)).join(lang === 'zh' ? '、' : ', ') : (lang === 'zh' ? '无' : 'none')
}

function rolesLabel(roles: readonly RoleId[], lang: Lang): string {
  return roles.length ? roles.map(r => roleName(r, lang)).join(lang === 'zh' ? '、' : ', ') : (lang === 'zh' ? '无' : 'none')
}

function teamLabel(team: Alignment, lang: Lang): string {
  return lang === 'zh' ? (team === 'good' ? '善良阵营' : '邪恶阵营') : (team === 'good' ? 'good team' : 'evil team')
}

function formatValue(value: DiscretionValue, lang: Lang, self?: Seat): string {
  const zh = lang === 'zh'
  const parts: string[] = []
  if (value.seats) parts.push(`${zh ? '座位' : 'Seats'}: ${seatsLabel(value.seats, lang, self)}`)
  if (value.roles) parts.push(`${zh ? '角色' : 'Characters'}: ${rolesLabel(value.roles, lang)}`)
  if (value.number !== undefined) parts.push(`${zh ? '数量' : 'Number'}: ${value.number}`)
  if (value.answer !== undefined) parts.push(value.answer ? (zh ? '是' : 'yes') : (zh ? '否' : 'no'))
  if (value.alignment) parts.push(teamLabel(value.alignment, lang))
  return parts.join(zh ? '；' : '; ') || (zh ? '无' : 'none')
}

/** Formats the documented AbilityInfo shapes, without adding truth or reliability claims. */
export function formatAbilityInfo(ability: RoleId, info: AbilityInfo, lang: Lang): string {
  return abilityInfo(ability, info, lang)
}

function abilityInfo(ability: RoleId, info: AbilityInfo, lang: Lang, self?: Seat): string {
  const zh = lang === 'zh'
  const seats = seatsLabel(info.seats ?? [], lang, self)
  const roles = rolesLabel(info.roles ?? [], lang)
  switch (ability) {
    case 'washerwoman':
    case 'librarian':
    case 'investigator':
      if (ability === 'librarian' && info.seats?.length === 0 && info.roles?.length === 0)
        return zh ? '没有外来者在场' : 'There are no Outsiders in play'
      return zh ? `${seats}之中有一人是${roles}` : `One of ${seats} is the ${roles}`
    case 'chef':
      return zh ? `邻座的邪恶玩家有 ${info.number} 对` : `There are ${info.number} pairs of neighbouring evil players`
    case 'empath':
      return zh ? `两侧最近的存活玩家中有 ${info.number} 名邪恶玩家` : `${info.number} of the two nearest alive neighbours are evil`
    case 'fortuneteller':
      return zh ? `所选的两名玩家之中${info.answer ? '有' : '没有'}恶魔` : `${info.answer ? 'Yes' : 'No'}: ${info.answer ? 'at least one of the chosen players is' : 'neither of the chosen players is'} a Demon`
    case 'undertaker':
      return zh ? `今天白天死于处决的玩家的角色是${roles}` : `The character that died by execution today was the ${roles}`
    case 'ravenkeeper':
      return zh ? `${seats}的角色是${roles}` : `${seats}: ${roles}`
    default:
      return formatValue(info, lang, self)
  }
}

function registrationLabel(registration: Registration | null, lang: Lang): string {
  return registration ? `${teamLabel(registration.alignment, lang)} / ${roleName(registration.role, lang)}` : (lang === 'zh' ? '无' : 'none')
}

function grimoirePatch(e: EventOf<'grimoire.set'> | Grimoire, lang: Lang): string {
  const zh = lang === 'zh'
  const parts: string[] = []
  if (e.seats) parts.push(...e.seats.map(s => {
    const statuses: string[] = []
    if ('alive' in s) {
      statuses.push(s.alive ? (zh ? '存活' : 'alive') : (zh ? '死亡' : 'dead'))
      if (s.poisonedBy !== null) statuses.push(zh ? `中毒（来自 ${seatLabel(s.poisonedBy, lang)}）` : `poisoned by ${seatLabel(s.poisonedBy, lang)}`)
      if (s.protectedBy !== null) statuses.push(zh ? `受保护（来自 ${seatLabel(s.protectedBy, lang)}）` : `protected by ${seatLabel(s.protectedBy, lang)}`)
      if (s.masterOf !== null) statuses.push(zh ? `${seatLabel(s.masterOf, lang)}的主人` : `master of ${seatLabel(s.masterOf, lang)}`)
      if (s.abilityUsed) statuses.push(zh ? '能力已用' : 'ability used')
      if (s.voteTokenUsed) statuses.push(zh ? '投票标记已用' : 'vote token used')
    }
    return `${seatLabel(s.seat, lang)}: ${roleName(s.role, lang)} / ${teamLabel(s.alignment, lang)}${statuses.length ? ` (${statuses.join(zh ? '，' : ', ')})` : ''}`
  }))
  if (e.drunkBelieves !== undefined) parts.push(`${zh ? '酒鬼以为的角色' : 'The Drunk believes they are'}: ${e.drunkBelieves === null ? (zh ? '无' : 'none') : roleName(e.drunkBelieves, lang)}`)
  if (e.redHerring !== undefined) parts.push(`${zh ? '占卜师的干扰项' : "Fortune Teller's red herring"}: ${e.redHerring === null ? (zh ? '无' : 'none') : seatLabel(e.redHerring, lang)}`)
  if (e.spyRegisters !== undefined) parts.push(`${zh ? '间谍被当作' : 'Spy registers as'}: ${registrationLabel(e.spyRegisters, lang)}`)
  if (e.recluseRegisters !== undefined) parts.push(`${zh ? '陌客被当作' : 'Recluse registers as'}: ${registrationLabel(e.recluseRegisters, lang)}`)
  if (e.bluffs) parts.push(`${zh ? '恶魔伪装' : 'Demon bluffs'}: ${rolesLabel(e.bluffs, lang)}`)
  return parts.join(zh ? '；' : '; ')
}

function toldText(e: EventOf<'told'>, lang: Lang, self?: Seat): string {
  const zh = lang === 'zh'
  switch (e.kind) {
    case 'role': return zh ? `${e.seat === self ? '你的角色是' : '角色是'}${roleName(e.role, lang)}。` : `${e.seat === self ? 'Your character is' : 'Character:'} the ${roleName(e.role, lang)}.`
    case 'minion_info': return zh ? `恶魔是 ${seatLabel(e.demon, lang, self)}。其他爪牙：${seatsLabel(e.minions, lang, self)}。` : `The Demon is ${seatLabel(e.demon, lang, self)}. Other Minions: ${seatsLabel(e.minions, lang, self)}.`
    case 'demon_info': return zh ? `爪牙：${seatsLabel(e.minions, lang, self)}。不在场的 3 个善良角色（可作伪装）：${rolesLabel(e.bluffs, lang)}。` : `Minions: ${seatsLabel(e.minions, lang, self)}. 3 good characters not in play (bluffs): ${rolesLabel(e.bluffs, lang)}.`
    case 'ability': return `${abilityInfo(e.ability, e.value, lang, self)}${zh ? '。' : '.'}`
    case 'spy_grimoire': return `${zh ? '魔典' : 'Grimoire'}: ${grimoirePatch(e.grimoire, lang)}`
    case 'became_imp': return zh ? `${e.seat === self ? '你' : ''}变成了小恶魔。` : `${e.seat === self ? 'You have' : 'Has'} become the Imp.`
  }
}

/** Render an already-projected event. Audience checks belong to rules.project, not to templates.
 * Seat text depends only on the event, language and self; seq and current state never affect it.
 * Decisions and game creation are structural UI records and deliberately have no text template.
 */
export function renderEvent(e: GameEvent, { lang, person, self }: RenderOptions): string | null {
  const zh = lang === 'zh'
  const perspective = person === 'seat' ? self : undefined
  const seat = (n: Seat) => seatLabel(n, lang, perspective)
  const seats = (ns: readonly Seat[]) => seatsLabel(ns, lang, perspective)
  const actor = (n: Seat) => n === perspective && !zh ? 'You' : seat(n)
  const verb = (n: Seat, singular: string, second: string) => n === perspective ? second : singular
  const source = (s: 'random' | 'storyteller' | 'manual') => ({ random: zh ? '随机' : 'random', storyteller: zh ? '说书人模型' : 'storyteller model', manual: zh ? '手动' : 'manual' })[s]
  switch (e.type) {
    case 'game.created':
    case 'contestant.decision':
    case 'storyteller.decision': return null
    case 'phase.started': return phaseLabel(e.phase, e.day, lang)
    case 'dawn.announced': return e.deaths.length
      ? (zh ? `黎明：昨夜死亡的是 ${seats(e.deaths)}。` : `Dawn: ${seats(e.deaths)} died last night.`)
      : (zh ? '黎明：昨夜无人死亡。' : 'Dawn: nobody died last night.')
    case 'told': {
      const prefix = person === 'storyteller' ? (zh ? `[告知 ${seat(e.seat)}]` : `[Told ${seat(e.seat)}]`)
        : person === 'seat' && e.seat === self ? (zh ? '[说书人告知你]' : '[The Storyteller tells you]')
          : (zh ? `${seat(e.seat)}被告知：` : `${seat(e.seat)} was told:`)
      return `${prefix} ${toldText(e, lang, perspective)}`
    }
    case 'seat.memo.updated': return zh ? `${actor(e.seat)}更新备忘录：${e.text}` : `${actor(e.seat)} ${verb(e.seat, 'updates', 'update')} the memo: ${e.text}`
    case 'night.choice': return zh ? `${actor(e.seat)}（作为${roleName(e.as, lang)}）选择了 ${seats(e.targets)}。` : `${actor(e.seat)} (as ${roleName(e.as, lang)}) chose ${seats(e.targets)}.`
    case 'whisper.room.opened': return zh ? `私聊房间 ${e.room} 成立：${seats(e.members)}。` : `Whisper room ${e.room} opened: ${seats(e.members)}.`
    case 'whisper.room.closed': return zh ? `私聊房间 ${e.room} 结束：${seats(e.members)}。` : `Whisper room ${e.room} closed: ${seats(e.members)}.`
    case 'whisper.speech': return zh ? `[房间 ${e.room}] ${actor(e.seat)}：“${e.text}”` : `[Room ${e.room}] ${actor(e.seat)}: "${e.text}"`
    case 'public.speech': {
      const tag = e.kind === 'nomination_reason' ? (zh ? '（提名理由）' : ' (nomination reason)') : e.kind === 'defense' ? (zh ? '（辩护）' : ' (defense)') : ''
      const shot = e.slayerTarget === undefined ? '' : zh ? ` [公开声称以猎手能力对 ${seat(e.slayerTarget)} 开枪]` : ` [claims to shoot ${seat(e.slayerTarget)} as the Slayer]`
      return zh ? `${actor(e.seat)}${tag}：“${e.text}”${shot}` : `${actor(e.seat)}${tag}: "${e.text}"${shot}`
    }
    case 'slayer.resolved': return e.died ? (zh ? `${actor(e.target)}死亡。` : `${actor(e.target)} ${verb(e.target, 'dies', 'die')}.`) : (zh ? '无事发生。' : 'Nothing happens.')
    case 'nomination': return zh ? `${actor(e.nominator)}提名 ${seat(e.nominee)}。` : `${actor(e.nominator)} ${verb(e.nominator, 'nominates', 'nominate')} ${seat(e.nominee)}.`
    case 'virgin.triggered': return zh ? `贞洁者能力触发：提名者 ${seat(e.nominator)}将立即被处决。` : `The Virgin's ability triggers: nominator ${seat(e.nominator)} will be executed immediately.`
    case 'vote': return zh ? `${actor(e.seat)}${e.raised ? '举手' : '不举手'}${e.tokenUsed ? '（用掉投票标记）' : ''}。` : `${actor(e.seat)} ${e.raised ? verb(e.seat, 'raises a hand', 'raise a hand') : verb(e.seat, 'does not raise a hand', 'do not raise a hand')}${e.tokenUsed ? ' (uses vote token)' : ''}.`
    case 'vote.tallied': return zh ? `计票：${seat(e.nominee)}得 ${e.votes} 票（门槛 ${e.threshold} 票），${e.aboutToDie ? '成为即将被处决' : '未成为即将被处决'}。` : `Tally: ${seat(e.nominee)} got ${e.votes} votes (threshold ${e.threshold}); ${e.aboutToDie ? 'now about to die' : 'not about to die'}.`
    case 'execution': return zh ? `${actor(e.seat)}被处决。` : `${actor(e.seat)} ${verb(e.seat, 'is', 'are')} executed.`
    case 'game.ended': {
      const reasons = {
        demon_dead: zh ? '恶魔死亡' : 'the Demon died', two_alive: zh ? '只剩两名存活玩家' : 'only two players remain alive',
        saint_executed: zh ? '圣徒被处决' : 'the Saint was executed', mayor_win: zh ? '镇长能力获胜' : "the Mayor's ability wins",
      }
      return zh ? `对局结束：${teamLabel(e.winner, lang)}获胜（${reasons[e.reason]}）。` : `Game ended: the ${teamLabel(e.winner, lang)} wins (${reasons[e.reason]}).`
    }
    case 'game.aborted': {
      const reasons = { model_failure: zh ? '模型调用失败' : 'model call failure', human: zh ? '人类终止' : 'human request', restart: zh ? '进程重启' : 'process restart', engine_error: zh ? '引擎错误' : 'engine error' }
      return `${zh ? '对局已终止' : 'Game aborted'}: ${reasons[e.reason]}${e.seat === undefined ? '' : ` (${seat(e.seat)})`}${e.discretion ? ` (${e.discretion})` : ''}${e.detail ? ` — ${e.detail}` : ''}`
    }
    case 'grimoire.set': return `${zh ? '魔典写定' : 'Grimoire set'}: ${grimoirePatch(e, lang)}`
    case 'status.changed': {
      const names = { poisoned: zh ? '中毒' : 'poisoned', protected: zh ? '受保护' : 'protected', ability_used: zh ? '能力已用' : 'ability used', vote_token_used: zh ? '投票标记已用' : 'vote token used', master: zh ? '主人' : 'master' }
      return zh ? `${seat(e.seat)}${e.on ? '获得' : '解除'}「${names[e.status]}」${e.source === undefined ? '' : `（来自 ${seat(e.source)}）`}。` : `${seat(e.seat)}: ${names[e.status]} ${e.on ? 'on' : 'off'}${e.source === undefined ? '' : ` (source: ${seat(e.source)})`}.`
    }
    case 'role.changed': return zh ? `${seat(e.seat)}从${roleName(e.from, lang)}变成${roleName(e.to, lang)}，${teamLabel(e.alignment, lang)}。` : `${seat(e.seat)} changes from ${roleName(e.from, lang)} to ${roleName(e.to, lang)}, ${teamLabel(e.alignment, lang)}.`
    case 'night.death': {
      const causes = { demon: zh ? '恶魔能力' : 'Demon ability', execution: zh ? '处决' : 'execution', slayer: zh ? '猎手能力' : 'Slayer ability', virgin: zh ? '贞洁者能力' : 'Virgin ability' }
      return zh ? `[夜间死亡] ${seat(e.seat)}，死因：${causes[e.cause]}。` : `[Night death] ${seat(e.seat)}, cause: ${causes[e.cause]}.`
    }
    case 'ability.resolved': {
      const truth = e.result ? `${zh ? '真值' : 'Truth'}: ${abilityInfo(e.as, e.result, lang)}` : (zh ? '无信息结果' : 'no information result')
      const reasons = { drunk: zh ? '醉酒' : 'drunk', poisoned: zh ? '中毒' : 'poisoned', register: zh ? '被当作' : 'registration' }
      const told = e.told ? `; ${zh ? '告知' : 'Told'}: ${abilityInfo(e.as, e.told.value, lang)} (${e.told.deviates ? (zh ? '偏离真值' : 'deviates from truth') : (zh ? '未偏离真值' : 'matches truth')}${e.told.reason ? `: ${reasons[e.told.reason]}` : ''})` : ''
      return `${seat(e.seat)} ${roleName(e.role, lang)} (${zh ? '作为' : 'as'} ${roleName(e.as, lang)}): ${e.effective ? (zh ? '能力有效' : 'functioning') : (zh ? '能力无效' : 'not functioning')}${e.targets ? `; ${zh ? '目标' : 'Targets'}: ${seats(e.targets)}` : ''}; ${truth}${told}`
    }
    case 'discretion.requested': {
      const candidates = e.candidates.kind === 'setup' ? (zh ? `为 ${e.candidates.seatCount} 个座位选角并分座` : `characters and seating for ${e.candidates.seatCount} seats`)
        : e.candidates.kind === 'seating' ? (zh ? `重新分座：${rolesLabel(e.candidates.roles, lang)}` : `re-seat: ${rolesLabel(e.candidates.roles, lang)}`)
          : (zh ? `${e.candidates.values.length} 个合法候选` : `${e.candidates.values.length} legal candidates`)
      return `${zh ? '请求说书人裁量' : 'Discretion requested'} ${e.discretion} (${source(e.source)}): ${candidates}${e.context.subject === undefined ? '' : `; ${zh ? '对象' : 'Subject'}: ${seat(e.context.subject)}`}${e.context.ability ? `; ${roleName(e.context.ability, lang)}` : ''}${e.context.truth ? `; ${zh ? '真值' : 'Truth'}: ${e.context.ability ? abilityInfo(e.context.ability, e.context.truth, lang) : formatValue(e.context.truth, lang)}` : ''}`
    }
    case 'discretion.resolved': {
      const value = (e.discretion === 'D1' || e.discretion === 'seating') && e.value.roles
        ? e.value.roles.map((r, i) => `${seat(i + 1)}: ${roleName(r, lang)}`).join(zh ? '；' : '; ')
        : formatValue(e.value, lang)
      return `${zh ? '裁量已结算' : 'Discretion resolved'} ${e.discretion} (${source(e.source)}): ${value}`
    }
    case 'whisper.proposed': return `${zh ? '私聊提议' : 'Whisper proposals'} (${zh ? '第 ' : 'round '}${e.round}${zh ? ' 轮' : ''}): ${e.rooms.length ? e.rooms.map(r => zh ? `${seats(r.proposers)}提议 ${seats(r.members)}` : `${seats(r.proposers)} proposed ${seats(r.members)}`).join(zh ? '；' : '; ') : (zh ? '无' : 'none')}`
    case 'whisper.candidates': return `${person === 'seat' && e.seat === self ? (zh ? '包含你的候选私聊房间' : 'Candidate whisper rooms that include you') : (zh ? `${seat(e.seat)}收到候选私聊房间` : `Candidate whisper rooms for ${seat(e.seat)}`)} (${zh ? '第 ' : 'round '}${e.round}${zh ? ' 轮' : ''}): ${e.rooms.length ? e.rooms.map(r => `${zh ? '房间' : 'room'} ${r.room} (${seats(r.members)})`).join(zh ? '；' : '; ') : (zh ? '无' : 'none')}`
    case 'whisper.ranked': return `${actor(e.seat)}${zh ? '的私聊房间排序' : "'s whisper room ranking"} (${zh ? '第 ' : 'round '}${e.round}${zh ? ' 轮' : ''}): ${e.ranking.length ? e.ranking.join(' > ') : (zh ? '不去任何房间' : 'no rooms')}`
    default: {
      const exhaustive: never = e
      return exhaustive
    }
  }
}
