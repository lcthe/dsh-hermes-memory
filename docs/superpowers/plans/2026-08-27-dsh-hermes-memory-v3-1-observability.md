# dsh-hermes-memory V3.1 可观测性与引用新鲜度实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DSH 记忆增加引用时间维护、受限列表和统计工具，为后续 retention、治理 UI 和 cleanup 建立稳定接口。

**Architecture:** 保持 `MemoryRepository` 的异步抽象不变，并新增 list/stats/markReferenced 方法。过滤、排序、统计和输出裁剪使用纯函数；InMemory 与 storage-domain adapter 共享相同语义。搜索和 session-start 注入只在主操作成功后异步更新 `lastReferencedAt`，更新失败通过稳定 warning 隔离，不增加主操作延迟。

**Tech Stack:** TypeScript、DSH `defineTool`、storage-domain `KvTable`、现有 workspace 授权、Node test runner、tsx、tsdown。

## Global Constraints

- 不修改 DSH 源码，不读取 DSH Session SQLite，不引入 Pi runtime、JSONL parser、TUI 或视觉资产。
- `memory_search` 的既有输出格式保持兼容。
- `memory_list` 默认最多 20 条，硬上限 50；每条 content 最多 2,000 字符。
- `lastReferencedAt` 只向前推进，不修改 content、scope、category、provenance 或 `updatedAt`。
- 只在 search 命中或 `agent.inject()` 成功后更新引用时间；list/stats 和注入失败不更新。
- 引用时间更新是 best-effort 旁路操作，任何失败都不能改变主操作结果。
- project 记录继续使用当前 workspace/cwd exact-match 授权，不自行推断 Git root 或 worktree。
- V3.1 不实现自动捕获、后台 review、retention cleanup、eviction、consolidation、FTS 或 `agent/pre-step` 检索。

---

### Task 1: 扩展 repository 接口和纯函数

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/validation.ts`
- Modify: `src/core/memory-repository.ts`
- Modify: `src/host/storage.ts`
- Create: `tests/observability.test.mjs`

**Interfaces:**

```ts
export interface MemoryListInput {
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}

export interface MemoryListResult {
  records: MemoryRecord[]
  total: number
}

export interface MemoryStatsBucket {
  count: number
  chars: number
}

export interface MemoryStatsResult {
  total: number
  totalChars: number
  byScope: Record<MemoryScope, MemoryStatsBucket>
}

export interface MemoryRepository {
  save(input: MemoryInput): Promise<MemoryRecord>
  search(input: MemorySearchInput): Promise<MemorySearchResult>
  list(input: MemoryListInput): Promise<MemoryListResult>
  getStats(projectKey?: string): Promise<MemoryStatsResult>
  markReferenced(ids: readonly string[], at?: string): Promise<void>
  replace(id: string, content: string, category?: MemoryInput['category']): Promise<MemoryRecord>
  remove(id: string): Promise<MemoryRecord>
}
```

- [x] **Step 1: 写失败测试**

在 `tests/observability.test.mjs` 中覆盖：

```js
const records = [
  record('global', 'global', 'preference', 'Answer in Chinese', '2026-08-27T10:00:00.000Z'),
  record('project', 'project', 'convention', 'Use pnpm', '2026-08-27T11:00:00.000Z', '/repo'),
  record('failure', 'failure', 'failure', 'Do not retry blindly', '2026-08-27T12:00:00.000Z'),
  record('other', 'project', 'convention', 'Other project', '2026-08-27T13:00:00.000Z', '/other'),
]

const repository = new InMemoryRepository(records)
const listed = await repository.list({ projectKey: '/repo', limit: 50 })
assert.deepEqual(listed.records.map(record => record.id), ['failure', 'project', 'global'])
assert.equal(listed.total, 3)

const stats = await repository.getStats('/repo')
assert.deepEqual(stats.byScope.project, { count: 1, chars: 9 })
assert.equal(stats.byScope.global.count, 1)
assert.equal(stats.byScope.failure.count, 1)
assert.equal(stats.total, 3)
assert.equal(stats.totalChars, 9 + 16 + 19)

await repository.markReferenced(['global'], '2026-08-27T15:00:00.000Z')
assert.equal((await repository.list({ limit: 50 })).records.find(item => item.id === 'global').lastReferencedAt, '2026-08-27T15:00:00.000Z')
await repository.markReferenced(['global'], '2026-08-27T14:00:00.000Z')
assert.equal((await repository.list({ limit: 50 })).records.find(item => item.id === 'global').lastReferencedAt, '2026-08-27T15:00:00.000Z')
```

还要验证：category/scope 过滤、默认 limit 20、limit 50 截断、其他 project 不计入、空 ID 和不存在 ID 不报错。

- [x] **Step 2: 运行测试确认失败**

```bash
node --import tsx --test tests/observability.test.mjs
```

Expected: FAIL，因为新的接口和实现尚不存在。

- [x] **Step 3: 增加类型和校验常量**

在 `src/core/types.ts` 增加 `MemoryListInput`、`MemoryListResult`、`MemoryStatsBucket`、`MemoryStatsResult`。在 `src/core/validation.ts` 增加：

```ts
export const DEFAULT_LIST_LIMIT = 20
export const MAX_LIST_LIMIT = 50
export const MAX_LIST_CONTENT_CHARS = 2_000
```

增加 `validateListInput()`，要求 limit 为正整数，超过 50 时截断到 50；scope/category 使用现有枚举校验；projectKey trim 后保留为空则视为 undefined。

- [x] **Step 4: 实现纯函数**

在 `src/core/memory-repository.ts` 增加并导出：

```ts
export function listMemoryRecords(
  records: Iterable<MemoryRecord>,
  input: MemoryListInput,
): MemoryListResult

export function summarizeMemoryRecords(
  records: Iterable<MemoryRecord>,
  projectKey?: string,
): MemoryStatsResult
```

`listMemoryRecords()` 使用 scope/category/project 过滤，按 `updatedAt` 降序、`id` 升序排序，返回深拷贝并按 `limit` 截断。projectKey 未定义时排除所有 project 记录；定义时只保留完全相等的 projectKey。

`summarizeMemoryRecords()` 统计 global/user/failure 和匹配 project 的记录；每个 bucket 的 chars 使用 `content.length`；初始化四个 scope bucket，即使数量为零也返回 `{ count: 0, chars: 0 }`。

- [x] **Step 5: 扩展 InMemoryRepository**

让 `InMemoryRepository` 支持可选初始记录数组，新增：

```ts
async list(input: MemoryListInput): Promise<MemoryListResult>
async getStats(projectKey?: string): Promise<MemoryStatsResult>
async markReferenced(ids: readonly string[], at = new Date().toISOString()): Promise<void>
```

`markReferenced()` 对每个已存在 ID 仅在 `lastReferencedAt` 缺失或 `at` 更新时才写回；不存在 ID 忽略；不改变 `updatedAt`。

- [x] **Step 6: 扩展 StorageMemoryRepository**

在 `src/host/storage.ts` 实现相同三个方法。读取仍使用 `storage.table.entries()`；写入引用时间时调用 `table.put(id, updatedRecord)`。单条写入失败继续处理其他 ID，最后抛出一个不含正文的稳定 storage error，供调用方旁路捕获。

- [x] **Step 7: 运行测试并提交**

```bash
node --import tsx --test tests/observability.test.mjs
npm run typecheck
```

Expected: 新测试和类型检查通过。

```bash
git add src/core/types.ts src/core/validation.ts src/core/memory-repository.ts src/host/storage.ts tests/observability.test.mjs
git commit -m "feat: add memory observability repository APIs"
```

---

### Task 2: 新增 memory_list 和 memory_stats 工具

**Files:**
- Modify: `src/host/tools.ts`
- Modify: `src/host/tool-definitions.ts`
- Modify: `tests/tools.test.mjs`

**Interfaces:**

```ts
export interface MemoryToolResult {
  success: boolean
  operation: 'save' | 'search' | 'list' | 'stats' | 'replace' | 'remove'
  records?: unknown[]
  record?: unknown
  total?: number
  stats?: unknown
  error?: { code: string; message: string }
}

export async function listMemory(
  args: { scope?: MemoryScope; category?: MemoryCategory; projectKey?: string; limit?: number },
  exec: ToolRunContext,
  context: ToolContext,
): Promise<MemoryToolResult>

export async function statsMemory(
  args: { projectKey?: string },
  exec: ToolRunContext,
  context: ToolContext,
): Promise<MemoryToolResult>
```

- [x] **Step 1: 写失败工具测试**

验证：

```js
const tools = createMemoryTools({ repository, sessionQuery: fakeSessionQuery })
assert.deepEqual(tools.map(tool => tool.name), [
  'memory_save', 'memory_search', 'memory_replace', 'memory_remove',
  'session_memory_search', 'memory_list', 'memory_stats',
])
```

直接调用 `listMemory()` 和 `statsMemory()`，验证当前 workspace 下 project 授权、默认 project 过滤、显式错误 projectKey 被拒绝、返回内容有界。

- [x] **Step 2: 运行测试确认失败**

```bash
node --import tsx --test tests/tools.test.mjs
```

Expected: FAIL，因为工具和结果类型尚不存在。

- [x] **Step 3: 实现 Host 工具函数**

`listMemory()`：

1. 用 `resolveWorkspace(exec)` 获取当前 project；
2. 若 `args.projectKey` 存在则调用 `authorizeProjectKey()`；
3. 若指定 scope 为 project 且没有 projectKey，则使用当前 workspace project；
4. 若未指定 scope，仍把当前 workspace projectKey 传给 repository，使其他 project 被排除；
5. 调用 repository.list；
6. 对每条 record 的 content 截断至 2,000 字符；
7. 返回 `{ success: true, operation: 'list', records, total }`；
8. 复用现有 `mapMemoryError()`。

`statsMemory()`：

1. 对显式 projectKey 执行 `authorizeProjectKey()`；
2. 未指定时使用当前 workspace projectKey；
3. 调用 repository.getStats(projectKey)；
4. 返回 `{ success: true, operation: 'stats', stats }`；
5. 不调用 `markReferenced()`。

- [x] **Step 4: 注册 DSH 工具**

在 `createMemoryTools()` 末尾增加：

```ts
defineTool({
  name: 'memory_list',
  description: 'List bounded persistent memories visible to the current DSH workspace.',
  parameters: {
    scope: scopeSchema,
    category: categorySchema,
    projectKey: { type: 'string' },
    limit: { type: 'integer' },
  },
  output: { schema: outputSchema, render: renderMemoryResult },
  execute: async (args, exec) => asJsonResult(await listMemory(args, exec, context)),
})

defineTool({
  name: 'memory_stats',
  description: 'Summarize bounded memory counts and character usage for the current workspace.',
  parameters: {
    projectKey: { type: 'string' },
  },
  output: { schema: outputSchema, render: renderMemoryResult },
  execute: async (args, exec) => asJsonResult(await statsMemory(args, exec, context)),
})
```

- [x] **Step 5: 运行工具测试并提交**

```bash
node --import tsx --test tests/tools.test.mjs
npm run typecheck
```

```bash
git add src/host/tools.ts src/host/tool-definitions.ts tests/tools.test.mjs
git commit -m "feat: add memory list and stats tools"
```

---

### Task 3: 接入搜索和启动注入的引用时间旁路更新

**Files:**
- Modify: `src/host/tools.ts`
- Modify: `src/host/memory-injection.ts`
- Modify: `tests/tools.test.mjs`
- Modify: `tests/session-injection.test.mjs`

**Interfaces:**
- `ToolContext.repository.markReferenced()` 是异步旁路接口。
- `installMemoryInjection()` 的 storage 读取和注入行为保持兼容。

- [x] **Step 1: 写失败测试**

增加一个记录 `markReferenced()` 调用的 fake repository，验证：

```js
const result = await searchMemory({ query: 'Chinese' }, exec, context)
assert.equal(result.success, true)
assert.deepEqual(markedIds, ['memory-id'])
```

增加启动注入测试：

```js
state.ctx.emit('agent/session-start', { agent: state.agent, source: 'startup' })
assert.deepEqual(markedIds, ['one'])
```

并验证：

- markReferenced rejection 不改变 search 成功结果；
- `agent.inject()` 抛错时 markedIds 为空；
- list/stats 不会标记引用。

- [x] **Step 2: 实现 search 旁路更新**

在 `searchMemory()` 返回成功结果前后调用：

```ts
const mark = context.repository.markReferenced(result.records.map(record => record.id))
void mark.catch(() => {
  // 只记录稳定 warning；不得把 record/content/error 写入结果或日志
})
```

为避免把 logger 混入现有 `ToolContext`，在 `ToolContext` 增加可选：

```ts
logger?: { warn(message: string): void }
```

若未提供 logger，则静默吞掉旁路失败；Host `apply()` 传入 `ctx.logger`。

- [x] **Step 3: 实现注入旁路更新**

`installMemoryInjection()` 增加 repository 参数，或增加一个只接受 `markReferenced` 的维护接口。只有 `agent.inject()` 成功返回后才调用 `markReferenced(records.map(record => record.id))`。失败时不调用。

旁路 rejection 只调用 logger：

```ts
logger.warn('dsh-hermes-memory: memory reference timestamp update skipped')
```

- [x] **Step 4: 更新 apply wiring**

在 `src/index.ts` 中：

- `createMemoryTools({ repository, sessionQuery: ctx.sessionQuery, logger: ctx.logger })`；
- `installMemoryInjection(ctx, storage, settings, ctx.logger, repository)`；
- 保留现有 disposer 顺序和 session capture 行为。

- [x] **Step 5: 运行测试并提交**

```bash
npm test
npm run typecheck
```

```bash
git add src/host/tools.ts src/host/memory-injection.ts src/index.ts tests/tools.test.mjs tests/session-injection.test.mjs
git commit -m "feat: track memory reference timestamps"
```

---

### Task 4: 同步文档、V3.1 状态和最终验证

**Files:**
- Modify: `docs/requirements.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-1-observability-design.md`

- [x] **Step 1: 更新需求文档**

新增 V3.1 已实现小节，明确：

- `lastReferencedAt` 在搜索命中和成功启动注入后更新；
- `memory_list`、`memory_stats` 已注册；
- list/stats 有界且继承 workspace 授权；
- 更新失败 fail-soft；
- retention cleanup、自动捕获和后台 review 仍延期。

- [x] **Step 2: 更新 README**

在中英文 README 中说明 V3.1 已实现，并增加两个工具名称、引用时间维护和统计能力。保留 V4/V5 的 deferred scope。

- [x] **Step 3: 更新设计规范状态**

将 V3.1 设计规范状态改为“已实现”，记录最终工具顺序、引用时间旁路更新方式和测试数量。

- [x] **Step 4: 运行文档自审**

```bash
grep -nE 'TBD|TODO|待实现|设计已确认' docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-1-observability-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-1-observability.md
```

唯一允许命中的内容是计划自检命令本身；不得存在未完成实现描述。

- [x] **Step 5: 最终验证**

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm pack --dry-run | grep -E 'lib/index.js|lib/client.js|README|cordis.patch.yml'
```

Expected：类型检查通过，所有旧测试和新增测试通过，构建与打包成功，包内不包含 Pi 资产或源码。

- [x] **Step 6: 检查 Git 状态并提交文档**

```bash
git diff --check
git status --short --branch
git add README.md README.zh.md docs/requirements.md docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-1-observability-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-1-observability.md
git commit -m "docs: record v3.1 observability implementation"
```

不自动 push 或发布 npm，除非用户另行明确要求。
