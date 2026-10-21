import en from '../i18n/locales/en.json'
import zh from '../i18n/locales/zh.json'
import { PHASE_LABELS } from './game/phases'
import { ROLES } from './game/roles'
import { visibleTo } from './game/rules'
import type {
  GameEvent,
  GameReason,
  InformationResult,
  Language,
  Observer,
  RoleId,
  SeatState,
} from './types/game'

const REASONS: Record<Language, Record<GameReason, string>> = {
  zh: zh.games.reasons,
  en: en.games.reasons,
}
const NIGHT_CAUSES: Record<string, { zh: string; en: string }> = {
  imp: { zh: '小恶魔击杀', en: 'killed by the Imp' },
  imp_suicide: { zh: '小恶魔自杀', en: 'Imp self-kill' },
}
const SOURCES = {
  random: { zh: '随机', en: 'random' },
  storyteller: { zh: '说书人模型', en: 'Storyteller model' },
  manual: { zh: '手动', en: 'manual' },
}

function seatName(seat: number, language: Language, observer: Observer): string {
  if (observer === `seat:${String(seat)}`) return language === 'zh' ? '你' : 'You'
  return language === 'zh' ? `${String(seat)} 号` : `Seat ${String(seat)}`
}

function seatList(seats: readonly number[], language: Language, observer: Observer): string {
  return seats.length
    ? seats.map((seat) => seatName(seat, language, observer)).join(language === 'zh' ? '、' : ', ')
    : language === 'zh'
      ? '无'
      : 'none'
}

function grimoireText(
  seats: readonly SeatState[],
  language: Language,
  redHerring?: number | null,
  bluffs?: readonly RoleId[],
): string {
  let text = seats
    .map((seat) => {
      const statuses = [
        seat.poisoned ? (language === 'zh' ? '中毒' : 'poisoned') : '',
        seat.protected ? (language === 'zh' ? '受保护' : 'protected') : '',
        seat.abilityUsed ? (language === 'zh' ? '能力已用' : 'ability spent') : '',
        seat.voteUsed ? (language === 'zh' ? '投票标记已用' : 'vote token spent') : '',
        seat.master === null
          ? ''
          : language === 'zh'
            ? `主人 ${String(seat.master)} 号`
            : `master Seat ${String(seat.master)}`,
        seat.believedRole
          ? language === 'zh'
            ? `以为是${ROLES[seat.believedRole].name.zh}`
            : `believes they are ${ROLES[seat.believedRole].name.en}`
          : '',
        seat.registeredRole
          ? language === 'zh'
            ? `被当作${ROLES[seat.registeredRole].name.zh}`
            : `registers as ${ROLES[seat.registeredRole].name.en}`
          : '',
        seat.registeredAlignment
          ? language === 'zh'
            ? `被当作${seat.registeredAlignment === 'good' ? '善良' : '邪恶'}`
            : `registers as ${seat.registeredAlignment}`
          : '',
      ].filter(Boolean)
      return language === 'zh'
        ? `${String(seat.seat)} 号：${ROLES[seat.role].name.zh}，${seat.alignment === 'good' ? '善良' : '邪恶'}，${seat.alive ? '存活' : '死亡'}${statuses.length ? `，${statuses.join('，')}` : ''}`
        : `Seat ${String(seat.seat)}: ${ROLES[seat.role].name.en}, ${seat.alignment}, ${seat.alive ? 'alive' : 'dead'}${statuses.length ? `, ${statuses.join(', ')}` : ''}`
    })
    .join('; ')
  if (bluffs?.length)
    text +=
      language === 'zh'
        ? `。恶魔伪装：${bluffs.map((role) => ROLES[role].name.zh).join('、')}`
        : `. Demon bluffs: ${bluffs.map((role) => ROLES[role].name.en).join(', ')}`
  if (redHerring === undefined) return text
  return language === 'zh'
    ? `${text}。占卜师干扰项：${redHerring === null ? '无' : `${String(redHerring)} 号`}。`
    : `${text}. Fortune Teller red herring: ${redHerring === null ? 'none' : `Seat ${String(redHerring)}`}.`
}

function informationText(
  result: InformationResult,
  language: Language,
  observer: Observer,
): string {
  const zh = language === 'zh'
  if (typeof result === 'boolean') return zh ? (result ? '是' : '否') : result ? 'Yes' : 'No'
  if (typeof result === 'number') return String(result)
  if ('redHerring' in result)
    return grimoireText(result.seats, language, result.redHerring, result.bluffs)
  const role = ROLES[result.role].name[language]
  if ('seats' in result) {
    const seats = seatList(result.seats, language, observer)
    return zh ? `${seats}之中有一名是${role}` : `One of ${seats} is the ${role}`
  }
  return `${seatName(result.target, language, observer)}: ${role}`
}

export function renderEvent(event: GameEvent, language: Language, observer: Observer): string {
  if (!visibleTo(event, observer)) return ''
  const zh = language === 'zh'
  const actor = 'seat' in event ? seatName(event.seat, language, observer) : ''
  const eventType = event.type
  switch (event.type) {
    case 'game.created':
      return zh
        ? `创建 ${String(event.seatCount)} 人对局；语言：${event.language === 'zh' ? '中文' : '英文'}；种子：${String(event.seed)}；日志版本：${String(event.logVersion)}。座位模型：${event.seats.map((seat, index) => `${String(seat.seat ?? index + 1)} 号 ${seat.name}（${seat.model}）`).join('；')}。`
        : `Created a ${String(event.seatCount)}-player game; language: ${event.language === 'zh' ? 'Chinese' : 'English'}; seed: ${String(event.seed)}; log version: ${String(event.logVersion)}. Seat models: ${event.seats.map((seat, index) => `Seat ${String(seat.seat ?? index + 1)}: ${seat.name} (${seat.model})`).join('; ')}.`
    case 'phase.started':
      return zh
        ? `第 ${String(event.day)} 天：${PHASE_LABELS[event.phase].zh}开始。`
        : `Day ${String(event.day)}: ${PHASE_LABELS[event.phase].en} started.`
    case 'game.ended':
      return zh
        ? `对局结束：${event.winner === 'good' ? '善良' : '邪恶'}阵营获胜。原因：${REASONS[language][event.reason]}。`
        : `Game ended: ${event.winner} wins. Reason: ${REASONS[language][event.reason]}.`
    case 'game.aborted':
      return zh
        ? `对局已终止：${REASONS[language][event.reason]}。错误：${JSON.stringify(event.error ?? null)}。`
        : `Game aborted: ${REASONS[language][event.reason]}. Error: ${JSON.stringify(event.error ?? null)}.`
    case 'game.paused': {
      const who =
        'discretion' in event
          ? zh
            ? `裁量 ${event.discretion}`
            : `discretion ${event.discretion}`
          : actor
      return zh
        ? `对局已暂停：${who}在重试上限内未得到合法结果。错误：${event.error}。`
        : `Game paused: ${who} produced no valid result within the attempt limit. Error: ${event.error}.`
    }
    case 'game.resumed':
      return zh ? '对局已继续：重试暂停的决策。' : 'Game resumed: retrying the paused decisions.'
    case 'contestant.decision':
      return zh
        ? `${actor}的模型决策：${event.request.tool}；第 ${String(event.attempt)} 次尝试，耗时 ${String(event.durationMs)} ms；校验：${JSON.stringify(event.validation)}。`
        : `${actor}: model decision for ${event.request.tool}; attempt ${String(event.attempt)}, ${String(event.durationMs)} ms; validation: ${JSON.stringify(event.validation)}.`
    case 'storyteller.decision':
      return zh
        ? `说书人裁量 ${event.discretion}：第 ${String(event.attempt)} 次尝试，耗时 ${String(event.durationMs)} ms；校验：${JSON.stringify(event.validation)}。`
        : `Storyteller decision ${event.discretion}: attempt ${String(event.attempt)}, ${String(event.durationMs)} ms; validation: ${JSON.stringify(event.validation)}.`
    case 'discretion.requested':
      return zh
        ? `请求裁量 ${event.discretion}，来源：${SOURCES[event.source].zh}；合法候选：${JSON.stringify(event.candidates)}。`
        : `Requested discretion ${event.discretion}, source: ${SOURCES[event.source].en}; legal candidates: ${JSON.stringify(event.candidates)}.`
    case 'discretion.resolved':
      return zh
        ? `裁量 ${event.discretion} 已结算，来源：${SOURCES[event.source].zh}；选择：${JSON.stringify(event.choice)}。`
        : `Resolved discretion ${event.discretion}, source: ${SOURCES[event.source].en}; choice: ${JSON.stringify(event.choice)}.`
    case 'grimoire.set':
      return zh
        ? `设定魔典：${grimoireText(event.seats, language, event.redHerring ?? null, event.bluffs)}`
        : `Grimoire set: ${grimoireText(event.seats, language, event.redHerring ?? null, event.bluffs)}`
    case 'status.changed': {
      const statuses = {
        poisoned: { zh: '中毒', en: 'poisoned' },
        protected: { zh: '受保护', en: 'protected' },
        abilityUsed: { zh: '能力已用', en: 'ability spent' },
        voteUsed: { zh: '投票标记已用', en: 'vote token spent' },
        master: { zh: '主人', en: 'master' },
      }
      const value =
        typeof event.value === 'boolean'
          ? event.value
            ? zh
              ? '是'
              : 'yes'
            : zh
              ? '否'
              : 'no'
          : event.value === null
            ? zh
              ? '无'
              : 'none'
            : seatName(event.value, language, observer)
      return zh
        ? `${actor}的状态变更：${statuses[event.status].zh} = ${value}。`
        : `${actor}: status changed, ${statuses[event.status].en} = ${value}.`
    }
    case 'role.changed':
      return zh
        ? `${actor}的真实角色从${ROLES[event.from].name.zh}变为${ROLES[event.to].name.zh}。`
        : `${actor}: actual character changed from ${ROLES[event.from].name.en} to ${ROLES[event.to].name.en}.`
    case 'ability.resolved': {
      let result: string
      if (typeof event.result !== 'object' || !('outcome' in event.result))
        result = informationText(event.result, language, observer)
      else {
        const outcomes = {
          killed: { zh: '目标死亡', en: 'target died' },
          dead: { zh: '目标已经死亡，无事发生', en: 'target was already dead; nothing happened' },
          soldier: { zh: '士兵免疫，无事发生', en: 'Soldier immunity; nothing happened' },
          protected: { zh: '目标受保护，无事发生', en: 'target was protected; nothing happened' },
          inactive: { zh: '能力无效，无事发生', en: 'ability inactive; nothing happened' },
        }
        result = `${seatName(event.result.target, language, observer)}: ${outcomes[event.result.outcome][language]}`
      }
      return zh
        ? `${actor}的${ROLES[event.role].name.zh}能力结算，真实结果：${result}；告知${event.deviated ? '偏离真值' : '未偏离真值'}${event.reason ? `（${event.reason}）` : ''}。`
        : `${actor}: ${ROLES[event.role].name.en} ability resolved; true result: ${result}; told information ${event.deviated ? 'deviated from' : 'did not deviate from'} the truth${event.reason ? ` (${event.reason})` : ''}.`
    }
    case 'night.death':
      return zh
        ? `${actor}在夜晚死亡，死因：${NIGHT_CAUSES[event.cause]?.zh ?? event.cause}。`
        : `${actor}: died at night. Cause: ${NIGHT_CAUSES[event.cause]?.en ?? event.cause}.`
    case 'told': {
      const self = observer === `seat:${String(event.seat)}`
      const possessive = self ? 'Your' : `${actor}'s`
      const prefix = zh ? `说书人告知${actor}：` : `The Storyteller told ${self ? 'you' : actor}: `
      if ('role' in event.content) {
        const role = ROLES[event.content.role]
        if (event.kind === 'role')
          return zh
            ? `${prefix}${actor}的角色是${role.name.zh}。`
            : `${prefix}${possessive} character is ${role.name.en}.`
        if (event.kind === 'imp')
          return zh
            ? `${prefix}${actor}变成了${role.name.zh}。`
            : `${prefix}${self ? 'You have' : `${actor} has`} become ${role.name.en}.`
        if (event.content.role === 'chef' && typeof event.content.result === 'number')
          return zh
            ? `${prefix}座位环上相邻邪恶玩家共有 ${String(event.content.result)} 对。`
            : `${prefix}There are ${String(event.content.result)} adjacent evil pairs in the seating circle.`
        if (event.content.role === 'empath' && typeof event.content.result === 'number')
          return zh
            ? `${prefix}${actor}两侧最近的存活玩家中有 ${String(event.content.result)} 名邪恶玩家。`
            : `${prefix}${String(event.content.result)} of ${self ? 'your' : `${actor}'s`} two nearest living neighbours are evil.`
        const result = event.content.result
        if (
          result === 0 &&
          (event.content.role === 'librarian' || event.content.role === 'investigator')
        )
          return zh
            ? `${prefix}没有${event.content.role === 'librarian' ? '外来者' : '爪牙'}（0）。`
            : `${prefix}There are no ${event.content.role === 'librarian' ? 'Outsiders' : 'Minions'} (0).`
        return zh
          ? `${prefix}${role.name.zh}能力结果：${result === undefined ? '无' : informationText(result, language, observer)}。`
          : `${prefix}${role.name.en} ability result: ${result === undefined ? 'none' : informationText(result, language, observer)}.`
      }
      if (event.kind === 'grimoire')
        return `${prefix}${grimoireText(event.content.seats, language, event.content.redHerring, event.content.bluffs)}`
      const seats = seatList(event.content.seats, language, observer)
      if (event.kind === 'minion-info')
        return zh
          ? `${prefix}邪恶同伴（恶魔和其他爪牙）：${seats}。`
          : `${prefix}Evil teammates (Demon and other Minions): ${seats}.`
      const bluffs: readonly RoleId[] =
        'bluffs' in event.content ? (event.content.bluffs ?? []) : []
      return zh
        ? `${prefix}爪牙：${seats}；不在场的善良伪装角色：${bluffs.map((role) => ROLES[role].name.zh).join('、') || '无'}。`
        : `${prefix}Minions: ${seats}; good characters not in play as bluffs: ${bluffs.map((role) => ROLES[role].name.en).join(', ') || 'none'}.`
    }
    case 'night.choice':
      return zh
        ? `${actor}作为${ROLES[event.role].name.zh}选择了${seatList(event.targets, language, observer)}。`
        : `${actor}, acting as ${ROLES[event.role].name.en}, chose ${seatList(event.targets, language, observer)}.`
    case 'dawn.announced':
      return event.deaths.length
        ? zh
          ? `第 ${String(event.day)} 天黎明：昨夜死亡的是${seatList(event.deaths, language, observer)}。`
          : `Dawn of day ${String(event.day)}: ${seatList(event.deaths, language, observer)} died last night.`
        : zh
          ? `第 ${String(event.day)} 天黎明：昨夜无人死亡。`
          : `Dawn of day ${String(event.day)}: nobody died last night.`
    case 'whisper.proposed':
      return event.members === null
        ? zh
          ? `${actor}在第 ${String(event.round)} 轮选择不私聊。`
          : `${actor}: chose not to whisper in round ${String(event.round)}.`
        : zh
          ? `${actor}在第 ${String(event.round)} 轮提议私聊成员：${seatList(event.members, language, observer)}。`
          : `${actor}: proposed whisper members in round ${String(event.round)}: ${seatList(event.members, language, observer)}.`
    case 'whisper.candidates':
      return zh
        ? `第 ${String(event.round)} 轮，包含${actor}的候选私聊房间：${event.rooms.map((room) => `${String(room.id)}（${seatList(room.members, language, observer)}）`).join('；') || '无'}。`
        : `Round ${String(event.round)}, candidate whisper rooms containing ${actor}: ${event.rooms.map((room) => `${String(room.id)} (${seatList(room.members, language, observer)})`).join('; ') || 'none'}.`
    case 'whisper.ranked':
      return zh
        ? `${actor}在第 ${String(event.round)} 轮的私聊房间排序：${event.ranking.join(' → ') || '不加入任何房间'}。`
        : `${actor}: whisper room ranking in round ${String(event.round)}: ${event.ranking.join(' → ') || 'join no rooms'}.`
    case 'whisper.room.opened':
      return zh
        ? `第 ${String(event.round)} 轮私聊房间 ${event.roomId} 成立，成员：${seatList(event.members, language, observer)}。`
        : `Whisper room ${event.roomId} opened in round ${String(event.round)}; members: ${seatList(event.members, language, observer)}.`
    case 'whisper.speech':
      return zh
        ? `私聊房间 ${event.roomId}，${actor}：“${event.speech}”`
        : `Whisper room ${event.roomId}, ${actor}: “${event.speech}”`
    case 'whisper.room.closed':
      return zh
        ? `第 ${String(event.round)} 轮私聊房间 ${event.roomId} 结束。`
        : `Whisper room ${event.roomId} closed in round ${String(event.round)}.`
    case 'public.speech': {
      const kind =
        event.kind === 'nomination'
          ? zh
            ? '提名理由'
            : 'nomination reasons'
          : event.kind === 'defense'
            ? zh
              ? '辩护'
              : 'defence'
            : zh
              ? '公聊'
              : 'public speech'
      return `${actor}（${kind}）: “${event.speech}”${event.slayerTarget === undefined ? '' : zh ? ` [声称以猎手能力对${seatName(event.slayerTarget, language, observer)}开枪]` : ` [claimed a Slayer shot at ${seatName(event.slayerTarget, language, observer)}]`}`
    }
    case 'slayer.resolved':
      return zh
        ? `${actor}对${seatName(event.target, language, observer)}的猎手开枪结算：${event.died ? '目标死亡' : '无事发生'}。`
        : `${actor}: Slayer shot at ${seatName(event.target, language, observer)} resolved: ${event.died ? 'target died' : 'nothing happened'}.`
    case 'nomination':
      return zh
        ? `${seatName(event.nominator, language, observer)}提名了${seatName(event.nominee, language, observer)}。`
        : `${seatName(event.nominator, language, observer)} nominated ${seatName(event.nominee, language, observer)}.`
    case 'virgin.triggered':
      return zh
        ? `贞洁者能力触发：提名者${seatName(event.nominator, language, observer)}将立即被处决。`
        : `Virgin ability triggered: nominator ${seatName(event.nominator, language, observer)} will be executed immediately.`
    case 'vote':
      return zh
        ? `${actor}${event.raiseHand ? '举手' : '未举手'}${event.voteUsed ? '，用掉死者投票标记' : ''}。`
        : `${actor}: ${event.raiseHand ? 'raised a hand' : 'did not raise a hand'}${event.voteUsed ? ', spending the dead vote token' : ''}.`
    case 'vote.tallied':
      return zh
        ? `计票：${seatName(event.nominee, language, observer)}得 ${String(event.votes)} 票，门槛 ${String(event.threshold)} 票；${event.aboutToBeExecuted ? '成为即将被处决者' : '未成为即将被处决者'}。`
        : `Tally for ${seatName(event.nominee, language, observer)}: ${String(event.votes)} votes, threshold ${String(event.threshold)}; ${event.aboutToBeExecuted ? 'now about to be executed' : 'not about to be executed'}.`
    case 'execution':
      return zh ? `${actor}被处决。` : `${actor}: executed.`
    default:
      return zh ? `未识别的事件类型：${eventType}。` : `Unrecognized event type: ${eventType}.`
  }
}
