# 提供商 Base URL 按各接口格式官方 SDK 的惯例填写

LLM 提供商的 Base URL 取该接口格式官方 SDK 接受的 base URL，用户可直接照抄各家文档：OpenAI Completions 与 OpenAI Responses 填到 `/v1`（如 `https://api.openai.com/v1`），由程序拼 `/chat/completions` 或 `/responses`；Anthropic Messages 只填 host 加前缀（如 `https://api.anthropic.com`、`https://openrouter.ai/api`），由程序拼 `/v1/messages`。

## Considered Options

- **所有格式统一填到 `/v1`**：规则一致，但 Anthropic 用户手里的 `ANTHROPIC_BASE_URL` 都不带 `/v1`，照抄必然 404，被否决。

## Consequences

- 同一网关在不同格式下的 Base URL 可能不同（OpenRouter：OpenAI 格式填 `…/api/v1`，Anthropic 格式填 `…/api`）。
- 本项目不为旧数据做兼容或迁移：按旧惯例存下的 Anthropic 提供商（以 `/v1` 结尾）会请求到 `/v1/v1/messages`，由用户自行改正。
