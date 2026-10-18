# OpenAI 兼容接口跨厂商能力核实

工单：#3（`wayfinder:research`），阻塞 #8（选手模型上下文与行动接口）、#9（对局配置）。
查阅日期：**2026-10**（各文档抓取于 2026-10-17）。来源均为官方文档；Ollama 的字段细节补充了官方仓库源码。
**本报告未做任何真实 API 调用**（无各家 key），所有结论是"文档说了什么"，不是实测；需要实测才能确认的点集中列在文末。

## 结论（先看这里）

1. **统一 OpenAI 兼容接口（base URL + key + 模型名）作为传输层够用，作为能力层不够。** 七家都能走 `/chat/completions` + SSE 流式 + function tools，但推理开关、推理内容字段、结构化输出模式、`tool_choice` 限制、历史消息回传规则各家都不同。需要一层**每个连接/模型一份的"能力档案（capability profile）"**，而不是为每家写原生 SDK 适配。
2. **没有任何一种结构化输出机制是七家通吃的。**
   - `json_schema`：OpenAI、Kimi、Ollama、Qwen（仅部分新模型）、OpenRouter（按端点）支持；**DeepSeek、GLM 不支持**（只有 `json_object`）；Claude 直连会**直接忽略** `response_format`。
   - tool calling：七家都支持，但 **OpenAI 最新模型在 Chat Completions 里带推理时不能用 tools**（须 Responses API），且 **DeepSeek / Qwen 思考模式拒绝强制 `tool_choice`、GLM 只支持 `auto`、Kimi K2.x 不支持 `required`、Claude 直连的最新几个模型（Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Mythos 5.1）强制调用会报错**，所以不能靠强制调用保证"一定返回结构"。
   - 结论：**以 tool calling（单个 `submit` 类函数，参数即 schema）作为跨厂商基线**，因为它是唯一在 DeepSeek / GLM / Claude 上也能携带 schema 的机制；`json_schema` 作为有能力的连接上的增强，OpenAI 新模型走 `json_schema`（不带 tools）；`json_object` + 提示词内嵌 schema 作为最后兜底。**无论哪种，都必须客户端校验（zod/ajv）+ 有限次重试**：除 OpenAI strict、Kimi strict（constrained decoding）、DeepSeek strict-tools（beta）外，其余都不保证 schema 符合。
3. **哪些必须原生适配（若要用到对应能力）：**
   - **OpenAI 新一代模型（GPT-6 Astra / 6.1 Sol；Sol/Luna 开推理时）**：要 tool calling 或推理摘要必须上 **Responses API**；只要结构化输出可用 Chat Completions + `json_schema` 避开 tools。
   - **Claude 直连**：兼容层官方定位为"用来测试"，`response_format`、`reasoning_effort`、`strict` 被忽略，思考内容不返回，system 消息被提升合并。要结构化输出/思考须用原生 Messages API，**或经 OpenRouter 路由**（OpenRouter 的 `reasoning` 参数文档覆盖 Claude，结构化输出文档把 Anthropic 列为支持方；具体端点是否可用仍需实测）。
   - **Gemini 直连**：兼容层仍标注 beta，思考要走 `extra_body.google.thinking_config`，Gemini 3 的 thought signature 需额外处理；经 OpenRouter 则统一为 `reasoning` / `reasoning_details`。非强制，但不如经 OpenRouter 省心。
   - DeepSeek / Qwen / Kimi / GLM / Ollama：**不需要原生适配**，但各自需要 `extra_body` 参数模板与响应字段解析（见矩阵）。
4. **"内心推理"（见 GLOSSARY）不要绑定到厂商的推理字段。** OpenAI（Chat Completions）不暴露原始推理，Claude 经 OpenRouter 只给**摘要**，Claude 直连不给。可移植的做法是把 `inner_reasoning` 作为行动 schema 里的一个普通字符串字段；厂商原生推理字段（`reasoning_content` / `reasoning` / `reasoning_details`）仅作为有则展示的附加物。这直接影响 #8。
5. **对 #9 的含义**：连接配置除 base URL / key / 模型名外，至少要存：结构化模式（`json_schema | tool | json_object | prompt`）、推理字段名、请求侧 `extra_body` 模板（如 `thinking` / `enable_thinking` / `reasoning`）、是否允许强制 `tool_choice`、采样参数是否被锁定。DeepSeek/Kimi/Claude/OpenAI 推理模式下 `temperature` 等被锁定或忽略，**配置里不应默认下发 `temperature`**。

## 能力矩阵

图例：✅ 文档明确支持；⚠️ 有条件/部分；❌ 文档明确不支持或被忽略；❓ 文档未说明。

### A. 结构化输出与 tool calling

| 厂商（Base URL）                                           | Chat Completions 兼容度              | `json_object`                                       | `json_schema`                                                                               | tool calling                                                                                      | 强制 `tool_choice`                                                                           | schema 是否强制                                                       |
| ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **OpenAI** `api.openai.com/v1`                             | 原生                                 | ✅                                                  | ✅（gpt-4o 起；根须为 object、全部字段 required、`additionalProperties:false`）             | ⚠️ GPT-6 Astra / 6.1 Sol：CC **不支持** tools；GPT-6 Sol/Luna 仅 `reasoning_effort:"none"` 时支持 | ✅（旧模型）                                                                                 | ✅ strict；CC 的 function 默认**非** strict                           |
| **DeepSeek** `api.deepseek.com`                            | 高（另有 Anthropic、Responses 格式） | ✅（须在提示词里要求 JSON，否则可能无限输出空白）   | ❌（仅 `text`/`json_object`）                                                               | ✅                                                                                                | ❌ 思考模式下 `required`/指定函数返回 400                                                    | tools 的 `strict` 为 **beta**（须 `base_url=…/beta`，且 schema 受限） |
| **Qwen** DashScope 兼容模式 `…/compatible-mode/v1`         | 高                                   | ✅（须含 "JSON" 字样；思考模式可能返回非严格 JSON） | ⚠️ 仅 Qwen3.7/3.8 的 Plus/Flash/Max 系列等部分模型                                          | ✅（含并行）                                                                                      | ❌ 思考模式下 `required`/指定函数报错；非思考模式 `required` 也不保证                        | json_schema + `strict:true` 时强制                                    |
| **Kimi** `api.moonshot.ai/v1`                              | 高                                   | ✅                                                  | ✅（`strict:true` 为 constrained decoding；K3、K2.7-code 稳，K2.6 复杂 schema 不稳）        | ✅                                                                                                | ⚠️ K3 `auto/none/required`；K2.6/K2.7-code **不支持 `required`**；可传函数对象               | json_schema strict 时强制                                             |
| **GLM** `open.bigmodel.cn/api/paas/v4/`                    | 中高                                 | ✅（仅文本模型）                                    | ❌                                                                                          | ✅（最多 128 个函数）                                                                             | ❌ **仅支持 `auto`**                                                                         | ❌                                                                    |
| **OpenRouter** `openrouter.ai/api/v1`                      | 高（统一并归一化各家）               | ❓（文档聚焦 json_schema）                          | ⚠️ **按端点**而非按模型；需 `provider.require_parameters:true` 才能避免被路由到不支持的端点 | ✅（原生支持的直传；其余转换为提示词模板）                                                        | ✅ `auto/none/指定函数`；其余受底层模型限制                                                  | 因端点而异：有的强制，有的当提示                                      |
| ↳ Claude 经 OpenRouter                                     | 同上                                 | ❓                                                  | ✅（OpenRouter 文档把 Anthropic 列为支持方）                                                | ✅                                                                                                | 受 Anthropic 限制                                                                            | Anthropic 结构化输出                                                  |
| ↳ Gemini 经 OpenRouter                                     | 同上                                 | ❓                                                  | ✅（文档把 Google 列为支持方）                                                              | ✅                                                                                                | —                                                                                            | Gemini 原生                                                           |
| **Ollama** `localhost:11434/v1/`                           | 中（取决于所载模型）                 | ✅（转为 `format:"json"`）                          | ✅（`schema` 作为 `format` 传给原生 API；`name`/`strict` 被丢弃）                           | ✅                                                                                                | ❓ 文档勾选 `tool_choice`，但源码请求结构体**无该字段**，[INFERENCE] 被忽略                  | 本地语法约束                                                          |
| _（补充）Claude 直连 `api.anthropic.com/v1/`_              | 低（官方定位为测试）                 | ❌ 忽略                                             | ❌ 忽略                                                                                     | ✅（`strict` 被忽略）                                                                             | ⚠️ 支持，但 Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Mythos 5.1 不支持强制调用并报错，须用 `auto` | ❌                                                                    |
| _（补充）Gemini 直连 `generativelanguage…/v1beta/openai/`_ | 中（beta）                           | ❓                                                  | ✅                                                                                          | ✅                                                                                                | ❓                                                                                           | Gemini 原生                                                           |

### B. 推理内容

| 厂商                   | 请求侧开关                                                                                                    | 响应字段（非流式 / 流式 delta）                                                                                                                                                                                                                       | 回传历史的要求                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **OpenAI**（CC）       | `reasoning_effort`（`none` 对 Astra/6.1 Sol 返回 400）；开推理时须去掉 `temperature`/`top_p`/`logprobs`       | **无推理文本**；只有 `usage…reasoning_tokens`。摘要仅 Responses API 的 `reasoning.summary`                                                                                                                                                            | 无                                                                                                        |
| **DeepSeek**           | `extra_body.thinking.type`=`enabled/disabled`（默认**开**）、`reasoning_effort`                               | `reasoning_content`，与 `content` 同级；流式 `delta.reasoning_content`                                                                                                                                                                                | 带 `tools` 的请求**必须**把此前所有 `reasoning_content` 原样回传，否则 **400**；无 `tools` 时传了也被忽略 |
| **Qwen**               | `extra_body.enable_thinking`（部分模型默认开）、`thinking_budget`                                             | `reasoning_content`；流式同名 delta                                                                                                                                                                                                                   | `preserve_thinking` 仅部分模型，可选；开启后计入输入 token                                                |
| **Kimi**               | K3 始终推理，顶层 `reasoning_effort`=`low/high/max`；K2.7-code 始终推理；K2.6 `thinking.type`/`thinking.keep` | `reasoning_content`；流式先出 `reasoning_content`，再出 `content`/`tool_calls`；OpenAI SDK 类型**未声明**该字段，需 `getattr`                                                                                                                         | K3、K2.7-code 要求把完整 assistant 消息（含 `reasoning_content`、`tool_calls`）原样回传                   |
| **GLM**                | `thinking.type`；`reasoning_effort`（GLM-5.2+）；GLM-5.3 **不能关闭**思考                                     | `reasoning_content`；流式同名 delta                                                                                                                                                                                                                   | "交错思考 + 工具"时**必须**保留并回传 reasoning content；`clear_thinking:false` 开启跨轮保留              |
| **OpenRouter**         | 统一 `reasoning:{effort｜max_tokens, exclude, enabled}`（`effort` 与 `max_tokens` 二选一）                    | 非流式 `message.reasoning`（字符串）+ `message.reasoning_details[]`；流式 `delta.reasoning_details`。类型 `reasoning.text / .summary / .encrypted`，`format` 标明来源（`anthropic-claude-v1`、`google-gemini-v1`…）。部分模型（如 OpenAI o 系）不返回 | 工具调用轮要原样回传 `reasoning_details`，不可重排/修改；`reasoning_content` 可作 `reasoning` 的别名传入  |
| ↳ Claude 经 OpenRouter | 同上；`max_tokens` 必须大于推理预算（预算最少 1024）                                                          | **摘要**（总结版），可见 token 少于计费的推理 token                                                                                                                                                                                                   | 同上                                                                                                      |
| ↳ Gemini 经 OpenRouter | `effort` 映射到 Google `thinkingLevel`，实际 token 由 Google 决定                                             | `reasoning_details`（`google-gemini-v1`）                                                                                                                                                                                                             | 同上                                                                                                      |
| **Ollama**             | `think`（原生）；兼容层 `reasoning_effort` / `reasoning.effort`，取值按模型用 `/api/show` 查询                | 字段名是 **`reasoning`**（不是 `reasoning_content`），流式 `delta.reasoning`（源码 `openai/openai.go`）                                                                                                                                               | ❓ 请求 `Message` 结构含 `reasoning` 字段，是否必须回传文档未说明                                         |
| _Claude 直连_          | `thinking` 参数可传                                                                                           | **不返回**思考内容                                                                                                                                                                                                                                    | —                                                                                                         |
| _Gemini 直连_          | `reasoning_effort`，或 `extra_body.google.thinking_config.{thinking_level,include_thoughts}`                  | 开 `include_thoughts` 后返回（字段形态文档未展开）                                                                                                                                                                                                    | Gemini 3 需带 thought signature                                                                           |

### C. 流式一致性

| 厂商                 | 与 OpenAI SSE 的差异 / 注意点                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI               | 基准。`stream_options.include_usage` 末尾带 usage。                                                                                                                            |
| DeepSeek             | `stream_options` 仅在 `stream:true` 时合法，否则 400；`delta.reasoning_content` 先于 `content`。                                                                               |
| Qwen                 | `include_usage` 同样可用；部分开源推理模型**只支持流式**，非流式调用会报错；DashScope 上的 GLM 模型要流式 tool_calls 须传 `tool_stream:true`（GLM-5.3 默认开）。               |
| Kimi                 | tool_calls 分片：同一调用 `index` 相同，`id`/`name` 仅首片出现，`arguments` 为 JSON 字符串分片需**追加**，流结束后再解析。                                                     |
| GLM                  | 要流式输出函数调用参数需 `tool_stream:true`（API 参考写默认 `false`，仅 GLM-5.3/5.2/5.1/5/5-Turbo/4.7/4.6 支持）。                                                             |
| OpenRouter           | 流里会出现 SSE 注释行（如 `: OPENROUTER PROCESSING`）必须跳过；**生成中途的错误**以普通 `data:` 事件、带 `error` 字段到达；末片带 usage；Response Healing 只对**非流式**生效。 |
| Ollama               | 支持 `include_usage`；tool_calls 由完整调用对象转换（源码 `ToToolCalls`），[INFERENCE] 不会出现 `arguments` 分片。                                                             |
| Claude / Gemini 直连 | `stream`、`stream_options` 支持；Claude 流里没有思考内容。                                                                                                                     |

## 逐家详情与已知坑

### OpenAI

- Chat Completions 与 Responses 都支持 `json_object` 与 `json_schema`（后者要求 gpt-4o-mini / gpt-4o-2024-08-06 及之后）。[Structured outputs](https://platform.openai.com/docs/guides/structured-outputs)
- 新旗舰对 CC 的限制：_"GPT-6 Astra and GPT-6.1 Sol support Chat Completions, but tool calling requires Responses. GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only with `reasoning_effort: "none"`."_ [Latest model](https://platform.openai.com/docs/guides/latest-model)；[Function calling](https://platform.openai.com/docs/guides/function-calling) 也说 GPT-6 Astra / 6.1 Sol 需要 Responses API 才能调工具。
- 推理：_"we don't expose the raw reasoning tokens"_，摘要通过 Responses 的 `reasoning.summary`；`reasoning_tokens` 在 usage 里。[Reasoning](https://platform.openai.com/docs/guides/reasoning)
- 坑：`reasoning_effort:"none"` 对 GPT-6 Astra / 6.1 Sol 返回 400，6.1 Sol 还不支持 `minimal`；推理开启时须去掉 `temperature`、`top_p`、`top_logprobs`、`logprobs`（CC）；CC 的 function 默认非 strict；strict schema 的限制（全字段 required、根不可 `anyOf`）。

### DeepSeek

- 模型名 `deepseek-flash`、`deepseek-v4-pro`。`response_format` 仅 `text`/`json_object`。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)
- JSON 模式：_"must also instruct the model to produce JSON yourself… Without this, the model may generate an unending stream of whitespace"_，并要合理设 `max_tokens` 防截断。[JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- 思考模式默认开启；`temperature`/`presence_penalty`/`frequency_penalty` 不报错但**无效**；`top_p` 行为随模型。**带 `tools` 的请求必须回传所有 `reasoning_content`，否则 400**（文档措辞是 _"even for turns where the model did not perform a tool call"_，具体覆盖多少历史轮次需实测）。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- `required` 与指定函数的 `tool_choice` 在思考模式下 400；strict tools 为 beta，要 `…/beta` base URL，所有对象属性须 `required` 且 `additionalProperties:false`，不支持 `minLength`/`maxLength`。[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- 近期变动：2026-09-10 `deepseek-v4-flash` 仅作兼容别名临时路由到 V4.1 Flash。[Change Log](https://api-docs.deepseek.com/updates)

### Qwen（DashScope 兼容模式）

- base URL 为**工作空间 ID + 地域**形式：`https://{WorkspaceId}.<region>.maas.aliyuncs.com/compatible-mode/v1`。文档里"Beijing"条目写成了 `ap-southeast-1`，而另一处示例写 `cn-beijing`，应以控制台为准。[OpenAI compatible](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- 结构化输出：`json_object` 覆盖大多数 Qwen 模型，须含 "JSON"，否则报错；`json_schema` 仅 Qwen3.7/3.8 的 Plus/Flash/Max 系列。文档同页对象表格写"only selected qwen-plus models"，与模型列表不一致，以列表为准。标注 "non-thinking mode" 的模型在思考模式下传 `json_object` 不报错，但可能返回非严格 JSON；官方给的兜底是"先思考模型出结果，再用 qwen-flash 修 JSON"。[Structured output](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
- 思考：`extra_body={"enable_thinking":True}`，内容在 `reasoning_content`；`thinking_budget` 限长；`preserve_thinking` 仅部分模型。[Deep thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)
- 工具：支持 `parallel_tool_calls`；_"Qwen series models do not support setting `tool_choice` to `required`"_，思考模式下 `required` 或指定函数对象直接报错 `The tool_choice parameter does not support being set to required or object in thinking mode`。[Function calling](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling)
- 该平台同时托管 DeepSeek / Kimi / GLM / MiniMax，且各自有额外要求（如 GLM 须 `tool_stream`）。

### Kimi（Moonshot）

- base URL `https://api.moonshot.ai/v1`。`json_schema` 需 `name` + `schema`，建议 `strict:true`（token 级 constrained decoding，schema 须符合其 MFJS 规范，可用 `walle` CLI 预检）；`anyOf/oneOf/$ref` 即使通过也可能不被严格遵守，要实调验证。K3 稳定，K2.7-code 最稳，**K2.6 复杂 schema 可能输出 Markdown 代码块、忽略 `oneOf`**。只解析 `message.content`，不要解析整个响应。[response_format](https://platform.moonshot.ai/docs/guide/response_format)
- 参数锁定：K3 / K2.7-code 的 `temperature` 固定 1.0，传其他值**报错**；`top_p=0.95`、`n=1` 固定。[Model parameter differences](https://platform.moonshot.ai/docs/api/models-overview)
- `tool_choice`：K3 支持 `auto/none/required`；K2.6/K2.7-code **不支持 `required`**。[Tool Choice](https://platform.moonshot.ai/docs/guide/use-tool-choice)
- 思考：`reasoning_content`；多轮与工具调用必须原样回传完整 assistant 消息；建议 `max_tokens ≥ 16000`。[Thinking Models](https://platform.moonshot.ai/docs/guide/use-thinking-models)、[Reasoning Effort](https://platform.moonshot.ai/docs/guide/use-reasoning-effort)
- 流式：见矩阵 C。[Streaming](https://platform.moonshot.ai/docs/guide/utilize-the-streaming-output-feature-of-kimi-api)

### GLM（智谱）

- base URL `https://open.bigmodel.cn/api/paas/v4/`，官方有 "OpenAI API 兼容" 页。[OpenAI API 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
- API 参考：`response_format.type` 只有 `text`、`json_object`（且"仅文本模型支持"）；`tool_choice` _"默认 `auto` 且仅支持 `auto`"_；函数上限 128；`tool_stream` 默认 `false`。[对话补全 API 参考](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8)；[结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)（只演示 JSON 模式，schema 靠系统提示词描述）。
- 思考：默认开；GLM-5.3 / 5.3-FLASH 传 `disabled` 会报错；`reasoning_effort` 为 GLM-5.2 及以上。[深度思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)
- "交错思考 + 工具"必须保留并回传 reasoning content；跨轮保留默认关（`clear_thinking:true`），需要时传 `false` 并完整、按序回传。[思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)
- 文档不一致：API 参考里 `reasoning_content` 的描述写"仅 glm-4.5 系列支持"，与深度思考页（GLM-5.x 均支持）冲突，视为过时描述。

### OpenRouter（含 Claude、Gemini 路由）

- 归一化 OpenAI Chat 形状；对原生不支持 tools 的提供方，**把 tools 转成 YAML 模板**让模型以文本回应（API 概览里的 schema 注释）。[API overview](https://openrouter.ai/docs/api/reference/overview)
- 结构化输出：按**端点**支持，默认路由策略下不支持某参数的提供方会收到请求但**静默忽略**；需 `provider.require_parameters:true` 才会只路由到支持者。`strict:true` 的执行强度因提供方而异，有的只当强提示。[Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)、[Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- Response Healing 只对非流式 `json_schema` 生效。[Response Healing](https://openrouter.ai/docs/guides/features/plugins/response-healing)
- 推理：见矩阵 B。另有坑：推理 token 与可见输出**共用 `max_tokens`**，预算太小会得到 `finish_reason:"length"` 且 `content` 为空。[Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)、[Parameters](https://openrouter.ai/docs/api/reference/parameters)
- tools 参数须**每次请求都带**（路由器要校验 schema）。[Tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- 流式：SSE 注释行与中途错误事件，见矩阵 C。[Streaming](https://openrouter.ai/docs/api/reference/streaming)

### Ollama

- base URL `http://localhost:11434/v1/`，`api_key` 必填但被忽略；云端直连用 `https://ollama.com/v1`。`/v1/chat/completions` 支持流式、JSON 模式、tools、推理控制、`response_format`、`stream_options.include_usage`。[OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)；[Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) 明确"通过 OpenAI 兼容 API 的 `response_format` 工作"。
- 源码核对（[`openai/openai.go`](https://github.com/ollama/ollama/blob/main/openai/openai.go)，该文件最近提交 2026-10-03）：`json_object`→`format:"json"`；`json_schema`→只取 `schema`；响应与流式 delta 的推理字段是 `reasoning`；`ChatCompletionRequest` 结构体里**没有** `tool_choice`、`n`、`user`、`logit_bias`，与文档勾选项不一致。
- 推理与 tools 是否可用**取决于所载模型**；推理可选值用 `/api/show` 的 `thinking.values` 查询。[Thinking](https://docs.ollama.com/capabilities/thinking)

### Claude 直连（补充，对应"必须原生适配"一问）

- [OpenAI SDK compatibility](https://docs.claude.com/en/api/openai-sdk)：`response_format`、`reasoning_effort`、`seed`、`logprobs` 等 **Ignored**；`strict` 被忽略，tool use JSON 不保证符合 schema；`tool_choice` 的 `"required"`/指定函数对 Claude Opus 5.5、Sonnet 5.5、Fable 5.1、Mythos 5.1 不支持并返回错误，须用 `"auto"`；_"the OpenAI SDK doesn't return Claude's thinking"_；system/developer 消息被提升并换行拼接；`n` 必须为 1；`temperature` 在 Claude 4.7+ 上低于 1 返回 400，`top_p` 非 0.99 返回 400；`usage.completion_tokens_details` 恒空。

### Gemini 直连（补充）

- [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)：base URL `https://generativelanguage.googleapis.com/v1beta/openai/`，页面写明支持库"仍在 beta"；`reasoning_effort` 映射到 `thinking_level`/`thinking_budget`，**Gemini 2.5 Pro 与 3 系列不能关闭思考**；返回思考需 `extra_body.google.thinking_config.include_thoughts`；Gemini 3 在 CC 里支持 thought signature；结构化输出用 `response_format`（官方示例用 Pydantic/zod 的 parse）。

## 对下游工单的建议输入

**#8（行动接口）**

- 每类行动一个 zod schema，统一用"单函数 tool + 校验重试"提交；`inner_reasoning` 作为 schema 字段，随行动一并产出。
- 不要用强制 `tool_choice` 保证返回结构；模型没调函数时按失败处理：重试，最后降级到 `json_object` + 提示词。
- 选手的 LLM 对话历史若用事件日志重建，要注意 DeepSeek（带 `tools` 时）、Kimi K3/K2.7-code、GLM（交错思考）、OpenRouter（工具轮）对**原始 assistant 消息（含推理字段）原样回传**的要求；两种取舍：(a) 每座位单独存原始消息链；(b) 每次行动做成无状态单轮请求，不回传 tool 轮。选哪种需在 #8 里定。
- 校验失败重试要预留 `max_tokens`：推理模型的推理 token 会占用上限（OpenRouter、Kimi 均有提示）。

**#9（对局配置）**

- 连接 = `baseUrl + apiKey + model` + 能力档案（字段见结论 5）。预设可附带"厂商模板"（DeepSeek、Qwen、Kimi、GLM、OpenRouter、Ollama 各一份默认 `extra_body` 与字段名）。
- Qwen 的 base URL 含工作空间 ID，Ollama 的 key 可为任意占位符，需在表单里区别对待。
- OpenRouter 连接默认开 `provider.require_parameters:true`，否则 `json_schema` / `tools` 可能被静默忽略；注意它会因路由改变实际服务的提供方。

## 未能核实 / 需实测的点

1. **全部为文档层面结论，没有真实调用。** 尤其 `json_schema` 在 Kimi（`anyOf/oneOf/$ref`）、Qwen、OpenRouter 各端点上的实际约束强度。
2. DeepSeek"带 `tools` 必须回传所有历史 `reasoning_content`"覆盖的轮次范围；若历史由事件日志重建、assistant 消息没有该字段，是否一律 400。
3. OpenRouter 对 `response_format:{type:"json_object"}` 的官方说明本次抓取的页面未覆盖（只核到 `json_schema`）。
4. Ollama 的 `tool_choice` 是否真被忽略（仅凭源码结构体推断）；Ollama 推理字段是否要求回传；各开源模型的 tools / thinking 可用性。
5. Gemini 直连的 `include_thoughts` 响应字段具体形态、对 `response_format: json_object` 的支持；官方 Gemini 结构化输出页未单独抓取。
6. OpenAI Chat Completions 在 GPT-6 系列上 `json_schema` 的行为：官方文档只说"CC 支持无 tools 的请求"，示例以 Responses 为主，未见 CC + `json_schema` + GPT-6 的明确陈述。
7. Qwen 地域 base URL 文档自相矛盾（见上）；Qwen 结构化输出页的"支持模型"标签页内容被扁平化，无法分辨 Kimi/GLM/DeepSeek 的条目对应 `json_object` 还是 `json_schema`，因此矩阵中这三家的 `json_schema` 以各自官方文档为准。
8. 其余各家 Responses API（DeepSeek、GLM、Ollama、OpenRouter 的导航里均出现）未评估，它们可能是绕开 OpenAI Chat Completions 限制的另一条统一路径，本工单范围外。
