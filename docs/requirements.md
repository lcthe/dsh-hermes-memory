# dsh-hermes-memory 需求文档

## 1. 项目定位

`dsh-hermes-memory` 是一个面向 DSH 的原生记忆插件，为跨会话使用提供可控、可追溯、可清理的本地记忆能力。

插件只依赖 DSH 的 Host、Session、Tool、Settings 和 Storage 扩展能力，不修改 DSH 源码，不替换聊天界面，也不复制任何 Pi 项目的运行时实现或视觉资产。

## 2. 要解决的问题

DSH 会话之间缺少稳定的用户偏好、项目约定和失败经验复用机制。用户需要能够：

- 主动保存重要事实和偏好；
- 在后续会话中检索历史记忆；
- 将记忆限制在全局、用户或项目范围；
- 删除或修正错误记忆；
- 防止 API Key、Token、私钥和提示注入内容进入持久记忆；
- 了解记忆来自哪个会话和事件。

## 3. 用户场景

### 3.1 用户偏好

用户说“以后统一使用中文回答”，模型可以保存为用户级记忆，在后续会话中检索或被明确加载。

### 3.2 项目约定

用户说“这个项目使用 pnpm，禁止直接修改生成文件”，模型可以保存为当前工作区项目记忆。

### 3.3 失败经验

某次工具调用失败后，用户说明正确做法。插件可以保存失败原因和纠正方式，避免未来重复犯错。

### 3.4 记忆维护

用户可以搜索、替换、删除和恢复记忆，避免错误信息永久滞留。

## 4. V1 功能范围（已实现）

### 4.1 显式记忆工具

提供以下 DSH 工具：

- `memory_save`：新增一条记忆；
- `memory_search`：按文本、scope 和 category 搜索；
- `memory_replace`：替换匹配的记忆；
- `memory_remove`：删除匹配的记忆。

### 4.2 记忆范围

- `global`：所有项目可用；
- `user`：用户偏好和个人信息；
- `project`：当前工作区项目约定；
- `failure`：失败、纠正和工具经验。

### 4.3 记忆分类

- `preference`；
- `convention`；
- `insight`；
- `failure`；
- `correction`；
- `tool-quirk`。

### 4.4 持久化

V1 使用 DSH `storage-domain` 保存结构化记录。每条记录至少包含：

- 稳定 ID；
- scope；
- category；
- content；
- createdAt；
- updatedAt；
- optional project key；
- source provenance；
- lastReferencedAt；
- schema version。

### 4.5 安全扫描

写入前必须检测：

- 常见 API Key 和访问 Token；
- 私钥区块；
- 数据库连接串和疑似密码；
- 零宽字符及方向控制字符；
- 常见提示注入和外泄指令。

检测到高风险内容时拒绝持久化，并返回可理解的原因。插件不得把扫描出的原始秘密写入日志、设置或工具结果。

### 4.6 设置

V1 设置至少包括：

- enabled；
- default retrieval limit；
- allowed scopes；
- secret scanning mode；
- retention days；
- project memory enabled；
- automatic capture disabled by default。

敏感设置必须由 DSH secret redaction 处理，浏览器端不能直接读取秘密值。

## 5. 非目标

V1 不包含：

- 插件安装、更新、卸载或商店；
- 修改 DSH 核心源码；
- 替换 DSH `sidebar.settings` 或聊天 shell；
- Pi 命令、Pi TUI、Pi session JSONL 解析器；
- Pi logo、Pi Hermes Memory logo、截图或品牌文案；
- 向量数据库、embedding 生成和语义排序；
- 每一步自动注入记忆；
- 自动模型复盘和后台跨重启队列；
- 将完整记忆数据写入 SessionEvent。

## 6. DSH 集成约束

- Host 侧负责存储、工具、权限和安全扫描；
- Client 侧只负责设置卡片和用户界面；
- 不允许浏览器访问数据库路径或 Node 文件句柄；
- 会话来源使用 DSH session/query API，不读取内部 SQLite 表；
- 若监听 `session/event`，必须保存 source session ID 和 event sequence；
- `session/event` 为提交后的观察流，索引失败不能影响主会话；
- 后台任务使用 `ctx.jobs`，任务状态必须单独持久化；
- 不声明未经 DSH 支持的自定义 SessionEvent 类型。

## 7. V1 验收标准

1. 插件可以构建并由 DSH profile 加载；
2. 四个显式记忆工具均可注册并返回结构化结果；
3. 新增记忆在进程重启后仍可读取；
4. project scope 会绑定当前工作区且不能跨项目误读；
5. secret scanner 能拒绝至少一组 API Key、私钥和提示注入样例；
6. replace/remove 找不到目标时不会破坏其他记录；
7. 设置页可以查看和修改非敏感配置；
8. 单元测试覆盖 scope 过滤、扫描拒绝、持久化恢复和工具参数校验；
9. 项目中不存在 Pi logo、Pi 图片、Pi TUI 或 Pi 运行时依赖；
10. 不修改 DSH 源码。

## 8. V2：会话来源追踪与原生会话搜索（已实现）

V2 采用 DSH 原生 `session/event`、`session/flush` 和 `ctx.sessionQuery`，不复制 Pi 的会话 JSONL 解析器，不建立第二套会话全文索引。

### 8.1 V2 功能

- 维护每个 session 的事件 watermark；
- 记录 `sessionId`、`eventSeq` 和 `flushedSeq` provenance；
- 新增 `session_memory_search` 工具；
- 按当前 workspace 继承 DSH 会话查询授权；
- 返回有上限的 session/date/project/role/snippet 结果；
- 观察或查询失败不影响主会话和 V1 记忆工具。

### 8.2 V2 不做

- 不把完整 transcript 复制到记忆存储；
- 不读取 DSH session SQLite 内部表；
- 不自动将会话内容写成长久记忆；
- 不自动注入记忆；
- 不声明未经 DSH 支持的自定义 SessionEvent。

详细设计见：

`docs/superpowers/specs/2026-08-26-dsh-hermes-memory-v2-session-search-design.md`

### 8.3 V2 验收结果

- `session/event` 只保存 session ID 和 watermark，不保存 transcript；
- `session/flush` 等待同一 session 的事件写入后更新 flushed watermark；
- `session_memory_search` 使用 DSH 原生 `sessionQuery`，结果有 limit 和 snippet 上限；
- 当前 role 过滤支持 `user` 和 `assistant`；
- workspace 不匹配时返回 `session_scope_denied`；
- 观察和查询失败不会影响主会话；
- V2 代码和测试通过 typecheck、17 项测试、build 和 npm pack 检查。


### V3

- 在 `agent/session-start` 注入有限的用户和项目记忆；
- 在 `agent/pre-step` 中提供可选的相关记忆检索；
- 增加 token 上限、去重和递归保护。

### V4

- 使用 `ctx.jobs` 执行空闲复盘；
- 自动合并和淘汰；
- 增加可靠的持久任务队列；
- 在 Host 侧增加可选 FTS5 或混合检索索引。
