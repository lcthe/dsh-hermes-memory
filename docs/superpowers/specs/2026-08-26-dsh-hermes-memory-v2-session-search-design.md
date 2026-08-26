# dsh-hermes-memory V2 设计规范：会话来源追踪与原生会话搜索

**日期：** 2026-08-26  
**状态：** V2 已实现

## 1. 目标

在 V1 显式记忆工具的基础上，增加 DSH 原生会话集成：

1. 记忆保存时可以记录当前 DSH session 和 event sequence 来源；
2. 插件维护会话事件观察 watermark，用于增量处理和故障恢复；
3. 提供 `session_memory_search`，复用 DSH `ctx.sessionQuery` 查询历史会话；
4. 不复制 Pi 的 JSONL 会话解析器，不建立第二套会话全文索引，不把完整 transcript 写入插件存储。

## 2. 方案边界

采用“来源追踪 + DSH 原生 sessionQuery”方案，而不是自建会话索引。

### 保留在插件中的数据

- 当前会话最近观察到的 `sessionId`；
- 最近处理到的 `eventSeq`；
- 最近完成的 `session/flush` watermark；
- 记忆记录中的 source session/event provenance。

### 不复制到插件的数据

- 完整 user/assistant transcript；
- thinking、tool result 或完整工具参数；
- DSH SessionEvent 原始日志；
- DSH session-query 的内部 SQLite 表。

## 3. DSH 集成点

### 3.1 `session/event`

通过 Host `ctx.on('session/event', (session, event) => ...)` 观察已提交事件。

插件只提取：

```ts
interface SessionWatermark {
  sessionId: string
  lastEventSeq: number // 初始为 -1，表示尚未观察到事件
  lastFlushedSeq: number // 初始为 -1，表示尚未完成 flush
  updatedAt: string
}
```

监听失败不能阻塞或回滚会话。每次事件处理都必须是尽力而为，错误记录到插件 logger，不输出 transcript 或秘密。

### 3.2 `session/flush`

`session/flush` 是可 await 的耐久检查点。插件在 flush 观察到后更新 `lastFlushedSeq`，再持久化 watermark。若 watermark 写入失败，下次事件或启动时允许重复处理，不得假设 exactly-once。

### 3.3 `ctx.sessionQuery`

`session_memory_search` 直接调用 DSH 的 session query service。插件不读取会话文件、内部 SQLite 或路径。

搜索请求必须继承 DSH 的 caller workspace/cwd 授权，至少支持：

- role 过滤当前实现为 `user` 和 `assistant`；DSH 基础公开事件契约不提供 `system/message`，不人为伪造该类型；

返回结果必须裁剪为 bounded JSON，不能把任意原始事件对象直接返回给模型。

## 4. 来源模型扩展

V1 的 `MemoryProvenance` 扩展为：

```ts
export interface MemoryProvenance {
  source: 'explicit' | 'session' | 'tool' | 'import'
  sessionId?: string
  eventSeq?: number
  flushedSeq?: number
  projectKey?: string
}
```

显式工具保存时：

- `source: 'tool'`；
- 如果 `exec.agent.session` 可用，携带当前 session ID；
- event sequence 只有在 DSH 执行上下文明确提供时才写入，不能猜测。

未来自动抽取记忆时：

- `source: 'session'`；
- 绑定实际候选所在的 session/event；
- 经过 scanner 后才能持久化。

## 5. Watermark 存储

在现有 `dsh_hermes_memory` domain 增加 `watermarks` 表：

```ts
interface SessionWatermark {
  sessionId: string
  lastEventSeq: number // 初始为 -1，表示尚未观察到事件
  lastFlushedSeq: number // 初始为 -1，表示尚未完成 flush
  updatedAt: string
  schemaVersion: 1
}
```

表 key 为 `sessionId`。写入使用 storage-domain 的串行 `put`，启动时从表读取，不依赖内存 timer。

### 重复和乱序

- 事件 seq 小于等于已记录值时忽略；
- 事件 seq 大于当前值时更新；
- flush seq 不能大于已观察 event seq，违反时只记录 warning，不写入非法状态；
- watermark 丢失时允许重新观察，不认为是数据损坏。

## 6. `session_memory_search` 工具

参数：

```ts
interface SessionMemorySearchArgs {
  query: string
  role?: 'user' | 'assistant'
  project?: string
  limit?: number
  snippetChars?: number
}
```

规则：

- query 必须非空；
- limit 默认 10，硬上限 20；
- snippetChars 默认 400，硬上限 2000；
- project 只能是当前 workspace，不能通过参数越权；
- 返回 session ID、日期、project、role 和 bounded snippet；
- 不返回完整事件 payload、工具参数、内部路径或原始错误堆栈。

输出：

```ts
interface SessionMemorySearchResult {
  success: boolean
  total: number
  results: Array<{
    sessionId: string
    project?: string
    role: 'user' | 'assistant'
    date?: string
    snippet: string
  }>
  error?: { code: string; message: string }
}
```

## 7. 错误处理

新增错误码：

- `session_query_unavailable`：DSH sessionQuery 未加载；
- `session_query_failed`：DSH 查询失败；
- `session_scope_denied`：请求 project 不属于当前 workspace；
- `invalid_args`：query、limit 或 snippetChars 不合法。

查询错误不影响记忆工具和当前会话。

## 8. 测试策略

### Core

- provenance 可选字段的 schema 校验；
- watermark 乱序、重复和 flush 越界；
- query/limit/snippetChars 边界。

### Host

- `session/event` 只更新 watermark，不保存完整 transcript；
- `session/flush` 更新 flushed seq；
- 观察器失败不抛出到 session producer；
- `session_memory_search` 正确调用 fake sessionQuery；
- workspace project 越权被拒绝；
- 返回结果被裁剪且不包含原始 payload。

### Build

```text
npm run typecheck
npm test
npm run build
```

## 9. 与 V1/V3 的关系

V2 不自动从会话内容生成长期记忆，也不自动注入记忆。

V3 才考虑：

- `agent/session-start` 注入少量已授权记忆；
- `agent/pre-step` 检索相关记忆；
- 从用户纠正或工具失败中生成候选记忆。

V2 的 watermark 设计必须为 V3 提供可靠来源，但不提前引入模型复盘。

## 10. 明确禁止

- 不复制 `pi-hermes-memory` 的 session parser；
- 不读取 Pi session JSONL；
- 不复制 Pi 的命令、TUI、Logo、截图或品牌资产；
- 不把完整会话事件写入 `dsh_hermes_memory`；
- 不声明未知 DSH SessionEvent 类型；
- 不绕过 DSH sessionQuery 的 workspace 授权。
