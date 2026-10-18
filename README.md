# AI on the Clocktower

自部署、单用户的 web app：让不同的 LLM 互相对局《血染钟楼》暗流涌动（Trouble Brewing），并以上帝视角直播或回放整局。规则由代码执行，说书人裁量可逐项交给随机、说书人模型或你亲手决定。术语见 [GLOSSARY.md](GLOSSARY.md)，规格见 issue #16。

## 运行

需要 Node 24+。

```bash
npm install
cp .env.example .env     # 填入各提供商的 API key（只从环境变量读取，不入库）
npm run build
npm start                # http://127.0.0.1:3000
```

开发：`npm run dev`。数据存放在 `DATA_DIR`（默认 `.data/app.db`，SQLite）。

> [!WARNING]
> 应用没有鉴权，默认只监听 `127.0.0.1`。如需暴露到外网，请在反向代理上自行加鉴权。

## 使用

1. **模型**页：录入 OpenAI 兼容的 LLM 提供商（base URL、凭据环境变量名、超时、最大并发），再创建模型预设，可先做一次试调用。
2. **新建对局**：选座位数（5–15）、给每个座位指派预设、配置 14 项裁量来源和对局语言。
3. **观战**：直播或回放；可切换上帝 / 说书人 / N 号 / 仅公开视角，展开内心推理和落选决策；手动裁量会弹窗等待你选择。

## 结构

| 路径 | 内容 |
|---|---|
| `shared/rules/` | 规则模块（纯 TS，前后端共用）：事件类型、魔典与公共局面折叠、受众、合法候选、校验、`runGame` |
| `shared/templates/` | 中英事件文案 |
| `server/prompts/` | 选手与说书人的提示词和工具 |
| `server/utils/`、`server/api/` | 运行时（LLM 客户端、提供商信号量、重试、SQLite、SSE）与 HTTP API |
| `app/` | Nuxt 界面 |

## 测试

```bash
npm test          # 全部（应用缝测试会先构建一次再启动真实服务器和假提供商）
npm run test:app  # 仅应用缝
```
