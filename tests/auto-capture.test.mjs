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

function setup({ automaticCapture = true, capturePreferences = true, captureConventions = true, captureCorrections = true, captureMaxPerSession = 5 } = {}) {
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