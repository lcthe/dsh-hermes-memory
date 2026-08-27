# dsh-hermes-memory V4.2 设计规范：retention 清理

**日期：** 2026-08-27  
**状态：** 已实现

实现结果：

- `retentionDays`（默认 90）与 `failureRetentionDays`（默认 30）均已生效；
- `selectExpiredRecords` 按 scope 阈值、以 `lastReferencedAt ?? updatedAt` 为基准选择过期记录；
- `installRetention` 在启动时清扫一次，并随 `agent/session-start` 按进程内每小时节流清扫；
- 硬删除 + 数量日志，单条删除失败跳过；`retentionEnabled` 可整体关闭；
- 54 项测试全部通过，typecheck、build 和 npm pack 通过；
- `ctx.jobs` 模型复盘、软删除/archive 以及 retention UI 继续延期。

## 1. 目标

让 `retentionDays` 真正生效：按最近引用时间清理过期记忆，失败类记忆使用更短的保留期，且不触碰 DSH 会话数据。

## 2. 保留策略

- 非 `failure` scope（global/user/project）使用 `retentionDays`（默认 90）；
- `failure` scope（failure/tool-quirk 记忆，即自动捕获或显式保存的失败经验）使用 `failureRetentionDays`（默认 30）；
- 保留基准时间取 `lastReferencedAt ?? updatedAt`；记录被搜索或启动注入引用后，保留时钟重置；
- 记录在 `now - anchor > thresholdDays * 86_400_000` 时过期；
- 时间解析失败（非 ISO 或非法值）的记录不删除，避免坏数据被误删；
- `retentionEnabled: false` 时不做任何清理。

阈值语义：`retentionDays: 0` 表示非失败记忆立即过期（`now - anchor > 0` 即过期）；`failureRetentionDays` 取值范围 1..3650。

## 3. 执行时机

不依赖未确认的定时器 API，采用：

1. 插件 `apply()` 打开存储后立即清扫一次；
2. `agent/session-start` 观察器中节流清扫：进程内最多每小时一次（`lastSweepAt` 内存节流）。

清扫是幂等且轻量的：每次遍历 memories 表、删除过期记录。会话不活跃时不再重复清扫，但每次新会话启动（和插件首次加载）都会保证清理。

## 4. 删除语义

- 硬删除：直接 `storage.table.delete(id)`；
- 单条删除失败只跳过该记录并继续，最后记录删除成功的数量；
- 日志只写数量，不写记录内容、ID、秘密或路径；
- 不清理 `watermarks` 表，不触碰 DSH 原始会话文件/SQLite。

删除后若该事件被 DSH 重放，捕获器会重新捕获（记录重新创建并刷新时间），这是预期的收敛行为。

## 5. Settings

新增：

```ts
retentionEnabled: boolean   // 默认 true
failureRetentionDays: number // 默认 30，范围 1..3650
```

保留现有 `retentionDays`（默认 90，范围 0..3650）。

## 6. 组件

新增 `src/host/retention.ts`：

```ts
export interface RetentionPolicy {
  retentionEnabled: boolean
  retentionDays: number
  failureRetentionDays: number
}

export function selectExpiredRecords(
  entries: Iterable<{ key: string; record: MemoryRecord }> | Iterable<MemoryRecord>,
  now: number,
  policy: RetentionPolicy,
): MemoryRecord[]

export function installRetention(
  ctx: Context,
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean
```

`installRetention`：

- 立即触发首次清扫（fire-and-forget，catch 后只记录稳定 warning）；
- 注册 `agent/session-start` 监听器，按 `lastSweepAt` 节流（每小时最多一次）；
- 用 in-flight 标志防止清扫重叠；
- 返回 disposer，清理监听器。

## 7. 测试策略

### Core/Host

- 普通与 failure 阈值分组生效；
- `lastReferencedAt` 优先于 `updatedAt`；
- 非法时间戳跳过；
- 恰好等于阈值不删除（严格大于）；
- `retentionEnabled: false` 无操作；
- 删除过期、保留新鲜；
- 单条删除失败仍继续且只记录数量；
- 节流：一次会话生命周期内多次 session-start 只触发一次清扫；
- disposer 后不再触发。

### Build

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## 8. 非目标

- 不引入 `ctx.jobs` 或其任务队列（后续模型复盘需要时再引入）；
- 不做软删除、archive 或恢复；
- 不清理 capture 去重状态（依赖 memories 表撤销后自然重建）；
- 不做 retention preview 或 Client UI（后续）；
- 不新增存储表或 domain 版本变更。

## 9. 后续关系

V4.2 让 `retentionDays` 从“可配置但无效”变为真实能力，为后续记忆治理 UI、统计和模型 consolidation 提供基线。