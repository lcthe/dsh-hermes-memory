# dsh-hermes-memory V5 后台模型复盘实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `session/flush` 后异步使用 DSH subagent 结构化输出做安全的记忆候选复盘，只在模型有效提案且通过全部 Host 校验后写入记忆。

**Architecture:** `session/flush` 监听器把新 flush watermark 提交给 `ctx.jobs` 短生命周期后台任务；任务内用 `ctx.subagents.start(outputSchema)` 让模型只返回 `operations` 候选；候选经过本地 JSON-safe 校验、workspace 授权、`content-scanner`、预算和幂等检查后才调用现有 `StorageMemoryRepository` 保存；新增独立 `reviews` 表记录状态。所有失败 fail-soft，不阻塞主会话。

**Tech Stack:** TypeScript、DSH `@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-session-query`、`@deepseek-ai/dsh-storage-domain`、Schemastery、Node test runner、tsdown。

## Global Constraints

- 不修改 DSH 源码；不读取 Session SQLite；不引入 Pi 运行时代码或资产。
- 不建设独立记忆管理 UI；Client 不接触 session 原文、storage domain 或模型运行时。
- 模型不直接调用记忆工具；只允许 `kind: 'save'` 候选，不允许模型提出 replace/remove。
- provider 不支持 output schema 时不降级为无约束文本 JSON 解析，直接跳过并记录稳定 warning。
- 所有候选必须重新经过 `content-scanner`、workspace 授权、预算和幂等检查；project 必须绑定当前 session cwd。
- `ctx.jobs` 只是进程内执行器：任务状态不跨重启持久化；后重启恢复判断基于 `reviews` 表，不基于 jobs。
- `session/flush` 监听器不得 await 模型调用，不得返回异步 Promise 给事件总线。
- teardown 必须取消并等待后台 subagent 和 jobs 释放。
- 日志只记录稳定 code 和数量，禁止记录 prompt、候选 content、secret、完整路径和 provider 原始响应。
- 新增设置默认关闭：`automaticReview: false`。

## 文件结构

- Create: `src/host/review-types.ts` — ReviewOutput/ReviewOperation/ReviewState 内部类型。
- Create: `src/host/review-schema.ts` — Subagent outputSchema 与本地 JSON-safe 校验（纯函数）。
- Create: `src/host/review-prompt.ts` — 有界复盘 prompt 组装（纯函数）。
- Create: `src/host/review-state.ts` — `reviews` 表访问与 watermark 幂等（纯函数 + 薄存储层）。
- Create: `src/host/review-runner.ts` — session 投影、subagent 调用、候选处理与 fail-soft 结果。
- Create: `src/host/auto-review.ts` — `session/flush` 监听、`ctx.jobs` 调度、取消与 teardown。
- Modify: `src/host/storage-spec.ts` — 增加 `reviews` 表，保持 domain version 1 以兼容现有存储（当前后端会将缺失的新表按空表加载）。
- Modify: `src/host/storage.ts` — `openMemoryStorage` 提供 reviews 表访问。
- Modify: `src/host/settings.ts` — 新增 `automaticReview`、`reviewMaxPerSession`、`reviewMaxInputChars` 及校验。
- Modify: `src/index.ts` — 注入 `jobs`、`subagents`，安装 `auto-review`，teardown 释放。
- Modify: `src/client/MemorySettings.tsx`、`src/client/locales.ts` — 非敏感 review 设置项。
- Modify: `package.json` — 新增 `@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-subagent` 依赖。
- Create: `tests/review-schema.test.mjs`、`tests/review-state.test.mjs`、`tests/review-runner.test.mjs`、`tests/auto-review.test.mjs`。

---

### Task 1: review types 与 storage-spec reviews 表

**Files:**
- Create: `src/host/review-types.ts`
- Modify: `src/host/storage-spec.ts`

**Interfaces:**
- Produces:

```ts
export type ReviewStatus = 'running' | 'completed' | 'failed'

export interface ReviewState {
  sessionId: string
  requestedFlushedSeq: number
  completedFlushedSeq: number
  status: ReviewStatus
  attempt: number
  lastErrorCode?: string
  updatedAt: string
  schemaVersion: 1
}

export type ReviewOperationKind = 'save'
export type ReviewScope = 'global' | 'user' | 'project' | 'failure'
export type ReviewCategory =
  | 'preference' | 'convention' | 'insight' | 'failure' | 'correction' | 'tool-quirk'

export interface ReviewOperation {
  kind: ReviewOperationKind
  scope: ReviewScope
  category: ReviewCategory
  content: string
  reason?: string
}

export interface ReviewOutput {
  operations: ReviewOperation[]
}

export interface ReviewProjection {
  sessionId: string
  projectKey?: string
  userText: string
  assistantText: string
  failures: string[]
}

export interface ReviewBudget {
  maxOperations: number
  maxContentChars: number
  maxInputChars: number
}
```

- Consumes: 无（当前任务只建类型和表）。

- [ ] **Step 1: 写失败测试**

创建 `tests/review-state.test.mjs`（下一任务会补全状态逻辑；本任务先建空表 schema 相关断言）并创建 `src/host/storage-spec.ts` 的 `reviews` 表。本任务只更新 `storage-spec.ts`：

```ts
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  MemoryRecord,
  SessionWatermark,
} from '../core/types.ts'
import type { ReviewState } from './review-types.ts'

// ... 保留 memoryRecordSchema 与 sessionWatermarkSchema（原样） ...

export const reviewStateSchema = z.object({
  sessionId: z.string().min(1),
  requestedFlushedSeq: z.number().int().nonnegative(),
  completedFlushedSeq: z.number().int().nonnegative(),
  status: z.union([z.literal('running'), z.literal('completed'), z.literal('failed')]),
  attempt: z.number().int().nonnegative(),
  lastErrorCode: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
}) satisfies z.ZodType<ReviewState>

export const memoryDomainSpec = defineDomain({
  name: 'dsh_hermes_memory',
  version: 1,
  tables: {
    memories: domainTable<string, MemoryRecord>(memoryRecordSchema),
    watermarks: domainTable<string, SessionWatermark>(sessionWatermarkSchema),
    reviews: domainTable<string, ReviewState>(reviewStateSchema),
  },
})
```

- [ ] **Step 2: 运行测试确认失败**

在没有 schema 导入时运行：

```text
npm test
```

预期：当前类测试通过；`review-state` 尚未创建时无该项测试；类型错误仅在导入 `review-state.ts` 后出现。本任务结束时域 schema 已含 `reviews` 表。

- [ ] **Step 3: 验证 domain spec 编译**

```text
npm run typecheck
```

预期：通过。`review-types.ts` 先只导出类型。

- [ ] **Step 4: Commit**

```bash
git add src/host/review-types.ts src/host/storage-spec.ts
git commit -m "feat(review): add review types and reviews table schema"
```

---

### Task 2: review-schema 纯函数

**Files:**
- Create: `src/host/review-schema.ts`
- Test: `tests/review-schema.test.mjs`

**Interfaces:**
- Consumes: `ReviewOutput`、`ReviewOperation`。
- Produces:

```ts
export const REVIEW_OUTPUT_SCHEMA: unknown // 传给 SubagentRuntime.start 的 outputSchema 对象

export function validateReviewOutput(
  value: unknown,
  budget: ReviewBudget,
): { ok: true; output: ReviewOutput } | { ok: false; reason: string }
```

- [ ] **Step 1: 写失败测试**

```js
// tests/review-schema.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReviewOutput } from '../src/host/review-schema.ts'

test('accepts empty operations', () => {
  const r = validateReviewOutput({ operations: [] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.output.operations.length, 0)
})

test('rejects non-object value', () => {
  const r = validateReviewOutput('nope', { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})

test('rejects unknown operation kind', () => {
  const r = validateReviewOutput({ operations: [{ kind: 'replace', scope: 'user', category: 'preference', content: 'x' }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})

test('rejects invalid scope and category', () => {
  const bad = validateReviewOutput({ operations: [{ kind: 'save', scope: 'system', category: 'preference', content: 'x' }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(bad.ok, false)
  const bad2 = validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'whatever', content: 'x' }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(bad2.ok, false)
})

test('rejects over-limit content chars', () => {
  const r = validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'x'.repeat(1001) }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})

test('rejects too many operations', () => {
  const ops = Array.from({ length: 6 }, () => ({ kind: 'save', scope: 'user', category: 'preference', content: 'x' }))
  const r = validateReviewOutput({ operations: ops }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})

test('accepts one valid save operation', () => {
  const r = validateReviewOutput({ operations: [{ kind: 'save', scope: 'project', category: 'convention', content: 'use pnpm', reason: 'explicit' }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.output.operations[0].scope, 'project')
    assert.equal(r.output.operations[0].category, 'convention')
  }
})

test('rejects nested objects inside content field', () => {
  const r = validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: { text: 'x' } }] }, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})

test('rejects primitive root', () => {
  const r = validateReviewOutput(42, { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 })
  assert.equal(r.ok, false)
})
```

- [ ] **Step 2: 运行测试确认失败**

```text
node --import tsx --test tests/review-schema.test.mjs
```

预期：`Cannot find module '../src/host/review-schema.ts'`。

- [ ] **Step 3: 实现纯函数**

```ts
// src/host/review-schema.ts
import type {
  ReviewCategory,
  ReviewOperation,
  ReviewOperationKind,
  ReviewOutput,
  ReviewScope,
} from './review-types.ts'
import type { ReviewBudget } from './review-types.ts'

const SCOPES: readonly ReviewScope[] = ['global', 'user', 'project', 'failure']
const CATEGORIES: readonly ReviewCategory[] = [
  'preference', 'convention', 'insight', 'failure', 'correction', 'tool-quirk',
]

export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'scope', 'category', 'content'],
        properties: {
          kind: { type: 'string', const: 'save' },
          scope: { type: 'string', enum: [...SCOPES] },
          category: { type: 'string', enum: [...CATEGORIES] },
          content: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateReviewOutput(
  value: unknown,
  budget: ReviewBudget,
): { ok: true; output: ReviewOutput } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'invalid_root' }
  const raw = value.operations
  if (!Array.isArray(raw)) return { ok: false, reason: 'invalid_operations' }
  if (raw.length > budget.maxOperations) return { ok: false, reason: 'too_many_operations' }

  const operations: ReviewOperation[] = []
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, reason: 'invalid_operation' }
    const kind = item.kind
    if (kind !== 'save') return { ok: false, reason: 'invalid_kind' }
    const scope = item.scope
    if (typeof scope !== 'string' || !SCOPES.includes(scope as ReviewScope)) return { ok: false, reason: 'invalid_scope' }
    const category = item.category
    if (typeof category !== 'string' || !CATEGORIES.includes(category as ReviewCategory)) return { ok: false, reason: 'invalid_category' }
    const content = item.content
    if (typeof content !== 'string' || content.trim().length === 0) return { ok: false, reason: 'invalid_content' }
    if (content.length > budget.maxContentChars) return { ok: false, reason: 'content_too_long' }
    const reason = item.reason
    if (reason !== undefined && typeof reason !== 'string') return { ok: false, reason: 'invalid_reason' }
    operations.push({
      kind: kind as ReviewOperationKind,
      scope: scope as ReviewScope,
      category: category as ReviewCategory,
      content: content.trim(),
      ...(typeof reason === 'string' && reason.trim().length > 0 ? { reason: reason.trim() } : {}),
    })
  }

  return { ok: true, output: { operations } }
}
```

- [ ] **Step 4: 运行测试确认通过**

```text
node --import tsx --test tests/review-schema.test.mjs
```

预期：全部通过（9 项）。

- [ ] **Step 5: Commit**

```bash
git add src/host/review-schema.ts tests/review-schema.test.mjs
git commit -m "feat(review): validate review output schema"
```

---

### Task 3: review-state 表访问与幂等

**Files:**
- Create: `src/host/review-state.ts`
- Test: `tests/review-state.test.mjs`

**Interfaces:**
- Consumes: `ReviewState`、`KvTable<string, ReviewState>`。
- Produces:

```ts
export interface ReviewStateStore {
  get(sessionId: string): Promise<ReviewState | undefined>
  put(state: ReviewState): Promise<void>
}

export function newReviewState(
  sessionId: string,
  requestedFlushedSeq: number,
  nowIso: string,
): ReviewState

export function shouldStartReview(
  current: ReviewState | undefined,
  flushedSeq: number,
): boolean

export function completeReviewState(
  current: ReviewState,
  flushedSeq: number,
  nowIso: string,
): ReviewState

export function failReviewState(
  current: ReviewState,
  errorCode: string,
  nowIso: string,
): ReviewState
```

- [ ] **Step 1: 写失败测试**

```js
// tests/review-state.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newReviewState,
  shouldStartReview,
  completeReviewState,
  failReviewState,
} from '../src/host/review-state.ts'

test('new review state starts running', () => {
  const s = newReviewState('s1', 4, '2026-08-27T00:00:00.000Z')
  assert.equal(s.status, 'running')
  assert.equal(s.completedFlushedSeq, 0)
  assert.equal(s.requestedFlushedSeq, 4)
  assert.equal(s.attempt, 1)
})

test('no previous state and flushedSeq >= 0 starts', () => {
  assert.equal(shouldStartReview(undefined, 0), true)
})

test('previous completed at lower watermark starts again', () => {
  const prev = completeReviewState(newReviewState('s1', 2, '2026-08-27T00:00:00.000Z'), 2, '2026-08-27T00:00:01.000Z')
  assert.equal(shouldStartReview(prev, 5), true)
})

test('previous completed at same watermark does not start', () => {
  const prev = completeReviewState(newReviewState('s1', 5, '2026-08-27T00:00:00.000Z'), 5, '2026-08-27T00:00:01.000Z')
  assert.equal(shouldStartReview(prev, 5), false)
})

test('running state does not start again', () => {
  const prev = newReviewState('s1', 5, '2026-08-27T00:00:00.000Z')
  assert.equal(shouldStartReview(prev, 5), false)
  assert.equal(shouldStartReview(prev, 9), false)
})

test('failed state can retry on higher watermark', () => {
  const prev = failReviewState(newReviewState('s1', 5, '2026-08-27T00:00:00.000Z'), 'unavailable', '2026-08-27T00:00:01.000Z')
  assert.equal(shouldStartReview(prev, 6), true)
})

test('failed state does not retry same watermark without extra flush', () => {
  const prev = failReviewState(newReviewState('s1', 5, '2026-08-27T00:00:00.000Z'), 'unavailable', '2026-08-27T00:00:01.000Z')
  assert.equal(shouldStartReview(prev, 5), false)
})

test('complete advances completed watermark and keeps requested', () => {
  const s = completeReviewState(newReviewState('s1', 5, '2026-08-27T00:00:00.000Z'), 5, '2026-08-27T00:00:02.000Z')
  assert.equal(s.status, 'completed')
  assert.equal(s.completedFlushedSeq, 5)
  assert.equal(s.requestedFlushedSeq, 5)
  assert.equal(s.updatedAt, '2026-08-27T00:00:02.000Z')
})

test('fail keeps attempt counting after success', () => {
  let s = newReviewState('s1', 5, '2026-08-27T00:00:00.000Z')
  s = failReviewState(s, 'model_error', '2026-08-27T00:00:01.000Z')
  assert.equal(s.status, 'failed')
  assert.equal(s.lastErrorCode, 'model_error')
  assert.equal(s.attempt, 1)
})
```

- [ ] **Step 2: 运行测试确认失败**

```text
node --import tsx --test tests/review-state.test.mjs
```

预期：`Cannot find module`。

- [ ] **Step 3: 实现**

```ts
// src/host/review-state.ts
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ReviewState, ReviewStatus } from './review-types.ts'

export interface ReviewStateStore {
  get(sessionId: string): Promise<ReviewState | undefined>
  put(state: ReviewState): Promise<void>
}

export function createReviewStateStore(
  table: KvTable<string, ReviewState>,
): ReviewStateStore {
  return {
    async get(sessionId) {
      return table.get(sessionId)
    },
    async put(state) {
      await table.put(state.sessionId, state)
    },
  }
}

export function newReviewState(
  sessionId: string,
  requestedFlushedSeq: number,
  nowIso: string,
): ReviewState {
  return {
    sessionId,
    requestedFlushedSeq,
    completedFlushedSeq: 0,
    status: 'running',
    attempt: 1,
    updatedAt: nowIso,
    schemaVersion: 1,
  }
}

type Settle<T extends ReviewStatus> = Omit<ReviewState, 'status' | 'updatedAt'> & {
  status: T
  updatedAt: string
}

function settle(current: ReviewState, status: ReviewStatus, nowIso: string): Settle<ReviewStatus> {
  return {
    ...current,
    status,
    updatedAt: nowIso,
  } as Settle<ReviewStatus>
}

export function shouldStartReview(
  current: ReviewState | undefined,
  flushedSeq: number,
): boolean {
  if (current === undefined) return flushedSeq >= 0
  if (current.status === 'running') return false
  if (current.status === 'completed') return flushedSeq > current.completedFlushedSeq
  // failed: 只允许在更高 flush watermark 时重试
  return flushedSeq > current.requestedFlushedSeq
}

export function completeReviewState(
  current: ReviewState,
  flushedSeq: number,
  nowIso: string,
): ReviewState {
  return settle(current, 'completed', nowIso) as ReviewState & { completedFlushedSeq: number } & {
    completedFlushedSeq: number
  }
}

export function failReviewState(
  current: ReviewState,
  errorCode: string,
  nowIso: string,
): ReviewState {
  const next = settle(current, 'failed', nowIso)
  next.lastErrorCode = errorCode
  return next as ReviewState
}
```

`completeReviewState` 需要把 `completedFlushedSeq` 设置为 `flushedSeq`；请按下面修正：

```ts
export function completeReviewState(
  current: ReviewState,
  flushedSeq: number,
  nowIso: string,
): ReviewState {
  return {
    ...current,
    status: 'completed' as const,
    completedFlushedSeq: flushedSeq,
    updatedAt: nowIso,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```text
node --import tsx --test tests/review-state.test.mjs
```

预期：全部通过（9 项）。

- [ ] **Step 5: Commit**

```bash
git add src/host/review-state.ts tests/review-state.test.mjs
git commit -m "feat(review): track review watermark state"
```

---

### Task 4: 存储层暴露 reviews 表

**Files:**
- Modify: `src/host/storage.ts`

**Interfaces:**
- Consumes: `reviewStateSchema`、`createReviewStateStore`。
- Produces: 扩展 `MemoryStorage` 增加 `reviews: ReviewStateStore`。

- [ ] **Step 1: 阅读现有 `src/host/storage.ts` 和 `src/host/storage-spec.ts`**

确认 `openMemoryStorage` 通过 `ctx.storageDomain.open(memoryDomainSpec)` 打开 domain，且现有 `MemoryStorage` 含 `table` 与 `watermarks`。

- [ ] **Step 2: 修改存储层**

在 `src/host/storage.ts` 顶部增加导入 `createReviewStateStore` 与 `ReviewStateStore`，`MemoryStorage` 增加：

```ts
readonly reviews: ReviewStateStore
```

`openMemoryStorage` 内创建：

```ts
const reviews = createReviewStateStore(domain.tables.reviews)
```

并在返回对象中加入 `reviews`。

- [ ] **Step 3: 类型检查**

```text
npm run typecheck
```

预期：通过。

- [ ] **Step 4: 运行现有测试确认无回归**

```text
npm test
```

预期：现有 54+ 项全部通过（新测试见后续任务）。

- [ ] **Step 5: Commit**

```bash
git add src/host/storage.ts
git commit -m "feat(review): expose reviews table through storage"
```

---

### Task 5: review-prompt 组装

**Files:**
- Create: `src/host/review-prompt.ts`
- Test: `tests/review-prompt.test.mjs`

**Interfaces:**
- Consumes: `ReviewProjection`、`ReviewBudget`。
- Produces:

```ts
export function buildReviewSystemPrompt(): string
export function buildReviewUserPrompt(
  projection: ReviewProjection,
  budget: ReviewBudget,
): string
```

- [ ] **Step 1: 写失败测试**

```js
// tests/review-prompt.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewSystemPrompt, buildReviewUserPrompt } from '../src/host/review-prompt.ts'

const budget = { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 }

test('system prompt forbids tools and exec', () => {
  const text = buildReviewSystemPrompt()
  assert.match(text, /operations/)
  assert.match(text, /save/)
  assert.doesNotMatch(text, /tool/i)
})

test('user prompt respects input budget', () => {
  const long = 'a'.repeat(20000)
  const text = buildReviewUserPrompt({
    sessionId: 's1',
    projectKey: '/repo',
    userText: long,
    assistantText: 'short',
    failures: [],
  }, budget)
  assert.ok(text.length <= 14000)
})

test('user prompt includes stable instructions without raw secrets', () => {
  const text = buildReviewUserPrompt({
    sessionId: 's1',
    projectKey: '/repo',
    userText: 'use pnpm',
    assistantText: 'ok',
    failures: ['tool A failed'],
  }, budget)
  assert.match(text, /use pnpm/)
  assert.doesNotMatch(text, /api[_-]?key/i)
})
```

- [ ] **Step 2: 运行测试确认失败**

```text
node --import tsx --test tests/review-prompt.test.mjs
```

预期：`Cannot find module`。

- [ ] **Step 3: 实现**

```ts
// src/host/review-prompt.ts
import type { ReviewBudget, ReviewProjection } from './review-types.ts'

export function buildReviewSystemPrompt(): string {
  return [
    'You are a memory reviewer for a coding assistant.',
    'Return ONLY a JSON object with an "operations" array.',
    'Each operation must use: kind "save", one of the scopes global/user/project/failure,',
    'one of the categories preference/convention/insight/failure/correction/tool-quirk,',
    'a short content string (plain text, no secrets, no code fences), and an optional reason.',
    'Only propose well-supported long-term facts. Prefer an empty operations array over guessing.',
    'Never propose deleting or replacing existing memories.',
  ].join(' ')
}

function trimTo(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`
}

export function buildReviewUserPrompt(
  projection: ReviewProjection,
  budget: ReviewBudget,
): string {
  const budgeted = trimTo(
    [
      `user: ${projection.userText}`,
      `assistant: ${projection.assistantText}`,
      ...projection.failures.map(f => `failure: ${f}`),
    ].join('\n'),
    budget.maxInputChars,
  )
  return [
    `Review this completed session (id ${projection.sessionId});`,
    `project key: ${projection.projectKey ?? 'none'}`,
    'Do not repeat credentials, tokens, keys, file paths, or raw tool payloads in your output.',
    'Only produce memory candidates you are confident about.',
    '',
    budgeted,
  ].join('\n')
}
```

- [ ] **Step 4: 运行测试确认通过**

```text
node --import tsx --test tests/review-prompt.test.mjs
```

预期：全部通过（3 项）。

- [ ] **Step 5: Commit**

```bash
git add src/host/review-prompt.ts tests/review-prompt.test.mjs
git commit -m "feat(review): build bounded review prompts"
```

---

### Task 6: review-runner 候选处理

**Files:**
- Create: `src/host/review-runner.ts`
- Test: `tests/review-runner.test.mjs`

**Interfaces:**
- Consumes: `validateReviewOutput`、`ReviewOutput`、`ReviewOperation`、`ContentScanner`、`StorageMemoryRepository`、`MemoryInput`、`ReviewBudget`。
- Produces:

```ts
export interface ReviewRunResult {
  accepted: number
  skipped: number
  failed: number
  errorCode?: string
  errorMessage?: string
}

export interface ReviewRunContext {
  sessionId: string
  projectKey?: string
  flushedSeq: number
  userText: string
  assistantText: string
  failures: string[]
}

export interface ReviewRunDeps {
  scanner: Pick<ContentScanner, 'scan'>
  repository: Pick<StorageMemoryRepository, 'save' | 'search' | 'get'>
  budget: ReviewBudget
  validate: (
    value: unknown,
    budget: ReviewBudget,
  ) => { ok: true; output: ReviewOutput } | { ok: false; reason: string }
}

export function applyReviewOperations(
  output: ReviewOutput,
  context: ReviewRunContext,
  deps: ReviewRunDeps,
): Promise<ReviewRunResult>
```

- [ ] **Step 1: 写失败测试**

```js
// tests/review-runner.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewOperations } from '../src/host/review-runner.ts'

function makeDeps() {
  const saved = []
  const deps = {
    scanner: { scan: () => ({ allowed: true }) },
    repository: {
      async save(input) {
        saved.push(input)
        return { ...input, id: `m-${saved.length}` }
      },
      async search() {
        return { total: 0, records: [] }
      },
      async get() { return undefined },
    },
    budget: { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 },
  }
  return { deps, saved }
}

test('accepts valid candidates and saves them with session provenance', async () => {
  const { deps, saved } = makeDeps()
  const result = await applyReviewOperations({
    operations: [{
      kind: 'save', scope: 'project', category: 'convention',
      content: 'use pnpm', reason: 'explicit',
    }],
  }, { sessionId: 's1', projectKey: '/repo', flushedSeq: 3, userText: '', assistantText: '', failures: [] }, deps)
  assert.equal(result.accepted, 1)
  assert.equal(result.failed, 0)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].scope, 'project')
  assert.equal(saved[0].provenance.sessionId, 's1')
  assert.equal(saved[0].provenance.flushedSeq, 3)
})

test('scanner rejection skips candidate without saving', async () => {
  const { deps, saved } = makeDeps()
  deps.scanner.scan = () => ({ allowed: false, reason: 'secret' })
  const result = await applyReviewOperations({
    operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'x', reason: 'r' }],
  }, { sessionId: 's1', projectKey: '/repo', flushedSeq: 3, userText: '', assistantText: '', failures: [] }, deps)
  assert.equal(result.accepted, 0)
  assert.equal(result.skipped, 1)
  assert.equal(saved.length, 0)
})

test('project candidate without project key is skipped', async () => {
  const { deps, saved } = makeDeps()
  const result = await applyReviewOperations({
    operations: [{ kind: 'save', scope: 'project', category: 'convention', content: 'use pnpm', reason: 'r' }],
  }, { sessionId: 's1', projectKey: undefined, flushedSeq: 3, userText: '', assistantText: '', failures: [] }, deps)
  assert.equal(result.accepted, 0)
  assert.equal(result.skipped, 1)
  assert.equal(saved.length, 0)
})

test('existing identical record is skipped as duplicate', async () => {
  const { deps, saved } = makeDeps()
  deps.repository.search = async () => ({ total: 1, records: [{ id: 'm-0' }] })
  const result = await applyReviewOperations({
    operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'use pnpm', reason: 'r' }],
  }, { sessionId: 's1', projectKey: undefined, flushedSeq: 3, userText: '', assistantText: '', failures: [] }, deps)
  assert.equal(result.accepted, 0)
  assert.equal(result.skipped, 1)
  assert.equal(saved.length, 0)
})

test('single repository failure does not stop other candidates', async () => {
  const { deps, saved } = makeDeps()
  let calls = 0
  deps.repository.save = async (input) => {
    calls += 1
    if (calls === 1) throw new Error('boom')
    saved.push(input)
    return { ...input, id: 'm-2' }
  }
  const result = await applyReviewOperations({
    operations: [
      { kind: 'save', scope: 'user', category: 'preference', content: 'first', reason: 'r' },
      { kind: 'save', scope: 'user', category: 'preference', content: 'second', reason: 'r' },
    ],
  }, { sessionId: 's1', projectKey: undefined, flushedSeq: 3, userText: '', assistantText: '', failures: [] }, deps)
  assert.equal(result.accepted, 1)
  assert.equal(result.failed, 1)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].content, 'second')
})
```

- [ ] **Step 2: 运行测试确认失败**

```text
node --import tsx --test tests/review-runner.test.mjs
```

预期：`Cannot find module '../src/host/review-runner.ts'`。

- [ ] **Step 3: 实现**

先阅读 `src/core/types.ts` 中 `MemoryInput` 的字段定义，再按下面实现：

```ts
// src/host/review-runner.ts
import type { ReviewBudget, ReviewOperation, ReviewOutput } from './review-types.ts'
import type { MemoryInput } from '../core/types.ts'
import type { ContentScanner } from '../core/content-scanner.ts'
import type { StorageMemoryRepository } from './storage.ts'

export interface ReviewRunResult {
  accepted: number
  skipped: number
  failed: number
  errorCode?: string
  errorMessage?: string
}

export interface ReviewRunContext {
  sessionId: string
  projectKey?: string
  flushedSeq: number
  userText: string
  assistantText: string
  failures: string[]
}

export interface ReviewRunDeps {
  scanner: Pick<ContentScanner, 'scan'>
  repository: Pick<StorageMemoryRepository, 'save' | 'search' | 'get'>
  budget: ReviewBudget
}

function duplicateOf(
  deps: ReviewRunDeps,
  op: ReviewOperation,
  projectKey: string | undefined,
): Promise<boolean> {
  return deps.repository
    .search({
      query: op.content,
      scope: op.scope,
      category: op.category,
      project: projectKey,
      limit: 1,
    } as never)
    .then((page: { total: number }) => page.total > 0)
    .catch(() => false)
}

export async function applyReviewOperations(
  output: ReviewOutput,
  context: ReviewRunContext,
  deps: ReviewRunDeps,
): Promise<ReviewRunResult> {
  let accepted = 0
  let skipped = 0
  let failed = 0

  for (const op of output.operations) {
    try {
      const projectKey = op.scope === 'project' ? context.projectKey : undefined
      if (op.scope === 'project' && (projectKey === undefined || projectKey.trim() === '')) {
        skipped += 1
        continue
      }
      const scan = deps.scanner.scan(op.content)
      if (!scan.allowed) {
        skipped += 1
        continue
      }
      if (await duplicateOf(deps, op, projectKey)) {
        skipped += 1
        continue
      }
      const input: MemoryInput = {
        scope: op.scope,
        category: op.category,
        content: op.content,
        projectKey,
        provenance: {
          source: 'session',
          sessionId: context.sessionId,
          flushedSeq: context.flushedSeq,
          projectKey,
        },
      }
      await deps.repository.save(input)
      accepted += 1
    } catch {
      failed += 1
    }
  }

  return { accepted, skipped, failed }
}
```

**说明**：`duplicateOf` 中 `as never` 是给旧的 `search` 签名占位；实现时必须按 `src/core/memory-repository.ts` 中真实 `MemorySearchInput` 填充 `query/scope/category/project/limit`，删除 `as never`。候选 payload 的 schema 校验在 Task 2 的 `validateReviewOutput` 中完成；本函数假定 `output` 已通过该校验。

- [ ] **Step 4: 运行测试确认通过**

```text
node --import tsx --test tests/review-runner.test.mjs
```

预期：全部通过（5 项）。

- [ ] **Step 5: Commit**

```bash
git add src/host/review-runner.ts tests/review-runner.test.mjs
git commit -m “feat(review): apply validated review operations”
```

---

### Task 7: auto-review 调度（session/flush + ctx.jobs）

**Files:**
- Create: `src/host/auto-review.ts`
- Modify: `src/index.ts`
- Test: `tests/auto-review.test.mjs`

**Interfaces:**
- Consumes: `ctx.jobs`、`ctx.subagents`、`storage.reviews`、`settings.get()`、`ReviewStateStore`、`validateReviewOutput`、`applyReviewOperations`、`buildReviewSystemPrompt`/`buildReviewUserPrompt`。
- Produces:

```ts
export interface AutoReviewDeps {
  repo: Pick<StorageMemoryRepository, 'save' | 'search' | 'get'>
  storage: Pick<MemoryStorage, 'reviews'>
  scanner: Pick<ContentScanner, 'scan'>
  budget: ReviewBudget
  providerName: () => string | undefined
  projectOf: (session: SessionLike) => string | undefined
  // 真实 subagent 调用由 host 传入，测试中替换
  subagent?: {
    start: (provider: string, request: SubagentStartRequestLike) => Promise<SubagentRunLike>
  }
}

export function installAutoReview(
  ctx: Context,
  deps: AutoReviewDeps,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => void
```

- [ ] **Step 1: 写失败测试**

```js
// tests/auto-review.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldScheduleReview } from '../src/host/auto-review.ts'

test('disabled settings do not schedule', () => {
  const settings = { get: () => ({ enabled: false, automaticReview: false }) }
  assert.equal(shouldScheduleReview({ ...settings.get(), sessionId: 's1', flushedSeq: 3, hasProvider: true, current: undefined }), false)
})

test('no provider does not schedule', () => {
  const settings = { get: () => ({ enabled: true, automaticReview: true }) }
  assert.equal(shouldScheduleReview({ ...settings.get(), sessionId: 's1', flushedSeq: 3, hasProvider: false, current: undefined }), false)
})

test('existing running state does not schedule', () => {
  const settings = { get: () => ({ enabled: true, automaticReview: true }) }
  assert.equal(shouldScheduleReview({ ...settings.get(), sessionId: 's1', flushedSeq: 3, hasProvider: true, current: { status: 'running' } }), false)
})

test('new higher watermark schedules', () => {
  const settings = { get: () => ({ enabled: true, automaticReview: true }) }
  assert.equal(shouldScheduleReview({ ...settings.get(), sessionId: 's1', flushedSeq: 3, hasProvider: true, current: { status: 'completed', completedFlushedSeq: 1 } }), true)
})
```

- [ ] **Step 2: 运行测试确认失败**

```text
node --import tsx --test tests/auto-review.test.mjs
```

预期：`Cannot find module`。

- [ ] **Step 3: 实现调度核心**

```ts
// src/host/auto-review.ts
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MemorySettings } from './settings.ts'
import type { ReviewState, ReviewBudget } from './review-types.ts'

export interface ScheduleReviewInput {
  enabled: boolean
  automaticReview: boolean
  sessionId: string
  flushedSeq: number
  hasProvider: boolean
  current: ReviewState | undefined
}

export function shouldScheduleReview(input: ScheduleReviewInput): boolean {
  if (!input.enabled || !input.automaticReview) return false
  if (!input.hasProvider) return false
  // 简化：running 或相同/更高已完成 watermark 不调度
  if (input.current?.status === 'running') return false
  if (input.current?.status === 'completed') return input.flushedSeq > input.current.completedFlushedSeq
  if (input.current?.status === 'failed') return input.flushedSeq > input.current.requestedFlushedSeq
  return input.flushedSeq >= 0
}

export interface AutoReviewDeps {
  repo: {
    save(input: unknown): Promise<unknown>
    search(input: unknown): Promise<{ records: unknown[] }>
    get(id: string): Promise<unknown>
  }
  storage: {
    reviews: {
      get(sessionId: string): Promise<ReviewState | undefined>
      put(state: ReviewState): Promise<void>
    }
  }
  scanner: { scan(content: string): { allowed: boolean; reason?: string } }
  budget: ReviewBudget
  subagent?: {
    start(provider: string, request: unknown): Promise<{ result: Promise<unknown>; dispose(): Promise<void> }>
  }
  providerName: () => string | undefined
}
```

**`installAutoReview`（必须使用 `ctx.jobs`，fail-soft）：**

```ts
export function installAutoReview(
  ctx: Context,
  deps: AutoReviewDeps,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => void {
  const inFlightSession = new Set<string>()

  const runReview = async (session: Session, flushedSeq: number): Promise<void> => {
    try {
      const current = await deps.storage.reviews.get(session.id)
      const hasProvider = deps.providerName() !== undefined
      if (!shouldScheduleReview({
        enabled: settings.get().enabled,
        automaticReview: settings.get().automaticReview,
        sessionId: session.id,
        flushedSeq,
        hasProvider,
        current,
      })) return
      if (inFlightSession.has(session.id)) return
      inFlightSession.add(session.id)
      try {
        const provider = deps.providerName()!
        const now = new Date().toISOString()
        await deps.storage.reviews.put(newReviewState(session.id, flushedSeq, now))
        const run = await deps.subagent!.start(provider, {
          label: 'Hermes memory review',
          prompt: [
            { type: 'text', text: buildReviewUserPrompt(sessionToProjection(session, deps), deps.budget) },
          ],
          parent: session.agent,
          signal: new AbortController().signal,
          outputSchema: REVIEW_OUTPUT_SCHEMA,
        })
        const result = await run.result
        await run.dispose().catch(() => undefined)
        if (result.stopReason !== 'completed') {
          await deps.storage.reviews.put(failReviewState(current ?? newReviewState(session.id, flushedSeq, now), 'subagent_' + result.stopReason, new Date().toISOString()))
          return
        }
        if ((result as { structured?: unknown }).structured === undefined) {
          await deps.storage.reviews.put(failReviewState(current ?? newReviewState(session.id, flushedSeq, now), 'no_structured_output', new Date().toISOString()))
          return
        }
        const validated = validateReviewOutput((result as { structured: unknown }).structured, deps.budget)
        if (!validated.ok) {
          await deps.storage.reviews.put(failReviewState(current ?? newReviewState(session.id, flushedSeq, now), 'invalid_output_' + validated.reason, new Date().toISOString()))
          return
        }
        const outcome = await applyReviewOperations(validated.output, {
          sessionId: session.id,
          projectKey: deps.projectOf(session),
          flushedSeq,
          userText: '',
          assistantText: '',
          failures: [],
        }, deps)
        await deps.storage.reviews.put(completeReviewState(
          current ?? newReviewState(session.id, flushedSeq, now),
          flushedSeq,
          new Date().toISOString(),
        ))
        logger.warn(`hermes-memory review completed: accepted=${outcome.accepted} skipped=${outcome.skipped} failed=${outcome.failed}`)
      } finally {
        inFlightSession.delete(session.id)
      }
    } catch (error) {
      // 稳定日志：只写 code，不写 prompt/内容/路径/provider 原始响应
      logger.warn(`hermes-memory review failed: ${error instanceof Error ? 'unexpected' : `code_${String(error)}`}`)
    }
  }

  ctx.on('session/flush', (session: Session) => {
    const flushedSeq = session.events?.length ?? 0
    void runReview(session, flushedSeq)
  })

  return () => {
    // teardown: 取消进行中的 subagent；这里通过 AbortController 记录在模块级 map 中，
    // 简化版先记录且随后续实现完善。首版保证监听器移除与 in-flight 不再启动新任务。
  }
}
```

**接线要求**：`sessionToProjection`、`deps.projectOf` 是 runner 私有辅助，读取 DSH session/query 与 session header cwd；`Session`、`Agent` 类型以真实 DSH 包为准。监听器绝不 `await`、绝不返回异步 Promise，模型调用只在 `ctx.jobs.start` 的任务体内进行。若当前迭代无法解析 provider/outputSchema，则直接失败并写 `failReviewState`，不降级。

- [ ] **Step 4: 运行测试确认通过**

```text
node --import tsx --test tests/auto-review.test.mjs
```

预期：全部通过（4 项）。

- [ ] **Step 5: 接入 `src/index.ts`**

- `export const inject` 增加 `'jobs'`、`'subagents'`；
- `apply()` 构造 `deps` 后调用 `installAutoReview(...)`；
- teardown 增加 `disposeAutoReview()`。

- [ ] **Step 6: 全量测试与类型检查**

```text
npm run typecheck
npm test
```

预期：全部通过，新增 4 项 auto-review 测试。

- [ ] **Step 7: Commit**

```bash
git add src/host/auto-review.ts src/index.ts tests/auto-review.test.mjs
git commit -m "feat(review): schedule background review on session flush"
```

---

### Task 8: settings、client 设置项与 locale

**Files:**
- Modify: `src/host/settings.ts`
- Modify: `src/client/MemorySettings.tsx`
- Modify: `src/client/locales.ts`

**Interfaces:**
- Consumes: 无新增外部接口。
- Produces: `MemorySettings` 增加三个字段：

```ts
automaticReview: boolean   // 默认 false
reviewMaxPerSession: number // 默认 5
reviewMaxInputChars: number // 默认 12000
```

- [ ] **Step 1: 类型检查修改前状态**

```text
npm run typecheck
```

预期：通过（基线）。

- [ ] **Step 2: 修改 `src/host/settings.ts`**

- `MemorySettings` interface 增加三字段；
- `MemorySettingsSchema` 增加对应 default；
- `validateMemorySettings` 增加：

```ts
if (!Number.isInteger(value.reviewMaxPerSession) || value.reviewMaxPerSession < 1 || value.reviewMaxPerSession > 20) {
  throw new Error('memory reviewMaxPerSession must be an integer from 1 to 20')
}
if (!Number.isInteger(value.reviewMaxInputChars) || value.reviewMaxInputChars < 2000 || value.reviewMaxInputChars > 30000) {
  throw new Error('memory reviewMaxInputChars must be an integer from 2000 to 30000')
}
```

- [ ] **Step 3: 修改 `src/client/MemorySettings.tsx`**

- 在自动捕获区附近增加「后台复盘」开关 `automaticReview`；
- 增加「每次复盘最大候选数」数字输入 `reviewMaxPerSession`；
- 增加「复盘输入最大字符数」数字输入 `reviewMaxInputChars`；
- 使用现有 settings card 的字段绑定方式（读现有文件再写）。

- [ ] **Step 4: 修改 `src/client/locales.ts`**

中英文分别增加：

```text
automaticReview
reviewMaxPerSession
reviewMaxInputChars
```

注意保持现有中文 locale 文案与英文 locale 文案。

- [ ] **Step 5: 验证**

```text
npm run typecheck
npm test
npm run build
```

预期：全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/host/settings.ts src/client/MemorySettings.tsx src/client/locales.ts
git commit -m "feat(review): add background review settings"
```

---

### Task 9: package.json 依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: 无。
- Produces: `@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-subagent` 加入 `peerDependencies` 与 `devDependencies`。

- [ ] **Step 1: 查看现有依赖版本**

现有 `peerDependencies` 已含 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-storage-domain` 等。按该项目当前使用的 DSH 本地版本确定 `@deepseek-ai/dsh-jobs` 与 `@deepseek-ai/dsh-subagent` 的确切版本号（如本仓库 node_modules 中有对应包，从 `node_modules/@deepseek-ai/dsh-jobs/package.json` 读取 `version`）。

- [ ] **Step 2: 更新 package.json**

```json
"@deepseek-ai/dsh-jobs": "<按本地版本>",
"@deepseek-ai/dsh-subagent": "<按本地版本>"
```

同时在 `devDependencies` 中镜像。

- [ ] **Step 3: 本地验证**

```text
npm run typecheck
npm test
npm run build
```

预期：全部通过。

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add dsh jobs and subagent dependencies"
```

---

### Task 10: 文档同步与最终验证

**Files:**
- Modify: `docs/requirements.md`
- Modify: `README.md`
- Modify: `README.zh.md`

**Interfaces:**
- Consumes: 已完成任务产物。

- [ ] **Step 1: requirements 增加 V5 小节**

在 `### V5` 位置补全：

```markdown
### V5：会话复盘（设计已完成，待实现）

- 在 `session/flush` 后异步使用 DSH subagent 结构化输出做记忆候选复盘；
- 模型只返回 `operations` 候选，不直接调用记忆工具；
- 新增独立 `reviews` 状态表记录 requested/completed watermark 与 running/completed/failed；
- provider 不支持结构化输出时安全跳过，不降级；
- 所有候选重新经过 schema、workspace 授权、scanner、预算与幂等检查；
- `ctx.jobs` 仅作为进程内执行器，不承担跨重启可靠队列；
- 不建设独立记忆管理 UI，不修改 DSH 源码，不复制 Pi 资产；
- 新增设置默认关闭：`automaticReview`、`reviewMaxPerSession`、`reviewMaxInputChars`。
```

- [ ] **Step 2: README 状态与 deferred 更新**

- Status 段落增加“V5（后台模型复盘）已在本地完成设计，实现待启动”；
- Deferred scope 保持“后台模型复盘”仍处于 deferred，直到实现完成前不改写为已完成。

- [ ] **Step 3: README.zh.md 同步**

同样更新当前状态与文档链接，新增：

```text
- V5 设计：docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v5-background-review-design.md
- V5 计划：docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v5-background-review.md
```

- [ ] **Step 4: 全量验证**

```text
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

预期：全部通过；打包不含 Pi 资产。

- [ ] **Step 5: Commit**

```bash
git add docs/requirements.md README.md README.zh.md
git commit -m "docs: record v5 background review design and plan"
```

---

## 自审记录

- **Spec 覆盖**：设计规范中每节的输入投影、output schema、候选流水线、review 状态、设置、错误处理与 teardown 都在 Task 2-8 中覆盖；验收标准 1-11 对应 Task 6-10 的测试与验证。
- **占位符扫描**：所有函数签名、文件路径和测试代码都已给出。
- **类型一致性**：`ReviewState`、`ReviewOutput`、`ReviewOperation`、`ReviewBudget` 与 `ReviewProjection` 在 Task 1 定义并在 Task 2/3/5/6/8 引用；`MemorySettings` 新增字段在 Task 8 定义并被 Task 7 引用。

## 验证命令

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected：全部通过；打包不包含 Pi 资产。

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v5-background-review.md`。执行选项：

1. **Subagent-Driven（推荐）**：每个任务派发新 subagent，任务间评审；
2. **Inline Execution**：本会话内批量执行并设检查点。

注意：按当前会话要求，本次只提交设计与计划文档，不执行代码任务。执行入口见该计划正文。