# dsh-hermes-memory V4 规则型会话候选捕获实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从真实用户消息中按规则捕获偏好、约定和纠正候选，经安全扫描后以 `source: 'session'` 写入记忆，且不增加存储表或 domain 版本。

**Architecture:** 新增纯规则模块 `src/core/capture-rules.ts`（无 DSH 依赖）和 Host 捕获器 `src/host/auto-capture.ts`（独立注册 `session/event` 监听器）。捕获器按 session 排队、fail-soft，去重和容量全部基于现有 memories 表的 provenance/content 查询，不使用新表。Settings 扩展四个字段并接入设置页。

**Tech Stack:** TypeScript、DSH `session/event`、storage-domain、现有 `MemoryRepository.save`、Schemastery、React 设置卡片、Node test runner。

## Global Constraints

- 不修改 DSH 源码，不读取 DSH Session SQLite，不引入 Pi runtime/命令/TUI/视觉资产。
- 只捕获 `source.kind === 'user'` 的真实用户消息；插件注入、AGENTS.md、技能、cron 通知不参与。
- 每条消息至多产出 1 个候选，优先级 correction > convention > preference。
- 候选文本必须经过 trim，长度 6..1,000 字符，超长裁剪；保存前必须通过现有 scanner。
- 幂等：同一 sessionId + eventSeq + scope 不得重复保存；相同 scope + projectKey + content 不得重复保存。
- 每 session 成功捕获数不得超过 `captureMaxPerSession`（默认 5，范围 1..20）。
- project 捕获仅在 session 有 cwd 时进行，使用 `session.header.cwd` 作为 projectKey。
- 不新增存储表，不升级 domain version。
- 观察、提取、规则、去重、保存任一失败只记录稳定 warning，绝不包含正文、秘密或完整堆栈。

---

### Task 1: 纯规则模块与测试

**Files:**
- Create: `src/core/capture-rules.ts`
- Create: `tests/capture-rules.test.mjs`

**Interfaces:**

```ts
export interface CaptureCandidate {
  scope: MemoryScope
  category: MemoryCategory
  text: string
}

export const CAPTURE_MIN_CHARS = 6
export const CAPTURE_MAX_CHARS = 1_000

export function detectCaptureCandidates(text: string): CaptureCandidate[]
```

- [x] **Step 1: 写失败测试**

```js
test('detects correction, convention, and preference candidates in priority order', () => {
  assert.deepEqual(detectCaptureCandidates('不对，应该用 pnpm'), [{ scope: 'failure', category: 'correction', text: '不对，应该用 pnpm' }])
  assert.deepEqual(detectCaptureCandidates('这个项目使用 pnpm'), [{ scope: 'project', category: 'convention', text: '这个项目使用 pnpm' }])
  assert.deepEqual(detectCaptureCandidates('以后都用中文回答'), [{ scope: 'user', category: 'preference', text: '以后都用中文回答' }])
  assert.deepEqual(detectCaptureCandidates('项目里以后都用 pnpm'), [{ scope: 'failure', category: 'correction', text: '项目里以后都用 pnpm' }])
})

test('rejects empty, too-short, and overlong texts', () => {
  assert.deepEqual(detectCaptureCandidates(''), [])
  assert.deepEqual(detectCaptureCandidates('   '), [])
  assert.deepEqual(detectCaptureCandidates('记住'), [])
  assert.deepEqual(detectCaptureCandidates('以后'.repeat(600)), [])
  assert.deepEqual(detectCaptureCandidates('没有信号的一句话'), [])
})
```

- [x] **Step 2: 运行确认失败**

```bash
node --import tsx --test tests/capture-rules.test.mjs
```

Expected: FAIL（模块不存在）。

- [x] **Step 3: 实现规则模块**

使用显式关键词数组 + 正则：

- correction 信号：`不对`、`错了`、`搞错了`、`不是这样`、`应该是`、`应该用`、`其实`、`不要再`、`以后别`
- convention 信号：`这个项目`、`本项目`、`我们项目`、`项目里`
- preference 信号：`以后`、`下次`、`请记住`、`记住`、`记得`

实现顺序：先 trim 并校验长度（6..1,000），再按 correction → convention → preference 顺序返回命中的第一个候选；信号位于文本任意位置即可命中；项目约定信号在无 cwd 时由 Host 层丢弃，本模块不感知 cwd。
`project` 候选信号只需匹配 convention 关键词，不需要偏好候选出现排序问题。

- [x] **Step 4: 运行测试并提交**

```bash
node --import tsx --test tests/capture-rules.test.mjs tests/core.test.mjs
npm run typecheck
```

```bash
git add src/core/capture-rules.ts tests/capture-rules.test.mjs
git commit -m "feat: add rule-based capture candidate detection"
```

---

### Task 2: Settings 与客户端设置页

**Files:**
- Modify: `src/host/settings.ts`
- Modify: `src/client/index.ts`
- Modify: `src/client/MemorySettings.tsx`
- Modify: `src/client/locales.ts`
- Modify: `tests/settings.test.mjs`

**Interfaces:**
- `MemorySettings` 增加 `capturePreferences`、`captureConventions`、`captureCorrections`、`captureMaxPerSession`。
- `validateMemorySettings()` 校验 `captureMaxPerSession` 为 1..20 的整数。

- [x] **Step 1: 写失败设置测试**

```js
test('accepts bounded capture settings', () => {
  assert.doesNotThrow(() => validateMemorySettings({ ...baseSettings, automaticCapture: true, capturePreferences: true, captureConventions: true, captureCorrections: true, captureMaxPerSession: 5 }))
})

test('rejects invalid capture bounds', () => {
  assert.throws(() => validateMemorySettings({ ...baseSettings, captureMaxPerSession: 0 }), /captureMaxPerSession/)
  assert.throws(() => validateMemorySettings({ ...baseSettings, captureMaxPerSession: 21 }), /captureMaxPerSession/)
})
```

- [x] **Step 2: 运行确认失败**

```bash
node --import tsx --test tests/settings.test.mjs
```

- [x] **Step 3: 扩展 schema 与校验**

默认值：`capturePreferences: true`、`captureConventions: true`、`captureCorrections: true`、`captureMaxPerSession: 5`。校验规则如上。`automaticCapture` 默认值保持 `false`。

- [x] **Step 4: 客户端**

在 `src/client/index.ts` fallback 补四个默认值；在 `MemorySettings.tsx` 把“自动捕获”改为可切换复选框，并增加三个类别开关和每会话上限数字输入；`captureMaxPerSession` 输入范围 1..20。

- [x] **Step 5: 中英文 locale**

增加 `automaticCapture`（不再是“暂不可用”）、`capturePreferences`、`captureConventions`、`captureCorrections`、`captureMaxPerSession` 的翻译，并更新说明文本：捕获通过规则识别真实用户消息，自动保存前经过安全扫描，默认关闭。

- [x] **Step 6: 测试与提交**

```bash
node --import tsx --test tests/settings.test.mjs
npm run typecheck
```

```bash
git add src/host/settings.ts src/client/index.ts src/client/MemorySettings.tsx src/client/locales.ts tests/settings.test.mjs
git commit -m "feat: add capture settings"
```

---

### Task 3: Host 捕获器与测试

**Files:**
- Create: `src/host/auto-capture.ts`
- Modify: `src/index.ts`
- Create: `tests/auto-capture.test.mjs`

**Interfaces:**

```ts
export function installAutoCapture(
  ctx: Context,
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean
```

- [x] **Step 1: 写失败测试**

使用 fake ctx 记录 `session/event` 监听器，fake settings、fake storage（memories entries）、fake repository（记录 save 调用）：

```js
const emitter = installAutoCapture(ctx, storage, settings, logger)
ctx.emit('session/event', makeSession('/repo'), realUserMessageEvent(1, '以后都用中文回答'))
await tick()
assert.equal(saved.length, 1)
assert.deepEqual(saved[0].provenance, { source: 'session', sessionId: 's1', eventSeq: 1, projectKey: '/repo' })
```

覆盖：

- plugin source 消息不捕获；
- 对应类别开关关闭时不捕获；
- `automaticCapture: false` 全局关闭；
- 同 session 同 eventSeq 同 scope 不重复保存（幂等）；
- 相同 scope+projectKey+content 不保存；
- 达到 `captureMaxPerSession` 后停止；
- project 候选无 cwd 时跳过；
- scanner 拒绝的内容不保存（repository.save 直接抛 block）；
- save 抛错只记录稳定 warning，不冒泡；
- 同一 session 事件按序处理。

- [x] **Step 2: 运行确认失败**

```bash
node --import tsx --test tests/auto-capture.test.mjs
```

- [x] **Step 3: 实现提取逻辑**

从 `event.data`（`event.type === 'user/message'` 时）提取：

- `source.kind === 'user'` 才继续；
- 从 `content` 的 text 块拼接文本；
- trim 后超过 1,000 字符则截断；
- 空文本跳过。

- [x] **Step 4: 实现捕获器**

```ts
export function installAutoCapture(ctx, storage, settings, logger): () => boolean {
  const pending = new Map<string, Promise<unknown>>()
  const onEvent = (session, event) => {
    if (event.type !== 'user/message') return
    const seq = event.seq
    const task = (pending.get(session.id) ?? Promise.resolve())
      .then(() => handleCapture(session, event, seq))
      .catch((error) => {
        logger.warn('dsh-hermes-memory: automatic capture skipped')
      })
    pending.set(session.id, task)
    void task.finally(() => {
      if (pending.get(session.id) === task) pending.delete(session.id)
    })
  }
  return ctx.on('session/event', onEvent)
}
```

`handleCapture` 内部：

1. 读取 settings，`!enabled || !automaticCapture` 直接返回；
2. 提取文本；
3. `detectCaptureCandidates(text)` 得到候选；
4. 候选类别对应开关关闭则返回；
5. 计算 projectKey：候选 scope 为 project 时取 `session.header.cwd`，无 cwd 返回；
6. 幂等检查（provenance sessionId+eventSeq+scope）；
7. 内容去重（scope+projectKey+content）；
8. 会话容量检查（`provenance.source === 'session'` 且 sessionId 匹配的计数）；
9. `repository.save({ scope, category, content: text, projectKey, provenance })`；
10. 任何异常向上抛出由外层 catch 处理，但绝不包含正文。

- [x] **Step 5: 接入 apply**

在 `src/index.ts` 调用 `installAutoCapture(ctx, storage, settings, ctx.logger)`，并在 `ctx.effect()` 清理中调用其 disposer。

- [x] **Step 6: 测试并提交**

```bash
node --import tsx --test tests/auto-capture.test.mjs tests/session-capture.test.mjs
npm test
npm run typecheck
```

```bash
git add src/host/auto-capture.ts src/index.ts tests/auto-capture.test.mjs
git commit -m "feat: capture memory candidates from session events"
```

---

### Task 4: 文档同步与最终验证

**Files:**
- Modify: `docs/requirements.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-capture-design.md`

- [x] **Step 1: 更新需求文档**

新增 V4 规则型捕获小节（真实用户消息、三类别、scanner、幂等、会话上限、默认关闭、无需新表），并把 V4 非目标明确为剩余部分（模型复盘、ctx.jobs、上下文关联纠正等仍延期）。

- [x] **Step 2: 更新 README**

中英文 Status 增加自动捕获已实现（默认关闭）说明；工具列表不变；暂不实现列表调整。

- [x] **Step 3: 更新设计规范状态**

改为“已实现”，记录最终规则优先级、幂等实现方式和测试数量。

- [x] **Step 4: 自审**

```bash
grep -nE 'TBD|TODO|待实现|设计已确认' docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-capture-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v4-capture.md
git diff --check
```

- [x] **Step 5: 全量验证**

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Expected: 类型检查通过、全部测试通过（原 34 项 + 新增规则与捕获测试）、构建与打包成功、包内无 Pi 资产。

- [x] **Step 6: 提交文档**

```bash
git add README.md README.zh.md docs/requirements.md docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v4-capture-design.md docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v4-capture.md
git commit -m "docs: record v4 rule-based capture"
```

不自动 push 或发布 npm，除非用户另行明确要求。