# V7 Memory Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual and threshold-triggered memory consolidation without deleting source memories before durable replacements exist.

**Architecture:** A pure planner validates model-proposed merge groups against a fresh authorized snapshot. A persistent state machine stages deterministic replacement records before retiring sources and reconciles unfinished work at startup.

**Tech Stack:** TypeScript, DSH storage-domain/jobs/subagents/tools/settings, React, Node test runner.

## Global Constraints

- Automatic consolidation defaults off with a 40,000-character trigger and 28,000-character target.
- A run reads at most 100 records and creates at most 20 replacements.
- Only ordinary memory records participate; standing context and skills are excluded.
- Replacement records must be durable before any source deletion.
- Concurrent user updates invalidate the affected merge group instead of being overwritten.
- The model cannot change scope/project authorization or issue arbitrary replace/remove operations.

---

### Task 1: Consolidation schema and persistent state

**Files:**
- Create: `src/host/consolidation-types.ts`
- Create: `src/host/consolidation-schema.ts`
- Create: `src/host/consolidation-state.ts`
- Modify: `src/host/storage-spec.ts`
- Modify: `src/host/storage.ts`
- Create: `tests/consolidation-schema.test.mjs`
- Create: `tests/consolidation-state.test.mjs`

**Interfaces:**
- Produces: `ConsolidationGroup`, `ConsolidationPlan`, `ConsolidationState`, `parseConsolidationOutput`, and `ConsolidationStateStore`.

- [ ] **Step 1: Write failing schema and state tests**

```ts
test('rejects repeated source ids across groups', () => {
  assert.throws(() => parseConsolidationOutput(outputWithRepeatedSource))
})

test('advances prepared through replacements-written to completed', async () => {
  await state.put(prepared)
  await state.markReplacementsWritten(prepared.id)
  await state.markCompleted(prepared.id)
  assert.equal((await state.get(prepared.id))?.status, 'completed')
})
```

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/consolidation-schema.test.mjs tests/consolidation-state.test.mjs`
Expected: FAIL because consolidation modules and table are absent.

- [ ] **Step 3: Implement bounded types, parser, and state table**

```ts
export interface ConsolidationGroup { sourceIds: string[]; category: MemoryCategory; content: string }
export type ConsolidationStatus = 'prepared' | 'replacements-written' | 'completed' | 'failed'
export interface ConsolidationState {
  id: string
  scope: MemoryScope
  projectKey?: string
  groups: ConsolidationGroup[]
  sourceVersions: Record<string, string>
  status: ConsolidationStatus
  updatedAt: string
  schemaVersion: 1
}
```

Enforce at least two source IDs per group, unique IDs across the plan, at most 20 groups, bounded content, known categories, and no unknown fields. Add the `consolidations` table and storage accessor.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/consolidation-schema.test.mjs tests/consolidation-state.test.mjs`
Expected: PASS.

```bash
git add src/host/consolidation-types.ts src/host/consolidation-schema.ts src/host/consolidation-state.ts src/host/storage-spec.ts src/host/storage.ts tests/consolidation-schema.test.mjs tests/consolidation-state.test.mjs
git commit -m "feat: persist consolidation plans"
```

### Task 2: Crash-safe consolidation executor

**Files:**
- Create: `src/host/consolidation-executor.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/memory-repository.ts`
- Modify: `src/host/storage.ts`
- Create: `tests/consolidation-executor.test.mjs`

**Interfaces:**
- Produces: `prepareConsolidation(input)` and `executeConsolidation(state, storage)`.
- Adds consolidation provenance and deterministic replacement IDs.

- [ ] **Step 1: Write failing executor tests**

```ts
test('never deletes a source when a replacement write fails', async () => {
  table.failPutAt(2)
  await assert.rejects(() => executeConsolidation(state, storage))
  assert.equal(sourceRecordsStillPresent(table), true)
})

test('resumes replacements-written by deleting unchanged sources', async () => {
  await executeConsolidation(replacementsWrittenState, storage)
  assert.equal(await stateStore.getStatus(id), 'completed')
})
```

Cover failure after every state/write/delete step, deterministic retry, stale `updatedAt` rejection, and projected target size.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/consolidation-executor.test.mjs`
Expected: FAIL because the executor is absent.

- [ ] **Step 3: Implement prepare/write/retire/reconcile phases**

```ts
export interface ConsolidationExecutor {
  prepare(input: ConsolidationRequest): Promise<ConsolidationState | undefined>
  execute(id: string): Promise<ConsolidationResult>
  reconcile(): Promise<ConsolidationResult[]>
}
```

Snapshot source `updatedAt`, derive replacement IDs from task ID and group index, write all replacements idempotently, mark `replacements-written`, recheck source versions, delete only unchanged sources, then mark complete. If projected total remains above 28,000 characters, return no plan and perform no writes.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/consolidation-executor.test.mjs tests/core.test.mjs`
Expected: PASS.

```bash
git add src/host/consolidation-executor.ts src/core/types.ts src/core/memory-repository.ts src/host/storage.ts tests/consolidation-executor.test.mjs tests/core.test.mjs
git commit -m "feat: execute recoverable memory consolidation"
```

### Task 3: Model runner, tool, automatic scheduling, settings, and docs

**Files:**
- Create: `src/host/consolidation-prompt.ts`
- Create: `src/host/consolidation-runner.ts`
- Create: `src/host/auto-consolidation.ts`
- Modify: `src/host/tools.ts`
- Modify: `src/host/tool-definitions.ts`
- Modify: `src/host/settings.ts`
- Modify: `src/index.ts`
- Modify: `src/client/MemorySettings.tsx`
- Modify: `src/client/locales.ts`
- Create: `tests/consolidation-runner.test.mjs`
- Create: `tests/auto-consolidation.test.mjs`
- Modify: `tests/settings.test.mjs`
- Modify: `tests/tools.test.mjs`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/requirements.md`

**Interfaces:**
- Adds `memory_consolidate` and settings `automaticConsolidation`, `consolidationThresholdChars`, `consolidationTargetChars`, `consolidationMaxRecords`, `consolidationMaxReplacements`.

- [ ] **Step 1: Write failing runner, scheduler, tool, and settings tests**

```ts
test('does not schedule below threshold or without a structured provider', () => {
  assert.equal(shouldScheduleConsolidation(disabledInput), false)
  assert.equal(shouldScheduleConsolidation(belowThresholdInput), false)
})

test('manual consolidation cannot target another project', async () => {
  const result = await runTool({ scope: 'project', projectKey: '/other' })
  assert.equal(result.error?.code, 'unauthorized_scope')
})
```

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/consolidation-runner.test.mjs tests/auto-consolidation.test.mjs tests/settings.test.mjs tests/tools.test.mjs`
Expected: FAIL because runner, scheduler, tool, and settings are absent.

- [ ] **Step 3: Implement bounded model flow and UI**

Reuse the V5 structured provider selection and job lifecycle, but keep independent state and prompts. Call the executor only after schema validation. Reconcile unfinished tasks during plugin startup before scheduling new work. Add a collapsed “Memory consolidation” settings card and current-state documentation.

- [ ] **Step 4: Run V7 verification and commit**

Run: `npm test && npm run typecheck && npm run build && git diff --check`
Expected: all tests pass, typecheck/build exit 0, and no whitespace errors.

```bash
git add src/host/consolidation-prompt.ts src/host/consolidation-runner.ts src/host/auto-consolidation.ts src/host/tools.ts src/host/tool-definitions.ts src/host/settings.ts src/index.ts src/client/MemorySettings.tsx src/client/locales.ts tests/consolidation-runner.test.mjs tests/auto-consolidation.test.mjs tests/settings.test.mjs tests/tools.test.mjs README.md README.zh.md docs/requirements.md
git commit -m "feat: add automatic memory consolidation"
```
