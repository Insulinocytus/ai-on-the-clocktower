import { applyPublic, initialPublic, foldGrimoire, project } from '../../shared/rules'
import { ROLE_BY_ID } from '../../shared/rules/roles'
import { TOOL_FOR_REQUEST } from '../../shared/rules/types'
import type { ContestantRequest, DiscretionAsk, GameConfig, GameEvent, Lang, PublicState, RoleId, Seat } from '../../shared/rules/types'
import { phaseLabel, renderEvent, roleName, seatLabel } from '../../shared/templates'
import { contestantSystem, storytellerSystem } from './rules'
import { discretionRequest } from './discretion'
import { retrySegment } from './validation'
import type { ChatMessage, RetryNote } from './types'

export { contestantTools, storytellerTools } from './tools'
export { validationMessage } from './validation'
export type { ChatMessage, OpenAITool, RetryNote } from './types'

export const PROMPT_VERSION = '1'
export const SPEECH_DAYS_KEPT = 2

function seatList(seats: readonly Seat[], lang: Lang): string {
  return seats.length ? seats.map(s => seatLabel(s, lang)).join(lang === 'zh' ? '、' : ', ') : (lang === 'zh' ? '无' : 'none')
}

function timeline(events: readonly GameEvent[], lang: Lang, self?: Seat): string {
  let today = 0
  for (const event of events) if (event.type === 'phase.started') today = event.day
  let day = 0
  const lines: string[] = []
  for (const event of events) {
    if (event.type === 'phase.started') day = event.day
    if (event.type === 'seat.memo.updated') continue
    if (self !== undefined && (event.type === 'public.speech' || event.type === 'whisper.speech') && day < today - SPEECH_DAYS_KEPT + 1) continue
    if (event.type === 'storyteller.decision' && self === undefined) {
      if (event.outcome.ok) {
        const args = event.outcome.call.args
        const value = Object.fromEntries(['reasoning', 'seats', 'roles', 'number', 'answer', 'alignment'].filter(k => k in args).map(k => [k, args[k]]))
        lines.push(lang === 'zh' ? `[你的裁量 ${event.discretion}] ${JSON.stringify(value)}` : `[Your discretion ${event.discretion}] ${JSON.stringify(value)}`)
      }
      continue
    }
    const line = renderEvent(event, self === undefined ? { lang, person: 'storyteller' } : { lang, person: 'seat', self })
    if (line !== null) lines.push(line)
  }
  return (lang === 'zh' ? '# 时间线\n' : '# Timeline\n') + lines.join('\n')
}

function identity(events: readonly GameEvent[], seat: Seat, lang: Lang): string {
  let id: RoleId | null = null
  for (const event of events) {
    if (event.type === 'told' && event.seat === seat) {
      if (event.kind === 'role') id = event.role
      if (event.kind === 'became_imp') id = 'imp'
    }
  }
  const heading = lang === 'zh' ? `# 你的身份\n你是 ${seatLabel(seat, lang)}。` : `# Your identity\nYou are ${seatLabel(seat, lang)}.`
  if (id === null) return heading + (lang === 'zh' ? '\n尚未被告知角色。' : '\nYour character has not yet been told.')
  const role = ROLE_BY_ID[id]
  return heading + (lang === 'zh'
    ? `\n你的角色：${role.name.zh}（${role.alignment === 'good' ? '善良' : '邪恶'}阵营）。\n能力：${role.ability.zh}\n目标：${role.alignment === 'good' ? '帮助善良阵营找出并处决恶魔。' : '帮助邪恶阵营获胜，保护恶魔。'}`
    : `\nYour character: ${role.name.en} (${role.alignment} team).\nAbility: ${role.ability.en}\nGoal: ${role.alignment === 'good' ? 'Help good find and execute the Demon.' : 'Help evil win and protect the Demon.'}`)
}

function currentState(state: PublicState, lang: Lang): string {
  const alive: Seat[] = []
  const dead: string[] = []
  state.alive.forEach((living, i) => {
    if (living) alive.push(i + 1)
    else dead.push(seatLabel(i + 1, lang) + (lang === 'zh' ? `（投票标记${state.voteTokenUsed[i] ? '已用' : '未用'}）` : ` (vote token ${state.voteTokenUsed[i] ? 'used' : 'unused'})`))
  })
  const phase = state.phase === null ? (lang === 'zh' ? '配置阶段' : 'setup') : phaseLabel(state.phase, state.day, lang)
  const about = state.aboutToDie ? `${seatLabel(state.aboutToDie.seat, lang)} (${state.aboutToDie.votes})` : (lang === 'zh' ? '无' : 'none')
  return lang === 'zh'
    ? `# 当前局面\n现在是${phase}。\n存活（${alive.length} 人）：${seatList(alive, lang)}。\n死亡（${dead.length} 人）：${dead.join('、') || '无'}。\n今天已提名：${seatList(state.nominatorsToday, lang)}。今天已被提名：${seatList(state.nomineesToday, lang)}。\n即将被处决：${about}。`
    : `# Current state\nIt is ${phase}.\nAlive (${alive.length}): ${seatList(alive, lang)}.\nDead (${dead.length}): ${dead.join(', ') || 'none'}.\nHave nominated today: ${seatList(state.nominatorsToday, lang)}. Have been nominated today: ${seatList(state.nomineesToday, lang)}.\nAbout to die: ${about}.`
}

function contestantRequest(request: ContestantRequest, seat: Seat, config: GameConfig, state: PublicState): string {
  const lang = config.language
  const zh = lang === 'zh'
  let body: string
  switch (request.kind) {
    case 'night_choice': {
      const eligible = Array.from({ length: config.seatCount }, (_, i) => i + 1).filter(s => request.allowSelf || s !== seat)
      body = zh
        ? `你作为${roleName(request.as, lang)}被唤醒。targets 填 ${request.count} 个不同座位。合法范围：${seatList(eligible, lang)}；${request.allowSelf ? '可以' : '不能'}选自己，可以选死亡玩家。`
        : `You are woken as the ${roleName(request.as, lang)}. Put ${request.count} distinct seats in targets. Legal seats: ${seatList(eligible, lang)}; ${request.allowSelf ? 'you may' : 'you may not'} choose yourself; dead players are allowed.`
      break
    }
    case 'propose_whisper':
      body = zh
        ? `私聊第 ${request.round} 轮。你还能进入 ${request.remaining} 个房间。可以邀请：${seatList(request.eligible, lang)}。members 填至少一名其他玩家，不含自己且不重复；自己自动加入。null 表示本轮不私聊。`
        : `Whisper round ${request.round}. You may join ${request.remaining} more rooms. Eligible invitees: ${seatList(request.eligible, lang)}. members must contain at least one other player, no self or duplicates; you join automatically. null means no whisper this round.`
      break
    case 'rank_whispers': {
      const rooms = request.rooms.map(r => `${r.room}: ${seatList(r.members, lang)}`).join('\n')
      body = zh
        ? `私聊第 ${request.round} 轮。合法候选房间编号与成员：\n${rooms}\nranking 从最想去到最不想去排序，不重复；不排入的房间就不去，可以为空。`
        : `Whisper round ${request.round}. Legal room numbers and members:\n${rooms}\nList ranking from most to least wanted, with no duplicates. Omit rooms you will not join; the list may be empty.`
      break
    }
    case 'speak': {
      const context = request.context
      let where: string
      if (context.where === 'whisper') where = zh ? `私聊第 ${context.round} 轮，房间 ${context.room}，成员：${seatList(context.members, lang)}。` : `Whisper round ${context.round}, room ${context.room}, members: ${seatList(context.members, lang)}.`
      else if (context.where === 'public') where = zh ? '公聊。' : 'Public discussion.'
      else if (context.where === 'nomination_reason') where = zh ? `你提名了 ${seatLabel(context.nominee, lang)}，现在给出一条提名理由。` : `You nominated ${seatLabel(context.nominee, lang)}; give one nomination reason.`
      else where = zh ? `${seatLabel(context.nominator, lang)} 提名了你，现在给出一条辩护。` : `${seatLabel(context.nominator, lang)} nominated you; give one defence.`
      const required = context.where === 'nomination_reason' || context.where === 'defense'
      body = where + (zh
        ? `\n${required ? '仅有 1 条，speech 必须非空，不能 pass。' : `如果本次发言被采用，之后还剩 ${request.remaining} 条。speech 填要说的话，或 null 表示 pass。`}\n${context.where === 'public' ? `slayer_target 可填合法目标 1–${config.seatCount}（此时 speech 必须非空），否则填 null。` : 'slayer_target 必须为 null。'}`
        : `\n${required ? 'Exactly 1 line; speech must be nonempty, no pass.' : `After this speech, if selected, you have ${request.remaining} lines left. Put your spoken words in speech, or null to pass.`}\n${context.where === 'public' ? `slayer_target may be a legal target from 1–${config.seatCount} (speech must then be nonempty), otherwise null.` : 'slayer_target must be null.'}`)
      break
    }
    case 'nominate':
      body = zh ? `今天尚未被提名的合法座位：${seatList(request.eligible, lang)}。nominee 填其中一个座位，或 null 表示本轮不提名。` : `Legal nominees not yet nominated today: ${seatList(request.eligible, lang)}. Set nominee to one of these seats, or null to pass this round.`
      break
    case 'vote': {
      const votes = request.votes.map(v => zh ? `${v.seat} 号${v.raised ? '举手' : '不举手'}` : `Seat ${v.seat} ${v.raised ? 'raised' : 'did not raise'}`).join(zh ? '，' : ', ')
      const count = request.votes.filter(v => v.raised).length
      body = zh
        ? `${request.nominator} 号提名了 ${request.nominee} 号。现在轮到你投票。\n已投：${votes || '无'}；目前 ${count} 票；存活 ${state.alive.filter(Boolean).length} 人，本次成为即将被处决的门槛为 ${request.threshold} 票（平此前最高票不处决）。\nraise_hand 填 true 赞成处决或 false 不举手。${request.dead ? `你已死亡，${state.voteTokenUsed[seat - 1] ? '投票标记已用，只能 false' : '举手将用掉整局唯一的投票标记'}。` : ''}`
        : `Seat ${request.nominator} nominated Seat ${request.nominee}. It is your turn to vote.\nVotes so far: ${votes || 'none'}; ${count} raised. ${state.alive.filter(Boolean).length} alive; threshold to be about to die now: ${request.threshold} votes (tying the prior high means no execution).\nSet raise_hand to true to execute or false not to. ${request.dead ? `You are dead; ${state.voteTokenUsed[seat - 1] ? 'your vote token is used, so only false is legal' : 'raising uses your only vote token for the entire game'}.` : ''}`
      break
    }
  }
  return (zh ? '# 本次请求\n' : '# This request\n') + body + '\n' + (zh ? '请调用 ' : 'Call ') + TOOL_FOR_REQUEST[request.kind]
}

export function buildContestantMessages(input: { config: GameConfig; seat: Seat; events: readonly GameEvent[]; request: ContestantRequest; retry?: RetryNote }): ChatMessage[] {
  const { config, seat, request } = input
  const lang = config.language
  const events = project(input.events, { kind: 'seat', seat })
  const state = events.reduce(applyPublic, initialPublic(config.seatCount))
  let memo = lang === 'zh' ? '（空）' : '(empty)'
  for (const event of events) if (event.type === 'seat.memo.updated' && event.seat === seat) memo = event.text
  const user = [identity(events, seat, lang), timeline(events, lang, seat), (lang === 'zh' ? '# 你的备忘录\n' : '# Your memo\n') + memo, currentState(state, lang), contestantRequest(request, seat, config, state)].join('\n\n')
  return [{ role: 'system', content: contestantSystem(lang, config) }, { role: 'user', content: user + (input.retry ? retrySegment(input.retry, lang) : '') }]
}

export function buildStorytellerMessages(input: { config: GameConfig; events: readonly GameEvent[]; ask: DiscretionAsk; retry?: RetryNote }): ChatMessage[] {
  const { config, ask } = input
  const lang = config.language
  const zh = lang === 'zh'
  const events = project(input.events, { kind: 'storyteller' })
  const memos = new Map<Seat, string>()
  for (const event of events) if (event.type === 'seat.memo.updated') memos.set(event.seat, event.text)
  const memoText = Array.from({ length: config.seatCount }, (_, i) => `## ${seatLabel(i + 1, lang)}\n${memos.get(i + 1) ?? (zh ? '（空）' : '(empty)')}`).join('\n')
  const grimoire = { ...foldGrimoire(events), seatCount: config.seatCount }
  const user = [timeline(events, lang), (zh ? '# 各座位备忘录\n' : '# Seat memos\n') + memoText, (zh ? '# 当前魔典\n' : '# Current Grimoire\n') + JSON.stringify(grimoire), discretionRequest(ask, config)].join('\n\n')
  return [{ role: 'system', content: storytellerSystem(lang, config) }, { role: 'user', content: user + (input.retry ? retrySegment(input.retry, lang) : '') }]
}

export function buildTestCallMessages(lang: Lang): ChatMessage[] {
  return lang === 'zh'
    ? [{ role: 'system', content: '这是一次工具兼容性测试。只调用一次指定工具。' }, { role: 'user', content: '请调用 speak：reasoning 填测试理由，speech 填一句测试发言，slayer_target 为 null，memo 可省略。' }]
    : [{ role: 'system', content: 'This is a tool compatibility test. Call the requested tool once.' }, { role: 'user', content: 'Call speak: supply test reasoning and a test speech, set slayer_target to null, and omit memo if desired.' }]
}
