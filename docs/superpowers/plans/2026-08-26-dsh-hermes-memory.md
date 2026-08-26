# dsh-hermes-memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DSH-native persistent memory plugin with explicit memory tools, scoped storage, pre-write safety scanning, and a settings card, without copying Pi runtime code or visual assets.

**Architecture:** Keep `src/core` independent from DSH. Implement storage, tools, workspace authorization, lifecycle adapters, and settings in `src/host`; expose only safe settings UI in `src/client`. V1 uses DSH `storage-domain`, not custom session SQLite or vector search, and leaves automatic capture/injection/background learning behind explicit interfaces.

**Tech Stack:** TypeScript, Cordis, DSH Host APIs, DSH `storage-domain`, DSH tools, React, DSH settings slots, tsdown, Node test runner with `tsx`.

## Global Constraints

- Do not copy Pi runtime code, Pi commands, Pi TUI, Pi logo, Pi Hermes Memory logo, screenshots, diagrams, or other Pi visual assets.
- Do not modify DSH source code.
- Do not expose Node file handles, database paths, raw secrets, or host stack traces to Client.
- Do not write complete memory state into DSH SessionEvent.
- Project memory must be authorized against the current workspace.
- All persisted content must pass the core safety scanner before storage.
- V1 must use `storage-domain`; custom SQLite/FTS5/vector indexing is deferred.

---

### Task 1: Initialize the DSH plugin package

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `tsdown.config.ts`
- Create: `.gitignore`
- Create: `src/types.d.ts`

**Interfaces:**
- Produces a buildable DSH package named `@lcthe/dsh-hermes-memory`.
- Exposes Host entry `src/index.ts` and Client entry `src/client/index.ts` in later tasks.

- [ ] **Step 1: Add package metadata and DSH bundle declaration**

Use `type: module`, MIT license, repository `https://github.com/lcthe/dsh-hermes-memory.git`, and DSH client injection for locale, settings, slots, primitives, and web runtime. Keep DSH packages as peer/dev dependencies and do not add Pi packages.

- [ ] **Step 2: Add TypeScript and tsdown configuration**

Use the existing DSH plugin pattern: Node ESM Host bundle, browser Client bundle, externalize React and DSH platform modules, inline CSS modules only for Client output, and emit declarations from `src`.

- [ ] **Step 3: Add CSS module declarations and ignore rules**

Declare `*.module.css` as `Record<string, string>`. Ignore `node_modules`, `lib`, local DSH links, logs, and OS metadata.

- [ ] **Step 4: Run the empty package typecheck**

Run: `npm run typecheck`
Expected: the command may report missing entry files until Task 2 creates them; do not commit a broken package after Task 2.

- [ ] **Step 5: Commit package bootstrap**

```bash
git add package.json cordis.patch.yml tsconfig.json tsconfig.build.json tsdown.config.ts .gitignore src/types.d.ts
git commit -m "chore: initialize dsh hermes memory package"
```

### Task 2: Implement the runtime-independent memory core

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/validation.ts`
- Create: `src/core/content-scanner.ts`
- Create: `src/core/memory-repository.ts`
- Test: `tests/core.test.mjs`

**Interfaces:**
- `MemoryScope`, `MemoryCategory`, `MemoryProvenance`, `MemoryRecord` from the design spec.
- `validateMemoryInput(input): ValidatedMemoryInput`.
- `scanContent(content): ScanResult`.
- `MemoryRepository` with `save`, `search`, `replace`, and `remove` operations.

- [ ] **Step 1: Write failing tests for validation and scanner**

Cover empty content, invalid scope/category, project scope without project key, representative API key, private key block, zero-width character, prompt injection pattern, and an ordinary safe sentence.

- [ ] **Step 2: Run core tests to verify failure**

Run: `node --import tsx --test tests/core.test.mjs`
Expected: FAIL because core modules do not exist.

- [ ] **Step 3: Implement types and pure validation**

Reject unsupported scope/category, trim content, enforce a bounded content length, require project key for `project`, and normalize optional limits to a hard maximum of 20.

- [ ] **Step 4: Implement scanner with non-sensitive result codes**

Return only `allowed`, `reason`, and `ruleId`; never return matched secret text. Keep patterns in a small immutable table so tests can assert rule IDs without exposing content.

- [ ] **Step 5: Implement in-memory repository contract**

Use this as the storage-independent reference implementation. Enforce scope filtering, project authorization, stable ID replacement/removal, deterministic ordering, and scanner invocation before save/replace.

- [ ] **Step 6: Run core tests to verify pass**

Run: `node --import tsx --test tests/core.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit core**

```bash
git add src/core tests/core.test.mjs
git commit -m "feat: add scoped memory core and safety scanner"
```

### Task 3: Connect the memory core to DSH storage-domain

**Files:**
- Create: `src/host/storage.ts`
- Create: `src/host/workspace.ts`
- Create: `tests/storage.test.mjs`

**Interfaces:**
- `openMemoryStore(ctx): Promise<MemoryStoreHandle>`.
- `resolveWorkspace(exec): WorkspaceContext`.
- `MemoryStoreHandle` implements the core repository operations and persists schema version 1 records through DSH storage-domain.

- [ ] **Step 1: Write failing storage adapter tests**

Use a fake domain implementing `get`, `entries`, `put`, `delete`, and `update`. Test save/reload, schema version preservation, project filtering, and missing-record removal.

- [ ] **Step 2: Run storage tests to verify failure**

Run: `node --import tsx --test tests/storage.test.mjs`
Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement storage-domain adapter**

Open a namespaced domain, serialize records as JSON-safe values, keep writes serial, and isolate storage errors behind `storage_unavailable` errors. Do not expose domain handles to Client.

- [ ] **Step 4: Implement workspace resolver**

Derive a stable project key from the current DSH agent/workspace context. Reject caller-supplied project keys that differ from the authorized workspace.

- [ ] **Step 5: Run storage tests to verify pass**

Run: `node --import tsx --test tests/storage.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit storage adapter**

```bash
git add src/host/storage.ts src/host/workspace.ts tests/storage.test.mjs
git commit -m "feat: persist memories through dsh storage domain"
```

### Task 4: Register DSH memory tools

**Files:**
- Create: `src/host/tools.ts`
- Create: `src/host/errors.ts`
- Create: `src/index.ts`
- Test: `tests/tools.test.mjs`

**Interfaces:**
- Register `memory_save`, `memory_search`, `memory_replace`, and `memory_remove` through `defineTool` and `ctx.tools.register`.
- Tool results use `{ success: boolean, content: string, details?: object, error?: { code: string, message: string } }`.

- [ ] **Step 1: Write failing tool contract tests**

Test registration names, save/search/replace/remove flow, blocked content, invalid arguments, unauthorized project scope, and not-found removal.

- [ ] **Step 2: Run tool tests to verify failure**

Run: `node --import tsx --test tests/tools.test.mjs`
Expected: FAIL because host tool registration is absent.

- [ ] **Step 3: Implement stable error mapping**

Map validation, authorization, scan, storage, and not-found failures to `invalid_args`, `unauthorized_scope`, `blocked_content`, `storage_unavailable`, and `not_found`.

- [ ] **Step 4: Implement DSH tool definitions**

Use JSON-safe schemas, bounded limits, explicit project authorization, and no raw exception/stack output. Keep tool execution short and synchronous from the model's perspective; do not start background learning in a tool body.

- [ ] **Step 5: Implement Cordis plugin entry**

Declare only required DSH injections, register tools inside `ctx.effect`, and make disposal remove all registrations automatically with the Fiber lifecycle.

- [ ] **Step 6: Run tool tests and typecheck**

Run: `node --import tsx --test tests/tools.test.mjs && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit tools**

```bash
git add src/index.ts src/host/tools.ts src/host/errors.ts tests/tools.test.mjs
git commit -m "feat: register explicit dsh memory tools"
```

### Task 5: Add settings namespace and Client settings card

**Files:**
- Create: `src/host/settings.ts`
- Create: `src/client/index.ts`
- Create: `src/client/locales.ts`
- Create: `src/client/MemorySettings.tsx`
- Create: `src/client/memory-settings.module.css`
- Test: `tests/settings.test.mjs`

**Interfaces:**
- Settings namespace `memory` with `enabled`, `defaultLimit`, `allowedScopes`, `scanMode`, `retentionDays`, `projectMemoryEnabled`, and `automaticCapture`.
- Client registers a keyed `settings.plugin.item` slot and renders only non-sensitive settings.

- [ ] **Step 1: Write failing settings tests**

Test defaults, limit validation, scope validation, `automaticCapture` defaulting to false, and redacted handling of future secret fields.

- [ ] **Step 2: Run settings tests to verify failure**

Run: `node --import tsx --test tests/settings.test.mjs`
Expected: FAIL because settings modules are absent.

- [ ] **Step 3: Implement Host settings schema**

Register the namespace with `applies: 'live'` for toggles and limits. Reject values outside bounded ranges and ensure automatic capture is disabled by default.

- [ ] **Step 4: Implement Client settings card**

Use DSH locale and settings APIs. Provide accessible labels, numeric limit input, scope checkboxes, and a warning that automatic capture is not part of V1. Do not show file paths, database details, or secrets.

- [ ] **Step 5: Run settings tests and build**

Run: `node --import tsx --test tests/settings.test.mjs && npm run build`
Expected: PASS and `lib` contains Host and Client bundles.

- [ ] **Step 6: Commit settings**

```bash
git add src/host/settings.ts src/client tests/settings.test.mjs
 git commit -m "feat: add dsh memory settings card"
```

### Task 6: Add documentation, local verification, and GitHub publication

**Files:**
- Modify: `README.md`
- Create: `README.zh.md`
- Modify: `docs/requirements.md`
- Modify: `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`
- Modify: `docs/superpowers/plans/2026-08-26-dsh-hermes-memory.md`

**Interfaces:**
- Documentation describes the implemented V1 contracts and explicitly preserves the no-Pi-assets boundary.

- [ ] **Step 1: Run the complete local verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands pass, and no Pi package, image, logo, or runtime import is present.

- [ ] **Step 2: Review package contents**

Run: `npm pack --dry-run`
Expected: only built plugin files, patch metadata, package metadata, and documentation intended for publication are included.

- [ ] **Step 3: Initialize Git and commit the bootstrap**

```bash
git init
git add .
git commit -m "docs: initialize dsh hermes memory design"
```

- [ ] **Step 4: Create the GitHub repository**

```bash
gh repo create lcthe/dsh-hermes-memory --public --source=. --remote=origin --description "DSH-native persistent memory and safe session-aware retrieval plugin"
git push -u origin HEAD
```

Expected: repository URL is `https://github.com/lcthe/dsh-hermes-memory` and the default branch contains the initial documentation and package skeleton.

- [ ] **Step 5: Verify GitHub state**

Run: `gh repo view lcthe/dsh-hermes-memory --json name,url,defaultBranchRef`
Expected: the repository exists, points to the local project, and the pushed branch is visible.
