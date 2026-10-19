import { renderEvent } from '../event-templates'
import { ROLES } from '../game/roles'
import { foldPublic, project } from '../game/rules'
import type { ContestantRequest, GameEvent, Language, Observer } from '../types/game'
import { contestantSystem } from './rules'

export const PROMPT_VERSION = 2
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
  request: ContestantRequest
}): { messages: [{ role: 'system'; content: string }, { role: 'user'; content: string }] } {
  const zh = language === 'zh'
  const observer = `seat:${String(seat)}` as Observer
  const projected = project(events, observer)
  const config = events.find((event) => event.type === 'game.created')
  const state = foldPublic(projected, config?.seatCount ?? 5)
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
  const requestText = (() => {
    switch (request.tool) {
      case 'propose_whisper': {
        const invited = request.eligible.filter((other) => other !== seat)
        return zh
          ? `# 本次请求\n私聊第 ${String(request.round)} 轮；本阶段还可进入 ${String(request.remaining)} 个房间。可邀请座位：${invited.join('、')}；其他座位的次数已用完，不能邀请。members 填至少一个可邀请座位，不含自己、不重复；你会自动加入。填 null 表示本轮不私聊。\n请调用 propose_whisper。`
          : `# This request\nWhisper round ${String(request.round)}; ${String(request.remaining)} room entries remaining this phase. Eligible invitees: ${invited.join(', ')}; all other seats have exhausted their allowance. Put at least one eligible invitee in members, without yourself or duplicates; you join automatically. Set members to null to decline whispering this round.\nCall propose_whisper.`
      }
      case 'rank_whispers': {
        const rooms = request.rooms
          .map((room) => `${String(room.id)}: ${room.members.join(', ')}`)
          .join('; ')
        return zh
          ? `# 本次请求\n私聊第 ${String(request.round)} 轮。候选房间（编号：成员座位）：${rooms}。ranking 按意愿从高到低填写这些房间编号，不能重复或使用未列出的编号；没排入就是拒绝，可以填空数组。\n请调用 rank_whispers。`
          : `# This request\nWhisper round ${String(request.round)}. Candidate rooms (number: member seats): ${rooms}. Fill ranking with listed room numbers from most to least preferred, without duplicates or unlisted numbers. Omission refuses a room; an empty array is allowed.\nCall rank_whispers.`
      }
      case 'nominate':
        return zh
          ? `# 本次请求\n请选择今天尚未被提名的座位：${request.nominees.join('、')}。可以提名自己或死者；nominee 填合法座位号或 null（pass）。只有本轮被选中执行的提名才消耗今天的提名次数，落选后下一轮重新选择。\n请调用 nominate。`
          : `# This request\nLegal nominees not nominated today: ${request.nominees.join(', ')}. You may nominate yourself or a dead seat. Put a legal seat number in nominee, or null to pass. Only the nomination selected this round spends your daily nomination; unselected proposals are asked again next round.\nCall nominate.`
      case 'speak': {
        const free = request.kind === 'free'
        const purpose =
          request.kind === 'whisper' && request.room
            ? zh
              ? `私聊第 ${String(request.room.round)} 轮，房间 ${request.room.id}；成员：${request.room.members.join('、')}。还可发言 ${String(request.remaining ?? 0)} 条；可以 pass（speech 填 null）。内容仅房间成员可见。`
              : `Whisper round ${String(request.room.round)}, room ${request.room.id}; members: ${request.room.members.join(', ')}. ${String(request.remaining ?? 0)} speeches remaining; you may pass with speech: null. Only room members see the conversation.`
            : free
              ? zh
                ? `公聊发言，还可发言 ${String(request.remaining ?? 0)} 条；可以 pass（speech 填 null）。`
                : `Public discussion: ${String(request.remaining ?? 0)} speeches remaining; you may pass with speech: null.`
              : request.kind === 'nomination'
                ? zh
                  ? `为提名 ${String(request.nominee)} 号给出一条非空的提名理由，不能 pass。`
                  : `Give one nonempty reason for nominating Seat ${String(request.nominee)}; you cannot pass.`
                : zh
                  ? `回应 ${String(request.nominator)} 号的提名，给出一条非空辩护，不能 pass。`
                  : `Give one nonempty defence against Seat ${String(request.nominator)}'s nomination; you cannot pass.`
        return zh
          ? `# 本次请求\n${purpose}\n${free ? '只有 speech 非空时才可把猎手开枪附在发言上，slayer_target 填目标座位号（1–5）；任何座位都可以声称开枪，否则填 null。' : 'slayer_target 必须填 null。'}reasoning 填内心推理；可选 memo 整份覆盖备忘录（最多 2000 字）。\n请调用 speak。`
          : `# This request\n${purpose}\n${free ? 'Attach a claimed Slayer shot only to a nonempty speech: slayer_target is a seat number (1–5), otherwise null. Any seat may claim a shot.' : 'slayer_target must be null.'} Put private inner reasoning in reasoning. Optional memo replaces the whole memo (at most 2000 characters).\nCall speak.`
      }
      case 'vote': {
        const votes = request.votes
          .map((vote) =>
            zh
              ? `${String(vote.seat)} 号：${vote.raiseHand ? '举手' : '未举手'}`
              : `Seat ${String(vote.seat)}: ${vote.raiseHand ? 'raised' : 'not raised'}`,
          )
          .join(zh ? '；' : '; ')
        const count = request.votes.filter((vote) => vote.raiseHand).length
        const butler =
          request.master === undefined
            ? ''
            : state.seats.find((player) => player.seat === seat)?.alive
              ? zh
                ? `你的主人是 ${String(request.master)} 号。只有主人已举手或已被计入本次投票时，你才可以举手；你不必跟票。请自行遵守这一约束。`
                : `Your master is Seat ${String(request.master)}. You may raise your hand only if your master has raised or already been counted in this vote; you need not follow their vote. Follow this restriction yourself.`
              : zh
                ? '你已死亡，管家不再限制你的唯一一票。'
                : 'You are dead; the Butler no longer restricts your one remaining vote.'
        return zh
          ? `# 本次请求\n${String(request.nominator)} 号提名 ${String(request.nominee)} 号，顺时针投票轮到你。前面的票：${votes || '无'}。当前 ${String(count)} 票；门槛 ${String(request.threshold)} 票；今天此前最高 ${String(request.highestVoteCount)} 票。达到门槛且严格超过此前最高票才能成为即将被处决者；与最高票平票则无人处决。${request.canRaiseHand ? 'raise_hand 填 true 或 false；死者举手将永久消耗唯一的投票标记。' : '你的死者投票标记已用，只能填 false。'}${butler}\n请调用 vote。`
          : `# This request\nSeat ${String(request.nominator)} nominated Seat ${String(request.nominee)}. It is your clockwise voting turn. Previous individual votes: ${votes || 'none'}. Current tally: ${String(count)}; threshold: ${String(request.threshold)}; previous highest today: ${String(request.highestVoteCount)}. Meeting the threshold and strictly exceeding the previous high makes the nominee about to be executed; tying the high cancels the execution leader. ${request.canRaiseHand ? 'Set raise_hand to true or false; a dead voter raising permanently spends their only vote token.' : 'Your dead vote token is spent; only false is legal.'} ${butler}\nCall vote.`
      }
      case 'night_choice': {
        const targetCount = request.role === 'fortuneteller' ? 2 : 1
        const legalTargets = request.targets
          .map((target) => (zh ? `${String(target)} 号` : `Seat ${String(target)}`))
          .join(zh ? '、' : ', ')
        return zh
          ? `# 本次请求\n第 ${String(request.day)} 夜，作为${ROLES[request.role].name.zh}选择 ${String(targetCount)} 名${targetCount === 2 ? '不同的' : ''}玩家。合法目标：${legalTargets}。${request.targets.includes(seat) ? '可以选择自己。' : '不能选择自己。'}可以选择列表中的死者，不得因目标已死而重选。\ntargets 填 ${String(targetCount)} 个合法座位号；reasoning 填内心推理；可选 memo 整份覆盖备忘录（最多 2000 字）。\n请调用 night_choice。`
          : `# This request\nNight ${String(request.day)}: acting as ${ROLES[request.role].name.en}, choose ${String(targetCount)} ${targetCount === 2 ? 'distinct players' : 'player'}. Legal targets: ${legalTargets}. ${request.targets.includes(seat) ? 'You may choose yourself.' : 'You may not choose yourself.'} Listed dead players are legal; a dead target does not grant a new choice.\nPut ${String(targetCount)} legal seat number${targetCount === 2 ? 's' : ''} in targets and private inner reasoning in reasoning. Optional memo replaces the whole memo (at most 2000 characters).\nCall night_choice.`
      }
    }
  })()

  return {
    messages: [
      {
        role: 'system',
        content: contestantSystem(
          language,
          config?.speechLimit ?? 10,
          config?.whisperLimit ?? 3,
          config?.seatCount ?? 5,
        ),
      },
      { role: 'user', content: [identity, timeline, memo, currentState, requestText].join('\n\n') },
    ],
  }
}
