# dsh-hermes-memory

面向 DeepSeek Harness（DSH）的原生持久记忆、安全检索和会话关联插件。

## 当前状态

V4.2 已在本地实现。过期记忆会按保留策略清理：普通记忆用 `retentionDays`（90 天），失败记忆用 `failureRetentionDays`（30 天），基准为 `lastReferencedAt ?? updatedAt`。清理在启动时执行一次，并随会话启动按进程内每小时节流执行，可整体关闭。后台模型复盘、记忆管理 UI 和向量检索仍然延期。

## 项目边界

这是一个全新的 DSH 插件，不复制 Pi 的运行时代码、命令、终端 UI、品牌名称、Logo、截图或其他视觉资产，只借鉴作用域记忆、来源追踪、全文检索、纠正记录和安全扫描等通用设计思想。

## V1 范围

- `memory_save`、`memory_search`、`memory_replace`、`memory_remove` 显式工具；
- 全局、用户、项目和失败记忆；
- 记忆来源包含 DSH 会话 ID 和事件序号；
- 通过 DSH 原生 `sessionQuery` 提供 `session_memory_search`；
- 可选的 V3 新会话启动参考记忆注入，默认关闭；
- V3.1 `memory_list`、`memory_stats` 和 `lastReferencedAt` 引用时间维护；
- V4 规则型会话捕获（偏好/约定/纠正，默认关闭）；
- V4.1 纠正与同轮失败工具调用的关联捕获（tool-quirk，默认开启但受自动捕获总开关控制）；
- V4.2 过期记忆清理（`retentionDays`/`failureRetentionDays`，启动 + 会话节流清扫）。

## 暂不实现

- 每一步自动注入；
- 后台模型复盘和自动合并；
- 向量或 embedding 检索；
- 自定义会话数据库；
- 替换 DSH 聊天界面或设置 shell。

## 文档

- 需求：`docs/requirements.md`
- 设计规范：`docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`
- V3 设计：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md`
- V3 计划：`docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md`
- V3.1 设计：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-1-observability-design.md`
- V3.1 计划：`docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-1-observability.md`
- V4 设计：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-capture-design.md`
- V4 计划：`docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v4-capture.md`
- V4.1 设计：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-1-tool-context-design.md`
- V4.1 计划：`docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v4-1-tool-context.md`
- V4.2 设计：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-2-retention-design.md`
- V4.2 计划：`docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v4-2-retention.md`

## 许可证

MIT。实现将使用 DSH 专用原创代码，不会携带 Pi 项目的品牌或视觉资源。
