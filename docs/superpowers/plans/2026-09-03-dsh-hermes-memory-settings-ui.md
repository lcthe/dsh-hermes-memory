# dsh-hermes-memory Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Hermes Memory settings content so it reads like a native DSH settings section in light and dark themes while preserving all existing setting values and update behavior.

**Architecture:** Keep the existing injected `MemorySettingsSection` and `settingsScope` update path. Add a small presentational group/row vocabulary inside the existing client component, and move all visual hierarchy into the CSS module using DSH `--dsw-alias-*` tokens. Keep dependent controls hidden when their controlling feature is disabled, without changing persisted fields or defaults.

**Tech Stack:** React 18, TypeScript, CSS Modules, DSH client theme aliases, Node test runner, tsx, tsdown.

## Global Constraints

- Use `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, `--dsw-alias-label-tertiary`, and `--dsw-alias-border-*` for theme-sensitive colors.
- Keep the page free of decorative cards, gradients, custom backgrounds, inline styles, and nonexistent `--dsh-fg-*` tokens.
- Preserve the existing `MemorySettings` fields, defaults, validation ranges, `settingsScope` update calls, and saving lock.
- Keep every control keyboard reachable, retain native checkbox and number-input semantics, and avoid horizontal overflow below 560px.
- Run focused tests, typecheck, build, and `git diff --check`; do not run the repository-wide suite unless a focused check exposes a cross-package failure.

---

### Task 1: Add failing structural and theme regression tests

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/tests/client-styles.test.mjs`
- Test source: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Test styles: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: the current client component and CSS module as UTF-8 source text.
- Produces: a red test proving the implementation has native settings groups, DSH theme tokens, and a narrow-layout rule.

- [x] **Step 1: Write the failing test**

Add a second test to `tests/client-styles.test.mjs` that reads both source files and asserts the component references `group`, `groupHeader`, `groupTitle`, `groupDescription`, `rows`, `rowCopy`, and `nested` classes. Assert that the CSS defines a `720px` content cap, a `560px` media query, the tertiary label token, and no shadow-based card decoration.

```js
test('uses native settings groups and responsive layout rules', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../src/client/MemorySettings.tsx', import.meta.url), 'utf8'),
    readFile(cssPath, 'utf8'),
  ])

  for (const className of ['group', 'groupHeader', 'groupTitle', 'groupDescription', 'rows', 'rowCopy', 'nested']) {
    assert.match(component, new RegExp(`css\\.${className}\\b`))
  }
  assert.match(css, /max-width:\s*720px/)
  assert.match(css, /@media\\s*\\(max-width:\s*560px\\)/)
  assert.match(css, /--dsw-alias-label-tertiary/)
  assert.doesNotMatch(css, /box-shadow:/)
})
```

- [x] **Step 2: Run the focused test and verify it fails for the missing design structure**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: the existing readable-token test passes and the new test fails because the current component and CSS do not define the required native settings group vocabulary.

---

### Task 2: Implement grouped native DSH settings content

**Files:**
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/locales.ts`
- Modify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`

**Interfaces:**
- Consumes: the existing `MemorySettingsSection` props, `MemorySettings` type, locale translator, and `patch` callback.
- Produces: a four-group settings section with unchanged persistence behavior and dependency-aware visibility.

- [x] **Step 1: Add the group copy to both locale dictionaries**

Add these keys to `zh` and `en`:

```ts
baseTitle: '基础记忆',
baseDescription: '控制记忆工具、项目范围和默认检索数量。',
captureTitle: '自动捕获',
captureDescription: '从用户消息中识别可以安全保存的偏好、约定和纠正。',
injectionTitle: '新会话注入',
injectionDescription: '在新会话开始时提供有限的参考记忆。',
lifecycleTitle: '保留策略与后台复盘',
lifecycleDescription: '控制过期清理和后台复盘的保留策略。',
```

Use the English equivalents `Core memory`, `Control memory tools, project scope, and the default retrieval count.`, `Automatic capture`, `Identify preferences, conventions, and corrections that are safe to save from user messages.`, `Session-start injection`, `Add a bounded reference context when a new session starts.`, `Retention and background review`, and `Control expired-memory cleanup and background review retention.`.

- [x] **Step 2: Add small presentational group and row wrappers in the client component**

Keep `patch` unchanged. Render this hierarchy inside `section`:

```tsx
<p className={css.description}>{t('description')}</p>
<div className={css.group}>
  <header className={css.groupHeader}>
    <h2 className={css.groupTitle}>{t('baseTitle')}</h2>
    <p className={css.groupDescription}>{t('baseDescription')}</p>
  </header>
  <div className={css.rows}>
    <label className={css.row}>
      <span className={css.rowCopy}>{t('enabled')}</span>
      <input type="checkbox" ... />
    </label>
    ...
  </div>
</div>
```

Use the same `row`/`rowCopy` arrangement for every checkbox and field, with the text on the left and the native control on the right. Put capture-specific options under `div className={css.nested}` only while `automaticCapture` is true. Put injection scope and limits under `nested` only while `automaticInjection` is true. Put `retentionDays` and `failureRetentionDays` under `nested` only while `retentionEnabled` is true. Move `automaticReview` out of the capture conditional into the lifecycle group so it can be enabled independently; keep its two budget fields conditional on `automaticReview`.

Preserve every existing input range and `onChange` patch key exactly. Keep `disabled={saving}` on all controls, keep the existing notes in the relevant groups, and keep `disabledNote` after the groups when `value.enabled` is false.

- [x] **Step 3: Replace the flat CSS with DSH settings layout rules**

Implement these rules in `memory-settings.module.css`:

```css
.section {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 720px;
  padding: 4px 0 24px;
  color: var(--dsw-alias-label-primary);
}

.description,
.groupDescription,
.note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 20px;
}

.groupHeader {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.groupTitle {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.rows,
.nested {
  display: flex;
  flex-direction: column;
}

.rows {
  gap: 0;
}

.nested {
  gap: 0;
  margin-left: 20px;
}

.row,
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding: 10px 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}

.rowCopy,
.field > span {
  min-width: 0;
  flex: 1;
}

.row input[type='checkbox'] {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
}

.field input[type='number'] {
  box-sizing: border-box;
  flex: none;
  width: 96px;
  min-height: 32px;
}

@media (max-width: 560px) {
  .section {
    gap: 22px;
  }

  .row,
  .field {
    align-items: flex-start;
  }

  .field input[type='number'] {
    width: 84px;
  }
}
```

Retain visible focus behavior from the native controls and use only DSH alias tokens for text and borders. Do not add a shadow, gradient, or colored side stripe.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/client-styles.test.mjs`

Expected: both client-style tests pass.

---

### Task 3: Verify the built client artifact and preserve repository quality

**Files:**
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/MemorySettings.tsx`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/locales.ts`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/src/client/memory-settings.module.css`
- Verify: `/Volumes/GM7/code/dsh-hermes-memory/lib/client.js`

**Interfaces:**
- Consumes: the grouped component and theme CSS from Task 2.
- Produces: a type-safe, bundled client artifact with no stale low-contrast token references.

- [x] **Step 1: Run the complete package test set**

Run: `npm test`

Expected: all package tests pass.

- [x] **Step 2: Run TypeScript validation**

Run: `npm run typecheck`

Expected: TypeScript exits successfully with no diagnostics.

- [x] **Step 3: Rebuild the package**

Run: `npm run build`

Expected: tsdown emits `lib/client.js` and `lib/index.js`; only the repository's existing tsdown deprecation warnings may appear.

- [x] **Step 4: Check the generated client for theme-token hygiene**

Run: `rg -n -- '--dsw-alias-label-(primary|secondary|tertiary)|--dsh-fg-' lib/client.js`

Expected: DSH alias tokens are present and no `--dsh-fg-` token is present.

- [x] **Step 5: Run whitespace and status checks**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the intended component, locale, CSS, test, plan, and generated build changes are present.

- [x] **Step 6: Commit the implementation**

```bash
git add src/client/MemorySettings.tsx src/client/locales.ts src/client/memory-settings.module.css tests/client-styles.test.mjs docs/superpowers/plans/2026-09-03-dsh-hermes-memory-settings-ui.md lib/client.js lib/index.js
git commit -m "feat(client): align memory settings with DSH UI"
```
