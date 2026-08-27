# dsh-hermes-memory V5 设计规范：后台模型复盘与安全候选写入

**日期：** 2026-08-27  
**状态：** 已设计，尚未实现

## 1. 摘要

V5 为 `dsh-hermes-memory` 增加可选的后台模型复盘能力：在 DSH 完成一次会话 flush 后，插件可以异步启动一次受限的子 agent，让模型从已完成会话中识别可能值得长期保存的用户偏好、项目约定、纠正和失败经验。

模型不直接写入记忆，也不拥有 `memory_save`、`memory_replace` 或 `memory_remove` 权限。模型只能返回结构化候选操作；Host 侧插件负责所有 schema 校验、workspace 授权、安全扫描、幂等判断、预算限制和实际持久化。任何复盘失败都必须 fail-soft，不能阻塞、回滚或改变主会话。

V5 首个切片不建设独立记忆管理 UI，不复制 Pi 的运行时、会话解析器、命令或终端 UI，也不承诺跨进程可靠队列和完整历史补偿。

## 2. 背景与已完成能力

V1-V4.2 已提供：

- 显式记忆工具：`memory_save`、`memory_search`、`memory_replace`、`memory_remove`；
- `global`、`user`、`project`、`failure` 四种 scope；
- DSH `storage-domain` 持久化；
- secret、不可见字符、提示注入和外泄指令扫描；
- `session_memory_search` 和 session watermark；
- 可选的 session-start 参考记忆注入；
- `memory_list`、`memory_stats` 和 `lastReferencedAt`；
- 规则型自动捕获及失败工具上下文关联；
- retention cleanup。

V4 的自动捕获依赖固定规则。V5 的目标不是替换 V4，而是在明确关闭的设置开关下，提供更强的候选识别能力，同时保留相同的安全写入边界。

## 3. 目标

### 3.1 功能目标

- 在 `session/flush` 之后异步触发已完成会话复盘；
- 使用 DSH 原生后台任务和子 agent 能力；
- 要求模型返回可验证的结构化候选操作；
- 支持候选保存为现有 memory scope/category；
- 复用现有 scanner、workspace 授权、repository 和幂等规则；
- 通过独立 review 状态记录已请求、已完成和失败的 flush watermark；
- 让复盘任务可取消、可观察，并在插件 teardown 时正确释放。

### 3.2 非目标

V5 首个切片不包含：

- 独立记忆管理 UI；
- 模型直接执行记忆工具；
- 每一步动态检索和注入；
- 向量或 embedding 检索；
- 自动合并、软删除、archive 或恢复；
- 自定义访问 DSH session SQLite；
- Pi session JSONL parser、Pi TUI、Pi 命令或 Pi 进程；
- 跨重启可靠任务队列；
- 在 provider 不支持结构化输出时降级为无约束 JSON 文本解析；
- 自动修改或删除已有记忆。

## 4. DSH 集成边界

### 4.1 `ctx.jobs`

`ctx.jobs` 来自 `@deepseek-ai/dsh-jobs`，本地实现是 `@deepseek-ai/dsh-jobs-local` 提供的进程内 `JobRegistry`。

V5 仅把它作为短生命周期执行器：

```ts
const id = ctx.jobs.start({
  kind: 'hermes-memory-review',
  label: 'Review flushed session',
  owner: agent,
  run: () => ({
    cancel: reason => controller.abort(reason),
    done,
  }),
})
```

实际实现必须遵守以下边界：

- `start(spec)` 同步返回 job ID；
- `run()` 同步返回 `JobHooks`；
- 任务自身负责异步工作和 `done` Promise；
- `kill`/owner teardown 通过 `cancel` 请求停止；
- `wait` 的 signal 只取消等待，不自动杀死任务；
- 没有内建 delay、interval、retry 或跨重启持久化；
- owner/session disposal 会取消并等待任务；
- job 状态仅存在于当前进程。

因此 `ctx.jobs` 不能被当成可靠队列。V5 的持久化 review 状态只用于 watermark 去重、状态观察和安全重试判断，不改变 `ctx.jobs` 的进程内性质。

### 4.2 结构化模型调用

V5 优先使用 `ctx.subagents` 的 `SubagentRuntime.start()`：

```ts
const run = await ctx.subagents.start(providerName, {
  label: 'Hermes memory review',
  prompt,
  parent: agent,
  signal,
  outputSchema: reviewOutputSchema,
})

const result = await run.result
await run.dispose()
```

`outputSchema` 要求 object-rooted JSON Schema，且选定 provider 必须声明 `outputSchema: true`。成功结果从 `SubagentResult.structured` 读取。若 provider 不支持该能力、子 agent 被取消、模型失败、达到 token 上限或拒答，则本次复盘不写入任何候选。

`ctx.llm.stream()` 仍可用于普通流式文本调用，但没有原生 `response_format`/structured-output API。V5 不采用“提示模型输出 JSON，再自行从任意文本中提取 JSON”的降级路径，因为这会扩大自动写入的解析和安全边界。

## 5. 产品行为

### 5.1 触发条件

后台复盘只有在以下条件全部满足时才触发：

- `enabled` 为 `true`；
- `automaticReview` 为 `true`；
- 监听到当前 session 的 `session/flush`；
- flush watermark 高于该 session 已完成 review 的 watermark；
- 当前 session 的可复盘内容达到最小长度；
- 当前 session 没有相同 watermark 的 running review；
- 当前 agent/session 仍然有效；
- 已解析出可用的 subagent provider 和模型配置。

`session/flush` 监听器不得等待模型调用，也不得把异步 Promise 返回给 DSH 事件总线。监听器只负责读取必要的 flush 信息并提交一个受控的后台 job。

### 5.2 输入范围

复盘输入必须是有界、最小化的数据投影，而不是任意内部对象。输入可以包含：

- 当前 session ID 和 project key（仅用于 provenance 和授权）；
- 从 DSH 原生 session/query API 读取的已完成用户消息、助手文本和工具结果摘要；
- session watermark 范围；
- 必要的失败工具名称和稳定错误摘要。

输入限制：

- 不读取或复制 DSH session SQLite 内部表；
- 不把完整 transcript 写入 memory storage 或 SessionEvent；
- 不把 API key、Bearer token、私钥、环境变量、完整工具 payload 或凭据传给模型；
- 输入总字符数有硬上限，超出部分按稳定规则截断；
- 工具结果只允许使用经过清理的短摘要，不传原始二进制和秘密；
- workspace 路径只作为 Host 侧授权上下文，除非明确属于用户可见项目约定，否则不作为模型输入。

### 5.3 结构化输出

模型只能返回以下语义的对象：

```ts
interface ReviewOutput {
  operations: ReviewOperation[]
}

interface ReviewOperation {
  kind: 'save'
  scope: 'global' | 'user' | 'project' | 'failure'
  category:
    | 'preference'
    | 'convention'
    | 'insight'
    | 'failure'
    | 'correction'
    | 'tool-quirk'
  content: string
  reason?: string
}
```

V5 首个切片只允许 `kind: 'save'`，不允许模型提出 replace/remove。`reason` 只用于受限诊断，不进入记忆内容，不返回给 Client，也不得覆盖 Host 的安全判断。

推荐的输出 schema 约束：

- object root；
- 只允许 `operations` 字段；
- `operations` 数量不超过 `reviewMaxPerSession`；
- `content` 为非空字符串，最大 1,000 字符；
- `scope`、`category`、`kind` 必须是固定枚举；
- 拒绝未知字段、数组根、嵌套对象内容和超大字符串；
- 空操作数组是合法结果，表示本次没有值得保存的长期记忆。

## 6. Host 侧候选处理流水线

模型返回后，Host 侧按以下顺序处理，每条候选独立失败，不影响其他候选：

1. 检查 subagent 的 `stopReason === 'completed'`；
2. 确认 `structured` 存在并通过 output schema；
3. 再次执行本地 JSON-safe 结构校验，不信任 provider 返回值；
4. trim 内容并执行现有长度和字段校验；
5. 校验 scope/category 组合；
6. 将 `project` scope 强制绑定到当前 session 的 authorized project key；
7. 拒绝缺少 cwd 的 project candidate；
8. 对所有内容执行现有 secret、不可见字符、提示注入和外泄扫描；
9. 使用 sessionId、flush watermark、scope、category 和 content 做幂等判断；
10. 检查本次 review 的条数、总字符数和单条字符预算；
11. 调用现有 repository 保存，并写入 `source: 'session'` provenance；
12. 记录成功、跳过和失败的数量，不记录原始内容或扫描匹配内容。

复盘生成的记忆必须遵守与显式工具和规则型捕获完全相同的 workspace 授权和安全扫描。模型不能绕过这些规则。

## 7. Review 状态和幂等

V5 增加独立 review 状态表，不复用现有 session watermark 的语义。建议模型：

```ts
interface ReviewState {
  sessionId: string
  requestedFlushedSeq: number
  completedFlushedSeq: number
  status: 'running' | 'completed' | 'failed'
  attempt: number
  lastErrorCode?: string
  updatedAt: string
  schemaVersion: 1
}
```

唯一键建议为 `sessionId`。状态转换：

```text
absent -> running -> completed
                  -> failed
```

规则：

- 同一 session 只能有一个当前 running review；
- 新 flush 只在 watermark 更高时创建或推进 review；
- completed watermark 不低于请求 watermark 时跳过；
- failed 状态允许后续新 flush 重新尝试，但不得无限重试同一失败 watermark；
- 任务启动前先写入 running，任务结束后写 completed 或 failed；
- 进程崩溃留下 running 时，下一次 session-start 可以将其视为 stale，并在满足预算和设置时重新调度；
- 重试必须再次经过所有 scanner、授权和幂等检查；
- review 状态不包含 transcript、候选原文、模型秘密或完整诊断文本。

由于 `ctx.jobs` 不跨重启持久化，V5 只保证 review 状态可恢复判断，不保证进程退出时一定完成未结束任务。可靠的跨重启队列和多次调度策略留给后续版本。

## 8. 设置

新增设置建议：

```ts
automaticReview: boolean      // 默认 false
reviewMaxPerSession: number   // 默认 5，范围 1..20
reviewMaxInputChars: number   // 默认 12000，范围 2000..30000
```

模型/provider 选择不在 V5 新建凭据管理。插件应复用 DSH 当前 profile/provider 配置；若没有可用的结构化输出 provider，复盘直接跳过并记录稳定 warning。

V5 不允许 Client 读取 API key，也不在设置页显示模型调用凭据。设置页只提供非敏感开关和预算字段；独立记忆管理 UI 仍不建设。

## 9. 错误、取消和可观测性

- `session/flush` 观察器异常必须被捕获；
- job 创建失败只记录稳定 warning；
- provider 不支持 output schema 时跳过，不降级；
- 子 agent `aborted`、`error`、`max-tokens` 或 `refusal` 时不写入候选；
- JSON/schema、授权或 scanner 失败的候选只计数，不记录原文；
- repository 单条写入失败不回滚其他已成功候选；
- owner/session teardown 必须取消后台模型调用并等待资源释放；
- 所有异步错误都不得 reject 到 DSH 主会话事件；
- 日志只允许记录 session-independent 的稳定 code 和数量，禁止记录 prompt、候选 content、secret、完整路径和 provider 原始响应。

可观测信息只包括：

```text
review scheduled
review skipped: disabled / no-provider / no-new-watermark / below-minimum-input
review completed: accepted=N skipped=M failed=K
review failed: stable-code
```

## 10. 文件和组件边界

计划新增或修改：

- `src/host/review-types.ts`：review output、operation、state 和内部状态类型；
- `src/host/review-schema.ts`：Subagent output schema 和本地 JSON-safe 校验；
- `src/host/review-prompt.ts`：最小化、有界、不可执行的复盘 prompt 组装；
- `src/host/review-runner.ts`：session 投影、subagent 调用、候选处理和 fail-soft 结果；
- `src/host/review-state.ts`：review 状态表访问和 watermark 幂等；
- `src/host/auto-review.ts`：`session/flush` 监听、`ctx.jobs` 调度、取消和 teardown；
- `src/host/storage-spec.ts`、`src/host/storage.ts`：增加 review state 表及 domain version/migration；
- `src/host/settings.ts`、`src/client/MemorySettings.tsx`、`src/client/locales.ts`：增加非敏感 review 设置；
- `src/index.ts`：注入 `jobs` 和 `subagents`，安装和释放 review 组件；
- `package.json`：增加公开 DSH jobs/subagent 依赖版本；
- `tests/*.test.mjs`：schema、状态、调度、取消、授权、scanner、幂等和 fail-soft 测试。

每个组件只通过明确接口通信。review runner 不直接操作 Client；Client 不接触 session 原文、storage domain 或模型运行时。

## 11. 测试策略

### 11.1 纯函数

- output schema 接受空操作列表和合法候选；
- 拒绝未知字段、错误枚举、超长内容、嵌套对象和数组根；
- prompt 输入严格遵守字符预算；
- scope/project 授权正确拒绝跨 workspace；
- review watermark 的重复、递增、stale running 和 failed 状态转换正确；
- 相同 session/flush/scope/category/content 不重复写入。

### 11.2 Host 集成

- `automaticReview: false` 不启动 job；
- 无结构化 provider 时安全跳过；
- flush 监听器不等待后台模型调用；
- job 取消能 abort subagent，并在 teardown 后完成；
- 子 agent 非 completed 结果不写入；
- scanner 拒绝候选且不泄漏原文；
- 单条候选失败不阻断其他候选；
- running/completed/failed 状态写入顺序正确；
- 重复 flush 不产生重复 review 或重复 memory；
- 主会话错误隔离。

### 11.3 构建验证

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

打包结果不得包含 Pi 运行时代码、Pi 资产、会话数据库副本或测试秘密。

## 12. 分阶段交付

### V5.0

- 独立 review 状态表；
- `session/flush` 后异步 `ctx.jobs` 调度；
- `SubagentRuntime.start(outputSchema)` 结构化复盘；
- 只允许 save 候选；
- Host 侧安全扫描、授权、幂等和写入；
- 默认关闭；
- 进程内取消和 fail-soft。

### 后续版本

- 更可靠的跨重启 review queue；
- 可配置 review provider/model 的安全设置；
- 经过验证的 session summary cache；
- 受控的合并建议，但仍由 Host 侧执行；
- 更丰富的统计和诊断，而不是独立管理 UI。

## 13. 验收标准

1. 默认设置下不会发起后台模型调用；
2. 开启后只在新 flush watermark 出现时调度一次 review；
3. 主会话不等待、不受后台失败影响；
4. 结构化 provider 不可用时不进行无约束文本 JSON 降级；
5. 模型无法直接调用记忆写入、替换或删除工具；
6. 所有候选都经过 schema、字段、workspace、scanner、预算和幂等检查；
7. project candidate 不可能越过当前 workspace 授权；
8. 重复 flush 和重试不会造成重复记忆；
9. teardown 会取消并释放 jobs/subagent；
10. 不新增独立记忆管理 UI，不修改 DSH 源码，不复制 Pi 运行时代码或资产；
11. typecheck、测试、build 和 npm pack 全部通过。
