# AI on the Clocktower

让多个 LLM 互相对局《血染钟楼》（暗流涌动），供人类观战并比较模型表现的自部署、单用户 web app。术语见 [`GLOSSARY.md`](GLOSSARY.md)，整体规格见 [#16](https://github.com/Insulinocytus/ai-on-the-clocktower/issues/16)。

技术栈：Nuxt 4（Nitro 常驻进程）· SQLite（better-sqlite3，WAL）· shadcn-vue（Tailwind v4 + Reka UI）· `@nuxtjs/i18n` · Vitest。

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
- **试调用**：用整局固定的六个工具和最小提示发一次真实请求，显示是否得到合法的 tool call 以及原始响应，结果不存档。

> [!WARNING]
> 本应用没有任何鉴权，默认只监听 `127.0.0.1`。如需暴露到外网，请自行在反向代理上加鉴权，再放宽 `HOST`。

## 开发

```sh
pnpm check   # prettier --check → nuxt typecheck → eslint → knip → vitest
pnpm format  # prettier --write
```

`pnpm install` 会通过 `simple-git-hooks` 安装 pre-commit hook，提交前自动跑 `pnpm check`；pull request 上 GitHub Actions 同样跑 `pnpm check`。

测试走应用缝：`test/` 下用 `@nuxt/test-utils` 构建并启动整个应用，经 HTTP API 驱动；`test/fake-provider.ts` 是按脚本返回 tool call、非法输出、429 + Retry-After、5xx 或超时的本地假 OpenAI 兼容提供商。
