# dsh-hermes-memory V4 设计规范：规则型会话候选捕获

**日期：** 2026-08-27  
**状态：** 已实现

实现结果：

- 纯规则模块 `src/core/capture-rules.ts` 按 correction > convention > preference 输出至多一个候选；
- Host 捕获器 `src/host/auto-capture.ts` 独立监听 `session/event`，按 session 排队且 fail-soft；
- 幂等通过 memories 表 provenance（sessionId+eventSeq+scope）与 content 去重实现，未新增存储表；
- `capturePreferences`、`captureConventions`、`captureCorrections`、`captureMaxPerSession` 设置已生效；
- 44 项测试全部通过，typecheck、build 和 npm pack 通过；
- 模型复盘、`ctx.jobs`、上下文关联纠正和 retention cleanup 继续延期。

## 1. 目标

V4 首个切片实现“规则型会话候选捕获”：从 DSH `session/event` 的真实用户消息中识别明确的偏好、项目约定和纠正语句，经现有安全扫描后以 `source: 'session'` 写入持久记忆。

本切片是自动学习闭环的第一步，但不引入模型打分、后台任务或新的存储表。

## 2. 产品范围

### 2.1 触发条件

仅监听 DSH `session/event` 中的 `user/message`，并且：

- `event.data.source.kind === 'user'`，即真实用户输入；跳过插件注入、AGENTS.md 指令、技能内容等非用户来源；
- 文本去除首尾空白后长度在 6..1,000 字符之间；
- `automaticCapture` 设置开启；
- 对应捕获类别开关开启。

### 2.2 类别与范围

规则按以下优先级单条命中，每条消息最多生成一个候选：

1. `correction`（纠正）：命中 `不对、错了、搞错了、不是这样、应该是、应该用、其实、不要再、以后别` 等信号 → `scope: failure`，`category: correction`；
2. `convention`（约定）：命中 `这个项目、本项目、我们项目、项目里` 等信号 → `scope: project`，`category: convention`，仅在 session 有 cwd 时可用；
3. `preference`（偏好）：命中 `以后、下次、请记住、记住、记得` 等信号 → `scope: user`，`category: preference`。

三个类别由独立设置控制：

```ts
capturePreferences: boolean
captureConventions: boolean
captureCorrections: boolean
```

候选文本使用完整用户消息（trim、裁剪至 1,000 字符）。不做分句或模型改写。

### 2.3 写入前检查

候选保存前必须满足全部条件，否则丢弃并记入稳定日志：

- 现有 scanner 允许（`repository.save()` 本身执行 scanner 和 schema 校验）；
- 同一 session 同一 eventSeq 未保存过相同 scope 的候选（跨重启幂等）；
- 相同 scope + projectKey + content 的完全重复记录不存在；
- 本次成功捕获的项目数量未超过 `captureMaxPerSession`（默认 5）。

### 2.4 持久化

写入使用现有 `repository.save()`，provenance 固定为：

```ts
{
  source: 'session',
  sessionId,
  eventSeq,
  projectKey, // project scope 时来自 session.header.cwd
}
```

不新增存储表，不升级 domain version。幂等完全依赖 memories 表已有字段的查询，避免 storage-domain 介质版本校验破坏既有本地数据。

## 3. 组合方式

### 3.1 纯规则模块

新增 `src/core/capture-rules.ts`，不依赖任何 DSH API：

```ts
export interface CaptureCandidate {
  scope: MemoryScope
  category: MemoryCategory
  text: string
}

export function detectCaptureCandidates(text: string): CaptureCandidate[]
```

职责：

- 长度边界（调用方 trim 后传入，此处再次校验 6..1,000）；
- 按 correction > convention > preference 优先级返回至多一个候选；
- 保持 match 逻辑为显式、可测试的正则和关键词列表。

### 3.2 Host 捕获器

新增 `src/host/auto-capture.ts`：

```ts
export function installAutoCapture(
  ctx: Context,
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean
```

职责：

- 注册独立 `session/event` 监听器（与 watermark 监听器互不依赖）；
- 每个 session 的事件处理按序排队，失败不阻塞主会话；
- 从 `user/message` 事件提取文本块；
- 完成三开关过滤、workspace、幂等和容量检查后调用 `repository.save()`；
- 所有异常只记录稳定 warning，绝不包含正文、秘密或完整堆栈。

### 3.3 Settings 扩展

在现有 `MemorySettings` 增加：

```ts
capturePreferences: boolean   // 默认 true
captureConventions: boolean   // 默认 true
captureCorrections: boolean   // 默认 true
captureMaxPerSession: number  // 默认 5，范围 1..20
```

`automaticCapture` 默认值保持 `false`，但从此开始真正生效。

## 4. 去重与容量规则

### 4.1 事件幂等

保存前检查 memories 表中是否存在：

```ts
record.provenance.source === 'session'
&& record.provenance.sessionId === sessionId
&& record.provenance.eventSeq === seq
&& record.scope === candidate.scope
```

命中则跳过。这保证：

- 重启后即使 DSH 重放历史事件也不会重复保存；
- resume 的 session 不会二次捕获同一句。

### 4.2 内容去重

检查 memories 表中是否存在相同 `scope`、相同 `projectKey`、完全相同的 `content`。命中则跳过，并记录为 content duplicate。

### 4.3 会话容量

统计 memories 表中：

```ts
record.provenance.source === 'session'
&& record.provenance.sessionId === sessionId
&& record.provenance.eventSeq !== undefined
```

当计数达到 `captureMaxPerSession` 后，该 session 后续候选全部跳过。

上述检查均为低频率扫描（每次捕获事件一次），捕获通常每 session 只有寥寥数条，不做索引优化。

## 5. 失败与安全边界

- 事件观察、提取、规则匹配、去重、保存中任何一步失败都只记录稳定 warning；
- 不把用户消息原文、秘密或工具结果写入日志；
- scanner 拒绝的候选（API Key、私钥、提示注入、外泄指令）丢弃，不写入 `source: 'session'` 记忆；
- 注入到会话的插件消息（含本插件 recall、AGENTS.md、技能、cron 通知）不参与捕获；
- project 捕获仅在 session 存在 cwd 时进行，绝不写其他 workspace；
- 捕获不修改 watermark 行为，不读取 DSH session SQLite，不复制完整 transcript。

## 6. 测试策略

### Core

- 三类规则的命中与优先级；
- 非真实用户消息（plugin source）不产生候选（在 Host 层验证）；
- 长度边界：过短和过长文本被拒绝；
- 无信号时返回空。

### Host

- user/message 事件文本提取；
- 三开关过滤；
- eventSeq + sessionId 幂等；
- content 重复跳过；
- 会话容量上限；
- project 无 cwd 时跳过；
- repository.save 失败只产生稳定 warning；
- 捕获成功后 watermark 监听仍正常工作。

### Build

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 7. 非目标

本切片不包含：

- 模型驱动的盘中复盘或 session flush review；
- `ctx.jobs` 后台任务；
- 基于 assistant/tool 上下文的关联纠正（V4.1）；
- 用户确认队列（capture 为直接写入，可通过 `memory_remove` 删除）；
- 分句、指代消解或文本改写；
- 新存储表或 domain version 升级；
- 向量检索与 FTS。

## 8. 后续关系

V4 后续：

- V4.1 引入 assistant/tool 上下文关联的纠正候选；
- V4.2 使用 `ctx.jobs` 做后台 review 和 retention cleanup；
- V4.3 记忆管理 UI 与 profile onboarding。

规则型捕获先落地，模型复盘在规则之上逐步叠加。