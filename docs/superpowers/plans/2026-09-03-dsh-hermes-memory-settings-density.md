# dsh-hermes-memory Settings Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce visual noise in the Hermes Memory settings page by removing row-level dividers and secondary helper copy while preserving the settings controls and switch behavior.

**Architecture:** Keep the existing four `SettingsGroup` blocks and all persistence code. Remove group descriptions and inline notes from the rendered tree, then replace row borders with spacing so only each group's top divider remains.

**Tech Stack:** React 18, TypeScript, CSS Modules, Node test runner, tsdown.

## Global Constraints

- Keep all setting fields, ranges, defaults, labels, and `patch` calls unchanged.
- Keep the page-level `description` and the section titles visible.
- Do not add new decorative surfaces, shadows, gradients, or hardcoded theme colors.
- Use whitespace and the existing group top divider for hierarchy.
- Run the focused test, package tests, typecheck, build, and `git diff --check` before claiming completion.

---

### Task 1: Add failing density regression tests

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/tests/client-styles.test.mjs`
- Test source: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Test styles: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: the current settings component and CSS module as source text.
- Produces: a red test that locks the compact hierarchy and removal of row-level dividers/helper paragraphs.

- [x] **Step 1: Write the failing test**

Append this test:

```js
test('keeps settings groups quiet and avoids row-level dividers', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.doesNotMatch(component, /css\\.groupDescription/)
  assert.doesNotMatch(component, /css\\.captureNote|css\\.injectionNote|css\\.reviewNote/)
  assert.doesNotMatch(css, /border-bottom:/)
  assert.match(css, /border-top:\s*1px solid var\\(--dsw-alias-border-l2\\)/)
  assert.match(css, /\.rows[\\s\\S]*gap:\s*12px/)
})
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: the existing tests pass and the new density test fails because group descriptions, note paragraphs, and row-level `border-bottom` rules still exist.

---

### Task 2: Remove secondary copy and row dividers

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: the current `SettingsGroup`, `ToggleRow`, and `NumberRow` components.
- Produces: the same settings controls with less visual fragmentation and no helper-note DOM nodes.

- [x] **Step 1: Remove group and conditional helper paragraphs from JSX**

Change `SettingsGroup` to accept only `title` and `children`, render only the `h2` header and rows, and remove the `description` prop from all four call sites. Remove `captureNote`, `injectionNote`, and `reviewNote` paragraphs. Keep `description`, all group titles, all control labels, and `disabledNote`.

- [x] **Step 2: Replace row borders with spacing**

Keep `.group`'s `border-top` rule. Change `.rows` and `.nested` to `gap: 12px`, remove `border-bottom` from `.row, .field`, and keep their existing padding and control alignment. Set `.nested` to `gap: 8px` so dependent fields remain visibly subordinate without additional rules.

- [x] **Step 3: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: all focused tests pass and the density test confirms no row-level divider or helper-note class remains in the rendered component.

---

### Task 3: Verify and commit

**Files:**
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/docs/superpowers/specs/2026-09-03-dsh-hermes-memory-settings-ui-design.md`

- [x] **Step 1: Run package tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all tests pass and TypeScript exits successfully.

- [x] **Step 2: Rebuild and inspect the client**

Run: `npm run build && if rg -n -- 'border-bottom|groupDescription' lib/client.js; then exit 1; else echo 'built client contains no row dividers or group-description selector'; fi`

Expected: the build succeeds and the command finds no removed row-divider or group-description selectors in the generated client. The locale dictionary may still contain the unused helper-copy translations for future reuse.

- [x] **Step 3: Run whitespace validation**

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 4: Commit the density revision**

```bash
git add src/client/MemorySettings.tsx src/client/memory-settings.module.css tests/client-styles.test.mjs docs/superpowers/specs/2026-09-03-dsh-hermes-memory-settings-ui-design.md docs/superpowers/plans/2026-09-03-dsh-hermes-memory-settings-density.md
git commit -m "feat(client): reduce memory settings visual noise"
```
