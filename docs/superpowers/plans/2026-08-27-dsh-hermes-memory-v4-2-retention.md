# dsh-hermes-memory V4.2 retention 清理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `retentionDays` 真正生效，按最近引用时间清理过期记忆，失败记忆使用更短保留期。

**Architecture:** 新增 `src/host/retention.ts`，包含纯函数 `selectExpiredRecords` 与安装器 `installRetention`。清扫在插件启动时立即执行一次，并在 `agent/session-start` 中按进程内节流（每小时最多一次）执行；硬删除 + 数量日志，单条失败跳过。

**Tech Stack:** TypeScript、storage-domain `KvTable`、`agent/session-start`、Schemastery、设置页、Node test runner。

## Global Constraints

- 不修改 DSH 源码，不读取 Session SQLite，不引入 Pi 资产。
- 保留基准取 `lastReferencedAt ?? updatedAt`；非法时间戳不删除。
- 只在 `now - anchor > thresholdDays * 86_400_000` 时过期（严格大于）。
- `failure` scope 使用 `failureRetentionDays`，其余使用 `retentionDays`。
- `retentionEnabled: false` 或插件 `enabled: false` 时不做清理。
- 硬删除；日志只记录数量，不记录内容、ID、秘密或路径。
- 不清理 `watermarks` 表，不触碰 DSH 会话数据。
- 不新增存储表，不升级 domain version。

## 实现步骤（已完成）

- [x] 设计规范提交：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-2-retention-design.md`
- [x] Settings 增加 `retentionEnabled`（默认 true）与 `failureRetentionDays`（默认 30，范围 1..3650），保留 `retentionDays`（0..3650）
- [x] `src/host/retention.ts` 实现 `selectExpiredRecords` 与 `installRetention`
- [x] `src/index.ts` 接入安装器并在 teardown 释放
- [x] 设置卡新增「启用过期清理」开关与「失败记忆保留天数」输入，中英文 locale 同步
- [x] 新增纯函数阈值/基准/非法时间戳/禁用用例与安装器删除/节流/单条失败用例
- [x] `npm test`（54 项）、`npm run typecheck`、`npm run build` 通过
- [ ] README、requirements 与设计状态文档同步（见 Task 4）

## 验证命令

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected：全部通过；打包不包含 Pi 资产。