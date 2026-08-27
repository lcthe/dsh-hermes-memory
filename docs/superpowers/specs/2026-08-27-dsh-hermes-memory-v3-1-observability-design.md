# dsh-hermes-memory V3.1 设计规范：记忆可观测性与引用新鲜度

**日期：** 2026-08-27  
**状态：** 已确认，待实现

## 1. 目标

补齐 Pi Hermes Memory 中与日常治理相关、但 DSH 当前尚未完整提供的基础能力：

- 记录记忆最近一次被搜索或启动注入引用的时间；
- 提供有界的记忆列表能力；
- 提供按 scope/category 的记忆统计能力；
- 让后续 retention、淘汰、管理 UI 有稳定的数据基础。

本版本不实现自动捕获、后台模型复盘、自动合并、自动淘汰、FTS 或每步动态检索。

## 2. 产品范围

### 2.1 `lastReferencedAt`

当一条记忆满足以下任一条件时，更新其 `lastReferencedAt`：

- 被 `memory_search` 返回；
- 被启动注入选中并成功加入注入消息。

更新时间使用 Host 当前时间的 ISO 字符串。更新失败必须 fail-soft，不影响搜索结果、会话启动或注入流程。

不更新以下情况：

- 记忆未命中搜索；
- 记忆被设置或 workspace 授权过滤掉；
- 记忆仅被 `memory_list` 或 `memory_stats` 读取；
- `agent.inject()` 失败的注入批次。

### 2.2 `memory_list`

新增 DSH 工具 `memory_list`，用于查看当前 workspace 可见的持久记忆。

参数：

```ts
interface MemoryListArgs {
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}
```

规则：

- project scope 和显式 `projectKey` 必须经过现有 workspace exact-match 授权；
- 未指定 `projectKey` 时，project scope 默认使用当前 workspace；
- 未指定 scope 时，global、user、failure 可按现有记录返回，project 只返回当前 workspace；
- limit 默认 20，硬上限 50；
- 排序为 `updatedAt` 降序，`id` 升序；
- 不更新 `lastReferencedAt`；
- 返回记录必须裁剪到有界 JSON，不能暴露数据库路径或内部句柄。

输出：

```ts
interface MemoryListResult {
  success: boolean
  records: MemoryRecord[]
  total: number
  error?: { code: string; message: string }
}
```

### 2.3 `memory_stats`

新增 DSH 工具 `memory_stats`，用于查看当前 workspace 可见记忆的数量和字符占用。

参数：

```ts
interface MemoryStatsArgs {
  projectKey?: string
}
```

规则：

- 使用与 `memory_search` 相同的 workspace 授权；
- 统计 global、user、failure 和当前授权 project 记录；
- 不把其他 workspace 的 project 记录计入统计；
- 不更新 `lastReferencedAt`；
- 单个字段使用安全整数和固定结构，避免输出原始表内容。

输出：

```ts
interface MemoryStatsResult {
  success: boolean
  total: number
  totalChars: number
  byScope: Record<MemoryScope, { count: number; chars: number }>
  error?: { code: string; message: string }
}
```

## 3. 数据和接口设计

### 3.1 Repository 扩展

在 `MemoryRepository` 增加以下异步接口：

```ts
list(input: MemoryListInput): Promise<MemoryListResult>
getStats(projectKey?: string): Promise<MemoryStatsResult>
markReferenced(ids: readonly string[], at?: string): Promise<void>
```

为了让测试和 storage adapter 保持一致，纯函数负责过滤、排序和统计；repository 实现负责持久化更新。

`markReferenced()` 规则：

- 只更新当前存在的 ID；
- 不修改 content、scope、category、provenance 或 updatedAt；
- `lastReferencedAt` 只允许向前推进，不回退到更早时间；
- 空 ID 列表是 no-op；
- 单条记录失败不得阻塞其他记录，adapter 可按记录 best-effort 写入并由调用方捕获错误。

### 3.2 Storage adapter

`StorageMemoryRepository` 继续使用 `storage.table`，不增加表，也不改变 domain version。列表和统计读取 `entries()`，引用时间更新通过现有 `table.put()` 写回完整 record。

`InMemoryRepository` 实现同样的异步契约，作为单元测试实现。

### 3.3 工具结果边界

- `memory_list` 默认最多返回 20 条，最多 50 条；
- 每条 content 最多 2,000 字符，超出使用省略号；
- `memory_stats` 只返回计数和字符数；
- 工具错误使用现有稳定错误码，不暴露原始异常、绝对路径或秘密；
- `memory_search` 原有结果格式保持兼容。

## 4. 搜索和注入的引用更新

### 4.1 搜索

`searchMemory()` 得到 repository 结果后，提取返回记录 ID，异步调用 `markReferenced()`：

```ts
void context.repository.markReferenced(result.records.map(record => record.id))
```

该调用必须捕获 rejection，并记录稳定 warning；不能让未处理 Promise rejection 影响 Host。

搜索结果先返回，不等待引用时间写入，避免增加工具延迟。

### 4.2 启动注入

启动注入完成以下步骤后，异步调用 `markReferenced()`：

1. 选择合法且已授权候选；
2. 生成 bounded 文本；
3. `agent.inject()` 成功返回。

注入失败时不标记引用。引用更新失败只记录稳定 warning。

## 5. Workspace 授权

继续复用 `resolveWorkspace()` 和 `authorizeProjectKey()`：

- global、user、failure 不需要 project key；
- project 只能匹配当前 session cwd；
- `memory_list` 未指定 projectKey 时，project scope 使用当前 cwd；
- `memory_stats` 未指定 projectKey 时，统计当前 cwd project；
- 不自行解析 Git root、worktree 或 `.git` 文件；
- 不允许调用方通过任意字符串读取其他 workspace。

## 6. 错误处理

新增或复用错误码：

- `invalid_args`：limit 或参数格式非法；
- `unauthorized_scope`：projectKey 不属于当前 workspace；
- `storage_unavailable`：列表、统计或引用更新时间失败。

`lastReferencedAt` 更新属于旁路维护：任何失败只记录不包含正文的 warning，不改变主操作结果。

## 7. 测试策略

### Core

- list 的 scope/category/project 过滤；
- 默认 workspace project 过滤；
- limit 默认值和 50 上限；
- updatedAt/id 稳定排序；
- 每条 content 的输出裁剪；
- stats 的 scope 计数和字符数；
- stats 不计入未授权 project；
- markReferenced 只前进时间，不覆盖较新时间；
- markReferenced 空列表和不存在 ID。

### Host

- `memory_search` 返回后触发 best-effort `markReferenced`；
- 引用更新时间失败不会改变搜索成功结果；
- 启动注入成功后更新命中记录；
- `agent.inject()` 失败时不更新引用时间；
- `memory_list` 和 `memory_stats` 工具继承 workspace 授权。

### Build

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 8. 非目标

本版本明确不包含：

- 自动从会话提取记忆；
- `agent/pre-step` 动态检索；
- 后台 review、session flush review 或 `ctx.jobs`；
- retention cleanup、archive、eviction；
- 自动合并和模型 consolidation；
- SQLite、FTS5、embedding 或向量搜索；
- 记忆管理 Client UI；
- Git root/worktree 自动识别；
- 修改 DSH 源码或读取 Session SQLite。

## 9. 后续关系

V3.1 为后续版本提供：

- 可用于 retention 的 `lastReferencedAt`；
- 可用于 UI 的 list/stats API；
- 可用于 cleanup 和审计的稳定 repository 边界。

V4 仍负责规则型纠正/失败候选、后台 review 和 retention cleanup；V5 再评估模型 consolidation 和 FTS。
