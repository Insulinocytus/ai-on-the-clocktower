import { renderEvent } from '../event-templates'
import { ROLES } from '../game/roles'
import { foldPublic, project } from '../game/rules'
import type { GameEvent, Language, NightRequest, Observer } from '../types/game'
import { contestantSystem } from './rules'

export const PROMPT_VERSION = 1
const SPEECH_DAYS = 2

export function buildContestantPrompt({
  events,
  seat,
  language,
  request,
}: {
  events: readonly GameEvent[]
  seat: number
  language: Language
  request: NightRequest
}): { messages: [{ role: 'system'; content: string }, { role: 'user'; content: string }] } {
  const zh = language === 'zh'
  const observer = `seat:${String(seat)}` as Observer
  const projected = project(events, observer)
  const state = foldPublic(projected)
  const identityEvent = projected.findLast(
    (event) =>
      event.type === 'told' &&
      event.seat === seat &&
      (event.kind === 'role' || event.kind === 'imp'),
  )
  if (identityEvent?.type !== 'told' || !('role' in identityEvent.content))
    throw new Error(`Seat ${String(seat)} has not been told a character`)
  const role = ROLES[identityEvent.content.role]
  const identity = zh
    ? `# 你的身份\n你是 ${String(seat)} 号。\n你的角色：${role.name.zh}；${role.alignment === 'good' ? '善良' : '邪恶'}阵营。\n能力：${role.ability.zh}\n目标：帮助${role.alignment === 'good' ? '善良阵营找出并消灭恶魔' : '邪恶阵营保护恶魔，直到只剩两人存活'}。`
    : `# Your identity\nYou are Seat ${String(seat)}.\nYour character: ${role.name.en}; ${role.alignment} team.\nAbility: ${role.ability.en}\nGoal: ${role.alignment === 'good' ? 'Help good find and eliminate the Demon' : 'Help evil protect the Demon until only two players live'}.`

  const lines: string[] = []
  let eventDay = 0
  for (const event of projected) {
    if (event.type === 'phase.started') eventDay = event.day
    if (event.type === 'seat.memo.updated') continue
    if (
      (event.type === 'public.speech' || event.type === 'whisper.speech') &&
      eventDay <= state.day - SPEECH_DAYS
    )
      continue
    const line = renderEvent(event, language, observer)
    if (line) lines.push(line)
  }
  const timeline = `${zh ? '# 时间线' : '# Timeline'}\n${lines.join('\n')}`
  const memoEvent = projected.findLast(
    (event) => event.type === 'seat.memo.updated' && event.seat === seat,
  )
  const memo = `${zh ? '# 你的备忘录' : '# Your memo'}\n${memoEvent?.type === 'seat.memo.updated' ? memoEvent.memo : zh ? '（空）' : '(empty)'}`
  const alive = state.seats.filter((player) => player.alive).length
  const phases = {
    'first-night': { zh: '首夜', en: 'first night' },
    night: { zh: '夜晚', en: 'night' },
    dawn: { zh: '黎明', en: 'dawn' },
    whisper: { zh: '私聊', en: 'whispers' },
    public: { zh: '公聊', en: 'public discussion' },
    nomination: { zh: '提名', en: 'nominations' },
  }
  const publicSeats = state.seats
    .map((player) =>
      zh
        ? `- ${String(player.seat)} 号：${player.alive ? '存活' : `死亡，投票标记${player.voteUsed ? '已用' : '可用'}`}`
        : `- Seat ${String(player.seat)}: ${player.alive ? 'alive' : `dead, vote token ${player.voteUsed ? 'spent' : 'available'}`}`,
    )
    .join('\n')
  const currentState = zh
    ? `# 当前公共局面\n第 ${String(state.day)} 天；阶段：${state.phase ? phases[state.phase].zh : '尚未开始'}。存活 ${String(alive)} 人；投票门槛 ${String(Math.ceil(alive / 2))} 票；今日最高票 ${String(state.highestVoteCount)} 票。\n${publicSeats}\n今日已提名者：${state.nominators.join('、') || '无'}。今日已被提名者：${state.nominees.join('、') || '无'}。即将被处决：${state.aboutToBeExecuted === null ? '无' : `${String(state.aboutToBeExecuted)} 号`}。`
    : `# Current public state\nDay ${String(state.day)}; phase: ${state.phase ? phases[state.phase].en : 'not started'}. ${String(alive)} alive; voting threshold ${String(Math.ceil(alive / 2))}; today's highest tally ${String(state.highestVoteCount)}.\n${publicSeats}\nNominated today: ${state.nominators.join(', ') || 'none'}. Nominees today: ${state.nominees.join(', ') || 'none'}. About to be executed: ${state.aboutToBeExecuted === null ? 'nobody' : `Seat ${String(state.aboutToBeExecuted)}`}.`
  const targetCount = request.role === 'fortuneteller' ? 2 : 1
  const legalTargets = request.targets
    .map((target) => (zh ? `${String(target)} 号` : `Seat ${String(target)}`))
    .join(zh ? '、' : ', ')
  const requestText = zh
    ? `# 本次请求\n第 ${String(request.day)} 夜，作为${ROLES[request.role].name.zh}选择 ${String(targetCount)} 名${targetCount === 2 ? '不同的' : ''}玩家。合法目标：${legalTargets}。${request.targets.includes(seat) ? '可以选择自己。' : '不能选择自己。'}可以选择列表中的死者，不得因目标已死而重选。\ntargets 填 ${String(targetCount)} 个合法座位号；reasoning 填内心推理；可选 memo 整份覆盖备忘录（最多 2000 字）。\n请调用 night_choice。`
    : `# This request\nNight ${String(request.day)}: acting as ${ROLES[request.role].name.en}, choose ${String(targetCount)} ${targetCount === 2 ? 'distinct players' : 'player'}. Legal targets: ${legalTargets}. ${request.targets.includes(seat) ? 'You may choose yourself.' : 'You may not choose yourself.'} Listed dead players are legal; a dead target does not grant a new choice.\nPut ${String(targetCount)} legal seat number${targetCount === 2 ? 's' : ''} in targets and private inner reasoning in reasoning. Optional memo replaces the whole memo (at most 2000 characters).\nCall night_choice.`

  return {
    messages: [
      { role: 'system', content: contestantSystem(language) },
      { role: 'user', content: [identity, timeline, memo, currentState, requestText].join('\n\n') },
    ],
  }
}
