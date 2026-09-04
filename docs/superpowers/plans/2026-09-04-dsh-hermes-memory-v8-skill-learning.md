# V8 Skill Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist reusable user/project skills and expose them through DSH's native skill registry and loader.

**Architecture:** A Hermes storage-backed skill provider projects validated records into DSH `SkillCandidate` and `SkillDefinition` objects. Explicit management tools own mutations; an optional structured background reviewer can create at most one new skill after a sufficiently complex successful session.

**Tech Stack:** TypeScript, DSH storage-domain/skill/jobs/subagents/tools/settings, React, Node test runner.

## Global Constraints

- Skills use DSH's native registry, catalog, precedence, and `skill` loader; Hermes does not create a second loader.
- Skill scope is `user` or `project`; project access requires exact workspace equality.
- Automatic skill learning defaults off and requires at least 8 successful calls across at least 2 distinct tools.
- One session review creates at most one skill and cannot update or delete existing skills.
- Initial skill bodies are bounded Markdown only; no scripts, binaries, or arbitrary attachments are generated.
- Ordinary memory remains usable when `ctx.skills` is unavailable.

---

### Task 1: Skill records, storage, and DSH provider

**Files:**
- Create: `src/host/skill-types.ts`
- Create: `src/host/skill-store.ts`
- Create: `src/host/memory-skill-provider.ts`
- Modify: `src/host/storage-spec.ts`
- Modify: `src/host/storage.ts`
- Modify: `package.json`
- Create: `tests/skill-store.test.mjs`
- Create: `tests/memory-skill-provider.test.mjs`

**Interfaces:**
- Produces: `StoredSkill`, `SkillStore`, `createSkillStore(table)`, and `installMemorySkillProvider(ctx, store)`.

- [ ] **Step 1: Write failing store and provider tests**

```ts
test('lists user and matching project skills for the current cwd', async () => {
  const summaries = await provider.list({ cwd: '/repo-a' })
  assert.deepEqual(summaries.map(item => item.name), ['project-skill', 'user-skill'])
})

test('refuses to load a project skill from another workspace', async () => {
  assert.equal(await provider.get(projectCandidate, { cwd: '/repo-b' }), undefined)
})
```

Cover kebab-case names, same-scope uniqueness, description/body bounds, scanner rejection, stable ordering, and invalidation after mutations.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/skill-store.test.mjs tests/memory-skill-provider.test.mjs`
Expected: FAIL because skill modules and storage are absent.

- [ ] **Step 3: Implement persistent records and provider**

```ts
export type StoredSkillScope = 'user' | 'project'
export interface StoredSkill {
  id: string
  name: string
  description: string
  content: string
  scope: StoredSkillScope
  projectKey?: string
  createdAt: string
  updatedAt: string
  provenance: { source: 'explicit' | 'session'; sessionId?: string; flushedSeq?: number }
  schemaVersion: 1
}
```

Register one `hermes-memory` provider through `ctx.skills.register()`, map records to DSH native candidates/definitions, enforce cwd again in `get`, and call provider control invalidation after successful writes. Use optional service lookup so missing skills support does not block plugin startup.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/skill-store.test.mjs tests/memory-skill-provider.test.mjs && npm run typecheck`
Expected: PASS and typecheck exits 0.

```bash
git add src/host/skill-types.ts src/host/skill-store.ts src/host/memory-skill-provider.ts src/host/storage-spec.ts src/host/storage.ts package.json tests/skill-store.test.mjs tests/memory-skill-provider.test.mjs
git commit -m "feat: provide persistent memory skills"
```

### Task 2: Explicit skill management tools

**Files:**
- Modify: `src/host/tools.ts`
- Modify: `src/host/tool-definitions.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools.test.mjs`

**Interfaces:**
- Consumes: `SkillStore` from Task 1.
- Produces: `memory_skill_create`, `memory_skill_list`, `memory_skill_update`, and `memory_skill_remove`.

- [ ] **Step 1: Write failing management-tool tests**

```ts
test('creates a project skill only in the active workspace', async () => {
  const result = await createSkill({ name: 'release-check', scope: 'project', projectKey: cwd, description, content }, exec)
  assert.equal(result.success, true)
})

test('does not move a skill between scopes during update', async () => {
  const result = await updateSkill({ id, scope: 'user' }, exec)
  assert.equal(result.error?.code, 'invalid_args')
})
```

Cover bounded summaries, duplicate names, missing IDs, scanner failures, cross-project authorization, and service-unavailable errors.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/tools.test.mjs`
Expected: FAIL because skill tool definitions are absent.

- [ ] **Step 3: Implement and register the tools**

```ts
export interface MemorySkillToolResult {
  success: boolean
  operation: 'skill-create' | 'skill-list' | 'skill-update' | 'skill-remove'
  skill?: unknown
  skills?: unknown[]
  error?: { code: string; message: string }
}
```

Resolve project scope from `ToolRunContext`, never trust a supplied foreign project key, return only summaries from list, and rely on DSH's native `skill` tool for full-body loading.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --import tsx --test tests/tools.test.mjs tests/memory-skill-provider.test.mjs`
Expected: PASS.

```bash
git add src/host/tools.ts src/host/tool-definitions.ts src/index.ts tests/tools.test.mjs
git commit -m "feat: manage persistent memory skills"
```

### Task 3: Automatic skill extraction, settings, UI, and docs

**Files:**
- Create: `src/host/skill-review-schema.ts`
- Create: `src/host/skill-review-prompt.ts`
- Create: `src/host/auto-skill-review.ts`
- Modify: `src/host/settings.ts`
- Modify: `src/index.ts`
- Modify: `src/client/MemorySettings.tsx`
- Modify: `src/client/locales.ts`
- Create: `tests/skill-review-schema.test.mjs`
- Create: `tests/auto-skill-review.test.mjs`
- Modify: `tests/settings.test.mjs`
- Modify: `tests/client-styles.test.mjs`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/requirements.md`

**Interfaces:**
- Adds `skillLearningEnabled`, `skillMinToolCalls`, `skillMinDistinctTools`, `skillMaxContentChars`, and `skillDefaultScope`.

- [ ] **Step 1: Write failing extraction and settings tests**

```ts
test('requires eight successful calls across two tools', () => {
  assert.equal(shouldReviewSkills({ successfulCalls: 7, distinctTools: 2 }), false)
  assert.equal(shouldReviewSkills({ successfulCalls: 8, distinctTools: 2 }), true)
})

test('creates at most one validated skill per flushed session', async () => {
  const result = await applySkillReview(outputWithTwoCandidates)
  assert.equal(result.created, 1)
})
```

Cover failed-ending sessions, repeated flushes, same-name candidates, unsupported providers, scanner rejection, project binding, cancellation, and teardown.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test tests/skill-review-schema.test.mjs tests/auto-skill-review.test.mjs tests/settings.test.mjs tests/client-styles.test.mjs`
Expected: FAIL because extraction and settings are absent.

- [ ] **Step 3: Implement structured extraction and UI**

Count only successful `tool/result` events paired with distinct tool names. Use independent per-session flush state, a bounded session projection, and a structured-output provider. Validate exactly one candidate through `SkillStore`; never update or delete an existing skill. Add a collapsed “Skill learning” settings card and current-state docs.

- [ ] **Step 4: Run V8 verification and commit**

Run: `npm test && npm run typecheck && npm run build && npm pack --dry-run && git diff --check`
Expected: all tests pass, typecheck/build/pack exit 0, and no whitespace errors.

```bash
git add src/host/skill-review-schema.ts src/host/skill-review-prompt.ts src/host/auto-skill-review.ts src/host/settings.ts src/index.ts src/client/MemorySettings.tsx src/client/locales.ts tests/skill-review-schema.test.mjs tests/auto-skill-review.test.mjs tests/settings.test.mjs tests/client-styles.test.mjs README.md README.zh.md docs/requirements.md
git commit -m "feat: learn reusable memory skills"
```
