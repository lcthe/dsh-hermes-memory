# V6 Standing Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist user profile and standing instructions and inject them once at every new agent lifecycle.

**Architecture:** Store standing entries in a dedicated storage-domain table and expose a focused repository. Model-facing pin tools are the only conversational write path; a separate session-start injector renders a bounded instruction block independently of ordinary memory injection.

**Tech Stack:** TypeScript, Cordis events, DSH storage-domain/tools/settings, React, Node test runner.

## Global Constraints

- Standing context is limited to 20 entries, 2,000 rendered characters, and 500 characters per entry.
- Background capture, background review, and consolidation cannot create or promote standing entries.
- Standing context injects once per agent lifecycle whenever the plugin and `standingContextEnabled` are enabled, even if `automaticInjection` is false.
- Project rules remain project memory and cannot become global standing context automatically.
- Every persisted and model-visible value passes existing safety scanning; failures log no original content.

---

### Task 1: Standing record storage and repository

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/host/storage-spec.ts`
- Modify: `src/host/storage.ts`
- Create: `src/host/standing-store.ts`
- Create: `tests/standing-store.test.mjs`

**Interfaces:**
- Produces: `StandingEntry`, `StandingInput`, `StandingLimits`, `StandingStore`, and `createStandingStore(table)`.
- `StandingStore` exposes `add(input, limits)`, `list()`, and `remove(id)`; callers supply live settings and the store enforces immutable maxima.

- [ ] **Step 1: Write failing repository tests**

```ts
test('persists profile and instruction entries in stable order', async () => {
  const store = createStandingStore(table)
  await store.add({ kind: 'profile', content: 'The user prefers Chinese.' })
  await store.add({ kind: 'instruction', content: 'Act as the DSH maintainer.' })
  assert.deepEqual((await store.list()).map(item => item.kind), ['profile', 'instruction'])
})

test('rejects unsafe, duplicate, oversized, over-count, and over-budget entries', async () => {
  await assert.rejects(() => store.add({ kind: 'instruction', content: blockedSecret }))
  assert.equal((await store.list()).length, originalCount)
})
```

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/standing-store.test.mjs`
Expected: FAIL because `standing-store.ts` and the storage table do not exist.

- [ ] **Step 3: Implement the validated data model**

```ts
export type StandingKind = 'profile' | 'instruction'
export interface StandingEntry {
  id: string
  kind: StandingKind
  content: string
  createdAt: string
  updatedAt: string
  provenance: { source: 'explicit'; sessionId?: string; eventSeq?: number }
  schemaVersion: 1
}
export interface StandingStore {
  add(input: StandingInput, limits: StandingLimits): Promise<StandingEntry>
  list(): Promise<StandingEntry[]>
  remove(id: string): Promise<StandingEntry>
}
```

Implement exact duplicate detection after trimming, safety scanning before writes, deterministic `kind/updatedAt/id` ordering, and immutable maxima of 20 entries, 2,000 total content characters, and 500 characters per entry. Reject supplied limits outside those maxima. Add `standing` to `memoryDomainSpec` and expose it through `MemoryStorage`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/standing-store.test.mjs`
Expected: PASS.

```bash
git add src/core/types.ts src/host/storage-spec.ts src/host/storage.ts src/host/standing-store.ts tests/standing-store.test.mjs
git commit -m "feat: persist standing memory context"
```

### Task 2: Pin tools and standing session injection

**Files:**
- Create: `src/host/standing-injection.ts`
- Modify: `src/host/tools.ts`
- Modify: `src/host/tool-definitions.ts`
- Modify: `src/index.ts`
- Create: `tests/standing-injection.test.mjs`
- Modify: `tests/tools.test.mjs`

**Interfaces:**
- Consumes: `StandingStore` from Task 1.
- Produces: `installStandingInjection(ctx, store, settings, logger)` and tools `memory_pin`, `memory_pins`, `memory_unpin`.

- [ ] **Step 1: Write failing tool and injection tests**

```ts
test('injects standing context when ordinary injection is disabled', async () => {
  settings.automaticInjection = false
  settings.standingContextEnabled = true
  await emitSessionStart(agent)
  assert.match(injectedText(agent), /Act as the DSH maintainer/)
})

test('does not duplicate standing context on resume', async () => {
  await emitSessionStart(agentWithRecordedStandingMessage)
  assert.equal(agentWithRecordedStandingMessage.injected.length, 0)
})
```

Add tool tests that verify provenance, bounded listing, missing-ID errors, and scanner error mapping.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/standing-injection.test.mjs tests/tools.test.mjs`
Expected: FAIL because the injector and tool definitions are absent.

- [ ] **Step 3: Implement tools and one-time injection**

```ts
export function renderStandingText(entries: readonly StandingEntry[], maxChars = 2_000): string | undefined
export function installStandingInjection(
  ctx: Context,
  store: StandingStore,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean
```

Render profile entries before instructions, use DSH's supported plugin source form `instructions` with the `[DSH standing context]` marker, detect that marker in session history, and inject through `agent.inject()`. Tool descriptions must say `memory_pin` is used only after an explicit user request. Pass the current `standingMaxEntries` and `standingMaxChars` settings to each add operation, and register and dispose all three tools through the existing settings-controlled tool lifecycle.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/standing-injection.test.mjs tests/tools.test.mjs`
Expected: PASS.

```bash
git add src/host/standing-injection.ts src/host/tools.ts src/host/tool-definitions.ts src/index.ts tests/standing-injection.test.mjs tests/tools.test.mjs
git commit -m "feat: inject and manage standing context"
```

### Task 3: Settings, UI, documentation, and V6 integration

**Files:**
- Modify: `src/host/settings.ts`
- Modify: `src/client/MemorySettings.tsx`
- Modify: `src/client/locales.ts`
- Modify: `tests/settings.test.mjs`
- Modify: `tests/client-styles.test.mjs`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/requirements.md`

**Interfaces:**
- Adds `standingContextEnabled`, `standingMaxEntries`, and `standingMaxChars` to `MemorySettings`.

- [ ] **Step 1: Write failing settings and UI tests**

```ts
test('accepts bounded standing settings', () => {
  assert.doesNotThrow(() => validateMemorySettings({ ...defaults, standingContextEnabled: true, standingMaxEntries: 20, standingMaxChars: 2_000 }))
})
```

Assert the settings component contains a collapsible standing-context card and exact setting update keys.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/settings.test.mjs tests/client-styles.test.mjs`
Expected: FAIL because the settings and UI card are absent.

- [ ] **Step 3: Implement settings and current-state documentation**

Add defaults `true`, `20`, and `2_000`; validate integer ranges `1..20` and `100..2_000`. Add concise Chinese and English labels without row-level help text. Update current-state docs, tool inventory, storage description, and remove standing context from deferred scope.

- [ ] **Step 4: Run V6 verification and commit**

Run: `npm test && npm run typecheck && npm run build && git diff --check`
Expected: all tests pass, typecheck/build exit 0, and no whitespace errors.

```bash
git add src/host/settings.ts src/client/MemorySettings.tsx src/client/locales.ts tests/settings.test.mjs tests/client-styles.test.mjs README.md README.zh.md docs/requirements.md
git commit -m "feat: expose standing context settings"
```
