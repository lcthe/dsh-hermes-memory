# dsh-hermes-memory

面向 DeepSeek Harness（DSH）的原生持久记忆、安全检索和会话关联插件。

## 当前状态

V2 已在本地实现完成，当前提供显式记忆工具、storage-domain 持久化、安全扫描、工作区授权、设置卡片、会话来源追踪、每会话 watermark，以及基于 DSH 原生 `sessionQuery` 的 `session_memory_search`。自动注入、后台复盘和向量检索仍属于后续版本。

## 项目边界

这是一个全新的 DSH 插件，不复制 Pi 的运行时代码、命令、终端 UI、品牌名称、Logo、截图或其他视觉资产，只借鉴作用域记忆、来源追踪、全文检索、纠正记录和安全扫描等通用设计思想。

## V1 范围

- `memory_save`、`memory_search`、`memory_replace`、`memory_remove` 显式工具；
- 全局、用户、项目和失败记忆；
- 记忆来源包含 DSH 会话 ID 和事件序号；
- 通过 DSH 原生 `sessionQuery` 提供 `session_memory_search`；
- 维护每个会话的事件和 flush watermark，但不复制会话正文。

## 暂不实现

- 每一步自动注入；
- 后台模型复盘和自动合并；
- 向量或 embedding 检索；
- 自定义会话数据库；
- 替换 DSH 聊天界面或设置 shell。

## 文档

- 需求：`docs/requirements.md`
- 设计规范：`docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`
- V2 设计：`docs/superpowers/specs/2026-08-26-dsh-hermes-memory-v2-session-search-design.md`
- V2 计划：`docs/superpowers/plans/2026-08-26-dsh-hermes-memory-v2-session-search.md`

## 许可证

MIT。实现将使用 DSH 专用原创代码，不会携带 Pi 项目的品牌或视觉资源。
