# dsh-hermes-memory V4.1 工具失败上下文捕获实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 V4 规则捕获之上，把用户纠正与同一轮对话中失败的工具调用关联，额外保存 `failure/tool-quirk` 记忆。

**Architecture:** 捕获器按 session 维护 `lastUserSeq`、`lastToolCall`、`lastFailure` 状态；`tool/call` 与 `tool/result` 事件更新状态，`user/message` 纠正命中时按 `errorSeq > lastUserSeq` 判定配对，再保存 correction 与 tool-quirk 两条记录。事件幂等升级为按 scope + category 判断。

**Tech Stack:** TypeScript、DSH `session/event`、现有 storage/repository、Schemastery、设置页、Node test runner。

## Global Constraints

- 不修改 DSH 源码，不读取 Session SQLite，不引入 Pi 资产。
- `toolName` 只来自 `tool/call.name`；工具名无法解析时跳过配对，保留普通 correction。
- 同一失败上下文最多配对一次（由 `errorSeq > lastUserSeq` 保证）。
- 不把工具参数、错误原文、用户消息正文写入日志。
- 不新增存储表，不升级 domain version，不改变 provenance schema。

## 实现步骤（已完成）

- [x] 设计规范提交：`docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-1-tool-context-design.md`
- [x] Settings 增加 `captureToolContext`（默认 true），同步 schema、客户端 fallback、设置卡片和中英文 locale
- [x] `src/host/auto-capture.ts` 增加 session 状态追踪与 tool/call、tool/result 事件处理
- [x] 事件幂等按 scope + category 判断，pair 记录共享用户事件 seq
- [x] `src/client/index.ts` fallback 同步默认值
- [x] 新增配对、单次消费、开关关闭、重放幂等、工具名缺失回退等测试用例
- [x] `npm test`（49 项）、`npm run typecheck`、`npm run build`、`npm pack --dry-run` 全部通过
- [ ] README、requirements 与设计状态文档同步（见 Task 4）

## 验证命令

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected：全部通过；打包不包含 Pi 资产。