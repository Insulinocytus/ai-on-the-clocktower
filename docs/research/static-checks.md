# 静态检查门禁调研

工单：#45“添加静态检查作为门禁”；供 #17 从零搭建骨架以及后续决策访谈（grill）使用。
查阅日期：**2026-10-18**。来源限官方文档、官方源码/发布记录和 npm Registry；下面的版本均为本次抓取值，不由日期或项目规划反推。
**本报告没有安装依赖、创建项目配置或运行 lint/typecheck/test/CI**；配置片段是依据文档与源码组合的接线示意，不是本仓库验证过的配置。项目尚无 Nuxt 骨架，组合在真实项目上的耗时、误报数量与端到端兼容性均为**未核实**。定性取舍标作 `[INFERENCE]`，不替用户选方案。

## 结论（先看这里）

1. **TypeScript 6 已在 typescript-eslint 的正式支持区间内，不必使用“忽略不支持版本”的绕行。** 本次 latest 是 typescript-eslint **8.71.2**，支持 TypeScript `>=4.8.4 <6.1.0`、ESLint 8.57/9/10；项目可以研究 TypeScript **6.0.3**。但 npm 的 TypeScript `latest` 已是 **7.0.2**，超出这个支持区间，不能把所有工具都写成无约束 `latest`。[依赖范围](https://typescript-eslint.io/users/dependency-versions/) · [8.71.2 元数据](https://registry.npmjs.org/typescript-eslint/8.71.2) · [TS 6.0.3](https://registry.npmjs.org/typescript/6.0.3) · [TS latest](https://registry.npmjs.org/typescript/latest)
2. **Nuxt 4 的多 tsconfig 与 Project Service 是可衔接的，不需要先扁平化成一个 ESLint 专用 tsconfig。** Nuxt **4.6.2** 使用 app/server/shared/node references；typescript-eslint **8.71.2** 的 `projectService` 支持 references。不过 `.vue` 必须保留外层 `vue-eslint-parser`，测试文件必须实际进入某个 context，且 Vue 组件类型仍有已知 lint 边界。[Nuxt TypeScript](https://nuxt.com/docs/4.x/guide/concepts/typescript) · [Project Service](https://typescript-eslint.io/blog/project-service/) · [Vue parser 10.4.1](https://github.com/vuejs/vue-eslint-parser/tree/v10.4.1) · [Vue TS config 14.9.0](https://github.com/vuejs/eslint-config-typescript/tree/v14.9.0)
3. **typecheck、typed lint 和项目依赖图检查不是同一层门禁。** `nuxt typecheck` 检查类型合法性；typescript-eslint 的 Promise/unsafe/条件规则检查类型允许但有风险的写法；Knip 检查可达文件、导出与依赖。运行成本和配置维护也各自增加；不能靠“启用 strict”代替其中任何一层。[Nuxt typecheck](https://nuxt.com/docs/4.x/api/commands/typecheck) · [typed lint](https://typescript-eslint.io/getting-started/typed-linting/) · [Knip](https://knip.dev/)
4. **工具、格式化、挂载点是三个独立选择。** 可以独立决定是否使用 Knip/SonarJS/Oxlint、由哪个工具独占格式化、以及 hook 只做快速反馈还是执行全量检查。hook 本身不是不可绕过的合并门禁；GitHub required checks 才能约束合并。[Git hooks](https://git-scm.com/docs/githooks) · [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 1. typescript-eslint：预设、类型感知与成本

### 1.1 版本与三个预设的准确关系

本节固定 **typescript-eslint / @typescript-eslint/eslint-plugin / parser 8.71.2**。`strict-type-checked` = `recommended` + `recommended-type-checked` + `strict` + 更强的类型感知规则，并会加严部分已有规则的选项；不需要把三个预设依次重复启用。`stylistic-type-checked` 是另一组“代码表达方式/简洁性”规则，**不是缩进、分号、引号等格式化规则**，也不是 strict 的超集。官方将 strict 与 strict-type-checked 标为**不保证 semver 稳定**，minor/patch 也可能改变启用项或选项；其余预设（all 除外）规则增删按 major 管理。[预设文档](https://typescript-eslint.io/users/configs/) · [格式化说明](https://typescript-eslint.io/users/what-about-formatting)

以下数量来自 **v8.71.2 生成的预设源码**中 `@typescript-eslint/*` 键的计数；只数该命名空间的规则，不把关闭的 ESLint core 规则算进去，也不冒充所有规则都需要类型信息。三个源码是可逐项复查的完整清单：[recommended-type-checked](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/eslintrc/recommended-type-checked.ts) · [strict-type-checked](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/eslintrc/strict-type-checked.ts) · [stylistic-type-checked](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/eslintrc/stylistic-type-checked.ts)。flat 与 legacy 的预设命名不同，ESLint flat 中使用 camelCase API 或插件的 `flat/...` 键，不把 legacy `extends` 字符串原样搬进去。

| 预设（8.71.2）           | TS 规则键数 | 覆盖内容与差别                                                                                                                                                                                                                                        |
| ------------------------ | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommendedTypeChecked` |          43 | 常见错误与类型安全：`await-thenable`、`no-floating-promises`、`no-misused-promises`、`no-unsafe-{argument,assignment,call,member-access,return}`、`unbound-method`、`only-throw-error`，同时包含不依赖类型的 `no-explicit-any`、`no-unused-vars` 等。 |
| `strictTypeChecked`      |          70 | 包含上述 43 个键，再增加下列 27 个；更主观，也更容易要求重写已有代码。                                                                                                                                                                                |
| `stylisticTypeChecked`   |          21 | 类型/接口/数组的统一表示、简化表达式与现代 API；可与 strict 配合，是否采用由风格偏好决定。                                                                                                                                                            |

**strict 新增的完整 27 项**（均省略 `@typescript-eslint/` 前缀）：

```text
no-confusing-void-expression, no-deprecated, no-dynamic-delete,
no-extraneous-class, no-generated-empty-object-type, no-invalid-void-type,
no-meaningless-void-operator, no-misused-spread, no-mixed-enums,
no-non-null-asserted-nullish-coalescing, no-non-null-assertion,
no-unnecessary-boolean-literal-compare, no-unnecessary-condition,
no-unnecessary-template-expression, no-unnecessary-type-arguments,
no-unnecessary-type-conversion, no-unnecessary-type-parameters,
no-unsafe-enum-assignment, no-useless-constructor, no-useless-default-assignment,
prefer-literal-enum-member, prefer-reduce-type-parameter, prefer-return-this-type,
related-getter-setter-pairs, return-await, unified-signatures,
use-unknown-in-catch-callback-variable
```

已有规则的加严包括：`ban-ts-comment.minimumDescriptionLength: 10`；`restrict-plus-operands` 禁止 any/boolean/nullish/number-string 混加/RegExp；`restrict-template-expressions` 不再容许 number、boolean、nullish、any 等默认宽松分支。`return-await` 配置为 `error-handling-correctness-only`。这些是 **8.71.2** 的实际值，不是 strict 一词的泛化解释。[strict 源码](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/eslintrc/strict-type-checked.ts)

**stylistic 的完整 21 项**：

```text
adjacent-overload-signatures, array-type, ban-tslint-comment,
class-literal-property-style, consistent-generic-constructors,
consistent-indexed-object-style, consistent-type-assertions,
consistent-type-definitions, dot-notation, no-confusing-non-null-assertion,
no-empty-function, no-inferrable-types, non-nullable-type-assertion-style,
prefer-find, prefer-for-of, prefer-function-type, prefer-includes,
prefer-nullish-coalescing, prefer-optional-chain, prefer-regexp-exec,
prefer-string-starts-ends-with
```

**strict 不等于“所有严格规则”**：8.71.2 的上述预设没有默认启用 `strict-boolean-expressions`、`switch-exhaustiveness-check`、`consistent-type-imports`；后者在 Nuxt 的配置里另外启用了。若要把 switch 穷尽性作为门禁，需要显式选择，而不是假定 strict 已包含。[strict 源码](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/eslintrc/strict-type-checked.ts) · [Nuxt 1.17.0 TS 配置源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/eslint-config/src/configs/typescript.ts)

### 1.2 `projectService` 与 Nuxt 4 多 tsconfig

- typescript-eslint **8.0 起稳定、8.71.2 仍适用**的 `languageOptions.parserOptions.projectService: true` 使用 TypeScript 与编辑器相同的 Project Service，为每个源文件查找最近的 `tsconfig.json`，并**沿 project references**加载相应项目。启用它时应移除旧的 `parserOptions.project`，而不是两种模式一起开。[Project Service](https://typescript-eslint.io/blog/project-service/) · [parser 参数](https://typescript-eslint.io/packages/parser/#projectservice)
- Nuxt **4.6.2** 应先 `nuxt prepare`，保留根 `tsconfig.json` 的 `files: []` 与四个 references，分别指向 `.nuxt/tsconfig.app.json`、`.server.json`、`.shared.json`、`.node.json`。Project Service 可以从根 solution 找到这些引用；**不需要把四个路径填到 `projectService` 里，也不应拿旧 `.nuxt/tsconfig.json` 代替四个 context**。手写并固定四个 `parserOptions.project` 路径属于旧 Program API 的另一条路径，并非 Project Service 必需配置。[Nuxt tsconfig](https://nuxt.com/docs/4.x/directory-structure/tsconfig) · [references 支持](https://typescript-eslint.io/blog/project-service/#scalability)
- `test/`、`vitest.config.ts`、`eslint.config.mjs` 不能仅凭目录名假设“肯定被 Nuxt 包含”。4.6.2 的生成源码明确包含 `test/nuxt`、`tests/nuxt` 到 app context，node 的基础入口主要是 Nuxt 配置与 modules。纯 TS 测试可加入 `typescript.nodeTsConfig.include`，或拥有一个被 solution 引用的测试 tsconfig；Nuxt-runtime 测试应进入 app context。相对路径需按**生成 tsconfig 所在目录**解释。[4.6.2 `resolveLayerPaths` 与生成器](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts)
- `allowDefaultProject` 只适合极少量 out-of-project 配置文件：默认最多 **8** 个，不能用含 `**` 的 glob，匹配文件不能同时属于正常项目；`defaultProject` 只给这些文件提供 compiler options，**不是“把整个 Nuxt 指向某个 tsconfig”的总开关**。每个默认项目文件都有明显额外成本；不要将整个 app/test/shadcn 目录塞进去。[8.71.2 parser](https://typescript-eslint.io/packages/parser/#allowdefaultproject)

### 1.3 性能边界

8.71.2 的官方说明是：typed lint 需要构建 TypeScript 类型图，成本通常与 typecheck 同量级，小项目也可能增加数秒；不是只解析一个 AST 的廉价检查。Project Service 在 references/大仓库中可减少配置与重复工作，但官方也记录过性能回归，**没有保证任何 Nuxt 项目必定快多少**。[typed lint 成本](https://typescript-eslint.io/getting-started/typed-linting/#performance) · [性能排查](https://typescript-eslint.io/troubleshooting/typed-linting/performance/) · [Project Service 性能说明](https://typescript-eslint.io/blog/project-service/#performance)

配置上的确定性风险：TS 和 Vue 文件的 `extraFileExtensions` 保持一致（例如都用 `['.vue']`），否则 Project Service 可能在文件之间反复 full reload；避免把构建产物放进宽泛 include；不要把第一条 typed rule 显示的耗时全归咎于那条规则，它常承担类型图首次计算。**ESLint `--cache` 只按文件缓存，不能正确追踪跨文件类型变化**，typescript-eslint 官方不建议依赖它保证 typed lint 完整性；这与缓存 pnpm store 是两回事。[8.71.2 性能指南](https://typescript-eslint.io/troubleshooting/typed-linting/performance/) · [缓存 FAQ](https://typescript-eslint.io/troubleshooting/faqs/eslint/#can-i-use-eslints---cache-with-typescript-eslint)

## 2. Nuxt 与 Vue：组合方式及陷阱

### 2.1 模块与独立配置包

本次 npm latest：`@nuxt/eslint` **1.17.0**、`@nuxt/eslint-config` **1.17.0**；两者 peer 都声明 ESLint `^9.0.0 || ^10.0.0`，所以官网仍提到历史上支持 flat 的 ESLint 8.x，不代表当前这两个包的 peer 接受 8.x。模块生成项目感知的 `.nuxt/eslint.config.mjs` 并附带 DevTools/auto-import 集成；独立配置包通过 `createConfigForNuxt()` 返回 composer，不要求安装 Nuxt 模块，但要自行提供项目设置。[模块元数据](https://registry.npmjs.org/@nuxt%2feslint/1.17.0) · [配置包元数据](https://registry.npmjs.org/@nuxt%2feslint-config/1.17.0) · [模块文档](https://eslint.nuxt.com/packages/module) · [配置包文档](https://eslint.nuxt.com/packages/config)

1.17.0 只支持 **flat config**，不是旧 `@nuxtjs/eslint-config`/`.eslintrc` 路线。根文件从 `./.nuxt/eslint.config.mjs` 导入 `withNuxt()`；参数会追加到 Nuxt 的配置之后，返回 `FlatConfigComposer`，可 `.append()` / `.prepend()` / `.override()`。因此 fresh CI 在加载根 ESLint 配置前必须生成 `.nuxt`。[模块文档](https://eslint.nuxt.com/packages/module) · [1.17.0 生成源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/module/src/modules/config/generate.ts)

**不要把 Nuxt 默认值叫作完整的 typescript-eslint strict-type-checked。** 1.17.0 源码默认使用 TS recommended，再按配置组合 strict/typed-only，并且额外关闭 `no-non-null-assertion`、定制 unused-vars 等；存在 `typescript.tsconfigPath` 路径选项，但其 `projectService.defaultProject` 本身不负责选择所有文件的 context。要完整采用上文 70 项，应显式覆盖规则并明确 typed lint 的 scope。[1.17.0 TS 配置源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/eslint-config/src/configs/typescript.ts)

以下是**保留 Nuxt parser 接线、只叠加 8.71.2 strict 规则**的一种可行写法；不是要求必须选这条路线。代码依据 Nuxt 1.17.0 自身的 `getRulesFromConfigs` 做法，避免把 TS preset 的外层 parser 覆盖到 `.vue`。将导入的 `@typescript-eslint/eslint-plugin` 声明为直接 devDependency，不依赖 pnpm 偶然 hoist 的传递依赖。strict 应用后会覆盖 Nuxt 同名规则的定制（例如 `_` 忽略策略），最终所需例外应在更后面的 rules 中显式写明。[Nuxt TS 源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/eslint-config/src/configs/typescript.ts) · [strict flat 源码](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/eslint-plugin/src/configs/flat/strict-type-checked.ts)

```js
// eslint.config.mjs：需已 nuxt prepare；示意，不是仓库配置
import withNuxt from './.nuxt/eslint.config.mjs'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const strictRules = Object.assign(
  {},
  ...tsPlugin.configs['flat/strict-type-checked'].map((config) => config.rules),
)

export default withNuxt({
  files: ['**/*.{ts,tsx,mts,cts,vue}'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
      extraFileExtensions: ['.vue'],
    },
  },
  rules: strictRules,
})
```

如果采用 `typescript-eslint` 的 `configs.strictTypeChecked` 数组整体组合，也可行，但必须用 `files` 限定作用域，并在最后为 `.vue` 恢复 `vue-eslint-parser` 外层与 TS 内层 parser；不能在 `withNuxt()` 最后无差别 spread 完就认为 Vue 接线仍在。`stylisticTypeChecked` 可以同样叠加，是否采用应独立决定。[8.71.2 预设](https://typescript-eslint.io/users/configs/) · [Vue parser 10.4.1](https://github.com/vuejs/vue-eslint-parser/tree/v10.4.1#parseroptionsparser)

### 2.2 `.vue` 类型感知 lint 可行，但不是 vue-tsc 的替身

本次 `eslint-plugin-vue` **10.11.1**、`vue-eslint-parser` **10.4.1**。`.vue` 外层应为 `languageOptions.parser: vueParser`，而 `<script lang="ts">` 使用 `languageOptions.parserOptions.parser: tsParser`；`projectService`、`tsconfigRootDir`、`extraFileExtensions` 放在 parserOptions，会传给内层 parser。Nuxt 1.17.0 已提供这一层级，前例有意不替换它。[插件元数据](https://registry.npmjs.org/eslint-plugin-vue/10.11.1) · [parser 元数据](https://registry.npmjs.org/vue-eslint-parser/10.4.1) · [parser 文档](https://github.com/vuejs/vue-eslint-parser/tree/v10.4.1) · [Nuxt Vue 接线源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/eslint-config/src/configs/vue.ts)

已知边界：

- Vue 官方 `@vue/eslint-config-typescript` **14.9.0** 提供适配 `.vue` 的 `vueTsConfigs.strictTypeChecked` / `withVueTs()`；它的 README 明示 JS script 可能有 false positive/negative，`lang="tsx"`/`jsx` 与 type-aware rules 有冲突，默认偏向全部 script 使用 TS。它默认还有 `allowComponentTypeUnsafety: true` 来缓解 Vue 组件操作的 `no-unsafe-*` 误报。**只装 Nuxt 的配置并不会自动获得另一包的所有修正**；完全不放宽与采用 Vue 的局部修正，是需要实际代码验证后的策略选择。[14.9.0 README](https://github.com/vuejs/eslint-config-typescript/blob/v14.9.0/README.md)
- 能解析模板中的 TypeScript 表达式，不等于每个普通 ESLint/TS rule 都会遍历 Vue 模板节点，更不等于完整验证 props、emits、slot 与模板推导。Vue parser 为模板提供专门 visitor；Vue TS config 也有 `tsSyntaxInTemplates` 选项，其 false 值会停止相应模板 type-aware 行为。类型正确性的总入口仍是 `nuxt typecheck` / vue-tsc。[parser visitor](https://github.com/vuejs/vue-eslint-parser/tree/v10.4.1#-usage-for-custom-rules--plugins) · [14.9.0 模板选项](https://github.com/vuejs/eslint-config-typescript/blob/v14.9.0/README.md#project-options) · [Nuxt typecheck](https://nuxt.com/docs/4.x/api/commands/typecheck)
- 10.4.1 parser 还列出按源文本而非 AST 工作的规则限制，例如 max-lines、linebreak-style 等可能把 script 外部内容也算进去；格式化边界不能只按普通 `.ts` 想当然。[Known Limitations](https://github.com/vuejs/vue-eslint-parser/tree/v10.4.1#-known-limitations)

### 2.3 Vue 推荐集与 auto-import

10.11.1 的 flat config 是数组：`flat/essential` 侧重防错，`flat/strongly-recommended` 增加可读性，`flat/recommended` 再加入主观社区风格；后两组部分规则默认是 **warn**。可以使用对应 `-error` 变体，或用 `eslint . --max-warnings 0` 将任何 warning 纳入失败条件；启用 recommended 不代表 CLI 默认会因 warning 失败。Nuxt 1.17.0 已合并 Vue 推荐规则，并在未启用 stylistic 时去掉一部分格式规则。[Vue 用户指南](https://eslint.vuejs.org/user-guide/#bundle-configurations-eslint-config-js) · [Nuxt Vue 源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/eslint-config/src/configs/vue.ts) · [ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface#--max-warnings)

Nuxt 1.17.0 模块从 Nuxt 与 Nitro 的 imports registry 生成 `nuxt/import-globals`，将 auto-import 名称标记 readonly；**globals 只解决 ESLint 的名字识别，不提供 TS 类型**，typed lint 还依赖 `nuxt prepare` 生成的 `.d.ts` 与正确 context。TS 文件不应再重复开启 core `no-undef`，typescript-eslint 官方说明该规则不看 TS 的全局类型；Nuxt 的 TS 配置已经关闭它。[globals addon 源码](https://github.com/nuxt/eslint/blob/v1.17.0/packages/module/src/modules/config/addons/globals.ts) · [no-undef FAQ](https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors)

shadcn-vue 的 `app/components/ui/**` 在本项目被视为第三方风格源码是**项目政策**，不是这些工具自动能识别的身份。`[INFERENCE]` 可用精准 `files` override 只豁免主观风格/Sonar 复杂度规则，而保留 typecheck 与 bug 规则；也可以整目录忽略 lint，但后者确实减少 bug 检查覆盖。不要将“豁免风格”误写成“忽略所有静态检查”；是否接受整目录豁免留到文末决策。[ESLint 文件级配置机制](https://eslint.org/docs/latest/use/configure/configuration-files#specifying-files-and-ignores)

## 3. Knip：依赖图门禁及框架集成

### 3.1 版本与检测范围

本次 `knip` npm latest 为 **6.42.0**，Node 要求 `^20.19.0 || >=22.12.0`，ESM、ISC；源码固定到官方 tag `knip@6.42.0`，不是沿用早期 5.x 的能力印象。发布依赖使用 `oxc-parser`，未声明 TypeScript peer；这不等于已经验证项目 TS 6 的全部语法/框架配置。[npm 元数据](https://registry.npmjs.org/knip/6.42.0) · [固定源码](https://github.com/webpro-nl/knip/tree/knip%406.42.0)

| 6.42.0 检查项       | 含义与边界                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| unused files        | `project files - (entry files + resolved files)`；从入口沿模块图不可达，而非全仓库文本没有出现文件名。         |
| unused exports      | 跨模块无人引用的导出；默认保护 entry 文件的 exports。                                                          |
| unused dependencies | 检查 package 依赖的使用，还能报告 unlisted dependencies/binaries 与 unresolved imports。                       |
| unused types        | 指导出的 `enum`、`interface`、`type` 无人使用，**不是检查类型赋值是否合法**。                                  |
| namespace/member    | `nsExports`、`nsTypes` 默认不启用；另有 enumMembers/namespaceMembers，不应泛称能检查任意对象属性与所有类成员。 |

来源：[issue types](https://knip.dev/reference/issue-types) · [handling issues](https://knip.dev/guides/handling-issues) · [配置 reference](https://knip.dev/reference/configuration)。`includeEntryExports: true` 能扩大导出检查，但插件识别的 entry/config 仍有保护，仅由 package scripts 发现的入口也有例外；不能以为一个开关就把框架所有入口的 exports 全部检查。[includeEntryExports](https://knip.dev/reference/configuration#includeentryexports)

### 3.2 Nuxt / Vue / Vitest / Tailwind / pnpm 支持

下表描述 **6.42.0 固定源码**中的识别行为，不宣称已在本项目组合实测。

| 集成                 | 已核实行为                                                                                                                                                                                                                                  | 一手来源                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuxt 4 目录          | `nuxt`/`nuxt-nightly` 依赖触发；识别 `nuxt.config.*`、app/error/layouts/middleware/pages/plugins/modules 和 server/api/routes/middleware/plugins/tasks；无显式 srcDir 时检测根 `app/`；处理 layers、aliases、`#shared`、modules、CSS 入口。 | [文档](https://knip.dev/reference/plugins/nuxt) · [6.42.0 源码](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/nuxt/index.ts)                                                             |
| Vue SFC              | 使用项目 `vue/compiler-sfc` 解析 script/script setup、模板标识符/组件及样式预处理引用；有 `.vue` compiler，不只是 Vue CLI 配置插件。                                                                                                        | [文档](https://knip.dev/reference/plugins/vue) · [Vue compiler/auto-import](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/_vue/auto-import.ts)                                           |
| Vitest               | `vitest`/`vite-plus` 触发；识别 config、workspace/projects、test/spec/bench/type-test、mocks，读取 setupFiles/globalSetup/environment/reporters/coverage/aliases 等。**识别插件存在不等于已验证 Vitest 5 所有新选项。**                     | [文档](https://knip.dev/reference/plugins/vitest) · [源码](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/vitest/index.ts)                                                                |
| Tailwind v4 使用方式 | 识别 `tailwindcss` 与 `@tailwindcss/{vite,webpack,postcss,cli}`；除 config 入口外，CSS compiler 提取 `@import`、`@config`、`@plugin`，所以没有 JS tailwind.config 不意味着无法识别依赖。                                                    | [插件](https://knip.dev/reference/plugins/tailwind) · [CSS compiler](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/tailwind/compiler.ts)                                                 |
| pnpm                 | lockfile/workspace 文件或 `packageManager: pnpm@...` 触发；读取 workspace packages、`.pnpmfile.{cjs,mjs}` 与 packageExtensions 的 peer 引用。workspace 会按各自 manifest 与可达关系分析，不等同扫描物理 `.pnpm` store。                     | [插件](https://knip.dev/reference/plugins/pnpm) · [源码](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/pnpm/index.ts) · [workspaces](https://knip.dev/features/monorepos-and-workspaces) |

### 3.3 auto-import、shadcn 与误报定位

**6.42.0 已主动处理 Nuxt auto-import**：读取 `.nuxt/imports.d.ts`、`.nuxt/components.d.ts`、`.nuxt/types/nitro-routes.d.ts`、`.nuxt/types/nitro-imports.d.ts`，建立 import/component map，向 `.vue`/`.ts` 补 synthetic imports；覆盖 PascalCase、kebab-case、Lazy 组件和 `#components`。官方测试还断言应报告未使用 composable，而非把整个可自动导入目录当入口保护。[Nuxt 源码](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/nuxt/index.ts) · [auto-import 实现](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/_vue/auto-import.ts) · [官方测试源码](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/test/plugins/nuxt-auto-import.test.ts)

`[INFERENCE]` 因此在 fresh CI 先 `nuxt prepare` 再 Knip 有实质意义：缺生成文件或别名信息，会破坏上述推导基础。动态拼接 import、运行时注册、额外 Nuxt module 的自定义生成路径、未进入插件模型的配置引用，仍可能产生 unused/unresolved 误判；应先看 entry/alias/生成物，再决定忽略，不应直接把所有 auto-import finding 判为噪声。[源码中的生成文件读取](https://github.com/webpro-nl/knip/blob/knip%406.42.0/packages/knip/src/plugins/nuxt/index.ts) · [处理指南](https://knip.dev/guides/handling-issues)

对于 shadcn-vue：本次在 **6.42.0 插件清单及源码**未发现专用 shadcn/`components.json` 解析；这项“未发现”不是保证未来永不支持。shadcn-vue 官方把 `components.json` 定义为 **CLI 生成配置**，`aliases.ui` 指示组件输出位置，其他 aliases 要与 tsconfig paths 对齐；它本身不证明某组件存在运行时消费者。Nuxt/Vue 的实际 import、模板及生成声明仍可以建立使用关系。[插件清单](https://knip.dev/reference/plugins) · [components.json 官方说明](https://www.shadcn-vue.com/docs/components-json)

常见情况必须区分：

- 保留整套复制组件，但业务尚未使用其中一部分：这可能是**真实 unused，不是误报**；是否允许库存是政策。
- `index.ts` 桶文件为 CLI/第三方风格保留额外 exports：Knip 按消费者判断，而不是按“来自 shadcn”免检。
- `components.json` 的 alias/配置字符串无法被建模：先确认 Knip path/插件设置，不能用 `components.json` 自动证明所有目标都活跃。

这些是基于上述图模型的 `[INFERENCE]`，实际组件误报数量**未核实**。6.42.0 支持的处理粒度如下：[配置 reference](https://knip.dev/reference/configuration)

| 手段                                      | 对检查边界的影响                                               |
| ----------------------------------------- | -------------------------------------------------------------- |
| `ignoreFiles`                             | 只隐藏 unused-files 类问题，其他分析保留。                     |
| `ignoreIssues`                            | 按文件 glob 与类别忽略，例如只对 UI 桶文件忽略 exports/types。 |
| `ignoreDependencies` / `ignoreUnresolved` | 分别对依赖名/导入 specifier 做精准例外。                       |
| `ignore`                                  | 对匹配文件隐藏所有问题，比前述范围更大。                       |
| `project` 的排除模式                      | 从分析范围移除；不只是隐藏诊断。                               |
| `entry`                                   | 改变可达图根；整目录设 entry 会掩盖未用文件，不是无损修正。    |

### 3.4 CI 与退出码

6.42.0 可作为直接 devDependency，以 `pnpm exec knip` 或 script `knip` 执行；默认检查开发与生产范围，报告阈值默认 **0**。官方退出码是 **0**（无问题）、**1**（分析完成但存在门禁问题）、**2**（配置加载/输入/内部错误）。`--no-exit-code` 不让普通 finding 失败，但错误仍可能退出 2；不能在门禁中误用它。[CI 指南](https://knip.dev/guides/using-knip-in-ci) · [CLI](https://knip.dev/reference/cli)

`--max-show-issues` 只减少展示，不减少失败数；`--max-issues` 才改变阈值。支持 GitHub Actions/JSON/SARIF reporter。**Knip 的 `--strict` 隐含 production**，会排除测试/开发配置入口与 devDependencies 并收紧 workspace 依赖边界，不是“保持全量 scope 再多开几条规则”；若同时关心测试依赖/导出，不能只运行 production。配置/tag hints 可单独选择 treat-as-errors。[CLI](https://knip.dev/reference/cli) · [production mode](https://knip.dev/features/production-mode)

Windows 方面，官方 known issues 记录 Node ≥22、内存压力下 oxc raw transfer 可能报 `Array buffer allocation failed`，提供 `KNIP_DISABLE_RAW_TRANSFER=1`；本报告**未复现**，也不预设默认需要加这个绕行。Knip cache 同样存在配置/别名变化等 stale 边界，不能把一次缓存结果当完整图证明。[known issues](https://knip.dev/reference/known-issues)

## 4. SonarJS：规则增量、版本与许可证

### 4.1 当前版本及重要许可证冲突

`eslint-plugin-sonarjs` latest 为 **4.2.2**；npm peer 声明 ESLint `^8.0.0 || ^9.0.0 || ^10.0.0`，依赖 TypeScript `>=5 <6.1.0`。本节源码固定到 npm `gitHead` **`aebf8d46933ec80ff3437ceb69e320b5a97b7108`**；未核实同名 npm 4.2.2 Git tag，不拿 SonarJS 分析器自身的 14.x 版本充当 npm 插件版本。[npm 4.2.2](https://registry.npmjs.org/eslint-plugin-sonarjs/4.2.2)

**不能把当前插件简单列成 LGPL。** 本次查到 npm/package.json 仍标 `LGPL-3.0-only`，但 **4.2.2 发布包的 LICENSE、对应源码 LICENSE.txt、规则文件头是 SSALv1（Sonar Source-Available License）**。官方 README 说明 **2024-11-29 之后发布的 analyzers（含旧版 patch）使用 SSALv1，具体看文件头**。这是上游元数据与许可文本的冲突，而不是本报告已经作出法律判断。[4.2.2 发布包](https://registry.npmjs.org/eslint-plugin-sonarjs/-/eslint-plugin-sonarjs-4.2.2.tgz) · [包内 LICENSE 的固定版本镜像](https://unpkg.com/eslint-plugin-sonarjs@4.2.2/LICENSE) · [源码 LICENSE](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/LICENSE.txt) · [官方许可变更声明](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/README.md#license)

| 已抽查 npm 版本 | 对应源码实际许可         | 来源                                                                                                                                                                                             |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0.4           | GNU LGPL v3              | [npm](https://registry.npmjs.org/eslint-plugin-sonarjs/1.0.4) · [对应旧仓库 LICENSE](https://github.com/SonarSource/eslint-plugin-sonarjs/blob/ebe523b9539d3dbc1bbcedc251bb8193c7ed9bf6/LICENSE) |
| 2.0.0           | GNU LGPL v3              | [npm](https://registry.npmjs.org/eslint-plugin-sonarjs/2.0.0) · [对应 LICENSE](https://github.com/SonarSource/SonarJS/blob/c34f41b8ff136b6981ab0dbd4238ce87c7836bb7/LICENSE.txt)                 |
| 3.0.0           | SSALv1，但 npm 仍写 LGPL | [npm](https://registry.npmjs.org/eslint-plugin-sonarjs/3.0.0) · [对应 LICENSE](https://github.com/SonarSource/SonarJS/blob/3b4ef37e905207d416f950a0906935468d0b60c0/LICENSE.txt)                 |
| 4.2.2           | SSALv1，但 npm 仍写 LGPL | [npm](https://registry.npmjs.org/eslint-plugin-sonarjs/4.2.2) · [对应 LICENSE](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/LICENSE.txt)                 |

SSALv1 的 `Non-competitive Purpose` 还包含对某些 AI 技术读取、分析或交互程序及其数据的限制；对本项目、AI coding workflow、CI 分发的具体法律适用**未核实，应由使用者判断是否需要法律意见**。首次改变许可的精确 npm patch、元数据为何未同步也**未核实**；不能把抽查推成“所有 2.x 都是 LGPL”。[完整许可文本](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/LICENSE.txt)

### 4.2 recommended 到底有多少规则

**4.2.2 共导出 295 条规则，recommended 开启 230 条、关闭 65 条；配置对象有 295 个键，不是启用 295 条。** 方法：静态计数固定 gitHead 的插件规则表连续 295 行中的 recommended 标记（230 个），再对照发布包 `plugin-rules.js` 的 295 个规则映射；`plugin.ts` 对每条规则都写 `error` 或 `off`。没有执行插件，也没有用会漂移的 master 计数。[固定规则表](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/README.md#L117-L411) · [固定配置构造源码](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/plugin.ts) · [固定发布映射](https://unpkg.com/eslint-plugin-sonarjs@4.2.2/cjs/plugin-rules.js)

4.2.2 的 `configs.recommended` 是 flat config，旧格式使用 `recommended-legacy`；**4.0.0 changelog 已记录 ESLint 10 支持**，并有上述 peer 范围佐证。flat 可追加 `sonarjs.configs.recommended`，不需要重复注册同名插件；若只给自有 TS/Vue 源码使用，应再限制 files，避免将 TS 专属检查无差别扩展到所有配置/生成文件。[使用说明](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/README.md#usage) · [4.0.0 changelog](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/CHANGELOG.md#2026-02-18-version-400)

**recommended 不自动建立类型图。** 部分规则依赖 TS parser services；例如 deprecation 的实现无服务时直接不工作。可以复用前面的 Project Service，但不能只看“配置已加载”就断言所有 typed Sonar 规则都在运行。本项目 Nuxt/Vue/ESLint 10 的完整组合**未核实**。[S1874 源码](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/S1874/rule.ts)

### 4.3 与 typescript-eslint strict 的重叠

比较版本：**SonarJS 4.2.2 / typescript-eslint 8.71.2**。SonarJS 分析器会复用其他 ESLint 规则，但其 npm 插件只导出 `implementation === 'original'` 的规则；README 中的 “ESLint rules / Improved ESLint rules” 表不属于插件提供的规则。不能把 SonarQube 内部复用的 `@typescript-eslint/no-explicit-any`、`await-thenable`、`no-misused-promises` 全算成 npm 插件的重复启用。[生成器](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/tools/generate-rule-indexes.ts) · [官方外部规则说明](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/README.md#eslint-rules)

但原创规则之间有**语义交叉，而非实现完全等价**：

| SonarJS recommended     | TS strict / strict-type-checked      | 重叠边界与源码                                                                                                                                                                                              |
| ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unused-vars`        | `no-unused-vars`                     | 都涉及 unused 局部变量，但 Sonar 的 definition/scope 过滤不同。[S1481](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/S1481/rule.ts) |
| `unused-import`         | `no-unused-vars`                     | unused import 目标交叉，Sonar 有自身 JSDoc/Vue setup 处理。[S1128](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/S1128/rule.ts)     |
| `no-primitive-wrappers` | `no-wrapper-object-types`            | wrapper 构造与类型注解的覆盖不能视为相同。[S1533](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/S1533/rule.ts)                      |
| `deprecation`           | `no-deprecated`（只有 typed strict） | 都涉及 deprecated API，Sonar 用 TS suggestion diagnostics。[S1874](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/S1874/rule.ts)     |

`[INFERENCE]` 可采用整个 recommended 再精确消重，也可只选其复杂度、重复分支、特定 bug/security 规则；前者范围广但诊断维护较多，后者更可控但要人工维护选集。**全部 230 条与 TS strict 的行为等价映射、重复比例未核实**；不能凭名字相似就自动关闭。规则越多也不是正确性覆盖的简单线性指标。

### 4.4 与 SonarQube Server / Cloud（原 SonarCloud）的区别

4.2.2 ESLint 插件是在本地 ESLint 中运行一部分原创 JS/TS 规则，不需要部署 Server/Cloud；SonarJS 分析器用于 SonarQube Server、Cloud、IDE，另有复用/改进的外部规则、CSS 分析、metrics、coverage/external issues 导入等。插件的 recommended 不是服务端 Quality Profile/Quality Gate，也不提供其完整项目历史、issue 状态同步/服务体系；安装插件不能宣称获得与 Server/Cloud 完全相同的结果。[插件 README](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/packages/analysis/src/jsts/rules/README.md) · [分析器 README](https://github.com/SonarSource/SonarJS/blob/aebf8d46933ec80ff3437ceb69e320b5a97b7108/README.md)

## 5. 替代/补充工具及格式化：只列事实与取舍

### 5.1 已抓取版本

| 包                         | npm latest（本次抓取） | 与本项目相关的元数据                                                                  | 来源                                                                     |
| -------------------------- | ---------------------: | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `oxlint`                   |             **1.88.0** | Node `^20.19.0                                                                        |                                                                          | >=22.12.0`，Windows x64/arm64 分发；optional peer `oxlint-tsgolint >=7.0.2003`。 | [registry](https://registry.npmjs.org/oxlint/1.88.0) |
| `eslint-plugin-oxlint`     |             **1.88.0** | peer `oxlint: ~1.88.0`，两者不能任意独立升级。                                        | [registry](https://registry.npmjs.org/eslint-plugin-oxlint/1.88.0)       |
| `oxlint-tsgolint`          |           **7.0.2004** | 当前原生类型后端的版本编码跟随 TypeScript；有 Windows 平台包。                        | [registry](https://registry.npmjs.org/oxlint-tsgolint/7.0.2004)          |
| `@biomejs/biome`           |             **2.5.15** | 有 Windows x64/arm64 分发，npm Node 要求 >=14.21.3。                                  | [registry](https://registry.npmjs.org/@biomejs%2fbiome/2.5.15)           |
| `prettier`                 |             **3.9.10** | Node >=14。                                                                           | [registry](https://registry.npmjs.org/prettier/3.9.10)                   |
| `@stylistic/eslint-plugin` |             **5.10.0** | ESM；ESLint 9/10 peer。官网部分 FAQ 仍保留旧版 Node/ESLint 要求，应以该发布版本为准。 | [registry](https://registry.npmjs.org/@stylistic%2feslint-plugin/5.10.0) |
| `oxfmt`                    |             **0.73.0** | Node `^20.19.0                                                                        |                                                                          | >=22.12.0`；有 Windows 分发。                                                    | [registry](https://registry.npmjs.org/oxfmt/0.73.0)  |
| `eslint-config-prettier`   |             **10.1.8** | peer ESLint >=7；只是关闭冲突，不是 formatter。                                       | [registry](https://registry.npmjs.org/eslint-config-prettier/10.1.8)     |

### 5.2 Oxlint type-aware 已不是“尚不存在”

**Oxlint 1.88.0 + oxlint-tsgolint 7.0.2004** 的类型规则路径已由上游称为 stable：Rust 层处理遍历/配置/非类型 lint，`tsgolint` 利用 `typescript-go` 建立 program 执行类型规则。需要额外安装后端；使用 `--type-aware` 或根配置 `options.typeAware: true`，`--type-check` 可同时报告该后端的类型错误。当前文档明确要求 **TypeScript 7.0+**；typeAware/typeCheck 只支持根配置，不支持嵌套配置。[type-aware 文档](https://oxc.rs/docs/guide/usage/linter/type-aware) · [tsgolint 官方 README](https://github.com/oxc-project/tsgolint#readme)

这与项目 **TS6.0.3** 有关键边界：它不是调用项目的 TS6 compiler；`[INFERENCE]` 语言/配置/诊断语义不能直接视为等价，尤其旧 baseUrl 等 tsconfig 选项。覆盖多数 typescript-eslint typed rules，但官方当前页面/README 存在 **59/61 与 60/62** 的内部统计差异，因此此处不编造一个无争议的精确覆盖率。Nuxt 的生成 context、Vue 虚拟文件、宏与 auto-import 的端到端兼容性**未核实**；`--type-check` 不是已证实能替代 vue-tsc 的承诺。[type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware) · [后端限制与 implemented rules](https://github.com/oxc-project/tsgolint#readme)

Oxlint 当前明确支持 `.vue` / `.svelte` / `.astro` 的 **script blocks**，不是完整 Vue template/style lint。其 JS plugins 仍标 **alpha**，不支持依赖 custom parser/file format 的 Vue/Svelte/Angular 插件，也不支持依赖 TS type-awareness 的 JS 插件规则；不能据此假设可以原样运行整个 eslint-plugin-vue 或任意 typescript-eslint typed rule。[支持范围](https://oxc.rs/docs/guide/usage/linter#what-oxlint-supports) · [JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins)

### 5.3 与 ESLint 共存：`eslint-plugin-oxlint` 不负责执行 Oxlint

**1.88.0** 官方支持 `oxlint && eslint`：前者跑其负责的规则，后者保留 Nuxt/Vue/其余规则。`eslint-plugin-oxlint` 生成**关闭 ESLint 重复规则**的配置，并不把 Oxlint 嵌入 ESLint 运行。[迁移文档](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint#running-oxlint-and-eslint-together) · [官方插件](https://github.com/oxc-project/eslint-plugin-oxlint#readme)

- `configs['flat/recommended']` 对应默认 correctness 类；不是“所有 Oxlint 能支持的规则”。
- `configs['flat/all']` 关闭所有支持的规则；若项目 Oxlint 没启用其中某条，`[INFERENCE]` 会造成覆盖空档。
- `await buildFromConfigFile('./.oxlintrc.json')` / `buildFromOxlintConfig(config)` 可据实际启用配置生成关闭项，放在其他 ESLint presets 之后。
- 对 `.vue` 尤其要保留 parser 与 Vue 专属规则；“关闭重复语义检查”不意味着 template 覆盖已迁移。

上述 API 与排序见 [1.88.0 插件 README](https://github.com/oxc-project/eslint-plugin-oxlint#readme)。`[INFERENCE]` 混合方案的收益在可转移的非类型规则上；如果 ESLint 仍要建立完整 Project Service，不能把 Oxlint 的速度宣传直接当作整个 check 耗时改善比例。

### 5.4 Biome：有类型推断，Vue 仍是 experimental

**Biome 2.5.15** 延续 v2 独立类型推断引擎与 module graph，不依赖 TS compiler，部分规则扫描跨文件与 node_modules `.d.ts`；因此“Biome 完全没有 type-aware”已过时，但它也不是 TS6 compiler 的替身。当前 language-support 页面仍写 TypeScript **5.9**，本次未找到对 TS6 全语法的完整承诺，记为**未核实**。v2 发布时的 floating-promises 检出率数据不能拿来当 2.5.15 当前准确率。[v2 设计](https://biomejs.dev/blog/biome-v2/) · [linter](https://biomejs.dev/linter/) · [domains](https://biomejs.dev/linter/domains/) · [语言支持](https://biomejs.dev/introduction/language-support/)

Vue 方面，当前官方将 parsing/formatting/linting 均标 **experimental**：v2.3 起可处理 SFC HTML/CSS/JS，v2.5 增加或改进 `useVueValidVBind`、`useVueValidVIf`、`useVueVForKey` 等模板规则，所以也不能再说“Biome 只看 script”。完整 HTML/SFC 支持需显式设置：

```json
{
  "html": {
    "experimentalFullSupportEnabled": true,
    "formatter": { "enabled": true }
  }
}
```

但官方仍提示误报；未启用 full support 时，`.vue` 中 useConst/useImportType/noUnusedVariables/noUnusedImports 等可能需要局部关闭。Vue plugin-support 一栏仍不支持，不能把它当成 eslint-plugin-vue 可原样迁移的容器。[当前 SFC 支持及限制](https://biomejs.dev/introduction/language-support/#html-super-languages-support) · [v2.5 发布说明](https://biomejs.dev/blog/biome-v2-5/)

Biome `check` 组合 formatter/linter/assist；`biome ci` 不写文件，可用 `--error-on-warnings` 纳入 warning，并能独立关闭 formatter/linter/assist。`[INFERENCE]` 可以与 ESLint 按职责或路径共存，但新增一个工具不会自动解决重复诊断、重复排版或配置冲突。[CLI](https://biomejs.dev/reference/cli/#biome-ci)

### 5.5 格式化工具的独立选择

| 选项（当前版本）            | 覆盖与机制                                                                                                                                                    | 取舍 / 边界                                                                                                                                                                                          | 一手来源                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier **3.9.10**         | 内置 Vue/TS/HTML/CSS/Markdown/YAML 等，解析后重新打印；`prettier . --check` 不写文件，0=合规、1=格式不符、2=工具错误。                                        | 可用同一个 formatter 覆盖代码与本仓库 Markdown；不是逻辑 lint。特定 Tailwind/import 排序属于插件/额外政策，不等同基础格式化。                                                                        | [支持与设计](https://prettier.io/docs/) · [CLI](https://prettier.io/docs/cli)                                                                                                                                                 |
| ESLint Stylistic **5.10.0** | JS/TS/JSX 的规则与 autofix，统一插件整合此前分包；Nuxt 可选 `eslint.config.stylistic`。                                                                       | 细粒度规则更多、保留部分原布局；不是统一重打印。Vue template 排版还靠 Vue 规则，不能说它独立覆盖所有语言；官方承认 ESLint 格式化不是最高效路线。                                                     | [getting started](https://eslint.style/guide/getting-started) · [why](https://eslint.style/guide/why) · [Nuxt 集成](https://eslint.nuxt.com/packages/module#eslint-stylistic)                                                 |
| Biome **2.5.15**            | 格式化与 lint/assist 可分开使用；Vue 为上述 experimental。                                                                                                    | 有 intentional Prettier divergences；当前 YAML/Markdown 表中仍为 in progress，不能宣称可覆盖全部 docs/workflows。                                                                                    | [语言表](https://biomejs.dev/introduction/language-support/) · [差异](https://biomejs.dev/formatter/differences-with-prettier/)                                                                                               |
| Oxfmt **0.73.0**            | npm 包原生处理 JS/TS/JSON/CSS/GraphQL/TOML/YAML/Markdown 等；Vue/HTML/MDX 等由附带 Prettier 处理，Vue 内部 JS/TS 仍可用原生格式器；`oxfmt --check` 不写文件。 | 独立二进制不具备所有 Node/Prettier-backed 格式支持；不能加载任意 Prettier 插件。默认 width=100（Prettier=80），当前迁移兼容基线为 Prettier 3.9.9，并非 latest 3.9.10；存在 intentional divergences。 | [语言支持](https://oxc.rs/docs/guide/usage/formatter/language-support) · [不支持项](https://oxc.rs/docs/guide/usage/formatter/unsupported-features) · [迁移](https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier) |

Oxfmt 0.73.0 内置 import/Tailwind 类/package.json 排序，但默认 `sortImports`、`sortTailwindcss` 关闭，`sortPackageJson` 开启；不能因“有内置替代”推断所有第三方 Prettier 插件行为等价。[unsupported features/替代](https://oxc.rs/docs/guide/usage/formatter/unsupported-features)

**不要混淆两种消重配置**：`eslint-plugin-oxlint` 关闭被 Oxlint 接管的检查规则；`eslint-config-prettier` **10.1.8** 只关闭与 Prettier/Oxfmt 冲突或冗余的格式规则，本身既不执行 Prettier，也不检查格式。它支持 Vue/Stylistic 等标准插件名，擅自给插件换别名可能使消重失效。Nuxt 默认不启用 Stylistic，可直接并用独立 Prettier；`typescript-eslint/stylisticTypeChecked` 则主要是表达方式，并不是这套排版规则。[eslint-config-prettier](https://github.com/prettier/eslint-config-prettier#readme) · [Prettier 集成 lint](https://prettier.io/docs/integrating-with-linters) · [Oxfmt 更新 lint 规则](https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier#update-lint-rules) · [Nuxt 模块](https://eslint.nuxt.com/packages/module#prettier)

`[INFERENCE]` 同一路径由一个工具独占排版，可避免互相改回；如果决定 shadcn-vue 保留上游风格，应同时明确 formatter 的路径政策，而不只改 ESLint。各 formatter 在本项目实际 diff、Tailwind v4 class 排序及 Vue 宏上的输出均**未核实**，本报告不比较未经实测的速度倍数。

## 6. 门禁挂载点：pnpm scripts、hooks 与 GitHub Actions

### 6.1 版本和聚合入口

本次 npm `latest`：**pnpm 12.14.0**、**ESLint 10.13.0**、**vue-tsc 3.3.13**、**Vitest 5.0.5**。项目约定只确定用 pnpm，并未在本报告替 #42 决定最终主版本；下列当前事实以 pnpm 12 为准，若最后锁 pnpm 10/11，需要采用该版本的文档，不能混用生命周期/批准/并发默认值。[pnpm](https://registry.npmjs.org/pnpm/12.14.0) · [ESLint](https://registry.npmjs.org/eslint/10.13.0) · [vue-tsc](https://registry.npmjs.org/vue-tsc/3.3.13) · [Vitest](https://registry.npmjs.org/vitest/5.0.5)

聚合 script 可以直接顺序组合，不需要为几条命令额外引入任务编排器。下面是**包含所有可选检查时**的语义示例；选择最小方案时移除尚未选用的子项，而不是为它们放 no-op 脚本。本报告没有创建 package.json。

```json
{
  "scripts": {
    "typecheck": "nuxt typecheck --checker vue-tsc",
    "lint": "eslint . --max-warnings 0",
    "knip": "knip",
    "test": "vitest run",
    "check": "pnpm run typecheck && pnpm run lint && pnpm run knip && pnpm run test"
  }
}
```

pnpm 会把本地 `.bin` 加入 PATH；Windows 默认命令环境支持 `&&`，这种显式链保证失败即停与确定顺序。若要格式化门禁，在链中加入被选 formatter 的 `--check`/非写入命令，而不是 `--write`/`--fix`。每个子脚本本身仍须跨平台：`NODE_ENV=x command` 等 POSIX 写法不能与 `&&` 链一概而论；test 必须 run 而非长期 watch。[pnpm run](https://pnpm.io/cli/run) · [Windows cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd) · [Vitest CLI](https://vitest.dev/guide/cli) · [Nuxt checker 选项](https://nuxt.com/docs/4.x/api/commands/typecheck)

pnpm **12.2 起** regex 多脚本默认并发，串行要用 `pnpm run --sequential "/^check:.*/"`（该选项自 11.14 加入），顺序是字典序而非 package.json 顺序；因此不能将不带选项的 regex 当作永远串行的聚合入口。`--no-bail` 可选择继续收集错误但最终失败，和 `&&` 的 fail-fast 是不同体验。[当前多脚本文档](https://pnpm.io/cli/run#running-multiple-scripts)

### 6.2 typecheck 与 typed lint 的职责边界

| 检查（本次版本）                                               | 独有责任                                                                                                                                                  | 重复与接线原则                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Nuxt **4.6.2** `typecheck` + vue-tsc **3.3.13** + TS **6.0.3** | 各 context 类型合法性、Vue SFC/模板/props 等类型检查；Nuxt 当前命令也能选 Golar，本项目计划明确选 vue-tsc。solution references 会自动走 build-mode 检查。 | dev/build 默认不 typecheck，不能只靠 build。无需再单独跑一遍相同 scope 的 `vue-tsc` 和 `tsc --noEmit` 冒充额外覆盖。 |
| typescript-eslint **8.71.2** typed rules                       | 类型合法但有风险的 Promise 误用、unsafe any 流动、不必要条件等。                                                                                          | 不转发全部 TS diagnostics，所以不能取代 typecheck；也不必同时跑重叠 core 与 TS extension 规则。                      |
| Knip **6.42.0**                                                | 文件/导出/包依赖可达性。                                                                                                                                  | 局部 unused 交给选定的 TS lint/compiler，跨模块导出不是 noUnusedLocals 能完成的。                                    |

来源：[Nuxt typecheck](https://nuxt.com/docs/4.x/api/commands/typecheck) · [typed lint](https://typescript-eslint.io/getting-started/typed-linting/) · [ESLint extension/no-undef FAQ](https://typescript-eslint.io/troubleshooting/faqs/eslint/) · [Knip issue types](https://knip.dev/reference/issue-types)。`[INFERENCE]` 先 typecheck 再 typed lint 可先解决类型错误造成的级联诊断，但两个独立 CLI 仍各自承担类型计算，不能宣称复用一个常驻编译器进程。

### 6.3 三种 git hook 方案

| 方案 / 当前版本             | 安装与维护                                                                                        | Windows + pnpm 边界                                                                                                                              | 一手来源                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lefthook **2.2.2**          | 依赖 postinstall 自动 install；运行时读取配置，改命令无需重新生成；可描述多命令/并行任务。        | 有 Windows native 包，但 run 经 `sh`，不是 PowerShell；GUI PATH 与 Git for Windows shell 仍要匹配。可 `LEFTHOOK=0/false` 禁用，CI 默认跳过安装。 | [npm](https://registry.npmjs.org/lefthook/2.2.2) · [安装](https://lefthook.dev/installation/node/) · [run/shell](https://lefthook.dev/configuration/run/) · [禁用](https://lefthook.dev/usage/envs/LEFTHOOK/) |
| simple-git-hooks **2.14.0** | 一 hook 一命令（可调用整个 pnpm check）；改配置后需重新执行 CLI 写 hooks；可用项目 prepare 安装。 | 生成 `#!/bin/sh`；依赖 postinstall 受批准政策影响，而项目 prepare 是不同机制。`SKIP_SIMPLE_GIT_HOOKS=1` 禁用运行，另有跳过安装变量。             | [npm](https://registry.npmjs.org/simple-git-hooks/2.14.0) · [官方 README](https://github.com/toplenboren/simple-git-hooks#readme)                                                                             |
| Husky **9.1.7**             | `husky init` 建立 `.husky` 并更新项目 prepare；安装用 `core.hooksPath`，不是依赖 postinstall。    | hook 应用 POSIX shell；官方列出 Windows startup/GUI PATH 情况；`HUSKY=0` 可跳过安装与运行。                                                      | [npm](https://registry.npmjs.org/husky/9.1.7) · [setup](https://typicode.github.io/husky/get-started.html) · [Windows/CI/GUI](https://typicode.github.io/husky/how-to.html)                                   |

这三者是不同的配置/安装模型，不改变实际 lint 工具严格度。`[INFERENCE]` pre-commit 适合快速反馈，pre-push 更容易容纳全量 typed lint/test；到底在哪个 hook 执行多少检查是用户体验选择，不是工具事实。staged-file 检查也不能独立替代 Knip/跨文件类型图的全量检查。多个 manager 可能争夺 hook 路径，尤其 Husky 使用 core.hooksPath，Lefthook 当前 install 遇到已有值会停止；没有必要默认叠三套。[Lefthook install](https://lefthook.dev/usage/commands/install/) · [Husky 实现](https://github.com/typicode/husky/blob/v9.1.7/index.js)

**pnpm 12.14.0 的安装注意事项，不能照搬 pnpm 10 教程：**

- 第三方依赖构建脚本需要批准；当前 `strictDepBuilds` 默认 **true**，未审核的脚本可能让 install 直接非零退出，而非“总是警告然后跳过”。Lefthook/simple-git-hooks 的依赖 postinstall 和 better-sqlite3 等原生依赖都应按项目明确政策处理，不默认全部放开。[strictDepBuilds](https://pnpm.io/settings/build#strictdepbuilds)
- `allowBuilds` 自 **10.26.0** 加入；**11** 起移除 onlyBuiltDependencies 等旧字段。**12.11** 又加入 `permissions.<包>.build`，其优先级高于 allowBuilds。Lefthook 当前文档仍给 onlyBuiltDependencies 示例，属于上游滞后，不是 pnpm12 可直接照抄的配置。[allowBuilds](https://pnpm.io/settings/build#allowbuilds) · [permissions](https://pnpm.io/settings/build#permissions) · [Lefthook 旧示例](https://lefthook.dev/installation/node/)
- 项目自己的 `prepare` 不等于依赖包 postinstall 批准，但 `pnpm install --ignore-scripts` 会连项目生命周期一起跳过。Nuxt prepare 和 hook install 如果共用项目 script，应组合已有步骤，不能互相覆盖。当前 pnpm run 的任意脚本 pre/post 默认也已为 true，不能沿用旧版默认不执行的描述。[install --ignore-scripts](https://pnpm.io/cli/install#--ignore-scripts) · [pnpm run](https://pnpm.io/cli/run) · [simple-git-hooks prepare 用法](https://github.com/toplenboren/simple-git-hooks#readme)
- Windows shell、hook shell、GUI 启动 PATH 不必相同；glob 用双引号，避免默认 shell 不理解的命令；若改 scriptShell/shellEmulator，必须把该设置纳入跨平台契约，不能假设本机安装 PowerShell 就改变 Git hook shell。[pnpm run](https://pnpm.io/cli/run) · [ESLint Windows glob](https://eslint.org/docs/latest/use/command-line-interface#run-the-cli) · [Husky how-to](https://typicode.github.io/husky/how-to.html)

Git 官方说明 `pre-commit`/`commit-msg` 可由 `git commit --no-verify` 绕过；不要泛化为该选项绕过所有 hook（prepare-commit-msg 不受其抑制）。工具也各有禁用环境变量。因此 **hook 是本地反馈，不是强制远端门禁**。[git hooks](https://git-scm.com/docs/githooks)

### 6.4 GitHub Actions：当前标准接线与缓存

本次官方 Releases API 返回：`pnpm/action-setup` **v6.1.0**、`actions/setup-node` **v7.1.0**、`actions/checkout` **v7.0.1**、`actions/cache` **v6.1.0**。这些是 Action release 版本，与 Node/pnpm/npm 包版本是不同维度，不照抄旧 README 示例中的 major。[action-setup latest](https://api.github.com/repos/pnpm/action-setup/releases/latest) · [setup-node latest](https://api.github.com/repos/actions/setup-node/releases/latest) · [checkout latest](https://api.github.com/repos/actions/checkout/releases/latest) · [cache latest](https://api.github.com/repos/actions/cache/releases/latest)

下面仅是步骤关系示例（**未执行**）；假设已选用当前 pnpm12、已有 lockfile 和对应 scripts。Node24 满足当前 Nuxt4.6.2 的 24.15+ 范围，精确 pin 由骨架/工具链策略决定。

```yaml
steps:
  - uses: actions/checkout@v7.0.1
  - uses: pnpm/action-setup@v6.1.0
    with:
      version: 12.14.0
  - uses: actions/setup-node@v7.1.0
    with:
      node-version: 24
      cache: pnpm
      cache-dependency-path: pnpm-lock.yaml
  - run: pnpm install --frozen-lockfile
  - run: pnpm exec nuxt prepare
  - run: pnpm run check
```

- **action-setup v6.1.0** 安装 pnpm，不安装 Node；version 可来自显式输入或 packageManager/devEngines.packageManager。run_install 默认不自动安装项目依赖；6.1.0 release 明确支持 pnpm12。[固定 action.yml](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml) · [release](https://github.com/pnpm/action-setup/releases/tag/v6.1.0)
- **setup-node v7.1.0** 的 pnpm cache 需要 pnpm 已可用，因而官方组合是先 action-setup，再 setup-node(cache: pnpm)。缓存 global package data/store，**不缓存 node_modules**；需要完整 frozen install，才能按平台处理原生依赖。缓存命中不是检查已通过。[固定 README](https://github.com/actions/setup-node/blob/v7.1.0/README.md) · [pnpm install](https://pnpm.io/cli/install#--frozen-lockfile)
- action-setup v6.1.0 自身也可以 `cache: true`，lockfile 输入名是 **`cache_dependency_path`**；setup-node 对应的是 **`cache-dependency-path`**。两条缓存路线可择一；`[INFERENCE]` 不必再无条件叠一个 actions/cache 管同一 store。action-setup 有 post prune，官方不要求额外手动 prune。[action-setup README](https://github.com/pnpm/action-setup/blob/v6.1.0/README.md)
- Action 内部运行在 Node24，不代表项目 node-version 已设置为24。self-hosted runner 需符合 Node24 Action 要求（setup-node 文档注明至少 **2.327.1**）；Windows cross-OS cache 若显式启用，还涉及 GNU tar/zstd，默认 enableCrossOsArchive=false。[setup-node 运行要求](https://github.com/actions/setup-node/blob/v7.1.0/README.md) · [cache](https://github.com/actions/cache#readme)
- 如果未来 Nuxt 项目位于子目录，manifest 路径、lockfile 路径和 run working-directory 是三个设置；defaults.run 不会自动改 uses 的输入。不要把 `.nuxt`/`node_modules` 当作跨 OS 通用缓存。[action-setup 输入](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml) · [setup-node 输入](https://github.com/actions/setup-node/blob/v7.1.0/action.yml)

Actions 运行检查与“阻止不合格合并”还是两个步骤：需在受保护分支/ruleset 中配置 required status checks；管理员/bypass 的约束另由 GitHub 设置决定。当前仓库无 CI 是项目背景，本报告未创建 workflow，也未更改 GitHub 保护规则。[GitHub required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 7. TypeScript 编译器本身的严格选项

### 7.1 先区分 Nuxt 已有默认值和额外政策

本节以 **TypeScript 6.0.3 / Nuxt 4.6.2** 为基线。Nuxt 4.6.2 的生成器默认已经设置 `strict: true`、`noUncheckedIndexedAccess: true`、`noImplicitOverride: true`、`forceConsistentCasingInFileNames: true`、`isolatedModules: true`、`verbatimModuleSyntax: true`；不必把这些全说成 #45 新增的严格度。strict 设置存在与是否执行 typecheck 是两件事：Nuxt 的 dev/build 默认不跑类型检查，仍需显式 gate。[4.6.2 生成器](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts) · [Nuxt typecheck 说明](https://nuxt.com/docs/4.x/guide/concepts/typescript#type-checking)

TS **6.0** 自身也改变了默认值：strict=true、noUncheckedSideEffectImports=true、types=[]，并弃用 baseUrl、node10 moduleResolution 等。不能照旧教程把这些当成全部尚未启用；“nuxt 当前生成器是否显式写该键”与“TS6 最终默认是否开启”也要区别。[TS 6.0 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)

| 选项（TS 6.0.3）                                   | 语义 / Nuxt 4.6.2 情况 / 取舍                                                                                                                                                                             | 一手来源                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict`                                           | 一组 strict-family 检查，不是所有下面的旗标；新 TS 版本可能继续加强。Nuxt 默认 true。                                                                                                                     | [strict](https://www.typescriptlang.org/tsconfig/strict.html)                                                                                                                                                                     |
| `noUncheckedIndexedAccess`                         | 数组/索引签名访问加入潜在 undefined；Nuxt 已默认 true。能避免 typed lint 仅因过于乐观的索引类型就把合理防御条件判为多余。                                                                                 | [选项](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) · [no-unnecessary-condition 限制](https://typescript-eslint.io/rules/no-unnecessary-condition/)                                                     |
| `exactOptionalPropertyTypes`                       | 区分字段缺席与字段存在且值 undefined；`p?: T` 不再允许显式写 undefined，除非类型含它。Nuxt 生成器未默认设置 true；开启会影响 props 转发、部分更新 DTO、库 options 等调用点。                              | [选项](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html) · [Nuxt 源码](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts)                                                              |
| `noImplicitOverride`                               | 覆盖基类成员时必须写 override，防止基类重命名后静默失去覆盖关系；Nuxt 已默认 true。                                                                                                                       | [选项](https://www.typescriptlang.org/tsconfig/noImplicitOverride.html)                                                                                                                                                           |
| `noPropertyAccessFromIndexSignature`               | 只有索引签名提供的成员须用 `obj['key']`，显式成员仍可点访问；Nuxt 未默认设置。对动态字典/env/config 访问影响较多，目的是表达意图，不是新增运行时校验。                                                    | [选项](https://www.typescriptlang.org/tsconfig/noPropertyAccessFromIndexSignature.html)                                                                                                                                           |
| `verbatimModuleSyntax`                             | 明确 type-only imports/exports 的删除，保留其他 imports；Nuxt 已默认 true。与 CJS/ESM 配置不匹配时会报错，不会偷偷把 ESM import 改写成 require。                                                          | [选项](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)                                                                                                                                                         |
| `isolatedModules`                                  | 约束源码可被单文件 transpiler 安全处理，涉及只导出类型、ambient const enum、非模块 namespace；Nuxt 已默认 true。                                                                                          | [选项](https://www.typescriptlang.org/tsconfig/isolatedModules.html)                                                                                                                                                              |
| `noImplicitReturns` / `noFallthroughCasesInSwitch` | 检查部分分支不返回、非空 switch case 意外贯穿；不属于 strict 总开关，是否接受所有相应编码限制需另外决定。                                                                                                 | [returns](https://www.typescriptlang.org/tsconfig/noImplicitReturns.html) · [fallthrough](https://www.typescriptlang.org/tsconfig/noFallthroughCasesInSwitch.html)                                                                |
| `noUnusedLocals` / `noUnusedParameters`            | 编译期 unused 检查；和 lint 局部变量重复，且 compiler 策略与 ESLint 可配置粒度不同（参数 `_` 有特例）。它们也不替代 Knip 的跨模块 exports/deps 检查。                                                     | [locals](https://www.typescriptlang.org/tsconfig/noUnusedLocals.html) · [parameters](https://www.typescriptlang.org/tsconfig/noUnusedParameters.html) · [TS unused-vars 规则](https://typescript-eslint.io/rules/no-unused-vars/) |
| `noUncheckedSideEffectImports`                     | TS6 默认 true；解析不到 `import './x.css'` 一类副作用模块时会报错，需正确 ambient declarations。Nuxt 4.6.2 源码在 future compatibility≥5 才显式写 true，并不取消 TS6 自身默认。                           | [选项](https://www.typescriptlang.org/tsconfig/noUncheckedSideEffectImports.html) · [TS6 默认变更](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)                                                          |
| `forceConsistentCasingInFileNames`                 | Nuxt 默认 true；Windows 本地到 Linux CI 的路径大小写是实际边界，不应为方便而关闭。                                                                                                                        | [选项](https://www.typescriptlang.org/tsconfig/forceConsistentCasingInFileNames.html) · [Nuxt 生成器](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts)                                                      |
| `skipLibCheck`                                     | Nuxt 默认 true；false 会扩展到第三方声明文件的一致性检查，时间和第三方冲突暴露都增加。它不是忽略所有库类型，true 时项目对库 API 的实际用法仍被检查；也不会把复制来的 `.vue/.ts` shadcn 源码变成免检声明。 | [选项](https://www.typescriptlang.org/tsconfig/skipLibCheck.html)                                                                                                                                                                 |

### 7.2 在生成配置中如何开

Nuxt **4.6.2** 官方配置路径为 `typescript.tsConfig.compilerOptions`（跨 context 的通用选项）与 `typescript.appTsConfig` / `sharedTsConfig` / `nodeTsConfig` / `serverTsConfig`（按 context 覆盖）。`nitro.typescript.tsConfig` 当前文档标为 deprecated，并与 server 配置同步；新配置使用 `typescript.serverTsConfig`，不要把早期 Nitro 写法当唯一入口。`lib`、jsx 等 app-only 选项不全局传播，`types`/`paths`/`noEmit` 也由 Nuxt 按 context 管理，需用对应 context 配置修改。[官方 tsconfig 文档](https://nuxt.com/docs/4.x/directory-structure/tsconfig) · [4.6.2 merge 源码](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts)

以下仅展示**如果选中这些政策**的配置位置，不代表本报告推荐全部开启。四个 context 应保持引用关系，不能只在根 solution 的 `compilerOptions` 写一份就假定所有 referenced projects 继承——references 不是 extends。[Nuxt tsconfig](https://nuxt.com/docs/4.x/directory-structure/tsconfig) · [TS project references](https://www.typescriptlang.org/docs/handbook/project-references.html)

```ts
// nuxt.config.ts：示意
export default defineNuxtConfig({
  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        noPropertyAccessFromIndexSignature: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
      },
    },
    // 如按 context 采用不同政策，在对应 ...TsConfig.compilerOptions 覆盖。
  },
})
```

`test/` 等额外目录也应接入正确 context，不能仅为 lint 在全局加入 DOM/Node ambient types 混成一锅。手工维护各层 tsconfig 也可以通过 extends 继承正确的生成配置，但需保持 Nuxt root references、别名、types 与目录归属；直接改 `.nuxt/*.json` 下次 prepare 会被重写。[Nuxt project references](https://nuxt.com/docs/4.x/guide/concepts/typescript#project-references) · [TS extends 规则](https://www.typescriptlang.org/tsconfig/#extends)

### 7.3 已知不兼容及未核实边界

1. **exact optional 的兼容成本是明确的语言语义，不等于某个库必然有 bug。** props/DTO/options 若把 `T | undefined` 显式传给 `p?: T`，会报错；复制的 shadcn-vue 源码同样受检查。当前具体 shadcn-vue/Reka UI/@nuxtjs/i18n 组合是否全部通过该选项，**未核实**；不编造一个“全版本不兼容”的结论。处理方式可能是省略字段、显式声明 undefined 为合法值，或按 context 不启用；不能把强转 any 当统一接线修正。[exact optional 语义](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
2. **verbatim + Node/CJS 配置**：若 Node context 被改为 nodenext，package.json 的 `type` 与文件后缀须匹配；better-sqlite3 的 CJS 属性并不意味着要把整个 Nuxt 应用改为 CommonJS。Nuxt 的不同 context 有不同 module/moduleResolution，保留框架生成设置后再处理真实 interop 问题。[verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) · [4.6.2 生成器](https://github.com/nuxt/nuxt/blob/v4.6.2/packages/kit/src/template.ts)
3. **副作用资源 import**：noUncheckedSideEffectImports 开启后 CSS 等资源需要可解析的声明；官方给出 `declare module '*.css' {}` 例子，但通配符声明只确认扩展名，不证明每个文件物理存在。应沿用 Nuxt/Vite 提供的资源声明，避免为了过门禁随意为所有模块声明 any。[TS 选项说明](https://www.typescriptlang.org/tsconfig/noUncheckedSideEffectImports.html)
4. **TS6 迁移选项**：types 默认 []、rootDir 默认 tsconfig 所在目录、baseUrl/node10 resolution 弃用均可能影响旧配置。Nuxt 的生成器管理了多 context，不能拿旧教程的根 tsconfig 覆盖掉它；TS6 的 `ignoreDeprecations: '6.0'` 只是暂时掩盖弃用，不是严格方案的长期配置。TS7 不再支持这些旧选项；本报告仍研究项目指定的 TS6，不自动迁移。[TS6 breaking changes](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/#breaking-changes-and-deprecations-in-typescript-6-0)
5. **类型信息依赖正确的类型声明**：如 no-unnecessary-condition 依据声明判断条件恒真，过于乐观的第三方类型或运行时非类型化输入可能需要真实边界校验；不能为了消除 lint 报告机械删除必要校验。Nuxt 已默认 noUncheckedIndexedAccess 有助于索引场景，但不是运行时数据验证器。[8.71.2 规则限制](https://typescript-eslint.io/rules/no-unnecessary-condition/)

## 方案矩阵

以下是供访谈比较的 **4 个可行组合**，不是推荐排序；共同底座为 Nuxt **4.6.2** / TS **6.0.3** / vue-tsc **3.3.13** 的 typecheck、Vue ESLint 接线与 Vitest **5.0.5** 的非 watch 测试。formatter 和 hook 挂载点是独立轴，可在任何一行另选。严格度、速度、配置复杂度与误报风险均为依据前文机制的 **`[INFERENCE]` 定性比较**，没有项目 benchmark；“快”不表示检查范围等价。事实依据见 [typed lint 成本](https://typescript-eslint.io/getting-started/typed-linting/#performance)、[Knip 插件](https://knip.dev/reference/plugins)、[SonarJS 4.2.2](https://registry.npmjs.org/eslint-plugin-sonarjs/4.2.2)、[Oxlint 共存](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint#running-oxlint-and-eslint-together)。

| 组合                                                                                                                                                 | 严格度/覆盖                                                                                         | 速度                                                                | 配置复杂度                                                     | 误报/维护风险                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A：最小类型规则门禁** — typecheck + Nuxt ESLint + typescript-eslint **8.71.2 strict-type-checked** + test                                          | 类型正确性与 70 项 TS 规则、Vue 专属规则；**不提供依赖图/死文件门禁**，不默认增加 21 项 stylistic。 | typed lint 本身有类型图成本；少一套全项目图工具。                   | 低到中：Project Service、四个 context、测试归属与 Vue parser。 | Vue 组件 no-unsafe 与严格表达式限制仍可能需精确例外；strict 预设升级非稳定。                                         |
| **B：增加依赖图** — A + Knip **6.42.0**                                                                                                              | 新增 unused files/exports/deps/types 与 unresolved/unlisted；和 A 是不同覆盖维度。                  | 增加一次模块图/插件配置加载。                                       | 中：Nuxt prepare、entry/aliases、shadcn unused 政策。          | 动态入口、生成声明缺失会影响图；预留 UI 组件可能是真 unused 而非误报。                                               |
| **C：广覆盖规则集** — B + SonarJS **4.2.2 recommended** 或明确选集；stylistic 可另选                                                                 | recommended 当前增加 230 个启用项，但与 TS/Vue 的语义有交叉，不是 230 种全新缺陷。                  | 更多规则执行，实际增量未测；部分规则复用 TS 类型信息。              | 高：消重、复杂度阈值、第三方风格范围及许可审查。               | 诊断重叠/主观复杂度标准增加；**当前 SSALv1 与 npm LGPL 元数据冲突是独立风险**。                                      |
| **D：Oxlint 混合** — typecheck + Oxlint **1.88.0** 非类型规则 + ESLint 保留 Vue/TS typed/未覆盖规则，配 eslint-plugin-oxlint **1.88.0**；Knip 可叠加 | 以实际启用项生成 ESLint 关闭项，可保持所迁移规则覆盖；不把 Oxlint script lint 当模板覆盖。          | 可加速迁走的非类型规则；ESLint 若仍建立类型图，整套耗时收益未核实。 | 高：两份运行路径、启用项同步与文件 scope。                     | 错用 flat/all 可能制造空档；若选择当前 Oxlint type-aware，还引入 **TS7 后端与项目 TS6** 的语义差异，不视为透明替换。 |

Biome **2.5.15** 也可作为选定路径的 formatter/linter 补充，但当前 Vue 仍 experimental、TS6 完整语法承诺未核实，因此本表不把“完整移除 Nuxt/Vue ESLint 与 vue-tsc”描述为已经证实的等价组合。这是证据边界，不是排除用户选择。[Biome 语言支持](https://biomejs.dev/introduction/language-support/)

## 待用户决定的问题清单

以下只列政策与偏好；版本号、支持范围、实际兼容性及性能仍应通过资料/后续实现验证，不把可查事实交给用户猜。

1. **第一天门禁范围**：采用 A/B/C/D 中哪一组？Knip、SonarJS 是立即阻断，还是先作为非阻断报告？不阻断阶段是否接受以及何时切换，由用户定。
2. **规则严格度政策**：仅 strict-type-checked，还是再加 stylistic-type-checked？是否另行要求 switch 穷尽检查、strict boolean expressions 等预设外规则？对 minor/patch 会变动的 strict 规则集，采取多强的升级审查？
3. **shadcn-vue 边界**：保留上游风格但检查 bug，还是也统一格式？允许存放暂未消费的 UI 组件/桶导出吗？允许哪些精确类别例外，是否接受整目录免检导致的覆盖损失？
4. **SonarJS 使用条件**：是否接受当前 SSALv1 许可及其使用限制，是否先做法律审查？若采用，是完整 recommended 还是人工维护选集？复杂度等主观阈值是否阻断？
5. **额外 compiler 约束**：是否启用 exactOptionalPropertyTypes、noPropertyAccessFromIndexSignature、noImplicitReturns/noFallthroughCasesInSwitch？四个 context 是否完全统一？是否将第三方 `.d.ts` 检查（skipLibCheck=false）也纳入政策？
6. **重复职责分配**：局部 unused、deprecated、wrapper 等交叉诊断由哪个规则来源负责？例外必须附原因、允许何种范围的 disable/ignore？
7. **排版唯一所有者**：Prettier、ESLint Stylistic、Biome、Oxfmt 选哪条路径？代码与 Markdown/YAML 是否用同一工具？是否额外要求 import/Tailwind 类排序？第三方源码格式是否跟随上游？
8. **本地反馈强度**：是否装 hook manager；选 Lefthook、simple-git-hooks 还是 Husky？pre-commit 只做快速/暂存文件检查，还是 pre-push/full check？可接受的阻塞时长与 fail-fast/收集全部结果的偏好是什么？
9. **远端合并政策**：哪些检查成为 required status checks？warning 是否一律失败、是否容许基线/阈值、谁可批准例外或 bypass？Windows 是否也作为 CI 门禁环境，而不只是开发机？
10. **工具链风险偏好**：#42 最终锁哪一代 pnpm、如何 pin Node/依赖与升级节奏？是否接受 Oxlint TS7 类型后端或 Biome experimental Vue 的额外覆盖验证成本，还是只把它们用于已明确覆盖的子任务？
