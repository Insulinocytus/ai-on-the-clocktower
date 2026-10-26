# 弃用 shadcn-vue，基于 reka-ui 手写界面组件

界面改为围绕魔典与昼夜两套配色的定制视觉后，shadcn-vue 生成的组件只剩默认样式需要逐个覆盖，反而成了负担。我们删掉 shadcn-vue 及其配套（生成的 `ui/` 组件、`class-variance-authority`、`cn`、`tw-animate-css`、`@lucide/vue`），所有组件手写样式；交互逻辑仍交给无样式的 reka-ui（对话框焦点锁定、下拉选择键盘操作等），提示仍用 vue-sonner 的无样式模式，样式继续用 Tailwind 写。

## Considered Options

- **保留 shadcn-vue，只改主题变量**：改动最少，但组件结构与默认外观绑定，定制视觉要在每个组件上反复覆盖，被否决。
- **连 reka-ui 也不用，从零手写交互**：完全自主，但焦点管理、键盘操作、ARIA 语义容易写错且没有收益，被否决。

## Consequences

- 新增组件时不再运行 shadcn 生成命令，直接在自己的组件里组合 reka-ui 原语。
- 可访问性行为依赖 reka-ui，样式与视觉一致性由项目自己维护。
- 组件统一放在 `app/components/grimoire/`；配色直接使用 `tokens.css` 的语义变量，不保留旧组件主题别名或目录级检查豁免。
