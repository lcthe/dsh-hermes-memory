# dsh-hermes-memory V4.1 设计规范：工具失败上下文的纠正捕获

**日期：** 2026-08-27  
**状态：** 已确认，待实现

## 1. 目标

在 V4 规则型捕获的基础上，把用户纠正与同一轮对话中失败的工具调用关联起来：

- 追踪会话内最近的失败工具调用；
- 用户纠正消息命中时，如果上一次用户消息之后存在失败工具调用，额外保存一条 `failure/tool-quirk` 记忆；
- 同一失败上下文最多被消费一次；
- 不改变 V4 的单条纠正记录行为。

## 2. 会话状态追踪

捕获器为每个 session 维护一个轻量状态：

```ts
interface SessionCaptureState {
  lastUserSeq: number   // 最近一次真实用户消息的 eventSeq，初始 -1
  lastToolCall?: { callId: string; name: string }
  lastFailure?: { toolName: string; errorSeq: number }
}
```

事件处理规则：

- `tool/call`：记录 `{ callId, name }` 到 `lastToolCall`；
- `tool/result` 且携带 `error`：若 `message.source.callId` 与 `lastToolCall.callId` 一致，记录 `lastFailure = { toolName, errorSeq: 当前事件 seq }`，并清空 `lastToolCall`；
- `user/message`（真实用户消息）：捕获逻辑使用当前的 `lastUserSeq` 作为配对边界，处理完成后更新 `lastUserSeq = 当前事件 seq`。

## 3. 配对规则

用户在消息中给出纠正（V4 规则命中 `scope: failure`、`category: correction`）时，判断：

```
captureToolContext === true
&& state.lastFailure !== undefined
&& state.lastFailure.errorSeq > state.lastUserSeq
```

满足时，除原有 correction 记录外，再保存一条：

```ts
{
  scope: 'failure',
  category: 'tool-quirk',
  content: `用户在对工具 ${toolName} 失败后纠正：${correctionText}`,
  projectKey,
  provenance: { source: 'session', sessionId, eventSeq: userMessageSeq, projectKey },
}
```

`errorSeq > lastUserSeq` 保证失败发生在“上一条用户消息之后、本条纠正之前”，即同一轮对话的 assistant/tool 工作之后；这也保证同一失败上下文不会被之后的多条纠正反复消费（后一条纠正的 `lastUserSeq` 已前移）。

## 4. 去重与容量

- 两条记录共享 `eventSeq = 用户消息 seq`；
- V4 的事件幂等检查从“按 scope”扩展为“按 scope + category”，否则 correction 与 tool-quirk 同为 `scope: failure` 时第二条会被误判为重复；
- 内容去重仍按 scope + projectKey + content 精确匹配；
- 每会话捕获上限仍为 `captureMaxPerSession`，一对记录计 2 条；
- 不新增存储表，不升级 domain version，不改 provenance schema。

## 5. Settings

新增：

```ts
captureToolContext: boolean // 默认 true，仅在 captureCorrections 开启时有意义
```

仅在配对条件全部满足时发挥效果；用户可显式关闭。

## 6. 失败与安全

- 状态追踪、配对、保存任一失败只记录稳定 warning；
- 不把工具参数、错误原文、用户消息正文写进日志；
- `toolName` 只来自 `tool/call` 的公开 `name` 字段，不会因缺失而猜测；
- 无对应工具名时跳过配对，仍保存普通 correction。

## 7. 测试策略

### Host

- 工具失败 + 纠正 → 保存 correction 与 tool-quirk 两条；
- 失败后无纠正 → 不保存；
- 纠正前无失败 → 只保存 correction 一条；
- 同失败上下文被第二条纠正消费 → 只配对一次；
- `captureToolContext: false` → 只保存 correction；
- 重放同一事件 → 仍只有一对记录；
- 工具名缺失 → 只保存 correction；
- 原 V4 全部场景保持通过。

### Build

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 8. 非目标

- 不监听 assistant 消息以推断纠正对象；
- 不把完整 tool/result 或错误堆栈写入记忆；
- 不做模型复盘或跨会话聚合；
- 不新增存储表或 schema 变更。

## 9. 后续关系

V4.2 在此基础上评估 `ctx.jobs` 后台复盘与 retention cleanup；V4.1 只做确定性的失败上下文关联。