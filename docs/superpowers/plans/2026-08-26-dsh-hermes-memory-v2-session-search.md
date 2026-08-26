# dsh-hermes-memory V2 Session Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add DSH-native session provenance, durable event watermarks, and a bounded `session_memory_search` tool without copying Pi session parsing or building a duplicate transcript index.

**Architecture:** Keep memory records in the existing storage-domain and add a `watermarks` table. Observe DSH `session/event` and `session/flush` only to advance per-session sequence state; delegate historical full-text search to `ctx.sessionQuery`. Keep workspace authorization and output bounding in the Host adapter, while Client remains unchanged except for V2 status copy if needed.

**Tech Stack:** TypeScript, Cordis, DSH session events, `@deepseek-ai/dsh-session-query`, DSH `storage-domain`, DSH tools, Node test runner with `tsx`.

## Global Constraints

- Do not copy Pi runtime code, Pi commands, Pi TUI, Pi session JSONL parsing, logos, screenshots, or visual assets.
- Do not read DSH session SQLite tables or session files directly.
- Do not copy full transcripts into `dsh_hermes_memory`.
- Use only the public `session/event`, `session/flush`, and `sessionQuery` APIs.
- Session observers are post-commit and fail-soft; they must never block or roll back the main session.
- Every search result is bounded by limit and snippet length and respects current workspace authorization.
- Keep `MemoryProvenance` JSON-safe and preserve existing V1 records without migration breakage.
- Synchronize `README.md`, `README.zh.md`, `docs/requirements.md`, the V1 design spec, the V2 design spec, and this plan.

---

### Task 1: Extend provenance and storage schemas

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/host/storage-spec.ts`
- Modify: `src/host/storage.ts`
- Test: `tests/watermark.test.mjs`

**Interfaces:**
- Add `flushedSeq?: number` to `MemoryProvenance`.
- Add `SessionWatermark` with `sessionId`, `lastEventSeq`, `lastFlushedSeq`, `updatedAt`, and `schemaVersion: 1`.
- Add a `watermarks` table to `memoryDomainSpec`.
- Add `WatermarkRepository` with `read(sessionId)`, `observeEvent(sessionId, seq)`, and `observeFlush(sessionId, seq)`.

- [x] **Step 1: Write failing watermark tests**

```js
test('advances event watermark monotonically', async () => {
  const repository = new InMemoryWatermarkRepository()
  await repository.observeEvent('session-a', 4)
  await repository.observeEvent('session-a', 2)
  assert.equal((await repository.read('session-a')).lastEventSeq, 4)
})

test('rejects flush sequence beyond observed event sequence', async () => {
  const repository = new InMemoryWatermarkRepository()
  await assert.rejects(() => repository.observeFlush('session-a', 2), /flush sequence/)
})
```

- [x] **Step 2: Run the test to verify failure**

Run: `node --import tsx --test tests/watermark.test.mjs`
Expected: FAIL because the watermark types and repository do not exist.

- [x] **Step 3: Implement JSON-safe watermark schema and repository**

Use `domainTable<string, SessionWatermark>` with the existing domain. `observeEvent` ignores duplicate/out-of-order sequence values. `observeFlush` only accepts a sequence less than or equal to `lastEventSeq`; it updates `lastFlushedSeq` monotonically and writes `updatedAt`.

- [x] **Step 4: Add durable storage adapter**

Open `domain.table('watermarks')` and implement the same repository interface over `KvTable`. Preserve existing `memories` records and keep `schemaVersion` at `1` for both tables.

- [x] **Step 5: Run watermark tests**

Run: `node --import tsx --test tests/watermark.test.mjs`
Expected: PASS.

- [x] **Step 6: Commit the schema layer**

```bash
git add src/core/types.ts src/host/storage-spec.ts src/host/storage.ts tests/watermark.test.mjs
git commit -m "feat: add session event watermark storage"
```

### Task 2: Add session event observers

**Files:**
- Create: `src/host/session-capture.ts`
- Modify: `src/index.ts`
- Test: `tests/session-capture.test.mjs`

**Interfaces:**
- `SessionCapture` with `onEvent(session, event): void` and `onFlush(session): Promise<void>`.
- `extractSessionSequence(event): number | undefined`.
- `installSessionCapture(ctx, watermarkRepository): () => Promise<void>`.

- [x] **Step 1: Write failing observer tests**

Use fake session/event objects. Test that an event with numeric `seq` advances the watermark, an event without a valid sequence is ignored, duplicate events do not regress state, and a flush updates `lastFlushedSeq` only after a valid event watermark exists.

- [x] **Step 2: Run observer tests to verify failure**

Run: `node --import tsx --test tests/session-capture.test.mjs`
Expected: FAIL because the observer module is absent.

- [x] **Step 3: Implement event extraction without transcript persistence**

Read only the event sequence and session ID. Do not stringify, store, or log event payloads. Wrap observer work in `void Promise.resolve(...).catch(...)` so post-commit errors are contained.

- [x] **Step 4: Implement `session/flush` handling**

Register a listener returning a promise. It may write the watermark, but it must not throw into the session producer; catch and log with a stable message that contains no path or event payload.

- [x] **Step 5: Install lifecycle cleanup**

Register both listeners through the plugin context and return a disposer that removes them. Do not create detached timers or background jobs in V2.

- [x] **Step 6: Run tests and typecheck**

Run: `node --import tsx --test tests/session-capture.test.mjs && npm run typecheck`
Expected: PASS.

- [x] **Step 7: Commit the observer**

```bash
git add src/host/session-capture.ts src/index.ts tests/session-capture.test.mjs
git commit -m "feat: track dsh session event watermarks"
```

### Task 3: Add DSH sessionQuery adapter

**Files:**
- Create: `src/host/session-search.ts`
- Modify: `src/host/workspace.ts`
- Test: `tests/session-search.test.mjs`

**Interfaces:**
- `SessionMemorySearchArgs` with `query`, optional `role`, `project`, `limit`, and `snippetChars`.
- `SessionMemorySearchResult` with bounded `results` and stable error codes.
- `searchSessionMemory(ctx, exec, args): Promise<SessionMemorySearchResult>`.

- [x] **Step 1: Write failing adapter tests**

Use a fake `sessionQuery.searchSessions` that returns session hits with headers and best-match snippets. Test default limits, hard limits, role filtering, project authorization, snippet truncation, unavailable service, and provider failure mapping.

- [x] **Step 2: Run adapter tests to verify failure**

Run: `node --import tsx --test tests/session-search.test.mjs`
Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement argument normalization**

Require a non-empty query. Clamp `limit` to `1..20` and `snippetChars` to `1..2000`. Treat query as data and pass it unchanged to DSH `sessionQuery`.

- [x] **Step 4: Implement workspace authorization**

Resolve the current cwd/project key from `exec.agent.session.header.cwd`. If a caller passes `project`, require exact equality with the current workspace. Translate it to a DSH `sessionFilters` cwd predicate rather than filtering returned rows after the fact.

- [x] **Step 5: Implement bounded projection**

Call `ctx.sessionQuery.searchSessions({ query, sessionFilters, eventFilters, limit })`. Project each hit to:

```ts
{
  sessionId: hit.header.id,
  project: hit.header.cwd,
  role: roleFromBestMatch,
  date: hit.bestMatch.time,
  snippet: hit.bestMatch.snippet.slice(0, snippetChars),
}
```

Never return raw headers, raw events, cursors, tool payloads, or stack traces.

- [x] **Step 6: Run adapter tests**

Run: `node --import tsx --test tests/session-search.test.mjs`
Expected: PASS.

- [x] **Step 7: Commit the adapter**

```bash
git add src/host/session-search.ts src/host/workspace.ts tests/session-search.test.mjs
git commit -m "feat: adapt dsh session query for memory search"
```

### Task 4: Register `session_memory_search`

**Files:**
- Modify: `src/host/tool-definitions.ts`
- Modify: `src/host/tools.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Test: `tests/session-tool.test.mjs`

**Interfaces:**
- Register `session_memory_search` beside the four V1 memory tools.
- Use `@deepseek-ai/dsh-session-query` as a peer/dev dependency.
- Return the V2 `SessionMemorySearchResult` JSON contract.

- [x] **Step 1: Write failing tool tests**

Test registration includes the new tool, valid calls return bounded results, invalid query maps to `invalid_args`, unavailable sessionQuery maps to `session_query_unavailable`, and project mismatch maps to `session_scope_denied`.

- [x] **Step 2: Run the tool tests to verify failure**

Run: `node --import tsx --test tests/session-tool.test.mjs`
Expected: FAIL because the new tool is not registered.

- [x] **Step 3: Implement the tool definition**

Use DSH JSON schema DSL for `query`, `role`, `project`, `limit`, and `snippetChars`. Render only the bounded JSON result. Do not call `sessionQuery` from Client or from a detached task.

- [x] **Step 4: Add `sessionQuery` injection**

Declare `sessionQuery` as a required host injection in `src/index.ts`. The plugin should fail to load only when V2 is enabled in a composition that lacks the service; the V1-only core remains independently testable.

- [x] **Step 5: Run tool tests and typecheck**

Run: `node --import tsx --test tests/session-tool.test.mjs && npm run typecheck`
Expected: PASS.

- [x] **Step 6: Commit the tool**

```bash
git add src/host/tool-definitions.ts src/host/tools.ts src/index.ts package.json tests/session-tool.test.mjs
 git commit -m "feat: add session memory search tool"
```

### Task 5: Synchronize documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/requirements.md`
- Modify: `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`
- Create: `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-v2-session-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-26-dsh-hermes-memory.md`
- Modify: `docs/superpowers/plans/2026-08-26-dsh-hermes-memory-v2-session-search.md`

**Interfaces:**
- All docs must state V2 status consistently and preserve the no-Pi-assets boundary.

- [x] **Step 1: Update README status and feature list**

Add `session_memory_search`, session provenance, and watermark tracking to both README files. State that DSH `sessionQuery` is reused and Pi session parsing is not included.

- [x] **Step 2: Update requirements**

Mark the V2 section as implemented, add V2 acceptance criteria, and move automatic injection/background review to V3/V4.

- [x] **Step 3: Update the V1 design spec**

Change the lifecycle section from “V2 planned” to “V2 implemented” and link the dedicated V2 spec.

- [x] **Step 4: Self-review all docs**

Run:

```bash
rg -n 'TBD|TODO|FIXME|待定|Pi.*JSONL|session_memory_search|watermark' README.md README.zh.md docs
```

Expected: no unresolved placeholder remains in the V2 docs; all status labels agree.

- [x] **Step 5: Run complete verification**

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected: all tests pass, bundles build, and the package contains no Pi code/assets or local dependency links.

- [x] **Step 6: Commit and push V2**

```bash
git add README.md README.zh.md docs package.json src tests
 git commit -m "feat: add session provenance and native session search"
 git push origin main
```

- [x] **Step 7: Verify remote state**

```bash
gh repo view lcthe/dsh-hermes-memory --json name,url,defaultBranchRef
```

Expected: `main` points to the V2 commit.
