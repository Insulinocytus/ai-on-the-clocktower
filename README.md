# AI on the Clocktower

让多个 LLM 互相对局《血染钟楼》（暗流涌动），供人类观战并比较模型表现的自部署、单用户 web app。术语见 [`GLOSSARY.md`](GLOSSARY.md)，整体规格见 [#16](https://github.com/Insulinocytus/ai-on-the-clocktower/issues/16)。

技术栈：Nuxt 4（Nitro 常驻进程）· SQLite（better-sqlite3，WAL）· shadcn-vue（Tailwind v4 + Reka UI）· `@nuxtjs/i18n` · Vitest。

界面由浏览器渲染（`ssr: false`），Nitro 常驻进程提供 API；目前不涉及 shadcn-vue 的 SSR hydration。

## 快速开始

需要 [mise](https://mise.jdx.dev/)：仓库根的 `mise.toml` 固定 Node 与 pnpm 版本。

```sh
mise install
pnpm install
cp .env.example .env   # 填入各提供商的 API key
pnpm dev               # http://127.0.0.1:3000
```

生产运行：

```sh
pnpm build
pnpm start             # 读取 .env，默认只监听 127.0.0.1:3000
```

可用环境变量见 [`.env.example`](.env.example)。数据库默认在 `.data/app.db`。

## 模型管理

在“模型”页录入：

- **LLM 提供商**：名称、OpenAI 兼容的 base URL、凭据环境变量名、单次调用超时（默认 300 秒）、最大并发（默认 5）。API key 只放在 `.env` 或进程环境里；数据库只存变量名，界面和接口只显示它是否已设置。
- **模型预设**：名称、所属提供商、模型名、是否允许强制 `tool_choice`、`extra_body`（JSON 对象，原样合并进每次请求，例如 `{"max_tokens": 4096}`）。
- **试调用**：用整局固定的六个工具和最小提示请求 `speak`，只将参数符合 schema 的单个 `speak` 调用判为合法，并展示原始响应；结果不存档。关闭弹窗会取消浏览器等待，迟到结果不会覆盖其他预设的试调用；已发送的上游请求仍可能执行到结束或提供商超时。

`extra_body` 不能覆盖 `temperature` 的禁用策略；预设不允许强制工具时，其中的 `tool_choice` 也不会下发。服务端诊断和提供商原始响应保留原文，界面控件支持中英切换。

## 对局与观战

在“对局”页新建对局，为 5 个座位分别选择模型预设（可以重复），再选择对局语言。缺少所用提供商凭据时，开局会被拒绝并列出环境变量名。种子由服务端生成，模型预设快照写入日志，之后修改预设不会改变旧对局。

当前是 #18 的曳光弹：角色池只有士兵、厨师、共情者、红唇女郎和小恶魔，固定 5 人，所有裁量随机。首夜分配角色并结算信息；白天只有黎明公告；其他夜晚由小恶魔选择目标，直到一方获胜。没有天数上限；小恶魔反复选择士兵或死者时，对局可能一直继续。

每次决策最多尝试 3 次，输出不合法与调用失败共用次数。不合法输出会立即重试，仅在请求末尾追加原始工具名、参数和对局语言的错误说明；失败尝试不产生游戏效果，也不更新备忘录。调用失败按 `Retry-After`（秒数或 HTTP 日期）等待；无有效值时退避 250、500 毫秒，原样重发。每次尝试分别记入决策事件；第 3 次仍失败才以座位号和最后一次错误终止对局。模型预设的试调用仍只发一次请求。

对局列表的状态由事件日志推出。打开运行中的对局进入直播，结束或终止的对局进入回放；事件按 seq 排列，使用界面语言渲染，决策可展开内心推理和原始响应。直播先订阅 SSE 再补齐历史，重连按 `Last-Event-ID` 续传并按 seq 去重。日志版本不兼容时禁止回放。

实现地图：

- `shared/types/game.ts`：事件、配置、魔典和 `Ports` 的共享契约。
- `shared/game/roles.ts`：22 个角色的官方双语名称、能力、夜序与提示标记。
- `shared/game/rules.ts`：纯 TS 规则脚本、种子随机数、配置校验、两个折叠与受众投影。
- `shared/event-templates.ts`：双语、按观察者人称渲染的事件模板。
- `shared/prompts/`：版本化双语规则块与无状态选手提示词。
- `server/utils/llm.ts`：OpenAI 兼容 Chat Completions 传输；`tools.ts`：固定工具与 schema 校验。
- `server/utils/game-runtime.ts`：每局异步任务、逐次决策日志、有限重试、随机裁量和失败终止。
- `server/utils/game-store.ts`：SQLite 只追加日志、日志状态与 SSE 订阅。
- `server/api/games/`：开局、列表、详情、投影事件与可续传 SSE。
- `app/pages/games/`：新建对局、列表、极简直播与回放。

HTTP：`POST /api/games` 接受 `{ presets: [id, id, id, id, id], language: "zh" | "en" }`；`GET /api/games` 与 `GET /api/games/:id` 返回日志派生摘要；`GET /api/games/:id/events?after=seq&observer=spectator` 返回事件；`GET /api/games/:id/stream` 为 SSE，参数相同，另支持 `Last-Event-ID`。观察者为 `spectator`、`storyteller`、`seat:1`–`seat:5` 或 `public`。

> [!WARNING]
> 本应用没有任何鉴权，默认只监听 `127.0.0.1`。如需暴露到外网，请自行在反向代理上加鉴权，再放宽 `HOST`。

## 开发

```sh
pnpm check   # prettier --check → nuxt typecheck → eslint → knip → vitest
pnpm format  # prettier --write
```

`pnpm install` 会通过 `simple-git-hooks` 安装 pre-commit hook，提交前自动跑 `pnpm check`；pull request 上 GitHub Actions 同样跑 `pnpm check`。

测试缝为规则和应用两处：`test/rules.test.ts` 用脚本化 `Ports` 驱动 `runGame` 并核对事件、折叠和逐格受众；应用测试用 `@nuxt/test-utils` 构建并启动整个应用，经 HTTP API 驱动。`test/fake-provider.ts` 是按脚本返回 tool call、非法输出、429 + Retry-After、5xx 或超时的本地假 OpenAI 兼容提供商；`test/games.test.ts` 包含整局烟雾测试。界面不写自动化测试。
