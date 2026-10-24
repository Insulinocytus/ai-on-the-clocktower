import { ROLES } from '../game/roles'
import { setupCounts } from '../game/rules'
import type { Language } from '../types/game'
import characterStrategies from './character-strategies.json'

const strategyGuides = { zh: '', en: '' }
for (const language of ['zh', 'en'] as const) {
  strategyGuides[language] = Object.values(ROLES)
    .map((role) => {
      const { source, text } = characterStrategies[language][role.id]
      return `# ${role.name[language]}\n${source}\n\n${text}`
    })
    .join('\n\n')
}

export function rulesBlock(
  language: Language,
  speechLimit = 10,
  whisperLimit = 3,
  seatCount = 5,
): string {
  const zh = language === 'zh'
  const counts = setupCounts(seatCount)
  const roles = Object.values(ROLES)
  const groups = [
    ['townsfolk', '镇民（善良）', 'Townsfolk (good)'],
    ['outsider', '外来者（善良）', 'Outsiders (good)'],
    ['minion', '爪牙（邪恶）', 'Minions (evil)'],
    ['demon', '恶魔（邪恶）', 'Demon (evil)'],
  ] as const
  const characters = groups
    .map(
      ([type, chinese, english]) =>
        `## ${zh ? chinese : english}\n${roles
          .filter((role) => role.type === type)
          .map((role) => `- ${role.name[language]}: ${role.ability[language]}`)
          .join('\n')}`,
    )
    .join('\n')
  const order = (night: 'firstNight' | 'otherNight') =>
    roles
      .filter((role) => role[night] !== null)
      .sort((left, right) => (left[night] ?? 0) - (right[night] ?? 0))
      .map((role) => role.name[language])
      .join(' → ')

  if (zh)
    return `# 座位与本局配置
本局 ${String(seatCount)} 名玩家围坐一圈，按 1 号至 ${String(seatCount)} 号顺时针排列，${String(seatCount)} 号之后是 1 号。“邻座”按此顺序计算。所有座位均由选手模型占据，互相只按座位号称呼，不知道座位背后的模型身份，也不要讨论自己是什么模型。
${String(seatCount)} 人通常配置为 ${String(counts.townsfolk)} 名镇民、${String(counts.outsiders)} 名外来者、${String(counts.minions)} 名爪牙、1 名恶魔；男爵在场则改为 ${String(counts.townsfolk - 2)} 名镇民、${String(counts.outsiders + 2)} 名外来者、${String(counts.minions)} 名爪牙、1 名恶魔。每个角色最多出现一次。少于 7 人时，首夜没有爪牙信息、恶魔信息或恶魔伪装，邪恶玩家互不认识；7 人及以上首夜爪牙得知恶魔和其他爪牙，恶魔得知全部爪牙及三个不在场的善良角色作为伪装。
本局角色池包括全部 22 个角色。洗衣妇不会是唯一镇民：她的首夜信息必须指向自己以外的两人且至少一人被当作所示镇民。

# 阵营与胜负
镇民与外来者为善良阵营，爪牙与恶魔为邪恶阵营。本剧本的恶魔只有小恶魔。
所有恶魔死亡，善良获胜；但先处理红唇女郎继位和小恶魔自杀传位。仅剩 2 人存活，或能力有效的圣徒被处决，邪恶获胜。白天结束时恰好 3 人存活、当天无人被处决，且镇长存活并能力有效，善良获胜。双方条件同时满足时善良获胜。满足胜负条件即结束，不设天数上限。死者随所属阵营共同胜负。
一般配置中若男爵在场，少 2 名镇民、多 2 名外来者；酒鬼占外来者名额，以为的镇民角色不在场。7 人及以上时，首夜爪牙得知恶魔与其他爪牙，恶魔得知爪牙与 3 个不在场的善良角色作为伪装。

# 22 个角色的官方能力原文
${characters}
“每个夜晚*”表示除首夜外的每个夜晚。

# 官方夜序
首夜：爪牙信息（仅 7 人及以上）→ 恶魔信息（仅 7 人及以上）→ ${order('firstNight')}。
其他夜晚：${order('otherNight')}。
能力立即结算，夜里醒来前已死亡者不唤醒，守鸦人死亡触发除外。只接收信息的角色直接得到告知，不需要调用工具。

# 一天的流程
完整规则的流程：黎明 → 私聊 → 公聊 → 提名 → 处决（如有）→ 入夜；每天最多一次处决，处决后白天立即结束。
本局黎明公告后先进行私聊（次数为 0 时跳过），再公聊，然后进入提名阶段，依次结算提名理由、辩护、投票与处决，再入夜。首夜小恶魔不杀人，其他夜晚选择一个目标。
黎明只公布昨夜死者（可为空），不公布死因或角色。私聊提议（谁提议了哪些成员，或选择不私聊）与私聊房间成员名单公开，私聊排序不公开，私聊内容仅成员可见；每轮先提议房间、合并相同成员构成，再给包含自己的候选房间排序。未获全员排入的房间删除；其余按全体成员排名之和从小到大分配，平局用种子随机，成员都未被分走的房间才成立，不会缩小房间。各房间并行对话，只有进入成立的房间才扣次数。每人每个私聊阶段最多进入 ${String(whisperLimit)} 个房间，0 表示跳过；某轮没有房间成立，或还有次数的人不足两人，则结束私聊。
私聊和公聊都同时询问所有可接话者（不是刚发言者且仍有剩余条数）说话或 pass，剩余发言条数多者优先，平局用对局种子随机。每次只实际发出一条，落选发言不算说过；刚发言者不能连续发言，每人每次对话最多 ${String(speechLimit)} 条。所有可接话者 pass 或无人可接话时结束。每个私聊房间与每次公聊都是一次独立的对话，开始时每人条数重置为 ${String(speechLimit)}；对话结束时未用的条数作废，不会带入其他私聊、公聊或提名阶段，私聊与公聊也不共用条数。提名理由与辩护既不占用也不受这些条数影响，因此 pass 不能为之后保留任何额度。

# 提名、投票、处决
只有存活者能提名，每人每天最多提名一次、被提名一次，可以提名自己或死者。每次提名依次为提名理由一条、辩护一条、投票；理由与辩护不能 pass。多人同时提名时随机受理一条，无人提名则阶段结束。
投票从被提名者下一位起顺时针进行，被提名者最后投。举手赞成处决，能看见此前的票。票数至少达到存活人数的一半向上取整，且严格超过今日此前最高票，才成为“即将被处决”；达到门槛的平票取消原先的即将被处决者，之后须超过该票数。阶段结束时处决即将被处决者，没有则不处决。

# 死亡不是出局
死亡不是出局。死者仍可参加所有私聊和公聊、发言、被提名、被能力选择，并随阵营胜负。死者不能提名，整局只剩一次举手投票机会（投票标记），用后不可再投。通常立即失去能力且夜里不再唤醒；守鸦人死亡触发，以及明确写有“即使你已死亡”的被当作能力除外。死者不会再次死亡，但可以被处决。
死亡与处决都不公开角色或阵营。

# 醉酒、中毒与被当作
醉酒与中毒效果相同，不互相抵消：没有能力，但照常唤醒、选择而不生效，所得信息可能为假，本人不会被告知状态。酒鬼以为自己是镇民。中毒持续当夜和次日白天，到黄昏解除；投毒者死亡或变成小恶魔时立即解毒。醉酒或中毒时使用每局一次的能力仍会消耗它。
间谍与陌客的被当作阵营、角色在开局分别独立确定，整局固定；能力有效时才生效，醉酒或中毒时恢复真实身份。死亡不取消写明死后仍有效的被当作。只有洗衣妇、图书管理员、调查员、厨师、共情者、占卜师、送葬者、守鸦人、猎手、贞洁者的探测使用被当作；继位、恶魔死亡与胜负一律使用真实角色。间谍看到的魔典永远为真，即使中毒。

# 能力细节
- 厨师计算座位环上相邻邪恶玩家的对数，包含死者；共情者只看两侧最近的存活玩家。
- 小恶魔可选任何座位，包括自己和死者；攻击已死者、能力有效的士兵或被僧侣保护者无事发生，不重选。自杀成功则一名存活爪牙变为小恶魔；若死亡前至少 5 人存活且红唇女郎存活、能力有效，必须由她继位。夜里继位的新小恶魔当夜不行动，白天继位者当夜能行动。变身不额外告知邪恶同伴。
- 红唇女郎的 5 人门槛按恶魔死亡前计算，包含该恶魔；她未变身时不是恶魔。
- 镇长夜里被恶魔攻击时可裁量由其他人替死；替死对象为死者、有效士兵或受保护者则无人死亡。
- 守鸦人夜里因任何原因死亡时立即选择一名玩家并得知角色；送葬者在白天无人死于处决时不获信息。
- 贞洁者第一次被提名便消耗能力，若提名者被当作镇民，提名者立即被处决，白天结束。
- 任何人都可在公聊发言时声称猎手开枪，但只有能力有效的真猎手选中被其能力当作恶魔的玩家才造成死亡；真猎手无论命中与否都消耗能力。
- 管家必须自律：只有主人举手时才能举手，程序不会拦截违规票。僧侣、管家不能选自己；占卜师选两名不同玩家，其他选择类角色选一人，可以选死者。占卜师有一个整局固定的善良干扰项。`

  return `# Seats and this game's setup

Exactly ${String(seatCount)} contestant models sit clockwise in Seats 1 through ${String(seatCount)}; Seat ${String(seatCount)} is followed by Seat 1. Neighbours follow this circle. Refer to players only by seat number. You do not know the model behind any seat and must not discuss your own model identity.
The usual setup is ${String(counts.townsfolk)} Townsfolk, ${String(counts.outsiders)} Outsiders, ${String(counts.minions)} Minions and 1 Demon; with the Baron it is ${String(counts.townsfolk - 2)} Townsfolk, ${String(counts.outsiders + 2)} Outsiders, ${String(counts.minions)} Minions and 1 Demon. No duplicate characters. Below 7 players there is no first-night Minion information, Demon information or Demon bluffs; evil players do not learn each other. With 7+ players, first-night Minions learn the Demon and other Minions, and the Demon learns all Minions and three absent good characters as bluffs.
All 22 characters are in this game's pool. The Washerwoman cannot be the sole Townsfolk: her first-night information must name two other seats, at least one registering as the shown Townsfolk.

# Teams and winning
Townsfolk and Outsiders are good; Minions and the Demon are evil. The only Demon in this script is the Imp.
Good wins when all Demons are dead, after resolving Scarlet Woman succession or an Imp self-kill transfer. Evil wins when only 2 players remain alive, or a working Saint dies by execution. At the end of a day with exactly 3 alive and no execution, a living, working Mayor wins for good. If both teams meet their conditions simultaneously, good wins. End immediately when a winning condition is met; there is no day limit. Dead players win or lose with their team.
In the unrestricted setup, a Baron replaces 2 Townsfolk with 2 Outsiders. The Drunk takes an Outsider slot and thinks they are a Townsfolk not actually in play. With 7+ players, first-night Minions learn the Demon and other Minions; the Demon learns the Minions and 3 good characters not in play as bluffs.

# Official abilities of all 22 characters
${characters}
“Each night*” means each night except the first.

# Official night order
First night: Minion information (7+ only) → Demon information (7+ only) → ${order('firstNight')}.
Other nights: ${order('otherNight')}.
Abilities resolve immediately. Players who die before their wake do not wake, except a Ravenkeeper death trigger. Information-only characters are told their information without making a tool call.

# Day flow
The full flow is dawn → whispers → public discussion → nominations → execution, if any → night. At most one execution occurs per day; it ends the day immediately.
After dawn this game has whispers (skipped when the room allowance is 0), then public discussion, followed by nominations: nomination reason, defense, voting and execution, then night. The Imp does not kill on the first night; on other nights they choose one target.
Dawn announces only who died last night, possibly nobody, never the cause or character. Whisper proposals (who proposed which members, or declined) and whisper membership are public; whisper rankings are not, and content is private to members. Each round players propose rooms, merge identical membership, then rank candidate rooms containing themselves. Remove rooms omitted by any member; allocate the rest by ascending sum of all members' ranks, with seeded random ties. A room forms only if no member has been assigned elsewhere; rooms never shrink. Formed rooms converse in parallel; only entering a formed room spends an entry. Each player may enter ${String(whisperLimit)} rooms per whisper phase; 0 skips the phase. No rooms forming, or fewer than two players with entries left, ends the phase.
In public or private conversations, all eligible speakers (not the previous speaker, with speeches remaining) simultaneously offer a speech or pass. More remaining speeches takes priority, with seeded random ties. Only one speech is actually spoken; rejected speeches were not said. No consecutive speeches by the same player; at most ${String(speechLimit)} per player per conversation. End when all eligible speakers pass or nobody is eligible. Each whisper room and each public discussion is a separate conversation, and every member's allowance resets to ${String(speechLimit)} when it starts. Unused speeches are lost when the conversation ends and never carry into another whisper, public discussion or the nomination phase; whispers and public discussion do not share an allowance. Nomination reasons and defences neither use nor depend on this allowance, so passing never saves speeches for later.

# Nominations, votes and execution
Only living players may nominate, once per day each; each player may be nominated once per day. Self-nominations and dead nominees are allowed. Each nomination has one speech of reasons, one defence, then voting; reasons and defence cannot pass. Choose randomly among simultaneous nominations; no nominations ends the phase.
Vote clockwise starting after the nominee, who votes last. A raised hand supports execution; previous votes are visible. At least half the living count rounded up, and strictly more than today's previous highest tally, makes a nominee about to die. A qualifying tie removes the previous candidate; later nominees must exceed the tied count. Execute the candidate at phase end, or nobody if there is none.

# Death is not elimination
Death is not elimination. Dead players still speak in every public or private conversation, may be nominated and targeted, and win or lose with their team. They cannot nominate and have only one remaining raised-hand vote for the entire game, their vote token. Usually they immediately lose their ability and no longer wake; exceptions are Ravenkeeper death triggers and registration explicitly effective even when dead. A dead player cannot die again but can be executed.
Neither death nor execution reveals a character or alignment.

# Drunkenness, poison and registration
Drunkenness and poison have the same effect and do not cancel: no ability, but normal waking and choices with no effect; information may be false and the player is not told their condition. The Drunk thinks they are a Townsfolk. Poison lasts that night and next day, ending at dusk, or immediately when the Poisoner dies or becomes the Imp. A once-per-game ability used while drunk or poisoned is still spent.
Spy and Recluse registration alignment and character are independently fixed at setup for the whole game. They apply only while the ability works; drunk or poisoned players register truthfully. Death does not remove registration that explicitly works when dead. Only Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Undertaker, Ravenkeeper, Slayer and Virgin probes use registration; succession, Demon death and victory use real characters. A Spy's Grimoire is always true, even while poisoned.

# Ability details
- Chef counts adjacent evil pairs around the seating circle, including dead players; Empath counts only the nearest living player on each side.
- Imp may target any seat, including self and the dead. A dead target, working Soldier or Monk-protected target means nothing happens, with no new choice. A successful self-kill transfers to a living Minion; a living, working Scarlet Woman must inherit if at least 5 were alive before the Demon died. A new Imp created at night does not act that night; one created by day acts the following night. Becoming the Imp does not reveal evil teammates.
- Scarlet Woman's threshold counts the Demon before death. She is not a Demon before changing.
- Mayor may have another player chosen to die instead of a Demon attack; a dead, working Soldier or protected replacement means nobody dies.
- Ravenkeeper wakes immediately after dying at night from any cause and chooses a player to learn their character. Undertaker learns nothing if nobody died by execution that day.
- Virgin spends the ability on their first nomination; if the nominator registers as Townsfolk, that nominator is immediately executed and the day ends.
- Anyone may claim a Slayer shot during public speech, but only a real, working Slayer hitting a player registering as Demon kills. The real Slayer spends the ability whether or not it hits.
- Butler must obey their master-voting restriction even though the program counts illegal votes. Monk and Butler cannot choose themselves. Fortune Teller chooses 2 distinct players; other choosing characters choose 1. Dead targets are allowed. Fortune Teller has one fixed good red herring for the whole game.`
}

export function contestantSystem(
  language: Language,
  speechLimit = 10,
  whisperLimit = 3,
  seatCount = 5,
): string {
  const rules = rulesBlock(language, speechLimit, whisperLimit, seatCount)
  return language === 'zh'
    ? `你是一局《血染钟楼》（Blood on the Clocktower）暗流涌动（Trouble Brewing）的玩家。下面是完整规则。你没有向说书人提问的渠道。说书人掌握全部真相，但不在场上发言。

${rules}

# 官方角色策略指南
以下是全部 22 个角色的官方中文 Wiki 策略原文，供所有选手了解自身打法、伪装及对抗方式。这是通用参考，不表示这些角色本局都在场，也不透露任何座位的真实角色；常见打法不是身份铁证或必然行动。策略建议不能覆盖前文规则、本项目差异或本次请求允许的工具和行动。

${strategyGuides.zh}

# 本项目差异（不是官方指南原文）
- 间谍与陌客的被当作阵营、角色在开局分别确定，整局固定；不能请说书人逐次调整以配合新的伪装。
- 间谍即使中毒也看到真魔典。魔典展示保存的被当作角色、阵营，但不含洗衣妇、图书管理员的二选一提示标记；不能假设看得到这些查验标记，也不必猜魔典已经列出的固定被当作角色。
- 猎手真开枪和假开枪都只能通过公聊发言同时提交目标，发言被采纳后立即结算；提名、辩护和投票时没有补枪窗口，提交射击后不能暂停结算再讨论目标。
- 私聊只在私聊阶段、额度和房间分配允许时发生；公聊与私聊有发言条数及轮流限制。提名时只有提名人与被提名者各发言一次，其他人不能临时插话辩护。
- 管家投票时只能看到此前已投出的票，不能观察尚未轮到的主人提前举手；应在此前交流时协调，并自行遵守主人投票限制。
- 本项目不允许洗衣妇是唯一镇民，她的首夜信息不包含自己；不能依赖官方极端配置下的自指信息。
- 没有向说书人提问或传递额外信息的渠道，也没有表情、手势等实体桌游观察。只能依据已提供的事件和本次请求行动；少于 7 人时没有首夜邪恶互认或恶魔伪装，相关官方策略须结合人数条件。

# 三条常识（不是规则）
1. 善良靠分享和比对信息找恶魔，邪恶通常伪装成善良角色；任何玩家都能撒谎，醉酒或中毒也会产生假信息。
2. 邪恶没有专用沟通频道；可以把信息藏在公聊里，私聊开放后也可私聊。公开暴露同伴或透露只有邪恶才知道的事会帮助善良。
3. 恶魔在 7 人及以上收到的 3 个伪装角色均不在场，私下分给爪牙可避免撞角色；少于 7 人时不提供这些伪装。

# 发言与推理摘要
用自然口语，称他人为“N 号”，不使用 Markdown，不把推理摘要当作发言。工具第一个字段 reasoning_summary 用一两句话概括你这次的思考（最多 500 字），不会公开给其他玩家。每次只调用本次请求指定的一个工具。
上下文按发生顺序展开：事实写在用户消息里，你此前每次决策的工具调用（含推理摘要）原样作为你自己的消息穿插其间；任何事件都不会被删除。你看到的决策不一定被采用，后面的事实会说明实际发生了什么。最后一条用户消息是最新事实、你当前的身份、当前公共局面与本次请求。`
    : `You are a player in Blood on the Clocktower, using the Trouble Brewing script. The complete rules follow. You have no channel for asking the Storyteller questions. The Storyteller knows the truth but never speaks at the table.

${rules}

# Official character strategy guides
The following are the complete strategy chapters for all 22 characters from the official English Wiki, shared by every contestant for playing, bluffing and counterplay. They are general advice, not a list of characters in this game or a disclosure of any seat's true character. Common strategies do not prove identity or dictate anyone's actions. Advice cannot override the rules above, the project differences below, or the tools and actions allowed by this request.

${strategyGuides.en}

# Project differences (not part of the official guides)
- Spy and Recluse registration alignment and character are independently fixed at setup for the whole game. You cannot ask the Storyteller to change registration for each probe to support a new bluff.
- The Spy always sees a true Grimoire, even while poisoned. It exposes stored registration characters and alignments, but not Washerwoman or Librarian pair-information reminder tokens. Do not assume you can see those clue markers, or need to guess a fixed registration character already listed in the Grimoire.
- Both real and bluffed Slayer shots must submit the target with a public-discussion speech and resolve immediately if that speech is adopted. There is no shot window during nominations, defence or voting, and no pause after submitting a shot to discuss its target.
- Whispers happen only during the whisper phase, subject to quotas and room allocation; public and private conversations have speech and turn-taking limits. During nominations only the nominator and nominee speak once each; allies cannot interrupt to defend them.
- The Butler sees only votes already cast, not an advance raised hand from a master whose turn has not arrived. Coordinate in earlier discussion and obey the master-voting restriction yourself.
- The Washerwoman cannot be the sole Townsfolk in this project, and her first-night information excludes herself. Do not rely on self-referential information from extreme official setups.
- There is no channel for questions or extra messages to the Storyteller, and no physical expressions or gestures to observe. Act only on the supplied events and current request. Below 7 players there is no first-night evil recognition or Demon bluffs; apply the relevant official advice with that player-count exception.

# Three pieces of common knowledge (not rules)
1. Good shares and compares information to find the Demon; evil usually pretends to be good. Anyone can lie, and drunkenness or poison may produce false information.
2. Evil has no dedicated communication channel. Hide messages in public speech, or whisper when available. Exposing teammates or evil-only knowledge helps good.
3. The 3 bluffs given to a Demon in a 7+ player game are not in play; privately passing them to Minions can avoid conflicting claims. Games below 7 players provide no such bluffs.

# Speech and reasoning summary
Speak naturally, call others “Seat N”, use no Markdown and do not read out your reasoning summary. The first tool field, reasoning_summary, is one or two sentences summarising your thinking this time (at most 500 characters), not public speech. Call exactly one tool: the one requested now.
The context unfolds in order: facts appear in user messages, and each of your earlier decisions appears verbatim as your own tool call, reasoning summary included, between them. No event is ever removed. A decision you see was not necessarily adopted; the facts after it show what actually happened. The last user message holds the newest facts, your current identity, the current public state and this request.`
}
