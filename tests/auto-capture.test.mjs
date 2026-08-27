import assert from 'node:assert/strict'
import test from 'node:test'
import { installAutoCapture } from '../src/host/auto-capture.ts'

function session(id = 's1', cwd = '/repo') {
  return { id, header: { cwd } }
}

function sessionWithoutCwd(id = 's1') {
  return { id, header: {} }
}

function userEvent(seq, text, sourceKind = 'user') {
  return {
    seq,
    time: Date.now(),
    type: 'user/message',
    data: {
      id: `m${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: sourceKind, plugin: sourceKind === 'plugin' ? 'other-plugin' : undefined },
    },
  }
}

function toolCallEvent(seq, callId, name) {
  return { seq, time: Date.now(), type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: '{}' } }
}

function toolResultEvent(seq, callId, withError = true) {
  return {
    seq,
    time: Date.now(),
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: { role: 'user', content: [], source: { kind: 'tool', callId } },
      ...(withError ? { error: { name: 'ToolError', code: 'E_FAIL' } } : {}),
    },
  }
}

function setup({ automaticCapture = true, capturePreferences = true, captureConventions = true, captureCorrections = true, captureToolContext = true, captureMaxPerSession = 5 } = {}) {
  let listener
  const ctx = {
    on(name, callback) {
      assert.equal(name, 'session/event')
      listener = callback
      return () => {
        listener = undefined
        return true
      }
    },
    emit(name, sessionValue, event) {
      assert.equal(name, 'session/event')
      listener?.(sessionValue, event)
    },
  }
  const entries = []
  const saved = []
  const repository = {
    save: async input => {
      const record = {
        id: `r${saved.length + 1}`,
        scope: input.scope,
        category: input.category,
        content: input.content,
        projectKey: input.projectKey,
        createdAt: '2026-08-27T10:00:00.000Z',
        updatedAt: '2026-08-27T10:00:00.000Z',
        provenance: input.provenance,
        schemaVersion: 1,
      }
      saved.push(record)
      entries.push([record.id, record])
      return record
    },
  }
  const storage = { table: { entries: () => entries } }
  const settings = {
    get: () => ({
      enabled: true,
      defaultLimit: 8,
      projectMemoryEnabled: true,
      automaticCapture,
      capturePreferences,
      captureConventions,
      captureCorrections,
      captureToolContext,
      captureMaxPerSession,
      retentionDays: 90,
      automaticInjection: false,
      injectionLimit: 5,
      injectionMaxChars: 3000,
      includeUserMemory: true,
      includeProjectMemory: true,
    }),
  }
  const warnings = []
  const logger = { warn: message => warnings.push(message) }
  return { ctx, storage, repository, settings, logger, warnings, saved }
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve))
}

test('captures a preference from a real user message with session provenance', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session('s1', '/repo'), userEvent(1, '以后都用中文回答'))
  await tick()

  assert.equal(state.saved.length, 1)
  assert.equal(state.saved[0].scope, 'user')
  assert.equal(state.saved[0].category, 'preference')
  assert.deepEqual(state.saved[0].provenance, {
    source: 'session',
    sessionId: 's1',
    eventSeq: 1,
    projectKey: undefined,
  })
})

test('ignores plugin-sourced and non-user messages', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答', 'plugin'))
  state.ctx.emit('session/event', session(), { seq: 2, time: Date.now(), type: 'turn/start', data: { turn: 1 } })
  await tick()
  assert.equal(state.saved.length, 0)
})

test('honors the master switch and per-category switches', async () => {
  const off = setup({ automaticCapture: false })
  installAutoCapture(off.ctx, off.storage, off.repository, off.settings, off.logger)
  off.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答'))
  await tick()
  assert.equal(off.saved.length, 0)

  const noPreference = setup({ capturePreferences: false })
  installAutoCapture(noPreference.ctx, noPreference.storage, noPreference.repository, noPreference.settings, noPreference.logger)
  noPreference.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答'))
  await tick()
  assert.equal(noPreference.saved.length, 0)
})

test('does not duplicate the same session event sequence or content', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答'))
  await tick()
  state.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答'))
  await tick()
  state.ctx.emit('session/event', session(), userEvent(2, '以后都用中文回答'))
  await tick()
  assert.equal(state.saved.length, 1)
})

test('stops after the per-session capture limit', async () => {
  const state = setup({ captureMaxPerSession: 1 })
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答'))
  state.ctx.emit('session/event', session(), userEvent(2, '这个项目使用 pnpm'))
  await tick()
  assert.equal(state.saved.length, 1)
})

test('skips project candidates without a workspace', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', sessionWithoutCwd('s1'), userEvent(1, '这个项目使用 pnpm'))
  await tick()
  assert.equal(state.saved.length, 0)
})

test('contains capture failures and logs only a stable warning', async () => {
  const state = setup()
  state.repository.save = async () => { throw new Error('secret text should not be logged') }
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  assert.doesNotThrow(() => state.ctx.emit('session/event', session(), userEvent(1, '以后都用中文回答')))
  await tick()
  assert.deepEqual(state.warnings, ['dsh-hermes-memory: automatic capture skipped'])
  assert.equal(state.warnings.some(message => message.includes('secret')), false)
})

test('pairs a correction with the failed tool call', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session('s1', '/repo'), toolCallEvent(1, 'c1', 'memory_save'))
  state.ctx.emit('session/event', session('s1', '/repo'), toolResultEvent(2, 'c1'))
  state.ctx.emit('session/event', session('s1', '/repo'), userEvent(3, '不对，应该用 pnpm'))
  await tick()

  assert.equal(state.saved.length, 2)
  const correction = state.saved.find(record => record.category === 'correction')
  const quirk = state.saved.find(record => record.category === 'tool-quirk')
  assert.ok(correction)
  assert.ok(quirk)
  assert.equal(quirk.scope, 'failure')
  assert.match(quirk.content, /memory_save/)
  assert.match(quirk.content, /不对，应该用 pnpm/)
  assert.equal(quirk.provenance.eventSeq, 3)
})

test('does not pair without a correction or without a failure', async () => {
  const noCorrection = setup()
  installAutoCapture(noCorrection.ctx, noCorrection.storage, noCorrection.repository, noCorrection.settings, noCorrection.logger)
  noCorrection.ctx.emit('session/event', session(), toolCallEvent(1, 'c1', 'memory_save'))
  noCorrection.ctx.emit('session/event', session(), toolResultEvent(2, 'c1'))
  noCorrection.ctx.emit('session/event', session(), userEvent(3, '看看这个文件'))
  await tick()
  assert.equal(noCorrection.saved.length, 0)

  const noFailure = setup()
  installAutoCapture(noFailure.ctx, noFailure.storage, noFailure.repository, noFailure.settings, noFailure.logger)
  noFailure.ctx.emit('session/event', session(), userEvent(1, '不对，应该用 pnpm'))
  await tick()
  assert.equal(noFailure.saved.length, 1)
  assert.equal(noFailure.saved[0].category, 'correction')
})

test('consumes the same failure context only once', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session(), toolCallEvent(1, 'c1', 'memory_save'))
  state.ctx.emit('session/event', session(), toolResultEvent(2, 'c1'))
  state.ctx.emit('session/event', session(), userEvent(3, '不对，应该用 pnpm'))
  state.ctx.emit('session/event', session(), userEvent(4, '不对，应该用 npm'))
  await tick()

  assert.equal(state.saved.filter(record => record.category === 'tool-quirk').length, 1)
  assert.equal(state.saved.filter(record => record.category === 'correction').length, 2)
})

test('honors captureToolContext and stays idempotent on replay', async () => {
  const disabled = setup({ captureToolContext: false })
  installAutoCapture(disabled.ctx, disabled.storage, disabled.repository, disabled.settings, disabled.logger)
  disabled.ctx.emit('session/event', session(), toolCallEvent(1, 'c1', 'memory_save'))
  disabled.ctx.emit('session/event', session(), toolResultEvent(2, 'c1'))
  disabled.ctx.emit('session/event', session(), userEvent(3, '不对，应该用 pnpm'))
  await tick()
  assert.equal(disabled.saved.length, 1)
  assert.equal(disabled.saved[0].category, 'correction')

  const replayed = setup()
  installAutoCapture(replayed.ctx, replayed.storage, replayed.repository, replayed.settings, replayed.logger)
  replayed.ctx.emit('session/event', session(), toolCallEvent(1, 'c1', 'memory_save'))
  replayed.ctx.emit('session/event', session(), toolResultEvent(2, 'c1'))
  replayed.ctx.emit('session/event', session(), userEvent(3, '不对，应该用 pnpm'))
  replayed.ctx.emit('session/event', session(), toolCallEvent(4, 'c2', 'memory_save'))
  replayed.ctx.emit('session/event', session(), toolResultEvent(5, 'c2'))
  replayed.ctx.emit('session/event', session(), userEvent(6, '不对，应该用 pnpm'))
  await tick()
  assert.equal(replayed.saved.length, 2)
})

test('falls back to the plain correction when the tool name is unknown', async () => {
  const state = setup()
  installAutoCapture(state.ctx, state.storage, state.repository, state.settings, state.logger)
  state.ctx.emit('session/event', session(), toolResultEvent(1, 'unknown-call'))
  state.ctx.emit('session/event', session(), userEvent(2, '不对，应该用 pnpm'))
  await tick()
  assert.equal(state.saved.length, 1)
  assert.equal(state.saved[0].category, 'correction')
})