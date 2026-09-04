# dsh-hermes-memory V7 设计规范：安全自动整理与合并

**日期：** 2026-09-04
**状态：** 待实现

## 1. 目标

V7 为普通记忆增加手动和自动 consolidation。它在单个授权 scope 的有效内容达到配置阈值时，让结构化输出子 agent 生成合并方案，再由 Host 校验并以可恢复的分阶段流程提交。失败、取消或进程退出不能导致原始记忆丢失。

常驻上下文和技能记录不参与普通记忆 consolidation，分别由各自能力管理。

## 2. 触发方式和预算

新增 `memory_consolidate` 工具，支持当前用户明确触发 global、user、当前 project 或 failure scope 的整理。自动整理在 session flush 后复用 DSH `jobs` 和结构化输出 `subagents` 服务，仅在以下条件满足时调度：

- 插件和 `automaticConsolidation` 均启用；
- 目标 scope 的字符数达到 `consolidationThresholdChars`；
- 没有同一 scope/project 的运行中任务；
- 有支持结构化输出的 provider；
- 距离上次完成的整理存在新记忆或更新。

默认设置为：自动整理关闭、触发阈值 40,000 字符、目标上限 28,000 字符、一次最多读取 100 条、一次最多产生 20 条替代记录。所有设置都有固定校验范围。

## 3. 模型输出

模型只能返回有界的合并组：

```ts
interface ConsolidationGroup {
  sourceIds: string[]
  category: MemoryCategory
  content: string
}
```

每个组至少包含两个互不重复的来源 ID。一次计划内的来源 ID 不能重复出现。模型不能更改 scope、project key、权限、来源记录或常驻上下文，也不能提出任意删除操作。

Host 在模型调用前使用稳定顺序和字符预算构造最小输入；模型返回后重新校验结构、来源存在性、scope/project 一致性、内容长度、安全扫描、计划内唯一性和目标预算。只有在按有效组计算的预计结果不超过目标上限时才允许提交；任一组无效只跳过该组，没有有效组或剩余计划仍超出目标时不修改存储。

## 4. 可恢复提交

新增 `consolidations` 状态表。每个任务以稳定 ID 保存目标 scope/project、来源 ID、候选替代记录、状态和时间戳。状态依次为：

```text
prepared -> replacements-written -> completed
                              \-> failed
```

提交顺序：

1. 完整校验计划并持久化 `prepared` 状态；
2. 使用任务 ID 派生稳定替代记录 ID，幂等写入所有替代记录；
3. 标记 `replacements-written`；
4. 再删除计划覆盖的原始记录；
5. 标记 `completed`。

任何删除都必须发生在全部替代记录成功持久化之后。启动时协调器恢复未完成任务：`prepared` 重试幂等写入，`replacements-written` 完成旧记录删除。若状态或记录不一致，保留原始记录并标记稳定失败码，不猜测修复。

替代记录保留 consolidation provenance，包括任务 ID 和来源 ID。用户仍可通过现有 list/search/remove 工具管理结果。

## 5. 并发、取消和错误

同一 scope/project 的 consolidation 串行执行，不同 scope 可以独立运行。任务从读取快照到提交前必须重新读取来源记录；若来源已被用户替换或删除，该组作废，不覆盖用户的新修改。

模型调用取消、provider 错误、输出无效或预算不足时不写入计划。状态写入或替代记录写入失败时不删除来源。日志只包含任务状态、scope 和计数，不包含记忆原文、模型输出或秘密。

## 6. 测试和验收

- 未达到阈值、设置关闭或无 provider 时不自动调度；
- 手动工具遵守 workspace 授权；
- 模型不能跨 scope/project 合并或直接删除；
- 无效组不会影响有效组和现有记录；
- 替代记录全部落盘前不会删除任何来源；
- 在每个持久化步骤注入失败后，恢复流程都不丢失记忆；
- 用户并发修改过的来源不会被旧计划删除；
- 重复调度和进程恢复保持幂等；
- scanner、预算、状态转换、取消和 teardown 有聚焦测试；
- typecheck、测试、build 和打包检查通过。

## 7. 非目标

- 不建设向量数据库或自定义 session 索引；
- 不整理常驻上下文或技能；
- 不允许模型直接调用 replace/remove；
- 不保证跨设备分布式锁；当前存储域和进程生命周期仍是权威执行边界。
