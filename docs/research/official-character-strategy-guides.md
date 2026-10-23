# 官方角色策略指南：来源、分发许可、规则差异与上下文体量

工单：[Insulinocytus/ai-on-the-clocktower#52](https://github.com/Insulinocytus/ai-on-the-clocktower/issues/52)  
调研日期：2026-10-22。范围为本仓库当前支持的暗流涌动 22 个角色，官方中英文各一页；不是自行编写或摘要的策略指南。

> 实施状态：维护者已在本次实施中确认具有覆盖既定用途的适用授权；实现据此收录官方全文，不把未核实的公开许可证标作 CC。第 1–5 节保留研究时的公开证据与计量口径，当前接入及实测见第 6 节。

## 0. 结论与交付边界

- **资料完整可定位：44/44 官方角色页成功取得实际 revision ID、UTC 时间及指定版本的渲染内容，无缺页、替代页或估算页。** 每页恰有两个策略二级章节；所有章节、内嵌例子与子列表均纳入计量。完整来源在第 2 节。
- **未核实官方 Wiki 文章正文采用 CC BY、CC BY-SA 或其他全文开放再分发许可。** 专项复查涵盖实际 HTML、许可元数据、版权/贡献提示、自定义公告及政策命名空间，不只依据空的 rightsinfo。发行商数字工具条款是另一层相关政策，不能替代 Wiki 文章内容许可证。第 1 节区分证据与法律适用边界。
- **策略与项目并非处处等价。** 固定的被当作状态、间谍魔典的信息边界、猎手行动窗口及交流调度会影响部分官方建议；原文应保持忠实，项目差异单独说明。详见第 3 节，不因此修改规则引擎或重写官方指南。
- **完整全文显著增加静态上下文。** 指定参考 tokenizer 的精确计数在第 4 节；它们不是所有模型的实际 token 用量，也不证明策略效果。
- **已完成选手提示词接入。** 固定版本的完整策略正文与来源位于 `shared/prompts/character-strategies.json`；所有选手按对局语言收到全部 22 个角色的指南，项目规则和交互差异独立列示。未改变规则引擎或说书人提示词的内容，未增加运行时联网。

## 1. 全文分发许可：证据与边界

以下为公开一手资料核查，不是最终法律意见。没有声称任何特定司法辖区一定构成侵权，也没有声称不存在项目已有的私下授权；本次未获得此类授权证明。

### Wiki 文章是否采用 CC：专项复查

**结论：本次无法确认两个官方 Wiki 的文章正文按 CC BY、CC BY-SA、CC BY-NC-SA、GFDL 或其他明确开放许可分发。** 这是“未找到可核实的明确授权”，不是“已证明不存在任何许可”或“禁止一切使用”。

- 两站的 [英文 rightsinfo](https://wiki.bloodontheclocktower.com/api.php?action=query&meta=siteinfo&siprop=rightsinfo&format=json) / [中文 rightsinfo](https://clocktower-wiki.gstonegames.com/api.php?action=query&meta=siteinfo&siprop=rightsinfo&format=json) 均明确返回 `{"url":"","text":""}`。这只证明该项公开配置没有许可名称/URL，不能单独排除其他位置的许可。
- 复查两站首页与洗衣妇页的实际完整 HTML：没有文章内容的 `rel="license"`、Creative Commons/GFDL 链接、版权许可图标或 rights 元数据。中文标准页脚虽然被隐藏，也已检查其内部内容，不是只看 reader 提取的可见段落。
- 两站的 [英文有效版权消息](https://wiki.bloodontheclocktower.com/api.php?action=query&meta=allmessages&ammessages=copyright%7Ccopyright-footer%7Ccopyrightwarning%7Ccopyrightwarning2%7Csitenotice%7Canonnotice&amlang=en&format=json) / [中文有效版权消息](https://clocktower-wiki.gstonegames.com/api.php?action=query&meta=allmessages&ammessages=copyright%7Ccopyrightwarning%7Ccopyrightwarning2%7Csitenotice%7Canonnotice&amlang=zh-cn&format=json) 也没有填入具体 CC 协议。`copyrightwarning` 中的 `$1/$2` 是未替换参数；`copyrightwarning2` 的贡献可编辑/再散布措辞没有给出 CC 名称或版本。不能把通用软件提示当成本站已发布 CC 授权。自定义版权提示/公告均未发现，普通自定义样式/导航也没有许可声明。
- 两站的政策命名空间完整枚举均为空：[英文 namespace 4](https://wiki.bloodontheclocktower.com/api.php?action=query&list=allpages&apnamespace=4&aplimit=500&format=json)、[中文 namespace 4](https://clocktower-wiki.gstonegames.com/api.php?action=query&list=allpages&apnamespace=4&aplimit=500&format=json)。实际页脚所连政策页及默认版权页也缺失，详见下方补查记录。定向站内/外 CC、Creative Commons、GFDL 检索未找到本站文章许可；索引结果不能证明穷尽全部历史或私下协议。
- 英文匿名源代码查看 GET 两次返回 HTTP 418，改用只读 revisions API；中文普通源代码查看 GET 返回 403，增加 `section=0` 后成功，页面只给出无编辑权限及可查看/复制源代码提示，没有 CC 名称或许可链接。没有登录或提交编辑，也没有把界面复制功能解释成全文公开再分发许可。
- **使用 MediaWiki 不代表文章自动采用 CC。** [MediaWiki 官方版权配置文档 rev7892532](https://www.mediawiki.org/w/index.php?title=Manual:Copyright&oldid=7892532)列明安装选项包含 `No license metadata`，文章许可由站点配置；MediaWiki 软件自身的 GPL 是另一回事。[RightsText 文档 rev7931312](https://www.mediawiki.org/w/index.php?title=Manual:$wgRightsText&oldid=7931312)的默认值为 `null`，说明了页脚文本与版权提示的用途。MediaWiki.org、Wikipedia 或其他百科自身的 CC 声明不能转授这两个官方站的文章。
- 一般法律背景：[WIPO 版权 FAQ](https://www.wipo.int/en/web/copyright/faq-copyright)说明多数国家版权自动产生，网上公开不等于进入公有领域；同时承认许可及法定例外。**[INFERENCE] 在未核实许可时，不能自行把这些全文标作 CC 并据此批准打包。** 本次未判断特定司法辖区的法定例外，也未核查私下合同或全部历史修订。

### 相关权利声明与发行商政策（不等于文章许可证）

| 一手来源                                                                                                                                                                                                                                                                                              | 直接观察                                                                                                       | 能支持的结论 / 不能推导的结论                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [英文 Wiki rightsinfo](https://wiki.bloodontheclocktower.com/api.php?action=query&meta=siteinfo&siprop=rightsinfo%7Cgeneral&format=json)、[中文 Wiki rightsinfo](https://clocktower-wiki.gstonegames.com/api.php?action=query&meta=siteinfo&siprop=rightsinfo%7Cgeneral&format=json)及实际角色页 HTML | 两站 `rightsinfo.url/text` 均为空；检查的页脚没有文本开放许可证                                                | 没有发现开放许可；空值本身既不是公有领域声明，也不是禁止一切使用的独立证据                                                      |
| [官方中文首页 rev5855](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%A6%96%E9%A1%B5&oldid=5855)，2026-01-26T11:51:39Z                                                                                                                                                                   | 自述官方中文资料站由集石独家运营维护，内容所有权归集石与 The Pandemonium Institute                             | 明确权利人声明，不是全文再分发许可；不能假设只需任意一方单独同意                                                                |
| [TPI Legal & Terms of Use，§4 Digital & Online](https://bloodontheclocktower.com/pages/terms-of-use)                                                                                                                                                                                                  | 允许个人创建电子工具；明确限制分享或分发包含其 IP 的工具，点名公开网站；公开数字版或关联工具包括其内容须获批准 | 存在直接相关的公开工具限制，不只是“未找到许可”。该段未逐名写 Wiki 策略文字；具体文字权属、项目归类、合同适用及法律例外仍需确认  |
| [TPI Community Created Content Policy](https://bloodontheclocktower.com/pages/community-created-content-policy) 的 Golden Rules、What You Can Do、TPI’s Rights、工具 FAQ                                                                                                                              | 鼓励符合条件的社区自制策略指南，限制冒充、商业化与竞争官方产品；明确说该政策不是 licence、不授予 IP 法律权利   | 鼓励自制指南不等于批准原样复制官方 44 份策略。该政策与 Legal §4 的细化/优先关系无明确说明，不应自行挑最宽松段落                 |
| [集石用户协议 §2 集石版权声明](https://www.gstonegames.com/about/agreement/)                                                                                                                                                                                                                          | 主站/应用内容未经明确书面特别授权不得转载、复制、发行、散布等                                                  | 说明集石的一般版权立场。正文点名 `www.gstonegames.com` 与应用，未观察到 Wiki 纳入该协议；不能直接宣称它已作为 Wiki 专属合同适用 |

### 检索补查及失败边界

- 英文页脚的 Privacy policy、About、General disclaimer，以及补查的 Copyrights，经[实际标题 API](https://wiki.bloodontheclocktower.com/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp&titles=Blood_on_the_Clocktower_Wiki:Privacy_policy%7CBlood_on_the_Clocktower_Wiki:About%7CBlood_on_the_Clocktower_Wiki:General_disclaimer%7CBlood_on_the_Clocktower_Wiki:Copyrights&format=json)均为 `missing`。中文真正的 project namespace 为 `Gs wiki`，其[隐私政策/关于/免责声明/版权](https://clocktower-wiki.gstonegames.com/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp&titles=Gs_wiki:%E9%9A%90%E7%A7%81%E6%94%BF%E7%AD%96%7CGs_wiki:%E5%85%B3%E4%BA%8E%7CGs_wiki:%E5%85%8D%E8%B4%A3%E5%A3%B0%E6%98%8E%7CGs_wiki:%E7%89%88%E6%9D%83&format=json)也均缺失。不存在的政策页不能当成已读到一份许可。
- 两站 project namespace 枚举为空，许可关键词搜索没有找到开放许可；站内索引和外部搜索不能证明穷尽所有协议。外部一次英文版权检索失败后，已换查询并用 API、HTML、发行商条款补查。
- [Creative, Copyright & Design Terms V1.1](https://bloodontheclocktower.com/pages/creativity-copyright-design-terms-version-1-1)针对自制角色/规则与创意提交，不是 Wiki 全文开放许可。[Online Terms of Use](https://bloodontheclocktower.com/pages/online-terms-of-use)可见最后修改日为 2026-06-18，针对官方软件 Service；不能无证据扩大到全部 Wiki 文字。[商店条款](https://bloodontheclocktower.com/policies/terms-of-service)也未被当成必然适用于独立 Wiki 子域的依据。
- TPI Legal、Community Policy 与集石协议是 2026-10-22 读取的现行网页，未发现可引用的不可变修订 ID或明确政策优先关系。不要给它们杜撰版本、生效日或跨子域效力。
- 公开可读、API 可请求、MediaWiki 软件开源、免费开源项目、注明出处、固定 revision 或去掉图片，均不自动提供策略文字的再分发许可。

### 发布门禁与可操作的下一步

**[INFERENCE] 建议：未确认权利许可前，不把完整策略正文提交公开仓库或打入可分发构建。** 这是本次公开全文打包的发布前置条件，不是对所有私人研究用途作禁令，也不等于最终法律判断。保持用户已确认的完整官方内容需求；不擅自改成摘要、自制指南、仅链接或运行时抓取来假装已经完成。

可通过上述官方政策提供的 `butler@thepandemoniuminstitute.com`、`storyteller@bloodontheclocktower.com`，以及中文首页的授权联系人 `jinjin@gstonegames.com` 询问。申请范围应明确：22 角色、两种官方语言、完整策略章节、固定旧版本、本地静态数据、公开源码/构建及下游再分发、第三方 LLM 提示词传输、是否商业使用、署名与保留旧版本条件。请确认谁能授权英文原文、中文译文及新增贡献内容；本次没有发送申请。

## 2. 全部 22 角色的双语来源与章节

角色范围来自 [`ROLES`](../../shared/game/roles.ts#L14-L298)：13 镇民、4 外来者、4 爪牙、1 恶魔；没有按本局是否在场或某个选手身份筛选。

每页的第一策略章节均为 **Tips & Tricks / 提示与技巧**；下表逐页列出第二策略章节的原名。善良角色使用 Bluffing as / 伪装成，邪恶角色使用 Fighting the / 对抗；不能另写源页面不存在的“伪装成邪恶角色”章节。酒鬼确有自己的伪装章节。所有 44 页均无策略内部 h3–h6 标题，但 16 页有嵌套列表，均保留。

下表字符为 Unicode 码点，不是“仅汉字数”，包含正文中的策略标题、列表符、缩进及规范化换行；不含每角色外层标题、页间分隔或现有提示词。全部为实测。固定链接本身同时给出来源站点和实际 revision ID。

### 英文官方 Wiki

| 角色（固定修订来源）                                                                                     | 修订时间 UTC         | 第二策略章节原名               | 字符数 | UTF-8 字节 |
| -------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------ | -----: | ---------: |
| [Washerwoman · 2630](https://wiki.bloodontheclocktower.com/index.php?title=Washerwoman&oldid=2630)       | 2024-12-08T15:02:41Z | Bluffing as the Washerwoman    |  7,117 |      7,119 |
| [Librarian · 1721](https://wiki.bloodontheclocktower.com/index.php?title=Librarian&oldid=1721)           | 2024-01-25T17:58:25Z | Bluffing as the Librarian      |  5,058 |      5,058 |
| [Investigator · 2983](https://wiki.bloodontheclocktower.com/index.php?title=Investigator&oldid=2983)     | 2025-11-19T16:04:44Z | Bluffing as the Investigator   |  5,068 |      5,068 |
| [Chef · 2510](https://wiki.bloodontheclocktower.com/index.php?title=Chef&oldid=2510)                     | 2024-11-03T13:16:55Z | Bluffing as the Chef           |  5,519 |      5,519 |
| [Empath · 1724](https://wiki.bloodontheclocktower.com/index.php?title=Empath&oldid=1724)                 | 2024-01-25T17:58:48Z | Bluffing as the Empath         |  4,696 |      4,696 |
| [Fortune Teller · 1887](https://wiki.bloodontheclocktower.com/index.php?title=Fortune_Teller&oldid=1887) | 2024-03-26T11:36:21Z | Bluffing as the Fortune Teller |  5,830 |      5,830 |
| [Undertaker · 2607](https://wiki.bloodontheclocktower.com/index.php?title=Undertaker&oldid=2607)         | 2024-12-06T09:07:34Z | Bluffing as the Undertaker     |  5,132 |      5,132 |
| [Monk · 3072](https://wiki.bloodontheclocktower.com/index.php?title=Monk&oldid=3072)                     | 2026-03-20T08:29:13Z | Bluffing as the Monk           |  5,442 |      5,442 |
| [Ravenkeeper · 3006](https://wiki.bloodontheclocktower.com/index.php?title=Ravenkeeper&oldid=3006)       | 2025-11-19T16:12:54Z | Bluffing as the Ravenkeeper    |  6,018 |      6,018 |
| [Virgin · 1729](https://wiki.bloodontheclocktower.com/index.php?title=Virgin&oldid=1729)                 | 2024-01-25T17:59:18Z | Bluffing as the Virgin         |  5,823 |      5,823 |
| [Slayer · 3011](https://wiki.bloodontheclocktower.com/index.php?title=Slayer&oldid=3011)                 | 2025-11-19T16:14:05Z | Bluffing as the Slayer         |  6,253 |      6,253 |
| [Soldier · 3012](https://wiki.bloodontheclocktower.com/index.php?title=Soldier&oldid=3012)               | 2025-11-19T16:14:18Z | Bluffing as the Soldier        |  4,963 |      4,963 |
| [Mayor · 2995](https://wiki.bloodontheclocktower.com/index.php?title=Mayor&oldid=2995)                   | 2025-11-19T16:08:36Z | Bluffing as the Mayor          |  3,729 |      3,729 |
| [Butler · 3098](https://wiki.bloodontheclocktower.com/index.php?title=Butler&oldid=3098)                 | 2026-04-02T14:52:22Z | Bluffing as the Butler         |  4,918 |      4,918 |
| [Drunk · 3110](https://wiki.bloodontheclocktower.com/index.php?title=Drunk&oldid=3110)                   | 2026-07-08T12:25:28Z | Bluffing as the Drunk          |  6,062 |      6,062 |
| [Recluse · 3007](https://wiki.bloodontheclocktower.com/index.php?title=Recluse&oldid=3007)               | 2025-11-19T16:13:04Z | Bluffing as the Recluse        |  4,353 |      4,353 |
| [Saint · 2603](https://wiki.bloodontheclocktower.com/index.php?title=Saint&oldid=2603)                   | 2024-12-06T09:06:43Z | Bluffing as the Saint          |  5,566 |      5,566 |
| [Poisoner · 1737](https://wiki.bloodontheclocktower.com/index.php?title=Poisoner&oldid=1737)             | 2024-01-25T18:00:05Z | Fighting the Poisoner          |  5,535 |      5,535 |
| [Spy · 3013](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3013)                       | 2025-11-19T16:14:35Z | Fighting the Spy               |  7,727 |      7,727 |
| [Scarlet Woman · 3010](https://wiki.bloodontheclocktower.com/index.php?title=Scarlet_Woman&oldid=3010)   | 2025-11-19T16:13:55Z | Fighting the Scarlet Woman     |  4,941 |      4,941 |
| [Baron · 2961](https://wiki.bloodontheclocktower.com/index.php?title=Baron&oldid=2961)                   | 2025-11-19T15:57:12Z | Fighting the Baron             |  6,253 |      6,253 |
| [Imp · 1741](https://wiki.bloodontheclocktower.com/index.php?title=Imp&oldid=1741)                       | 2024-01-25T18:00:32Z | Fighting the Imp               |  9,377 |      9,377 |

### 官方中文钟楼百科

| 角色（固定修订来源）                                                                                                                  | 修订时间 UTC         | 第二策略章节原名 | 字符数 | UTF-8 字节 |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | -----: | ---------: |
| [洗衣妇 · 2953](https://clocktower-wiki.gstonegames.com/index.php?title=%E6%B4%97%E8%A1%A3%E5%A6%87&oldid=2953)                       | 2023-04-10T12:35:55Z | 伪装成洗衣妇     |  2,042 |      5,954 |
| [图书管理员 · 6235](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%9B%BE%E4%B9%A6%E7%AE%A1%E7%90%86%E5%91%98&oldid=6235) | 2026-06-22T01:36:56Z | 伪装成图书管理员 |  1,433 |      4,151 |
| [调查员 · 6197](https://clocktower-wiki.gstonegames.com/index.php?title=%E8%B0%83%E6%9F%A5%E5%91%98&oldid=6197)                       | 2026-06-13T03:20:17Z | 伪装成调查员     |  1,458 |      4,232 |
| [厨师 · 2956](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%8E%A8%E5%B8%88&oldid=2956)                                  | 2023-04-10T12:38:50Z | 伪装成厨师       |  1,529 |      4,437 |
| [共情者 · 2957](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%85%B1%E6%83%85%E8%80%85&oldid=2957)                       | 2023-04-10T12:40:19Z | 伪装成共情者     |  1,419 |      4,007 |
| [占卜师 · 4355](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%8D%A0%E5%8D%9C%E5%B8%88&oldid=4355)                       | 2024-05-21T02:02:01Z | 伪装成占卜师     |  1,691 |      4,859 |
| [送葬者 · 6236](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%80%81%E8%91%AC%E8%80%85&oldid=6236)                       | 2026-06-22T01:37:58Z | 伪装成送葬者     |  1,454 |      4,212 |
| [僧侣 · 6470](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%83%A7%E4%BE%A3&oldid=6470)                                  | 2026-08-07T11:17:20Z | 伪装成僧侣       |  1,414 |      4,108 |
| [守鸦人 · 4870](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%AE%88%E9%B8%A6%E4%BA%BA&oldid=4870)                       | 2024-12-05T10:23:03Z | 伪装成守鸦人     |  1,781 |      5,137 |
| [贞洁者 · 4018](https://clocktower-wiki.gstonegames.com/index.php?title=%E8%B4%9E%E6%B4%81%E8%80%85&oldid=4018)                       | 2024-01-31T02:04:42Z | 伪装成贞洁者     |  1,600 |      4,610 |
| [猎手 · 6237](https://clocktower-wiki.gstonegames.com/index.php?title=%E7%8C%8E%E6%89%8B&oldid=6237)                                  | 2026-06-22T01:38:59Z | 伪装成猎手       |  1,566 |      4,516 |
| [士兵 · 6469](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%A3%AB%E5%85%B5&oldid=6469)                                  | 2026-08-07T11:17:19Z | 伪装成士兵       |  1,225 |      3,549 |
| [镇长 · 6239](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%95%87%E9%95%BF&oldid=6239)                                  | 2026-06-22T01:39:33Z | 伪装成镇长       |  1,176 |      3,406 |
| [管家 · 6063](https://clocktower-wiki.gstonegames.com/index.php?title=%E7%AE%A1%E5%AE%B6&oldid=6063)                                  | 2026-06-09T13:09:20Z | 伪装成管家       |  1,173 |      3,393 |
| [酒鬼 · 6433](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%85%92%E9%AC%BC&oldid=6433)                                  | 2026-07-20T10:16:40Z | 伪装成酒鬼       |  1,701 |      4,947 |
| [陌客 · 6246](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%99%8C%E5%AE%A2&oldid=6246)                                  | 2026-06-22T01:45:11Z | 伪装成陌客       |  1,221 |      3,543 |
| [圣徒 · 4886](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%9C%A3%E5%BE%92&oldid=4886)                                  | 2024-12-05T10:37:22Z | 伪装成圣徒       |  1,167 |      3,387 |
| [投毒者 · 5857](https://clocktower-wiki.gstonegames.com/index.php?title=%E6%8A%95%E6%AF%92%E8%80%85&oldid=5857)                       | 2026-01-28T08:16:17Z | 对抗投毒者       |  1,333 |      3,841 |
| [间谍 · 6248](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%97%B4%E8%B0%8D&oldid=6248)                                  | 2026-06-22T01:46:45Z | 对抗间谍         |  1,951 |      5,671 |
| [红唇女郎 · 6413](https://clocktower-wiki.gstonegames.com/index.php?title=%E7%BA%A2%E5%94%87%E5%A5%B3%E9%83%8E&oldid=6413)            | 2026-07-17T14:58:42Z | 对抗红唇女郎     |  1,580 |      4,594 |
| [男爵 · 6143](https://clocktower-wiki.gstonegames.com/index.php?title=%E7%94%B7%E7%88%B5&oldid=6143)                                  | 2026-06-13T02:43:00Z | 对抗男爵         |  1,869 |      5,443 |
| [小恶魔 · 6230](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%B0%8F%E6%81%B6%E9%AD%94&oldid=6230)                       | 2026-06-17T05:28:58Z | 对抗小恶魔       |  2,843 |      8,263 |

### 提取与冻结方法

1. 两站分别请求 `api.php?action=query&prop=revisions|info&inprop=url&rvprop=ids|timestamp|content&rvslots=main&format=json&titles=…`，取得实际修订编号、UTC 时间与源 wikitext；不是根据检索摘要推测 revision。
2. 每页再请求 `action=parse&oldid=<revid>&prop=text|sections|revid|displaytitle&format=json`。44 个 `parse.revid` 都与所选 revision 相同。
3. 选取完整的两段策略二级章节，直到下一个同级/更高非策略标题；保留章节内所有段落、子列表及例子。排除导航、背景故事、能力、Summary/角色简介、How to Run/运作方式、独立 Examples/范例、提示标记、规则细节、分类和编辑控件。
4. 使用渲染 HTML 的可见文本：链接保留显示文字，模板保留实际展开文字；标题写为 `## `，列表为 `- `，每层子列表缩进两个空格。保留原文拼写/建议，不翻译、不摘要、不纠错、不作项目适配。
5. 横向空白合并为单空格但保留列表缩进；去掉其余行首尾空白，连续三个以上换行合并为两个；LF、UTF-8 无 BOM，页末恰好一个 LF。长度为 `len(text)`、`len(text.encode('utf-8'))`。
6. 父会话对 44 页逐一验证角色/语言覆盖、长度、字节、SHA-256、revision 身份，并独立从源 HTML 选定章节拼接可见文字，与提取正文在忽略空白和新增 Markdown 标记后比对：**44/44 相符**。这证明本次观察文本保真，不是未来页面不会变化的保证。

**重要冻结限制：`oldid` 只固定页面修订，不自动固定其引用模板的历史修订。** 本次保存实际抓取时的指定 oldid 渲染结果、原始 wikitext 和 HTML。未来若只按 oldid 在线重渲染，模板更新可能改变显示；应在许可解决后使用已冻结的正文与内容哈希，而非承诺仅凭 oldid 永远逐字复现。

中英文站不必逐句一致。例如洗衣妇的英文策略允许公开询问或分别私聊，而该中文版本的对应建议不同；两边应各保留自己的官方内容，不互译、拼接或“修正”为统一版本。来源见上表洗衣妇两条固定链接。

## 3. 与项目规则、信息和交互契约的具体差异

本节主要是源码与官方原段落的静态交叉核查，重点覆盖间谍、陌客、小恶魔、红唇女郎、管家、猎手、洗衣妇、投毒者、酒鬼。**不是完整对局验证，也不声称穷尽所有策略的语义差异。** 下面把确定的实现事实与策略后果推断分开；不据此在本次研究中修改游戏规则。

| 差异                       | 官方依据（原章节或相关规则）                                                                                                                                                                                                                                                            | 当前源码证据                                                                                                                                                                                                                                                                                                | 结论与影响                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 固定被当作                 | [Spy](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3013) Tips & Tricks 要求让说书人知道自己的新伪装，以便送葬者结果配合；Summary/How to Run 与 [Recluse](https://wiki.bloodontheclocktower.com/index.php?title=Recluse&oldid=3007) Summary 明确逐次/同夜可不同。     | [rules.ts:766–787](../../shared/game/rules.ts#L766-L787)开局存下 registeredRole/registeredAlignment；[598–607](../../shared/game/rules.ts#L598-L607)之后读取固定值；[提示词:80–82](../../shared/prompts/rules.ts#L80-L82)明示整局固定。                                                                     | 高置信实现差异；[INFERENCE] 新伪装不能逐次获得对应的被当作裁量，除非恰好匹配开局固定值。                                               |
| 中毒间谍恒真魔典           | [间谍](https://clocktower-wiki.gstonegames.com/index.php?title=%E9%97%B4%E8%B0%8D&oldid=6248)“规则细节”允许中毒魔典为假；[Poisoner](https://wiki.bloodontheclocktower.com/index.php?title=Poisoner&oldid=1737)也说明中毒信息并非必假。                                                  | [rules.ts:992–1003](../../shared/game/rules.ts#L992-L1003)直接发送 state.seats/redHerring/bluffs，无 functioning 分支；[提示词:129](../../shared/prompts/rules.ts#L129)明确恒真。                                                                                                                           | 这是官方允许集合的收窄，不是“官方要求每次造假”。[INFERENCE] 本实现向间谍投毒不能破坏其魔典信息。                                       |
| 间谍情报边界不同           | [Spy](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3013) Tips & Tricks 要看洗衣妇/图书管理员提示标记；Fighting the Spy 与 [Washerwoman](https://wiki.bloodontheclocktower.com/index.php?title=Washerwoman&oldid=2630) Tips & Tricks 说间谍并不知道具体被显示的镇民。 | [rules.ts:946–1003](../../shared/game/rules.ts#L946-L1003)首夜信息未作为查验标记放入魔典；[SeatState:195–208](../../shared/types/game.ts#L195-L208)无这些字段；[模板:66–74](../../shared/event-templates.ts#L66-L74)、[252–253](../../shared/event-templates.ts#L252-L253)却会输出具体固定被当作角色/阵营。 | 高置信数据/渲染差异；[INFERENCE] 一方面缺查验提示标记，另一方面揭示固定的具体被当作角色。不要写成“间谍知道一切，因此一样”。            |
| 猎手行动窗口缩窄           | [Slayer](https://wiki.bloodontheclocktower.com/index.php?title=Slayer&oldid=3011) Tips & Tricks 允许白天任何时间，尤其临刑时补枪；也建议宣布后让大家讨论再选目标。                                                                                                                      | [验证:518–528](../../shared/game/rules.ts#L518-L528)只允许 free 发言携带 slayer_target；[公聊结算:1220–1248](../../shared/game/rules.ts#L1220-L1248)立即结算；[提名/辩护:1482–1505](../../shared/game/rules.ts#L1482-L1505)无射击窗口，随后[处决:1557–1562](../../shared/game/rules.ts#L1557-L1562)。       | 行动窗口差异已直接调用验证器确认；[INFERENCE] 提名后的临刑补枪无法照官方策略使用。可先前公聊讨论，但没有一次已宣布射击内部的讨论暂停。 |
| 交流、插话与响应受调度约束 | [Washerwoman](https://wiki.bloodontheclocktower.com/index.php?title=Washerwoman&oldid=2630)建议秘密结盟及互相辩护；[Spy](https://wiki.bloodontheclocktower.com/index.php?title=Spy&oldid=3013)建议多次私聊/公开暗号协调。                                                               | [提示词:67–75](../../shared/prompts/rules.ts#L67-L75)规定有限私聊、公聊再提名；[引擎:1151–1219](../../shared/game/rules.ts#L1151-L1219)每次只采纳一条且不能连续发言；[1482–1505](../../shared/game/rules.ts#L1482-L1505)提名时只有提名人和被提名者各一次。                                                  | 交互契约差异，不是禁止私聊或禁止邪恶沟通。[INFERENCE] 即时私聊、盟友临时插话辩护可能没有窗口，且受额度/房间分配影响。                  |

### 边界差异与不能误报的事项

- **管家非法票仍计并非规则漏洞。** [Butler](https://wiki.bloodontheclocktower.com/index.php?title=Butler&oldid=3098) How to Run、[管家](https://clocktower-wiki.gstonegames.com/index.php?title=%E7%AE%A1%E5%AE%B6&oldid=6063)规则细节均要求自律且误投仍计，本项目[提示词:92](../../shared/prompts/rules.ts#L92)、[计票:1512–1548](../../shared/game/rules.ts#L1512-L1548)相符。真正的观察限制是本接口逐人询问，只提供已发生的票；主人尚未轮到时，没有实体游戏中“已经提前举手”的同时状态。中文资料本身也承认线上轮盘计票困难，不能因此建议引擎强制拒票。
- **洗衣妇唯一镇民配置被项目排除。** [洗衣妇](https://clocktower-wiki.gstonegames.com/index.php?title=%E6%B4%97%E8%A1%A3%E5%A6%87&oldid=2953)规则细节允许极端情况下得知“自己与另一人之中有洗衣妇”；本项目[配置验证:129–131](../../shared/game/rules.ts#L129-L131)、[首夜候选:951](../../shared/game/rules.ts#L951)排除这一情况，并在[提示词:51](../../shared/prompts/rules.ts#L51)说明。这是配置约束收窄，不是官方禁止该配置，也不使正常二选一策略全部失效。
- **小恶魔不拥有选择继承人的保证。** [Imp](https://wiki.bloodontheclocktower.com/index.php?title=Imp&oldid=1741) How to Run 把选择交给说书人，项目[892–917](../../shared/game/rules.ts#L892-L917)的裁量与此一致；策略中希望传给特定爪牙不等于玩家有该参数。[Scarlet Woman](https://wiki.bloodontheclocktower.com/index.php?title=Scarlet_Woman&oldid=3010)的有效红唇女郎、死亡前五人门槛与优先继承也不应误报成差异。
- **六人及以下邪恶互不认识、没有恶魔伪装是官方小局规则。** [Imp](https://wiki.bloodontheclocktower.com/index.php?title=Imp&oldid=1741) Fighting the Imp 与[小恶魔](https://clocktower-wiki.gstonegames.com/index.php?title=%E5%B0%8F%E6%81%B6%E9%AD%94&oldid=6230)对抗小恶魔包含例外；项目[736–765](../../shared/game/rules.ts#L736-L765)、[1365–1390](../../shared/game/rules.ts#L1365-L1390)相符。其他官方策略的一般化“首夜知道恶魔”建议须结合人数条件，不是项目缺功能。
- **假猎手开枪已经支持。** [1220–1248](../../shared/game/rules.ts#L1220-L1248)为非真猎手产生不致死结果；不要错报只有真实猎手才能提交射击。[Slayer](https://wiki.bloodontheclocktower.com/index.php?title=Slayer&oldid=3011) Bluffing as the Slayer 的用途与此相符。
- **醉酒/中毒不是必须收到假信息。** [Drunk](https://wiki.bloodontheclocktower.com/index.php?title=Drunk&oldid=3110) Tips & Tricks、[Poisoner](https://wiki.bloodontheclocktower.com/index.php?title=Poisoner&oldid=1737) Fighting the Poisoner 都允许信息仍真；本项目[信息裁量:821–856](../../shared/game/rules.ts#L821-L856)及[受损候选:975–989](../../shared/game/rules.ts#L975-L989)没有要求必假。投毒者死亡/变成小恶魔时解毒[915–919](../../shared/game/rules.ts#L915-L919)，也有[投毒者](https://clocktower-wiki.gstonegames.com/index.php?title=%E6%8A%95%E6%AF%92%E8%80%85&oldid=5857)规则依据。
- 表情、流汗、实体魔典方向、提示说书人多展示一会等物理社交建议，不应被当成需要实现的规则功能。模型只能使用实际提供的文本事件和请求；保留官方原文但单独说明媒介限制即可。

### 本次实际执行的行为检查

使用 `bun --eval` 直接导入现有模块，未新增永久测试：

- 对同一个 `slayer_target=2` 发言调用 `validateSpeechChoice`：`free` 接受；`whisper`、`nomination`、`defense` 均返回 `invalid_slayer_target`。
- 给 `renderEvent` 一个真实形状的 `told/grimoire` 事件，含间谍的固定管家/善良被当作字段：实际输出包含 `registers as Butler` 与 `registers as good`。这验证渲染边界，不是跑过一整局间谍对局。

其余规则差异为源码/官方文档证据，不冒充实际引擎对局验证。

## 4. 文本体量与参考上下文增量

| 对局语言 | 文本范围                  |  字符数 | UTF-8 字节 | cl100k_base tokens | o200k_base tokens |
| -------- | ------------------------- | ------: | ---------: | -----------------: | ----------------: |
| 中文     | 现有 system 规则          |   4,023 |     11,137 |              4,629 |             3,231 |
| 中文     | 22 角色策略（含角色标题） |  34,814 |    100,564 |             40,527 |            26,198 |
| 中文     | 现有规则 + 策略           |  38,839 |    111,703 |             45,156 |            29,429 |
| 英文     | 现有 system 规则          |  11,530 |     11,586 |              2,498 |             2,477 |
| 英文     | 22 角色策略（含角色标题） | 125,670 |    125,672 |             27,218 |            26,870 |
| 英文     | 现有规则 + 策略           | 137,202 |    137,260 |             29,716 |            29,347 |

### 计量口径

- 研究期规则基线是接入前实际执行 `contestantSystem(language)` 的输出，默认 5 座位、speechLimit=10、whisperLimit=3；不是估算源代码字节数。当前实现见[提示词函数](../../shared/prompts/rules.ts#L142-L202)。
- 策略库按 `ROLES` 插入顺序组合每角色 `# {角色名}\n\n{完整策略正文}`，块间以 `\n\n` 连接；“现有规则 + 策略”为 `contestantSystem + '\n\n' + 策略库`。此为测量约定，不是已经接入功能。页正文末尾的 LF 保留。
- 使用仓库外隔离环境中的 Python 3.12.11 / `tiktoken 0.14.0`，对完整字符串分别用 `cl100k_base`、`o200k_base` 编码并计数。上表对这些明确 tokenizer 是精确值；作为未来实际模型 token 量的参考估计，不能套用于所有提供商。没有安装项目依赖或更改锁文件。
- “策略”行包含角色外层标题及页间分隔，因而与第 2 节逐页正文相加的字符/字节数不同。未加入将来的来源元数据、项目差异说明、其他包装文字或 API 消息封装。
- 未计入对局事件、选手身份/本次请求、带入的决策、工具定义、重试提示、输出预留或提供商私有封装。实际单次调用会更长。中英文是二选一，不是把两种全文同时发给每位选手。

### 工程影响（推断，非已实现功能）

- [`buildContestantPrompt`](../../shared/prompts/contestant.ts#L146-L164)每次决策加入 system 文本，并另带事件/决策历史；[浏览器对局 runner](../../app/api/game-runner.ts)对每次选手请求重新构建提示词。若按该位置注入固定全文，每次相关调用都会携带策略静态前缀，不能把体积理解为“每局只付一次”。
- [LLM 请求组装](../../app/api/llm.ts)发送实际 messages 与 tools；提供商返回的 usage 由[浏览器对局 runner](../../app/api/game-runner.ts)记录。没有为本报告发送真实模型请求，因此没有账单、延迟、缓存命中率或实际供应商 usage 结论。
- 32,768-token 窗口下，中文 `cl100k_base` 参考静态文本已超窗；另外三种语言/参考编码组合的静态文本也接近 30k，再加历史、工具与输出预留可能超限。真实兼容性必须用所选模型 tokenizer/窗口判断，不能笼统保证“32k 可用”。
- 固定前缀是否缓存、如何计费取决于提供商。不要未经实测承诺缓存会抵消全文成本，也不要为压缩而悄悄改为摘要/按角色筛选。

## 5. 验证记录、复核入口与未做事项

已完成的观察/执行：44 页官方 API 及指定修订渲染成功；revision 一致性、角色/语言覆盖、字符/字节/SHA-256 全量核对；44 页独立 DOM 可见正文对比；实际生成中英文规则基线；两种参考 tokenizer 全文计数；猎手验证器与魔典渲染边界直接调用。公开条款及关键间谍/猎手页面已交叉复读。

本报告是唯一新增仓库研究文件。中间研究备忘、指标及原文均不作为产品内容提交：

- 会话指标：`local://issue52-guide-metrics.json`（44 页来源、revision/UTC、标题、长度、内容 SHA-256），`local://issue52-context-measurements.json`（参考 tokenizer 计数），`local://issue52-prompt-baseline.json`（本次实际生成基线）。这些是会话内部复核入口，不保证离开本会话仍可访问。
- 仓库外临时目录：`C:/Users/NAGASE~1/AppData/Local/temp/issue52-official-guides-sbhgzj3m/`；含 `{en|zh}-{role_id}-strategy.txt`、同角色 `.wikitext`、`.html` 与查询元数据。临时目录可能被系统清理，不是已经获准随仓库分发的内容库。
- 逐页哈希清单见下，哈希对象为第 2 节规范化后的实际 UTF-8 策略正文，不含角色外层标题。它们不包含或编码策略全文。

| 角色 id         | 英文 SHA-256                                                       | 中文 SHA-256                                                       |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `washerwoman`   | `95ebdff3ce5250f24170bfa896c84b0ecca941afad1936263d4b53d60bbb3861` | `71c0b1e11b60971c9d3ccd94c927e463441b633fc4e497369aeb2f6cbd36d57b` |
| `librarian`     | `23004e4befb438749667fa7894e3b7938ab8016a94b8425a9bbbbd67c3bf612b` | `3085375485f624d7aa447289dff364f68096fc6e5572e170b36592095684a22f` |
| `investigator`  | `db246457df2f22434533e689ced985ccb61b9dfb584038827844ad2c2f61ebf5` | `9aa09c984eb549259a57ad90c61869201dd59a12dfb13ba7140d15ee340a4870` |
| `chef`          | `a7ddd6c1b44d5d81536dd1c51c906afc61ad61882099bee60be777eeed39e99a` | `03357cfa572facc21ef6fbc53be4f484a3e7e4ee6bcba416501f2b3f7b9dc3ee` |
| `empath`        | `0ef729dfc9e164a24eba8bb89e2bbdfcf54c3cc0669c59b11a941e1081a3414e` | `fb02852d90108698651c3295fa214ccf6f7c62061240e3f2ea71fb699248e94d` |
| `fortuneteller` | `793eff4d7df4d85e61759051a96eac7b51f2cff9cf406c05212791b10e02c245` | `569135a1a28ae57007edcb4fb7ba13603be5bc2d68c79a8c75882ffe2a8da56c` |
| `undertaker`    | `372f7dfb5073bb44ca75f2ecf1fe23a2f24a295c483991dbe7f877af15998d6b` | `d80b00f2a61ea105fc1db8723932ba9c1f802a8479fd9323bf0fee88a0428dd1` |
| `monk`          | `ac75d10626ba5e226447231352a8f99f0f654892bf9f05bf60af72ca6ef62ce7` | `fce17aee003aa613508aed297768bc6d12fa9fac7c5822f31b5cfcdea03c4586` |
| `ravenkeeper`   | `e64988aa392e0709a9adc1fbeedfc3e1ddaffa2fb8db8a51b0a622065b979ba9` | `594b7b9f7c7652b4b5373096fbf5c3889adc1d572d48291bbd1e71e2f3f5abea` |
| `virgin`        | `71632e9e4432f54c9b557d229e3b706588abbeae98a621ff8f26e120ee1051d4` | `f707f86560a2288bd540935ebf30a0d32aa2df2fc71e548c3e85b78ff207fe91` |
| `slayer`        | `f07f68c17b75ec41a0ec1a520bec8106c22e25333547d0efd1016aa97ea72a32` | `8fd38710f8f28d4dcd1aaf3c5e782c884b57863b1f0b18bcf7192c9eb90ee6d0` |
| `soldier`       | `3d83640da3389ec8f9f0072c74e51b19a8d7dd9a3a3a34ba24ba71990ff63a4f` | `edfa411ecad459a6d45ef4001ba624357d84372306497ca9f041cf0858f5b1dc` |
| `mayor`         | `379d0c17066a09f8eb826dd4e455bb897682930043254f52f7b6d6fc4fb1aa1e` | `b9141f5f735abe4c21986ff9054d82f3cf7da9f2a4bf1b3edccf80816cd40867` |
| `butler`        | `0005e48703ca6861e4fed6f796e2f100d544167b88e4284cff84666dbdc1c559` | `9563af0e6bfb2322028d65ea8756a2dbc4a2819323fc193181a4989ec8dae459` |
| `drunk`         | `2eeae5142391038d93ce256d1873ac390b228a6d8423505e036346108d9fd923` | `86f990b37e9bebb249f5c1687ff2eb4376f4d40c080f18cf8f440fdd7069cdf1` |
| `recluse`       | `7a84e227157d1f5fa183825b34f8bcad7d16c6b62483229881538fd23769ff49` | `3bb380aaacfdc7bd63dbfe8a4d59b2808b9fca58ecbf41c4a82311c8ffe182bc` |
| `saint`         | `19467a9a96518b4874767bcb5eff4cb7ab7b1d498342b7ddf680da11948224ac` | `77e28d7b25df7b273d8156c1578282a923f44092d48d895c82136c9ef2958725` |
| `poisoner`      | `54e8087d283766325fb0fb1f2e5e00f03533ac230616c0bea25968fa55fe0a49` | `779a474cefc6c9f04de9cc68f82c8c726d5b3a98fd8a72b46db0920d386ff5b5` |
| `spy`           | `f3131a5d6330152f0d63894b65a19e915e4c5653ac0c67b96831fe1ef87a9021` | `bb67dfc2fa7254d04d3db25823833ecf576404cb5ce44256d3b7762edae10781` |
| `scarletwoman`  | `2c857aacd5fe9fb9bbf3fa57c0a6d3b24944805fe27602d438b776a5c047dd99` | `bcceb392caba13cd44a1f9e2a012bf0af9deeaf1a3df17d86a03c9999c27e98c` |
| `baron`         | `3084e09f722536008b268454276fc81992c3357d173001fc00c5f34e1f95a147` | `ced93c798e319f2904be8f342bf9a964b57f0e521d6a698f9680d322c52d7f99` |
| `imp`           | `bc35583d367845ee12974ac24d0d61a91f189d5a18e3ae9d76d59115527eb506` | `a8a2f090bb1e1ca17e93b1d376344efbd4bc5878c2ab8dca375cbdeaf369456f` |

研究阶段未做：没有修改提示词/引擎，没有永久测试、构建、lint 或格式化；没有实际 LLM 对局、胜率评估或权利人联系。实施后的变化与验证见第 6 节。

研究时的授权风险：未找到可核实的公开全文许可，现行网页政策优先关系及其对 Wiki 的合同适用范围未确认；维护者在实施时另行确认已有适用授权。固定页 revision 不固定模板历史，策略原文不能自动适用于本项目所有机制；参考 token 计数不保证任意模型的窗口、费用或表现。

## 6. 实施记录

### 内容与接入

- `shared/prompts/character-strategies.json` 按 `zh` / `en` 和已有角色 id 保存 44 份完整策略；每份包含固定 `oldid` 的官方来源链接与正规化正文。正文逐份匹配第 5 节 SHA-256，不翻译、摘要或为兼容而改写。
- `shared/prompts/rules.ts` 在模块加载时组合两种语言的策略块；`contestantSystem` 为每个选手决策注入对应语言的全角色策略，而不是按当前角色或本局在场角色筛选。原 `rulesBlock` 保持不变，说书人仍只收到原有规则内容。
- 官方正文之外，独立说明通用建议不能作为本局角色分配或身份铁证，并列出固定被当作、间谍魔典、猎手窗口、交流调度、管家观察、洗衣妇配置与实体媒介等项目差异；后续工具及请求限制优先。
- 没有新增依赖、配置、运行时抓取或自动更新。更新资料时应按第 2 节方法取得新的固定修订，替换对应的来源与完整正文，并同步本报告的修订、时间、大小及哈希；不得只改官方策略中的某句话来适配项目。

### 最终静态上下文实测

以下是实际调用接入后的默认 `contestantSystem(language)`，包含固定来源链接、完整策略、项目差异和原有规则；不含对局历史、请求、工具定义或输出预留。与第 4 节的研究期组合约定不同，不能用旧表冒充最终大小。

| 对局语言 | Unicode 字符 | UTF-8 字节 | cl100k_base tokens | o200k_base tokens |
| -------- | -----------: | ---------: | -----------------: | ----------------: |
| 中文     |       41,493 |    115,543 |             46,713 |            30,762 |
| 英文     |      141,123 |    141,181 |             30,682 |            30,316 |

计量仍使用 Python 3.12.11 / tiktoken 0.14.0。每次请求还会加入其他上下文；32k 窗口可能不足，不能承诺缓存、费用或胜率收益。

### 行为验证

在既有 `buildContestantPrompt` 公开边界执行仓库外断言脚本：修改前因缺少洗衣妇完整策略失败；修改后中英各 15 座位 × 9 种请求变体，共 270 次实际提示词构建通过。逐份核对 22 角色完整正文、固定来源链接、对局语言隔离，以及其他座位私密推理不会泄露；同时确认 `rulesBlock` 没有加入选手策略。未保留复制正文或钉死措辞的永久测试，未运行付费模型或声称模型表现改善。

验证结果：`mise run typecheck` 通过；准备好 Nuxt 类型文件后，`vitest run test/prompts.test.ts` 为 10/10 通过；最终 `mise run check` 的类型、lint、Prettier、knip 均通过，完整测试为 5 个文件、488/488 通过。首次单文件测试与 Nuxt 类型准备并发启动，曾因 `.nuxt/tsconfig.app.json` 尚未生成而无法收集测试；完成准备后按序执行通过，未修改项目配置规避错误。
