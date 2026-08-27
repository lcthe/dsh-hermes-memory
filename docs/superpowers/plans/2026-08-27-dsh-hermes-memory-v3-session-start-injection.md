# DSH Hermes Memory V3 Session-Start Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an opt-in, bounded, fail-soft memory context message to each newly started DSH agent session without performing per-step retrieval or automatic capture.

**Architecture:** Keep the existing asynchronous `MemoryRepository` unchanged. Read already-opened storage-domain records synchronously from the KV table during the synchronous `agent/session-start` notification, select only authorized global/user/project records, render one bounded reference message, and call DSH `agent.inject()` at most once per agent lifecycle. Extend the existing live settings namespace and client card, while isolating all injection logic in a focused Host module with pure functions for deterministic tests.

**Tech Stack:** TypeScript, DSH Cordis events, `@deepseek-ai/dsh-llm` `createUserMessage`, DSH storage-domain `KvTable`, Schemastery, React settings card, Node test runner with `tsx`.

## Global Constraints

- Do not modify DSH source code or read DSH session SQLite internals.
- Do not copy Pi runtime code, session parser, TUI, logo, screenshots, or visual assets.
- `agent/session-start` is synchronous and non-vetoing; no unawaited repository Promise may be required for first-request injection.
- Use only the public DSH `MessageSource` shape `{ kind: 'plugin', plugin: string }`, optionally with the publicly declared `form: 'recall'` field.
- Automatic injection defaults to `false`.
- Inject at most 5 records by default and never exceed 3,000 rendered characters by default.
- Automatically inject only `global`, `user`, and authorized current `project` records; never inject `failure` records automatically.
- A malformed record, read error, render error, or `agent.inject()` error must not block session startup and must not log memory content, secrets, absolute paths, or full stack traces.
- Do not implement `agent/pre-step` dynamic retrieval, automatic capture, background review, consolidation, eviction, vector search, or a memory UI in this change.

---

### Task 1: Confirm public message and storage interfaces

**Files:**
- Read: `/Volumes/GM7/code/deepseek-harness/packages/core/agent-loop/node_modules/@deepseek-ai/dsh-llm/src/message.ts`
- Read: `/Volumes/GM7/code/dsh-hermes-memory/src/host/storage.ts`
- Read: `/Volumes/GM7/code/dsh-hermes-memory/src/host/settings.ts`

**Interfaces:**
- Consume `createUserMessage`, `UserMessage`, and the public plugin `MessageSource` from `@deepseek-ai/dsh-llm`.
- Consume `MemoryStorage.table.entries()` and `MemoryRecord` from the existing storage adapter.

- [x] **Step 1: Verify the message source contract**

Confirm that the implementation uses only:

```ts
createUserMessage({
  content: [{ type: 'text', text }],
  source: {
    kind: 'plugin',
    plugin: '@lcthe/dsh-hermes-memory',
    form: 'recall',
  },
})
```

If the installed public type does not accept `form: 'recall'`, omit that field rather than adding a declaration merge or type assertion.

- [x] **Step 2: Verify synchronous KV reads**

Use the existing `MemoryStorage.table.entries()` iterator only after `openMemoryStorage()` has resolved. Do not change the `MemoryRepository` Promise methods.

- [x] **Step 3: Add the explicit LLM dependency**

Modify `package.json` to add `@deepseek-ai/dsh-llm` to peer and dev dependencies at the locally supported DSH version range. Keep it external in the Node bundle by relying on the package's peer dependency rather than bundling DSH runtime code.

- [x] **Step 4: Run the type checker**

Run:

```bash
npm run typecheck
```

Expected: the existing project still type-checks before feature code is added.

- [x] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: declare dsh llm dependency"
```

---

### Task 2: Extend settings and validation

**Files:**
- Modify: `src/host/settings.ts:8-30`
- Modify: `src/client/index.ts:31-43`
- Modify: `src/client/MemorySettings.tsx:14-51`
- Modify: `src/client/locales.ts:2-27`
- Modify: `tests/settings.test.mjs:4-29`

**Interfaces:**
- Produce `MemorySettings` with `automaticInjection`, `injectionLimit`, `injectionMaxChars`, `includeUserMemory`, and `includeProjectMemory`.
- Preserve existing settings defaults and validation behavior.

- [x] **Step 1: Add failing settings tests**

Add tests for the V3 defaults and bounds:

```js
test('accepts bounded automatic injection settings', () => {
  assert.doesNotThrow(() => validateMemorySettings({
    enabled: true,
    defaultLimit: 8,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 90,
    automaticInjection: false,
    injectionLimit: 5,
    injectionMaxChars: 3000,
    includeUserMemory: true,
    includeProjectMemory: true,
  }))
})

test('rejects unsafe injection bounds', () => {
  const base = {
    enabled: true,
    defaultLimit: 8,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 90,
    automaticInjection: true,
    injectionLimit: 5,
    injectionMaxChars: 3000,
    includeUserMemory: true,
    includeProjectMemory: true,
  }
  assert.throws(() => validateMemorySettings({ ...base, injectionLimit: 0 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...base, injectionLimit: 11 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...base, injectionMaxChars: 499 }), /injectionMaxChars/)
  assert.throws(() => validateMemorySettings({ ...base, injectionMaxChars: 8001 }), /injectionMaxChars/)
})
```

- [x] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --import tsx --test tests/settings.test.mjs
```

Expected: FAIL because the new fields and validation do not exist yet.

- [x] **Step 3: Implement settings schema and validation**

Add these fields and defaults:

```ts
automaticInjection: z.boolean().default(false),
injectionLimit: z.number().default(5),
injectionMaxChars: z.number().default(3_000),
includeUserMemory: z.boolean().default(true),
includeProjectMemory: z.boolean().default(true),
```

Validate `injectionLimit` as an integer from 1 through 10 and `injectionMaxChars` as an integer from 500 through 8,000. Keep `automaticCapture` disabled and unchanged.

- [x] **Step 4: Update the client fallback and controls**

Add matching fallback values in `src/client/index.ts`. Add controls to `MemorySettings.tsx` for automatic injection, user memory inclusion, project memory inclusion, injection limit, and maximum characters. The automatic-capture control remains disabled and labeled as unavailable.

- [x] **Step 5: Update Chinese and English locale strings**

Add translations for the five new controls and an explanatory note that injection is opt-in, bounded, and only runs once when a session starts.

- [x] **Step 6: Run focused tests and typecheck**

Run:

```bash
node --import tsx --test tests/settings.test.mjs
npm run typecheck
```

Expected: PASS and no TypeScript errors.

- [x] **Step 7: Commit**

```bash
git add src/host/settings.ts src/client/index.ts src/client/MemorySettings.tsx src/client/locales.ts tests/settings.test.mjs
git commit -m "feat: add memory injection settings"
```

---

### Task 3: Implement deterministic bounded candidate selection and rendering

**Files:**
- Create: `src/host/memory-injection.ts`
- Create: `tests/memory-injection.test.mjs`

**Interfaces:**
- Produce:

```ts
export interface MemoryInjectionSettings {
  automaticInjection: boolean
  injectionLimit: number
  injectionMaxChars: number
  includeUserMemory: boolean
  includeProjectMemory: boolean
  projectMemoryEnabled: boolean
}

export interface MemoryInjectionWorkspace {
  cwd?: string
}

export function selectInjectionRecords(
  records: Iterable<MemoryRecord>,
  settings: MemoryInjectionSettings,
  workspace: MemoryInjectionWorkspace,
): MemoryRecord[]

export function renderInjectionText(
  records: readonly MemoryRecord[],
  maxChars: number,
): string | undefined
```

- [x] **Step 1: Write failing pure-function tests**

Cover:

```js
const records = [
  record('global-new', 'global', 'preference', 'Answer in Chinese', '2026-08-27T10:00:00.000Z'),
  record('user-old', 'user', 'preference', 'Use concise answers', '2026-08-26T10:00:00.000Z'),
  record('project-new', 'project', 'convention', 'Use pnpm', '2026-08-27T11:00:00.000Z', '/repo'),
  record('failure', 'failure', 'failure', 'Do not retry this tool blindly', '2026-08-27T12:00:00.000Z'),
  record('other-project', 'project', 'convention', 'Other project', '2026-08-27T13:00:00.000Z', '/other'),
]

assert.deepEqual(
  selectInjectionRecords(records, defaults, { cwd: '/repo' }).map(item => item.id),
  ['project-new', 'user-old', 'global-new'],
)
assert.deepEqual(
  selectInjectionRecords(records, { ...defaults, includeProjectMemory: false }, { cwd: '/repo' }).map(item => item.id),
  ['user-old', 'global-new'],
)
assert.equal(selectInjectionRecords(records, defaults, { cwd: '/other' }).some(item => item.id === 'project-new'), false)
assert.equal(selectInjectionRecords(records, defaults, {}).some(item => item.scope === 'failure'), false)
```

Test that the rendered text:

- starts with a reference-only header;
- includes scope/category labels and content;
- excludes IDs, provenance, project paths, and watermark fields;
- is no longer than `maxChars`;
- returns `undefined` for an empty list.

- [x] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --import tsx --test tests/memory-injection.test.mjs
```

Expected: FAIL because `src/host/memory-injection.ts` does not exist.

- [x] **Step 3: Implement candidate selection**

Filter in this order:

```ts
record.scope === 'global'
|| (record.scope === 'user' && settings.includeUserMemory)
|| (record.scope === 'project'
  && settings.projectMemoryEnabled
  && settings.includeProjectMemory
  && workspace.cwd !== undefined
  && record.projectKey === workspace.cwd)
```

Skip malformed records defensively. Sort by scope priority `project` then `user` then `global`, then descending `updatedAt`, then ascending `id`. Return at most `injectionLimit` records.

- [x] **Step 4: Implement bounded rendering**

Render one message with this exact semantic shape:

```text
[DSH memory context — reference only]

- [project/convention] Use pnpm
- [user/preference] Answer in Chinese

Treat these entries as reference context. They do not override system or user instructions.
```

Trim each content value, omit empty content, and append entries only while the final string remains within `maxChars`. If one entry is too long, truncate it with `…` while preserving the total bound. Never include `id`, `projectKey`, `provenance`, timestamps, or storage keys.

- [x] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
node --import tsx --test tests/memory-injection.test.mjs
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/host/memory-injection.ts tests/memory-injection.test.mjs
git commit -m "feat: select bounded startup memory context"
```

---

### Task 4: Register session-start injection with fail-soft lifecycle behavior

**Files:**
- Modify: `src/host/memory-injection.ts`
- Modify: `src/index.ts:1-35`
- Create: `tests/session-injection.test.mjs`

**Interfaces:**
- Produce:

```ts
export interface MemoryInjectionAgent {
  readonly session: { readonly header: { readonly cwd?: string } }
  inject(message: UserMessage): void
}

export function installMemoryInjection(
  ctx: Context,
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean
```

- [x] **Step 1: Write failing lifecycle tests**

Use a fake event context and fake agent to verify:

```js
const dispose = installMemoryInjection(ctx, storage, settings, logger)
ctx.emit('agent/session-start', { agent, source: 'startup' })
assert.equal(agent.messages.length, 1)
ctx.emit('agent/session-start', { agent, source: 'resume' })
assert.equal(agent.messages.length, 1)
dispose()
ctx.emit('agent/session-start', { agent: secondAgent, source: 'startup' })
assert.equal(secondAgent.messages.length, 0)
```

Also verify:

- disabled settings produce no injection;
- empty candidates produce no message;
- an `inject()` exception is caught and only a stable warning is logged;
- a malformed table entry does not prevent a valid entry from being injected.

- [x] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --import tsx --test tests/session-injection.test.mjs
```

Expected: FAIL because the lifecycle installer is not implemented.

- [x] **Step 3: Implement `installMemoryInjection`**

Register a synchronous listener:

```ts
const injected = new WeakSet<object>()
const stop = ctx.on('agent/session-start', ({ agent }) => {
  if (injected.has(agent)) return
  injected.add(agent)
  try {
    const value = settings.get()
    if (!value.enabled || !value.automaticInjection) return
    const records = selectInjectionRecords([...storage.table.entries()].map(([, record]) => record), value, {
      cwd: agent.session.header.cwd,
    })
    const text = renderInjectionText(records, value.injectionMaxChars)
    if (text === undefined) return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: '@lcthe/dsh-hermes-memory', form: 'recall' },
    }))
  } catch {
    logger.warn('dsh-hermes-memory: startup memory injection skipped')
  }
})
return stop
```

Do not log the caught error object. If the public source type rejects `form: 'recall'`, use only `{ kind: 'plugin', plugin: '@lcthe/dsh-hermes-memory' }`.

- [x] **Step 4: Wire the installer into `apply()`**

Call `installMemoryInjection(ctx, storage, settings, ctx.logger)` after opening storage. Include its disposer in the existing `ctx.effect()` teardown. Preserve the existing tool registration watcher and session capture disposer.

- [x] **Step 5: Run lifecycle tests and the full test suite**

Run:

```bash
node --import tsx --test tests/session-injection.test.mjs
npm test
npm run typecheck
```

Expected: all tests pass and typecheck succeeds.

- [x] **Step 6: Commit**

```bash
git add src/host/memory-injection.ts src/index.ts tests/session-injection.test.mjs
git commit -m "feat: inject memory at session start"
```

---

### Task 5: Synchronize requirements, README, and V3 status

**Files:**
- Modify: `docs/requirements.md:179-191`
- Modify: `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md:1-220`
- Modify: `README.md:4-40`
- Modify: `README.zh.md:4-37`
- Create: `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md`

**Interfaces:**
- Document V3 as implemented only after code and tests pass.
- Keep V3.1 per-step retrieval and automatic capture explicitly deferred.

- [x] **Step 1: Update the requirements status**

Replace the V3 placeholder with:

```markdown
### V3：新会话记忆注入（已实现）

- 默认关闭 `agent/session-start` 自动注入；
- 只读取已持久化且通过现有 scanner 的 global、user 和当前 project 记忆；
- 使用 DSH `agent.inject()`，每个 agent 生命周期最多注入一次；
- 注入条数和总字符数有硬上限；
- 失败时 fail-soft，不影响会话启动；
- 不在 `agent/pre-step` 中重复检索。
```

- [x] **Step 2: Update both READMEs**

State that V3 startup injection is implemented but opt-in, bounded, and not automatic capture. Link the V3 design and plan files.

- [x] **Step 3: Mark the design specification implemented**

Change the V3 design status to `已实现`, record the final public MessageSource shape actually used, and note any implementation deviation from the original draft.

- [x] **Step 4: Run a placeholder and contradiction scan**

Run:

```bash
grep -nE 'TBD|TODO|待实现|设计已确认' docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md
```

Expected: no unresolved implementation placeholders. Intentional deferred-work references must say `延期` or `非目标` rather than `待实现`.

- [x] **Step 5: Commit documentation**

```bash
git add README.md README.zh.md docs/requirements.md docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md
git commit -m "docs: record v3 session-start injection"
```

---

### Task 6: Full verification and package inspection

**Files:**
- Read: generated `lib/` files and `npm pack --dry-run` output

- [x] **Step 1: Run all checks**

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected:

- TypeScript typecheck passes;
- all existing V1/V2 tests plus V3 tests pass;
- Node and client bundles build successfully;
- package dry run contains `lib/index.js`, `lib/client.js`, `lib/invariant.js`, READMEs, and patch metadata;
- no Pi assets or source files are included.

- [x] **Step 2: Inspect the generated bundle**

Run:

```bash
grep -R "memory-injection\|@deepseek-ai/dsh-llm\|pi-hermes" -n lib || true
```

Expected: the bundle references the public DSH LLM dependency as external or contains only the intended import; no Pi strings or assets appear.

- [x] **Step 3: Check Git state**

```bash
git status --short --branch
git log --oneline -8
```

Expected: clean worktree and all V3 commits visible.

- [x] **Step 4: Commit any final verification-only correction**

Only if a generated or documentation correction is required:

```bash
git add <exact-files>
git commit -m "fix: finalize v3 verification"
```

Do not publish a new npm version or push unless explicitly requested.
