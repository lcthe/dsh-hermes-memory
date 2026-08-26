# dsh-hermes-memory 设计规范

**日期：** 2026-08-26  
**状态：** V1 已实现；V2 会话来源追踪与原生会话搜索设计已确认

## 1. 设计目标

构建一个 DSH 原生、低耦合、可追溯的持久记忆插件。第一阶段只交付显式记忆工具和安全持久化，后续通过 DSH 已有生命周期扩展点逐步增加会话捕获、自动注入和后台学习。

核心原则：

1. 记忆状态不进入 DSH SessionEvent 主日志；
2. Host 负责所有 Node、文件、存储、权限和敏感数据处理；
3. Client 只通过公开 API 和 slots 访问数据；
4. 所有记忆写入都经过安全扫描；
5. 每条记忆都保存来源和工作区范围；
6. 失败时尽量返回结构化错误，不阻塞主会话；
7. 代码和视觉资产全部为 DSH 项目原创，不复制 Pi 运行时或品牌资产。

## 2. 方案选择

### 方案 A：只使用 settings namespace

把记忆直接保存到 DSH settings。

**不采用。** Settings 适合用户配置，不适合高频、可搜索、带来源和生命周期的记忆记录。并且会让设置文档膨胀，难以分页和维护。

### 方案 B：插件私有 SQLite

在 Host 侧自带 `better-sqlite3` 和 FTS5。

**暂不作为 V1。** 搜索能力好，但引入 native ABI、数据库迁移和打包复杂度。V1 应先验证记忆语义和 DSH 工具边界。

### 方案 C：storage-domain 记忆核心，后续可插入索引

使用 DSH `storage-domain` 保存 schema-validated 记录，设计独立的 `MemoryRepository` 接口；未来可添加 FTS5 或向量索引实现。

**采用。** 与 DSH 原生能力一致，安装稳定，便于测试，也保留后续替换存储实现的边界。

## 3. 总体架构

```text
┌────────────────────────────────────────────┐
│ DSH Host                                   │
│                                            │
│  tools ───────┐                            │
│  settings ────┼──> memory service           │
│  session/event┘       │                     │
│                       ├── scanner           │
│                       ├── repository        │
│                       ├── scope resolver    │
│                       └── provenance        │
└───────────────────────┼────────────────────┘
                        │ public API / slots
┌───────────────────────▼────────────────────┐
│ DSH Client                                 │
│  settings plugin card                      │
│  memory list/search UI (later)              │
└────────────────────────────────────────────┘
```

目录边界：

```text
src/core   纯 TypeScript 领域模型和规则，不导入 DSH
src/host   DSH Host 插件、工具、存储和生命周期适配
src/client DSH Client 设置入口和本地化
```

## 4. 核心领域模型

```ts
export type MemoryScope = 'global' | 'user' | 'project' | 'failure'

export type MemoryCategory =
  | 'preference'
  | 'convention'
  | 'insight'
  | 'failure'
  | 'correction'
  | 'tool-quirk'

export interface MemoryProvenance {
  source: 'explicit' | 'session' | 'tool' | 'import'
  sessionId?: string
  eventSeq?: number
  projectKey?: string
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
  createdAt: string
  updatedAt: string
  lastReferencedAt?: string
  provenance: MemoryProvenance
  schemaVersion: 1
}
```

V1 使用稳定 ID 和显式 schema version，避免未来迁移时无法识别旧记录。

## 5. 存储设计

Host 启动时打开一个命名 storage domain，例如：

```text
ctx.storageDomain.open({ name: 'dsh-hermes-memory', ... })
```

建议的逻辑表：

```text
memories
memory_meta
pending_operations
```

V1 至少保存：

- `memories`：记忆记录；
- `memory_meta.schemaVersion`：存储版本；
- `memory_meta.lastMigration`：迁移状态。

`pending_operations` 在 V1 只保留接口，不启用后台模型任务。后续用于记录 session capture 和学习任务的 watermark。

所有写入通过 repository 串行执行，不允许在 Client 侧直接修改存储。

## 6. 工具契约

### memory_save

```ts
interface MemorySaveArgs {
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
}
```

规则：

- `content` 去除首尾空白后不得为空；
- `project` scope 必须具有当前工作区 project key；
- `projectKey` 不能由任意调用方绕过 workspace authorization；
- 通过 scanner 后才写入；
- 返回新记录摘要和 provenance。

### memory_search

```ts
interface MemorySearchArgs {
  query: string
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}
```

规则：

- 默认最多返回 10 条，硬上限 20 条；
- project scope 只允许当前 workspace；
- 结果按 scope、更新时间和简单文本匹配排序；
- 不把未授权项目记忆混入结果；
- 结果中不返回扫描器内部规则详情。

### memory_replace

```ts
interface MemoryReplaceArgs {
  id: string
  content: string
  category?: MemoryCategory
}
```

V1 使用稳定 ID 替换，避免模糊文本替换误伤其他记录。替换后的内容重新扫描并更新 `updatedAt`。

### memory_remove

```ts
interface MemoryRemoveArgs {
  id: string
}
```

删除不存在的 ID 返回结构化 `not_found`，不影响其他记录。

## 7. 安全扫描

扫描器位于 `src/core/content-scanner.ts`，不读取 DSH Context。输出统一结果：

```ts
interface ScanResult {
  allowed: boolean
  reason?: 'secret' | 'invisible-character' | 'prompt-injection' | 'exfiltration'
  ruleId?: string
}
```

扫描器不返回原始匹配内容，不向日志输出用户秘密。工具层只展示用户可理解的分类提示。

## 8. 会话集成策略

V1 不自动捕获会话，仅保留接口。

V2 使用 DSH `session/event`：

```text
session/event
  → normalized event
  → candidate extractor
  → memory repository
```

由于 `session/event` 是 post-commit observer，写入失败不影响会话；每个候选记忆保存 `sessionId` 和 `eventSeq`。

V2 使用 `session/flush` 作为可选 durability checkpoint，不能假设观察器参与主事务。

V2 已实现的会话来源追踪与原生会话搜索详见：

`docs/superpowers/specs/2026-08-26-dsh-hermes-memory-v2-session-search-design.md`

V1 不自动注入。

未来版本：

- `agent/session-start`：注入少量用户和项目记忆；
- `agent/pre-step`：根据当前消息检索相关记忆；
- 限制最大 token；
- 当前 step 排除；
- 记忆去重；
- 记录注入来源；
- 防止工具调用触发无限检索递归。

## 10. 设置与客户端

Host 注册唯一 settings namespace：

```text
memory
```

Client 通过 `settings.plugin.item` 提供设置卡片。设置卡片只显示：

- 启用状态；
- 默认搜索条数；
- 允许的 scope；
- 安全扫描模式；
- 项目记忆开关；
- 保留天数。

不在浏览器端暴露：

- 数据库路径；
- Node 文件句柄；
- 原始秘密；
- 未脱敏的 host 内部错误。

## 11. 错误处理

错误分为：

- `invalid_args`：参数不合法；
- `unauthorized_scope`：越过工作区范围；
- `blocked_content`：安全扫描拒绝；
- `not_found`：目标记忆不存在；
- `storage_unavailable`：存储暂时不可用；
- `migration_failed`：版本迁移失败。

工具必须返回稳定的错误 code 和用户可读 message。存储写入失败不吞掉错误，也不暴露内部路径和堆栈。

## 12. 测试设计

V1 测试分为：

### Core 单元测试

- scope 和 category 校验；
- project key 校验；
- scanner 阻断秘密和注入；
- 空内容和超长内容；
- 排序和 limit；
- schema version。

### Host 集成测试

- storage domain 打开和恢复；
- 四个工具注册；
- save → search → replace → remove 完整流程；
- workspace 授权；
- 结构化错误结果。

### Build 验证

```text
npm run typecheck
npm run build
npm test
```

## 13. 资产与许可证约束

- 项目名称固定为 `dsh-hermes-memory`；
- 不使用 Pi Hermes Memory 的 logo、图标、截图、流程图、配色或品牌文案；
- 不复制 Pi 专属入口、TUI、session JSONL 解析和命令实现；
- 仅借鉴公开的通用工程概念；
- 新代码采用本项目自己的 MIT 许可证和 DSH 命名；
- 如果未来直接复制第三方代码，必须先确认许可证、保留版权和分离来源文件。
