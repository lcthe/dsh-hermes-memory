# dsh-hermes-memory Switch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible checkboxes in Hermes Memory settings with compact DSH-style sliding switches while retaining native checkbox semantics and keyboard access.

**Architecture:** Keep `ToggleRow` as the single owner of toggle interaction and `patch` as the existing persistence path. Wrap each native checkbox in a switch track, visually hide only the input's default appearance, and use theme aliases for off, on, disabled, and focus states.

**Tech Stack:** React 18, TypeScript, CSS Modules, DSH theme aliases, Node test runner, tsdown.

## Global Constraints

- Preserve `input type="checkbox"`, its checked state, `disabled={saving}`, and the existing `onChange` path.
- Use `--dsw-alias-*` tokens only for switch colors; do not hardcode light-theme colors.
- Keep the switch reachable by keyboard and expose the same accessible label through the surrounding `<label>`.
- Match the supplied reference: compact horizontal track, circular thumb, green active state, neutral inactive state.
- Run the focused test, package tests, typecheck, build, and `git diff --check` before claiming completion.

---

### Task 1: Add the failing switch regression test

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/tests/client-styles.test.mjs`
- Test source: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Test styles: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: the current toggle row source and CSS module.
- Produces: a red test requiring a dedicated switch wrapper, track, thumb, checked state, and visible focus rule.

- [x] **Step 1: Add the structural assertions**

Append a test that reads the component and CSS and asserts the component references `css.switch`, `css.switchTrack`, and `css.switchThumb`; the CSS defines a checked selector, a `:focus-visible` selector, and the success-primary theme token.

```js
test('renders accessible toggles with DSH switch visuals', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  assert.match(component, /css\\.switch\\b/)
  assert.match(component, /css\\.switchTrack\\b/)
  assert.match(component, /css\\.switchThumb\\b/)
  assert.match(css, /input:checked \\+ \\.switchTrack/)
  assert.match(css, /input:focus-visible/)
  assert.match(css, /--dsw-alias-state-success-primary/)
})
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: the existing tests pass and the new switch test fails because `ToggleRow` and the CSS module do not yet define switch visuals.

---

### Task 2: Implement the accessible DSH-style switch

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: `ToggleRow`'s existing `checked`, `disabled`, and `onChange` props.
- Produces: a label containing the original native checkbox plus a visual track and thumb.

- [x] **Step 1: Wrap the native checkbox in the switch elements**

Change only `ToggleRow`'s control markup to:

```tsx
<span className={css.switch}>
  <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  <span className={css.switchTrack} aria-hidden="true">
    <span className={css.switchThumb} />
  </span>
</span>
```

Keep the visible `rowCopy` span and the enclosing label unchanged so accessible names and click-to-toggle behavior remain intact.

- [x] **Step 2: Add the switch geometry and theme states**

Append these rules to the CSS module:

```css
.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  width: 36px;
  height: 20px;
}

.switch input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  opacity: 0;
}

.switchTrack {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  width: 36px;
  height: 20px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  padding: 2px;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}

.switchThumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary);
  transition: transform 120ms ease-out, background-color 120ms ease-out;
}

.switch input:checked + .switchTrack {
  border-color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-state-success-primary);
}

.switch input:checked + .switchTrack .switchThumb {
  background: var(--dsw-alias-label-primary-foreground);
  transform: translateX(16px);
}

.switch input:focus-visible + .switchTrack {
  outline: 2px solid var(--dsw-alias-border-l3);
  outline-offset: 2px;
}

.switch input:disabled {
  cursor: default;
}

.switch input:disabled + .switchTrack {
  opacity: 0.4;
}

@media (prefers-reduced-motion: reduce) {
  .switchTrack,
  .switchThumb {
    transition: none;
  }
}
```

Use `@media (max-width: 560px)` only for the existing row layout; the switch remains 36px wide so the control stays easy to target on narrow screens.

- [x] **Step 3: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: all focused client-style tests pass.

---

### Task 3: Verify and commit the switch change

**Files:**
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/lib/client.js`

- [x] **Step 1: Run package tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all tests pass and TypeScript exits successfully.

- [x] **Step 2: Rebuild the package**

Run: `npm run build`

Expected: the client bundle is regenerated successfully; existing tsdown deprecation warnings may remain.

- [x] **Step 3: Check the built switch selectors and whitespace**

Run: `rg -n -- 'switchTrack|state-success-primary|--dsh-fg-' lib/client.js && git diff --check`

Expected: the built client contains the switch track and success token, contains no `--dsh-fg-` token, and has no whitespace errors.

- [x] **Step 4: Commit the change**

```bash
git add src/client/MemorySettings.tsx src/client/memory-settings.module.css tests/client-styles.test.mjs docs/superpowers/plans/2026-09-03-dsh-hermes-memory-switch-controls.md
git commit -m "feat(client): use switches for memory settings"
```
