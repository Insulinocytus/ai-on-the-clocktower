# 现有 LLM 社交推理游戏项目与论文调研（工单 #4，`prior-art`）

调研日期：2026-10-17。范围：血染钟楼（BotC）、狼人杀（Werewolf）、Avalon、Mafia、Among Us、Diplomacy 的 LLM 开源项目与论文。
来源均为一手：仓库源码/README/设计文档、论文原文、官方站点。未能核实的标 **UNVERIFIED**；GitHub 链接中 `HEAD` 指默认分支，行号会漂移。

---

## 0. 结论（先看这里）

1. **没有任何现成项目能直接套用**：没有一个项目同时具备「事件溯源日志 + 集中式可见性 + 玩家间任意私聊 + 上下文压缩 + 全知回放」。最接近的是 BloodArena（BotC，LLM 说书人 + 代码规则，12 个不同 LLM 同局）、ai-werewolf（可见性与事件日志）、wolfcha（上下文压缩实测）、AIWolf（发言配额协议）。
2. **白天讨论**：所有成熟项目的终止都靠**硬上限**（轮数/条数/步数），没有一个只靠 LLM 自判「该结束」。主流三种：固定/随机轮转（便宜，但被迫开口、易复读/回声）；bidding（werewolf_arena，每句多 N 次调用）；stance 轮次 + pass（foaster）。**把「沉默」做成一等动作（pass/skip/over）并带配额**是 AIWolf 的做法，最值得抄。
3. **私聊**：**没有任何狼人杀项目实现了「玩家间任意私聊」**，只有狼夜聊。BotC 项目里 Sullivan 把私聊做成「同一个 `send_message` 工具的 `recipients[]` 子集」，BloodArena 限定「仅第 1 天、一问一答」以控成本。AI Diplomacy 的「同轮并发、轮末统一释放、同一收件人未回复前不得再发」是成熟的私聊调度模型。BotC 私聊是新设计空间，需要自己定预算规则。
4. **上下文压缩**：wolfcha 的实测结论最有价值——**压缩只删不改**：硬事实账本由代码生成且永不裁剪；身份/技能声明钉住；往日发言只留原文摘录；**不要让模型写的摘要进入他人上下文**（实测约每 3 份摘要就有 1 处转述出入，错误会扩散）。BloodArena 的做法与之互补：日终「从权威游戏状态重建历史」再让选手自己写策略总结。
5. **事件可见性**：最强的模型是 ai-werewolf 的「单一无状态类 + 事件类型白名单 + visibility 枚举」双层 fail-safe，且全知视角与 agent 上下文物理隔离；论文 _Auditing Belief-Conditioned Agents_ 把它表述为「代码层面的上下文构建边界」。**BotC 特有难点（醉酒/中毒/间谍/隐士使「被告知的内容」≠ 真值）所有项目都没覆盖**——日志里必须同时存「真值事件」与「该座位被告知的内容」。
6. **反复出现的失败模式**：回声/共识（Medium 手动实验、Sullivan 的 groupthink）、复读（Werewolf Arena、LLMafia）、夜间信息泄漏（foaster：狼公开说出夜间刀口）、解析失败静默变默认值污染数据（WOLF、BloodArena）、失败即整局崩溃（werewolf_arena、raphydaphy）、上下文无限增长（多数项目）、成本（每句发言 +N 次度量/投票调用）。

---

## 1. 项目/论文总览

| 项目                                                                                                            | 游戏                                    | 发言调度                                        | 私聊                                  | 记忆/压缩                                 | 可见性                                      | 观战/回放                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| [BloodArena](https://github.com/BloodArena/BloodArena)                                                          | BotC TB，12 人 12 个 LLM + LLM 说书人   | 每天 3 轮顺序发言                               | 仅第 1 天、一问一答；邪恶队有首日密聊 | 增量游标 + 日终从状态重建后自总结         | 按频道数组 + 角色格式化函数                 | 轨迹文件 + 浏览器                                                         |
| [Sullivan](https://github.com/james-sullivan/multi-agent-social-deduction)                                      | BotC TB，Claude                         | 4 轮每轮洗牌，工具含 pass，全员连续 pass 早结束 | `send_message.recipients[]` 子集      | 每夜 summarize → notes，清历史            | 每事件 recipients 列表                      | JSONL + [React 时间线](https://james-sullivan.github.io/botc-visualizer/) |
| [hmdurland](https://github.com/hmdurland/AI-on-the-Clocktower)                                                  | BotC TB/BMR，GPT-5 系                   | 座位顺序 ×2 遍                                  | 无                                    | 近 3 天公开发言 + `<THINK>` 自注（无界）  | 自承认有泄漏                                | XML 日志 + Streamlit                                                      |
| [raphydaphy](https://github.com/raphydaphy/clocktower-ai)                                                       | BotC（Teensyville），Gemini，人类说书人 | 随机选人，全员 idle 则结束                      | 公开宣布请求，同步多轮小房间          | 全量聊天重放（无压缩）                    | 调用点手工指定                              | 每人 CSV                                                                  |
| [npow/botc-ai](https://github.com/npow/botc-ai)                                                                 | BotC TB，浏览器                         | urgency + exhaustion 检测                       | 无（仅样式）                          | 读游标                                    | 日志 `cls` + 客户端过滤                     | JSON 导出 + 日志查看器                                                    |
| [Clocktower Radio](https://clocktower-radio.com/how-it-works.html)                                              | BotC，8 人，两模型镜像对局              | 每阶段洗牌、单次调用/回合                       | UNVERIFIED                            | 阈值压缩 STM + 每日 LTM                   | 按玩家视角 morph                            | 网页回放（细节 UNVERIFIED）                                               |
| [werewolf_arena](https://github.com/google/werewolf_arena) / [论文](https://arxiv.org/abs/2407.13943)           | 狼人杀 8 人                             | **bidding 0–4**                                 | 无                                    | observations 全量 + 每轮 LLM 自总结       | GameMaster 逐个更新                         | `index.ts` 查看 prompt/bid/推理                                           |
| [Xu et al.](https://arxiv.org/abs/2309.04658)                                                                   | 狼人杀 7 人                             | 随机顺序                                        | 狼夜聊 `visible_to`                   | 最近 K=15 + 重要度 + 问答反思 + 经验池    | `Message.visible_to`                        | 无 UI                                                                     |
| [foaster Werewolf-bench](https://werewolf.foaster.ai/)                                                          | 狼人杀 6 人，7 模型 Elo                 | 3 轮，stance 优先级，可 pass                    | 狼夜聊                                | 未披露                                    | —                                           | 文本日志：私有想法→公开发言配对 + vote-intention                          |
| [wolfcha](https://github.com/oil-oil/wolfcha)                                                                   | 狼人杀 10–12 人，玩家+LLM               | 座位顺序，警长最后                              | 狼聊被简化掉                          | **账本+声明钉住+只删不改**（有实测）      | `GameEvent.visibility` + `resultsAnnounced` | 玩家向 UI，非全知                                                         |
| [AgentScope werewolves](https://github.com/agentscope-ai/agentscope/blob/v1/examples/game/werewolves/README.md) | 狼人杀 9 人                             | `sequential_pipeline`                           | 狼 `MsgHub`                           | ReAct memory 全量                         | MsgHub 参与者 = 可见集                      | Java HITL 版有 `GOD_VIEW_ONLY` 回放                                       |
| [ai-werewolf](https://github.com/JJJayden-Yang/ai-werewolf)                                                     | 狼人杀 6/9 人                           | 顺序发言，投票同时                              | 狼提名私有事件                        | 4000 token 预算 + Fact Stream             | **白名单+枚举双层**                         | `events?since=cursor` 轮询 + 回放页 + belief 曲线                         |
| [AIWolf](https://aiwolf.org/en/protocol)                                                                        | 人狼 5/9 人                             | turn 制 + 配额 + Skip/Over；另有 Speak-Anytime  | `whisper` 仅狼                        | 增量历史                                  | 协议层 Info 只含本人字段                    | 官方日志/viewer                                                           |
| [LLMafia](https://arxiv.org/abs/2506.05309)                                                                     | Mafia，LLM 混入真人                     | **无回合，轮询 `<send>/<wait>`**                | 狼夜聊文件                            | 无（全量时间戳聊天）                      | 按频道文件                                  | —                                                                         |
| [AI Diplomacy](https://github.com/GoodStartLabs/AI_Diplomacy)                                                   | Diplomacy                               | 3 轮并发，轮末释放                              | GLOBAL/私有，防连发                   | 私有日记：最近 40 条 + 旧年份便宜模型合并 | 轮末统一释放                                | Three.js 3D 回放                                                          |
| [MafiaScope](https://arxiv.org/abs/2607.10645)                                                                  | Mafia                                   | —                                               | —                                     | —                                         | —                                           | 非侵入式信念探针 + fork 重放                                              |
| [Auditing Belief-Conditioned Agents](https://arxiv.org/abs/2607.10814)                                          | 狼人杀 9 人                             | —                                               | —                                     | —                                         | **代码层上下文构建边界 + canonicalizer**    | 决策 trace                                                                |

---

## 2. 重要项目详述

### 2.1 BotC 项目

**BloodArena（最接近本项目）** — https://github.com/BloodArena/BloodArena ，[基准说明](https://github.com/BloodArena/BloodArena/blob/main/benchmark/README_EN.md)，引擎 `benchmark/engine.js`

- 12 人暗流涌动，12 个不同 LLM（OpenRouter）各占一座，另有 Storyteller LLM（不计分）。`discussionRounds=3`、`maxNominationsPerDay=3`、`maxDays=10`、单次调用 120s 超时、`maxRetries=3`。
- **调度**：白天 3 轮，每轮每个活人依次一条公开发言；每人发言后询问是否发起私聊；邪恶队首日公开讨论前有 ≤3 轮、每人 ≤3 条的内部密聊。**私聊仅第 1 天（`isPrivateChatOpen`），一次请求 = 一问一答**，README 的理由是控制成本与信息爆炸。
- **记忆**：每位选手持久 message session；`USE_INCREMENTAL_CHAT_CONTEXT` 用 per-actor 游标只注入 `seq > cursor` 的新条目；日终 `compressPlayerSessions`：**丢弃原始对话，从权威游戏状态重建完整历史**（公聊、私聊、邪恶密聊、私有信息、存活摘要），再让该选手自己的模型用**阵营专属模板**（好人：声明分析/矛盾追踪；邪恶：队友协调/伪装/威胁评估）写总结，每天总结保留。
- **说书人 LLM 只管裁量**：`storytellerChooseRegistrationProfile`（间谍/隐士登记）、`storytellerChooseInfo`（醉酒/中毒信息）、`storytellerChooseTrueInfoPair`（洗衣妇/图书管理员/调查员配对）、`storytellerChooseMayorRedirect` 等；**每个都返回 JSON 且有规则兜底**（如间谍 70% 登记为好人、市长 50% 转移）；日志有「信息审计」可区分真假信息。与本项目分工一致。
- **问题**：回复靠 `extractJson`（JSON.parse 失败再正则），所有错误 `catch (_) {}` 静默吞掉，投票解析失败默认 "no"，难以发现退化；README 自己提醒要检查「天数是否合理（通常 3–8）、token 是否合理」，说明退化局常见。
- 出处：engine.js 内函数名；行为描述来自子代理读码，具体行号 UNVERIFIED。

**james-sullivan/multi-agent-social-deduction** — [仓库](https://github.com/james-sullivan/multi-agent-social-deduction)，[EA Forum 报告](https://forum.effectivealtruism.org/posts/gsrMv7892p2uq4pjk/how-do-ai-agents-work-together-when-they-can-t-trust-each)，[visualizer](https://github.com/james-sullivan/botc-visualizer)

- **调度**：`_run_day_phase` 共 4 轮，每轮洗牌；前 2 轮不开提名；每回合玩家必须从工具（message / nominate / 一次性能力 / pass）里选一个；全员连续 pass 则提前结束当天。发言与私聊是同一个 `send_message(recipients[])`，工具描述写明「宣布提名不等于提名」「幽灵仍可收消息」。
- **记忆**：prompt = 缓存的静态系统块（规则/角色表/座位/身份/策略建议）→ 动态状态 + `<notes>` → `<history>`；每夜结束 `summarize_history()` 把历史压成 notes（一半摘要，一半 5 条可执行策略），清空 history。使用 Anthropic prompt caching，`CostTracker` 按模型记 token 与费用。
- **欺骗/发现（EA 报告，Haiku 3.5 / Sonnet 4 / Opus 4，数十局，定性）**：邪恶队除非 prompt 里写明，否则不会协作（恶魔不分享 3 个未上场角色，间谍不分享魔典）；**groupthink**（一人幻觉出规则，三人原样采纳，包括在 extended thinking 里）；**「dead」一词让模型认为死人不能说话，改称 `ghost` 后修复**；Haiku 违规最多，Opus 4 才会推「未上场角色」。
- **可见性**：`_broadcast_info(sender, recipients, ...)` 向 recipients 的 `history` 追加 `Round N Phase P Message from X to [list]`，可见性完全由**调用点传入的 recipients 决定**，无中心规则/测试。
- **回放**：每事件一行 JSON（含全知 `game_state` 与 `public_game_state`），还有 pickle 检查点可从任意事件恢复。可视化器的 `GAME_FILES` 是硬编码的静态数组。
- **失败处理**：无效动作带异常文本重试 2 次，仍失败 → `NoAction`；投票失败 → NO。

**hmdurland/AI-on-the-Clocktower** — https://github.com/hmdurland/AI-on-the-Clocktower （`engine.py` ~8k 行）

- 座位顺序、每天 2 遍，提名与投票分阶段，`FAST_LLM_VOTING` 并行收票。
- 记忆：公开发言只带当天 + 前 2 天；模型输出 `<THINK>…</THINK><SAY>…</SAY>`，`THINK` 追加进「给自己的备忘」并在之后回灌（**无界增长**）；缺 `<SAY>` 时回退并打 WARNING，未闭合的 `<THINK>` 被剥掉以防泄漏。
- **作者自注 `KNOWN ERRORS`（engine.py 顶部）**：承认「很多其他玩家也可能得到不该得到的信息」（Courtier 泄漏）；`<THINK>` 里的「I'll pass」被正则当成了目标 Minstrel——**用自由文本解析动作的教训**。
- prompt 技巧：「只能声称剧本里有的角色」重复 3 次；反 bandwagon 段落；邪恶方「问问自己：我怎么会被抓到？」。推理模型会把输出预算耗在隐藏推理上，故强制最小输出 2048 token，并刻意不静默提升上限以免隐藏问题。
- 另含 `intel_tests/`：用真实日志场景回放对比候选模型的回归基准（内部细节 UNVERIFIED）。

**raphydaphy/clocktower-ai** — https://github.com/raphydaphy/clocktower-ai

- 随机选人发言（上一次 idle 的人被重掷，全员 idle 则结束）；动作菜单包含 `request_private_chat`（公开宣布请求与受邀者，内容私密）、`public_ability`（允许虚假 Slayer 射击）、`idle`；人类说书人每 6 条消息询问「继续/公告/开提名」。
- 输出为 JSON Schema，`action` 是**当前合法动作的 enum**，Zod 校验，失败重试后抛异常（崩溃）。
- 记忆：每人 `chatHistory` 全量重放，**自己的推理也留在上下文里**，无压缩。
- 问题：随机选人会让一人连续发言；无统一事件日志；重试耗尽即崩。

**npow/botc-ai** — https://github.com/npow/botc-ai

- **本质是脚本化模拟，LLM 只是把已决定的台词润色**（fire-and-forget，失败静默保留模板）。决策来自启发式。
- 值得学的是 **「lock-based」调度**：每个活人每个槽计算 urgency = 0.1 +（被点名 +0.6）+（对最可疑者的怀疑度）+（邪恶 +0.15）+（持有未公布夜间信息 +0.3）+（有未读 +0.1）+ 随机；**上一发言者的 urgency ×0.08 防独白**；连续 2 个槽最高 baseUrgency < 0.25 判定「讨论冷却」→ 进入提名；每人有读游标，prompt 只含「自你上次发言后的新消息」。
- 其 LLM 台词 prompt 有反 AI 腔技巧（禁用「logically」「data points」等口头禅，「刚有人发言时你在直接回应 TA，要点名」）。
- 私聊：**未发现真实实现**（仅 CSS 类），UNVERIFIED 以外可视为无。

**Clocktower Radio** — https://clocktower-radio.com/how-it-works.html （仅站点页；源码 UNVERIFIED）

- 单次调用/回合，状态按玩家视角转换；每阶段开头洗牌；原因是推理模型慢、实时会造成对话断裂。说书人是代码（骰子 + 启发式），如醉酒共情者「总是得到错数而非有时对」。
- 记忆：阈值触发压缩成固定大小 STM，每日末再压成 LTM。
- 「multiverse」脚手架：强制 CoT 考虑多种世界；站点称提升显著（站点自述，未独立验证）。
- 评测设计：两模型镜像对局（两局互换阵营、角色不变）去除角色运气；Bradley-Terry 评分；公开「$/局」与「tokens/行动」。

**其他**：[EthanQC/auto-dm](https://github.com/EthanQC/Blood-on-the-Clocktower-auto-dm)（Go，LLM 当说书人服务真人；README 有**按事件类型的可见性投影表**与事件溯源 `seq` 重连；源码未读）；[MilkyBoat/BoTC-AI](https://github.com/MilkyBoat/BoTC-AI)（内部 UNVERIFIED）；[Medium 手动 ChatGPT 实验](https://medium.com/@thelast19digitsofpi/chatgpt-plays-blood-on-the-clocktower-and-loses-to-the-vortox-day-1-04cf63f88e4f)：纯轮流发言出现大量「我同意大家」式回声，没人跳身份，恶魔未被质疑。

### 2.2 狼人杀 / Mafia

**google/werewolf_arena** — [论文](https://arxiv.org/abs/2407.13943)，[代码](https://github.com/google/werewolf_arena)

- 调度：`MAX_DEBATE_TURNS=8`；每次发言前对**除上一发言者外**的所有活人并行 `bid()`（0 观望 / 1 一般想法 / 2 具体批评 / 3 非常紧急 / **4 被直接点名必须回应**），取最高者；上句里被点名的最高 bidder 权重翻倍，随机选。论文称被点名者约 40% 出价 4。
- 记忆：`observations` 按轮分组**全量入 prompt**；每轮辩论后每人 `summarize()`（第一人称，「尽可能给每个人做笔记」）写回 observations。选项顺序随机化以抵消首/末位偏置。
- 失败：`lm.py` 重试 3 次且每次**升温 +0.2**；`game.py` 里 `bid/dialogue/vote is None` 直接 `raise ValueError`（整局失败）；`runner.py` 可从 `game_partial.json` 弹掉失败轮、清该轮 observations 后重跑。
- 成本：「synthetic votes」每句发言后全员模拟投票，是**每句 +N 次调用**的代价。
- 观战：`index.ts` 读 `game_logs.json`，可看私有推理/bid/vote/prompt；`LmLog(prompt, raw_resp, result)` 逐次调用落盘 = 全知视角「内心推理」的来源。
- 论文发现：GPT-4 狼用间接话术被认为「冗长」；Gemini 短句带情绪更像人；后期少人时有重复。

**Xu et al. 2309.04658** — [论文](https://arxiv.org/abs/2309.04658)，[代码](https://github.com/xuyuzhuang11/Werewolf)

- 记忆检索三视角：最近 K=15 条可见消息；启发式重要度（获得角色 5 / 有人淘汰 4 / 声称或点名角色 3 …）取 top；**问答式反思**（从固定问题池选 3 个自问自答）；另有跨局 experience pool（10–20 局有益，更多则不稳定，§4.3）。
- 可见性：`Message.visible_to`，`get_visible_messages_with_importance` 先过滤 `visible_to` 再选取。
- 问题：README 称超过 2 小时或 12 个游戏日的局会被丢弃以避免死循环；每次发言需 ≥3 次调用；论文未报告 token 成本（UNVERIFIED）；API 限速是实际瓶颈。

**foaster Werewolf-bench** — https://werewolf.foaster.ai/ ，[日志](https://github.com/Foaster-ai/Werewolf-bench)

- 每天 3 轮、每人每轮至多一次、先选 stance（defense > attack > analysis 优先）、可 pass；**每条公开发言配私有想法，并在每条消息前后记录各玩家 vote-intention**，用于「说服力」度量。
- 发现：**信息泄漏**（狼说出只有狼知道的夜间信息）是最常见败因；有模型表现出「策略性沉默」；能力呈阶梯式。成本：称「已很贵」，无数字。

**wolfcha** — https://github.com/oil-oil/wolfcha ，压缩设计文档：[`docs/context-compression-design-20260930.md`](https://github.com/oil-oil/wolfcha/blob/HEAD/docs/context-compression-design-20260930.md)

- **数据**（16 局 559 次发言请求）：第 4 天 prompt 中位 33,676 字，往日发言占 80%；发言长度从第 1 天 528 字涨到第 5 天 977 字；发言中约 40% 篇幅在复盘往日。
- **做法**：硬事实账本（票型/出局/夜间结果/警徽）由代码生成、永不裁剪；身份与技能声明段落正则钉住（43 条真实声明召回 43/43）；往日发言只留每次发言最后一段（本人最后两段）；当天全文；失败回退全文；说明文字写「只引用这里出现的原话」，**不写「其余已省略」**（会诱发编造）。
- **实测**（deepseek-v4.1-flash，8 局面 ×15 次）：输入 token 中位 21,595 → 9,949（-54%），事实错误 1.24 → 0.96，好人投中狼的比例未下降（40% vs 42%）。局限：单模型、中文、全 AI、3 局都在第 3–4 天结束。
- **发现**：全文也不准（第 3/4 天发言 78% 含至少一处事实出入）；模型写的摘要约每 3 份就有 1 处转述出入，且一旦写错就会作为「记录」发给之后所有玩家；「以今天为主」的 prompt 提示无效。
- **可见性**：`night-visibility.ts` 的 `resultsAnnounced` 标志（**结算 ≠ 公布**）；`GameEvent{visibility, visibleTo}`。
- **输出协议**：[`docs/单人上下文约束.md`](https://github.com/oil-oil/wolfcha/blob/HEAD/docs/%E5%8D%95%E4%BA%BA%E4%B8%8A%E4%B8%8B%E6%96%87%E7%BA%A6%E6%9D%9F.md) 记录真实故障（`messages` 包装被换成省略号、逗号分隔对象流、会话封套被当台词、未转义引号截断）；修复为只读公开字段、恢复一次、恢复耗尽则暂停并显示重试入口、**不把错误写成角色台词**、「HTTP 200 不等于解析成功」；每张票立即落库。
- 多人模式的压缩细节依据文档，源码未读（UNVERIFIED）。

**AgentScope werewolves** — [v1 示例](https://github.com/agentscope-ai/agentscope/blob/v1/examples/game/werewolves/README.md)，[Java HITL `EventVisibility`](https://github.com/agentscope-ai/agentscope-java/blob/1.x/agentscope-examples/documentation/werewolf-hitl/src/main/java/io/agentscope/examples/werewolf/web/EventVisibility.java)，[阿里云博客](https://www.alibabacloud.com/blog/what-my-werewolf-game-skills-are-worse-than-ais_602815)

- `MsgHub(participants)` = 参与者集合即可见集合；默认 `enable_auto_broadcast=False`，白天讨论前开、后立即关；狼夜聊独立 hub，上限 `3×n_wolves` 轮，仅在 `reach_agreement` 时提前结束；投票用 `fanout_pipeline` **并发**收集，再延后广播。
- 结构化输出：`Literal[tuple(names)]` 约束只能投活人；动机是「提示里说只回复号码，模型仍会夹带解释」。
- Java 版 `EventVisibility { PUBLIC, WEREWOLF_ONLY, SEER_ONLY, …, GOD_VIEW_ONLY }`；AI 投票解析失败只提示不重试。
- 无上下文压缩（ReAct memory 全量）。

**ai-werewolf** — https://github.com/JJJayden-Yang/ai-werewolf

- **可见性**：[`context/visibility_rules.py`](https://github.com/JJJayden-Yang/ai-werewolf/blob/HEAD/context/visibility_rules.py) 的 `VisibilityRuleSpec`——事件类型白名单（第一层）+ `Visibility` 枚举映射角色集合（第二层），「即使 `role_assigned` 被误标 public，第一层也能拦住」；转公开事件时丢弃 payload 里的系统字段（如 `fallback_used`）；`NIGHT_KILL_ANNOUNCED` 不进白天公开信息（平安夜不能反推刀口/救人）；真实身份只在 god-view 的 `role_map`，**不进任何 AgentContext**。
- **上下文预算**（`context_window_policy.py`）：9 人局每 agent ≤4000 token，`max_historical_speech_raw=0`（第 2 天起历史发言原文禁入 prompt），历史发言由 `speech_summarizer.py` 以**纯规则（无 LLM）**压成 Fact Stream 短句；超预算 `assert` fail-loud。
- **解析/兜底**：`ActionParser → ActionCanonicalizer（清洗 META_AI/COT_LEAK）→ RuleValidator → FallbackPolicy`，每个 phase 有硬编码合法兜底；LLM 重试仅在调用层（max 2），`retry_count/parse_error/llm_error` 写入决策 trace。
- **日志与回放**：`GameEvent{event_id, round, phase, event_type, actor, target, visibility, payload}`；`/games/{id}/events?since=` 返回全知流和 `next_cursor`；玩家端点经 `VisibilityRuleSpec` 过滤；观战页每 1500ms 轮询；回放含 belief 曲线与审计页。
- **局限**：权宜注释多；fallback 命中被计数而非阻止；历史发言压成 Fact Stream 会丢措辞与语气。

**AIWolf** — [协议页](https://aiwolf.org/en/protocol)，[NLP 服务器](https://github.com/aiwolfdial/aiwolf-nlp-server)，[2026 自然语言赛规则](https://aiwolfdial.github.io/aiwolf-nlp/en/menu/inlg_2026_en/regulation/)

- Protocol Division：每 turn 每人最多 1 条，turn 内顺序随机；每人每日 ≤10 条；全员 Over、全员连续 3 次 Skip 或 20 turn 后结束；`Skip` = 本回合不说，`Over` = 今天不再说；第 1 天不聊天。
- NLP 服务器配置示例（`default_5.yml`）：`per_agent: 4`、`per_day: 20`、单条长度上限 50（被点名 50）、`timeout.action 60s`、**`max_continue_error_ratio: 0.2`（连续出错比例超限踢出）**；`Info` 里含 `remain_count/remain_skip`；**服务器只发相对上次请求的增量历史**；阶段表可配置。
- `whisper` 仅狼，位置固定（白天投票后、袭击投票前）。2026 年有 Turn-Based 与 Speak-Anytime 两 track，`@Name` 前缀表示指向性发言。

**LLMafia / Time to Talk** — [论文](https://arxiv.org/abs/2506.05309)，[仓库](https://github.com/niveck/LLMafia)

- 无回合；每秒轮询聊天，**两次调用**：调度器只答 `<send>`/`<wait>`（≤6 token），仅 `<send>` 后才调生成器（「只写一句短话」「别重复自己」）。
- **防刷屏三层**：自己的发言占比 < 1/n 时 prompt 追加「让自己被听到」，否则追加「别刷屏，让别人说」；硬规则「本阶段没人说话前不开口」；按词数的模拟打字延迟。代码注释记录「被点名即回复」规则因「talks 过多」被删。
- 无记忆（每次全量时间戳聊天，无状态）；生成消息仍比真人长、可被分类。

**WOLF（LangGraph + 欺骗度量）** — https://github.com/MrinalA2009/WOLF-Werewolf-based-Observations-for-LLM-Deception-and-Falsehoods

- 0–10 bidding；每条发言后自评 + 其余每个活人并发 peer 评，指数平滑成怀疑度；约 3N 次调用/发言（我推算，作者未给数字）。
- 失败：解析失败被静默计为「不欺骗」，污染度量；`KNOWN_ISSUES.md` 列出 round 不递增等缺陷。

**ChatArena** — https://github.com/Farama-Foundation/chatarena `message.py`

- `Message.visible_to` + `get_visible_messages(agent, turn)` **只看更早 turn 的消息**（同 turn 内互不可见）+ Moderator 全可见；结束信号含随机 UUID 防被玩家利用；LLM 彻底失败 = 终止整局。官方仓库不含 werewolf。

**Mai0313/LLMWereWolf**（TUI，低价值）：顺序发言，异常吞掉；`Event.visible_to` 存在但实际只有预言家查验用了，其余靠分开的 Python 列表。

### 2.3 Avalon / Mafia 评测 / Among Us / Diplomacy

- **AvalonBench** [2310.05036](https://arxiv.org/abs/2310.05036)：有「Summary」「Discussion」步骤和把自由文本转合法动作的「Parse Prompt」；规则基线机器人用于校验引擎。
- **ReCon** [2310.01320](https://arxiv.org/abs/2310.01320)：发言前两阶段思考（推断他人想法 → 推断他人如何看我）；论文自己讨论了暴露私有信息与「隐藏思维欺骗」的局限。成本 ≥2 调用/发言（细节 UNVERIFIED）。
- **Mini-Mafia** [2509.23023](https://arxiv.org/abs/2509.23023)：4 人局，2 轮随机顺序发言，记忆 = 角色 + 自己的夜间事件；最小 prompt 与 8 轮讨论消融**不改变模型排名**。
- **MafiaScope** [2607.10645](https://arxiv.org/abs/2607.10645)：发言后对每个活人做**非侵入式**信念探针（在 message 列表副本上问，不回流游戏）；回放可从任意步 fork 重采样。
- **Auditing Belief-Conditioned Agents** [2607.10814](https://arxiv.org/abs/2607.10814)：每次决策由代码按 `f(H_public, H_private_i, S_visible, A_i)` 构造上下文并序列化为 JSON，agent 无法触及隐藏对象；输出经 parser → canonicalizer（拒绝角色泄漏/元 AI 用语/CoT 文本）→ 规则校验 → 安全合法动作兜底，全部失败可审计；并发 LLM 失败与兜底会扭曲策略对比。
- **Among Us** [2504.04072](https://arxiv.org/abs/2504.04072)：会议阶段 3 轮讨论后投票；每步输出 `[Condensed Memory] [Thinking Process] [Action]`，模型每步自己压缩记忆。
- **Sarkar et al.** [2502.06060](https://arxiv.org/abs/2502.06060)：训练向，轨迹长达数万 token；仅作「纯 prompt 系统必须摘要」的旁证。
- **AI Diplomacy** [仓库](https://github.com/GoodStartLabs/AI_Diplomacy)：`conduct_negotiations(max_rounds=3)`，每轮所有存活者**并发**一次调用（`asyncio.gather(return_exceptions=True)`），消息**轮末统一生效**；`last_sent_round/awaiting_reply` 防连发；失败计入 `model_error_stats` 并跳过该玩家，不卡死。私有日记最近 40 条 + 旧年份由便宜模型合并（保留背叛、转折点）。Three.js 3D 回放。成本数字 UNVERIFIED。
- **Cicero**（只借思想）：发言以计划动作为条件，`MAX_ATTEMPTS_GEN_VALID=5`，用分类器过滤无意义/重复消息；训练数据过滤 `phase_repeats`。
- **Generative Agents** [2304.03442](https://arxiv.org/abs/2304.03442)：记忆流 + 检索 + 反思，Werewolf Arena 沿用其思路；对于 ≤7 天的 BotC，嵌入检索看起来得不偿失（推断）。
- 复读/泄漏**未找到专门的事后总结文章**；相关证据都在上述论文与 foaster 站点内。Kaggle "Reading the Room" 页面 JS 渲染，内容 UNVERIFIED。

---

## 3. 对本项目的「借鉴」清单

### 3.1 白天讨论与私聊调度

1. **硬上限是唯一可靠的终止**：每天总发言预算 + 每人条数 + 每人每日私聊条数 + 步数保险丝（参考 werewolf_arena 8 轮、AIWolf 每人每日 10 条/20 turn、ai-werewolf `_MAX_PHASE_STEPS=1000`）。LLM 自报「达成共识」只能作为提前结束，不能是唯一出口。
2. **沉默是一等动作**：提供 `pass`（本回合不说）与 `over`（今天不再说），全员连续 pass / 全 over 提前结束（AIWolf `Skip/Over`；Sullivan 全员连续 pass 早结束）。prompt 里暴露**剩余配额**（AIWolf `remain_count/remain_skip`；Sullivan `remaining_action_rounds`）。
3. **每个座位保证首轮发言权**（werewolf_arena），之后用可选的低成本调度：
   - 方案 A（便宜）：每轮洗牌顺序 + 配额 + pass（Sullivan、Clocktower Radio）；
   - 方案 B（可信度更高）：两次调用分离——先一个 ≤8 token 的 `speak|pass` 决策，再仅对要发言者调生成（LLMafia）；或 0–4 bid，**4 = 被直接点名**（werewolf_arena）；
   - 方案 C（零额外调用）：npow 式规则 urgency（被点名/未读/手握夜间信息/刚发言者降权）+ 冷却检测。
     防独白：上一发言者降权（npow ×0.08；werewolf_arena 排除上一发言者）。
4. **发言占比反馈**：当某人发言占比 > 1/n 时给「让别人说」提示，反之给「让自己被听到」（LLMafia）。
5. **私聊 = 同一个消息动作的 `recipients[]` 子集**（Sullivan），不要另建一套 phase；私聊预算独立计数。
6. **私聊采用「轮」模型**：同一轮内各座位并发出牌，**轮末统一释放**，同一收件人未回复前不得再发给 TA（AI Diplomacy）；可选更保守的 BloodArena 方案（仅首日、一问一答）作为降成本档。
7. **投票/提名要同时收集再唱票**（AgentScope `fanout_pipeline`、ai-werewolf）；每张票立即落库（wolfcha）。
8. **选手单次调用要结构化**：JSON Schema/工具调用，`action` 为**当前合法动作的 enum**，目标名用 enum 限定（raphydaphy、AgentScope `Literal[names]`、Sullivan）。工具描述里明确「宣布提名 ≠ 提名」。
9. **反回声/反复读 prompt**：显式反 groupthink（hmdurland）；要求引用具体规则条文再下结论（Sullivan 建议，未验证）；「只引用已发生的原话」；「不要重复自己」+ 单条长度上限（LLMafia、AIWolf 50 字）；要求回应点名者（npow）。
10. **名词选择**：用 `ghost`（对应中文需选「亡魂」之类，别用「死者」暗示不能说话）——Sullivan 发现「dead」会让模型以为死人不能说话/不参与。
11. **邪恶队协作要显式支持**：不提示就几乎不会协作（Sullivan）；提供邪恶队密聊频道（BloodArena 的首夜邪恶密聊；BotC 首夜本就有爪牙/恶魔互认）。
12. **并发/时序**：同阶段内互不可见（ChatArena turn 隔离）；说话顺序不暗示信息优势时洗牌（Radio、Sullivan）。

### 3.2 选手上下文压缩

1. **分层 prompt（缓存友好）**：静态规则/角色表/身份 → 私有账本 → 动态状态 → 近期事件（Sullivan 缓存前缀；hmdurland 把玩家专属内容放最后；wolfcha 把角色私有信息放最前）。
2. **事实账本由代码从事件日志生成，永不裁剪**：票型、出局、夜间已公布结果、本座位获得的信息（真假都按「被告知」口径）、能力使用情况（wolfcha、ai-werewolf、Xu 的 informativeness 规则）。
3. **声明段落钉住**：身份/技能声明用规则钉住不删；代码对「声明」只带归属（谁说的），不升级为事实（wolfcha `buildDecisionGrounding`、Xu RL 论文的 facts vs potential truths 区分）。
4. **往日发言只删不改**：保留每次发言的最后一段原文；当天全文；失败回退全文；说明文字不写「其余已省略」（wolfcha 实测 -54% token、事实错误未增加）。
5. **增量游标**：每个座位记住已读到的 `seq`，prompt 只带新事件（BloodArena、npow `_lastReadIdx`、AIWolf 增量历史）。
6. **若要用 LLM 摘要，只作「本人私有笔记」，不进他人上下文**：日终由该选手自己的模型用阵营专属模板写策略总结，输入是**从权威日志重建**的历史而非它自己的对话（BloodArena）；每夜重写 notes（Sullivan）；也可用「最近 N 条原文 + 旧阶段由便宜模型合并」的日记（AI Diplomacy）。
7. **可观测**：记录每次调用的 prompt 字数/token、各段占比（hmdurland `LLM_INPUT_STATS`）、预算超限 fail-loud（ai-werewolf `assert`）；压缩验收照抄 wolfcha 的重放法（固定局面 × 多次采样，比较 token、事实错误、投票质量）。
8. **不要上嵌入检索与跨局经验池**：Xu 的经验池 10–20 局后不稳定；一局只有 ≤7 天（推断，Generative Agents 式检索得不偿失）。
9. 选手自己的**内心推理**不应整体回灌下一轮（raphydaphy 把推理留在上下文是无界增长的来源）；要保留的认知放进显式 notes 字段（hmdurland `<THINK>` 备忘，但需上限）。

### 3.3 事件可见性建模

1. **一份只追加事件日志，每个事件带显式可见性**，而不是调用点传 recipients（Sullivan/raphydaphy/werewolf_arena 的做法已被 hmdurland 自己承认会漏）。直播与回放均读它（ai-werewolf `events?since=cursor`；EthanQC 的 `seq` 重连）。
2. **一个集中的、无状态的投影函数**决定「某座位能看到什么」（ai-werewolf `VisibilityRuleSpec`；Auditing 论文的上下文构建边界）；选手上下文**只能**由该函数输出构成，真实身份只存在于全知投影，不进任何选手上下文。
3. **双层 fail-safe**：事件类型白名单 + 可见性枚举，任一层拒绝即不可见（ai-werewolf）。
4. **「真值事件」与「被告知内容」分开存**：醉酒/中毒/间谍/隐士使选手收到的信息 ≠ 真值（所有现有项目均未覆盖；BloodArena 的「信息审计」与 ai-werewolf 的 TruthState vs AgentContext 最接近）。观战端据此显示「此信息为假（因中毒）」。
5. **「结算 ≠ 公布」**：夜间结算与白天公布是不同事件，有显式 `announced` 时点（wolfcha `resultsAnnounced`）。内部刀口不进白天公开信息（ai-werewolf：平安夜不能反推刀口）。
6. **私聊内容私有、但存在可公开**：raphydaphy 把「X 请求与 Y 私聊」公开宣布；可作为可选规则，也可全私密（本项目需自行决定，这是产品决策而非调研结论）。
7. **同阶段互不可见**（ChatArena turn 隔离；AgentScope 投票前关闭广播）；同时行动的事件在阶段末才进入各座位视图。
8. **输出清洗**：发言文本经 canonicalizer 去除 CoT 泄漏/元 AI 用语（ai-werewolf、Auditing 论文）；由于 BotC 中「我是 X」是合法策略动作，不能用词表一刀切禁角色名（ai-werewolf 的 ROLE_LEAK 词表为空的原因）。
9. **泄漏测试**：对每种事件类型 × 每个座位断言可见/不可见（EthanQC README 的投影表 + 泄漏测试思路）；另用对局后离线扫描「发言里出现只有该阵营才知道的信息」（foaster 的 information slip 检测）。
10. **观战端**：全知视角 = 日志的另一种投影（Sullivan 的 `game_state` vs `public_game_state`、npow 的 `cls` 过滤、AgentScope-Java 的 `GOD_VIEW_ONLY`）；每条发言配私有想法（foaster）；每次调用存 `prompt/raw_response/result`（werewolf_arena `LmLog`、WOLF NDJSON）。

---

## 4. 本项目应「避开」清单

### 4.1 调度

- **纯随机或纯轮流**：出现回声/共识（Medium 实验；raphydaphy 随机选人能让一人连说多次；AIWolf 也避免纯随机因无社交理由）。
- **无上限循环**：Xu 实验因死循环/超长局而丢弃 2 小时或 12 天以上的局。
- **每句发言附带 N 次额外调用**（werewolf_arena synthetic votes；WOLF 约 3N 调用/发言；foaster 每条前后收集 vote-intention）——这类度量只能做**可选的离线/异步**功能，不得放在对局关键路径（MafiaScope 的非侵入式探针同理，仅作后续特性）。
- **墙钟轮询调度**（LLMafia）：不确定且不可复现，与「事件日志直播=回放」冲突；若借鉴，改为按 tick 的版本。
- **同步多轮私聊房间**（raphydaphy）：一组私聊会阻塞全局；可见时序也复杂。
- **让模型自报「该结束了」作为唯一终止**（AgentScope `reach_agreement` 仍有 3n 上限是对的）。
- **单人版简化掉邪恶队沟通**（wolfcha 狼聊被简化为「首狼决定」）：BotC 的爪牙/恶魔协作是关键玩法。

### 4.2 记忆与上下文

- **全量堆叠无预算**（werewolf_arena、LLMWereWolf、AgentScope、raphydaphy、hmdurland 的 `<THINK>` 备忘）。
- **让模型摘要进入他人上下文**：wolfcha 实测 ~1/3 摘要有转述错误且会扩散。
- **把规则压成 Fact Stream 丢掉语气**：ai-werewolf 的纯规则压缩会丢失措辞，而 BotC 的社交推理依赖措辞（本条是推断，未经实验）。
- **「以今天为主」式软提示**（wolfcha 实测无效）与「其余已省略」（诱发编造）。
- **让模型自由选保留哪些段落**（wolfcha：20 天中 10 天选了 80%+ 段落，不可靠）。
- **轻易改用小模型做摘要而不验证**：Sullivan 观察到 Haiku 违规最多。

### 4.3 可见性与稳健性

- **调用点手工传 recipients / 开关式 auto-broadcast**（Sullivan、AgentScope `set_auto_broadcast`、LLMWereWolf 只有一处用了 `visible_to`）。
- **靠 prompt 保密**（「你的投票不会公开」之类）。
- **用正则从自由文本解析动作**（hmdurland Courtier 误判）；`extractJson` 回退正则（BloodArena）可接受仅限发言，不可用于动作。
- **失败即整局崩溃**（werewolf_arena、raphydaphy）或**静默吞错变默认值**（BloodArena `catch(_){}`、WOLF 把解析失败记为「不欺骗」、LLMWereWolf 吞异常、AgentScope 仅警告）。需要：重试 → 合法兜底 → **兜底命中计数并写进事件日志/观战可见**；对失败座位可跳过本回合而非卡死（AI Diplomacy）；可借鉴 AIWolf 的「连续出错比例超限」硬规则。
- **把兜底输出渲染成角色台词**（wolfcha 的教训）。
- **失败重试升温**（werewolf_arena +0.2）：会让输出更不稳定，仅供参考，不推荐。
- **回放依赖重新推演而非日志**：fork 重采样需要引擎在线（MafiaScope），不是默认的回放形态。
- **轮询**（ai-werewolf 1.5s 轮询）：本项目是 Nitro 常驻进程，直接 SSE 推事件即可（自己决定，这里是建议）。
- **Jotai/localStorage 式前端持久化**（wolfcha）：不适合 append-only 事件日志。

### 4.4 说书人（附带发现）

- 说书人裁量应**返回 JSON + 有规则兜底 + 审计记录来源**（`llm | rule | fallback`、reason），BloodArena 已验证可行；Clocktower Radio 与 hmdurland 则用代码随机/启发式替代。
- **说书人 LLM 失败不能卡住对局**：兜底概率表（如间谍 70% 登记为好人）是现成模式，但本项目的兜底分布应由 TS 规则/说书人工单决定，这里不预设。

---

## 5. 未能核实 / 需要二次确认

- **Reddit 页面**（BotC 相关帖子）被反爬阻挡，仅用搜索摘要；**Clocktower Radio** 无源码，回放 UI 细节与可见性处理 UNVERIFIED；其「multiverse 提升显著」为站点自述。
- 未读源码：Sullivan visualizer 除 `types.ts` 外、raphydaphy 的 `cycle.ts/night.ts`、EthanQC Go 源码、MilkyBoat 机制细节、wolfcha 多人模式源码。
- npow/botc-ai 未发现真实玩家间私聊；其 urgency 数值来自子代理读 `botc-ai.html`，行号未复核。
- **数字待抽查**：wolfcha 的 -54% 与事实错误数来自其设计文档（单模型、中文、全 AI）；werewolf_arena 的 bid 统计（被点名者约 40% 出价 4、各模型发言次数）来自论文，未独立复算；Werewolf 笔记在上下文压缩后落笔，部分行级细节依据归档历史，未逐条回读源码。
- Xu 2309.04658 的 token 成本、experience score 公式；foaster 的 token 成本；AI Diplomacy 的美元成本与回放文件 schema；ReCon 的调用数；_Hidden in Plain Text_ 的框架细节；Kaggle "Reading the Room" 内容；Cicero Science 论文原文（403，改用仓库源码与项目页）——均 UNVERIFIED。
- 2026-07 的几篇 arXiv（MafiaScope 2607.10645、Auditing 2607.10814、ParliamentBench 2607.28146）本次仅读摘要/架构文档，结论可靠度低于已成熟的项目；ParliamentBench 未读。
- 本轮**未找到专门的复读/信息泄漏事后总结文章**，相关结论来自论文与 foaster 站点。
