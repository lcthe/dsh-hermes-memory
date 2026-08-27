import assert from 'node:assert/strict'
import test from 'node:test'
import { installRetention, selectExpiredRecords } from '../src/host/retention.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-08-27T12:00:00.000Z')

function record(id, scope, updatedAt, lastReferencedAt) {
  return {
    id,
    scope,
    category: scope === 'failure' ? 'correction' : 'preference',
    content: `content ${id}`,
    createdAt: updatedAt,
    updatedAt,
    ...(lastReferencedAt !== undefined ? { lastReferencedAt } : {}),
    provenance: { source: 'session' },
    schemaVersion: 1,
  }
}

const policy = { retentionEnabled: true, retentionDays: 90, failureRetentionDays: 30 }

test('selects expired records by scope threshold and reference recency', () => {
  const records = [
    record('old-global', 'global', new Date(NOW - 100 * DAY).toISOString()),
    record('recent-global', 'global', new Date(NOW - 10 * DAY).toISOString()),
    record('old-failure', 'failure', new Date(NOW - 100 * DAY).toISOString()),
    record('young-failure', 'failure', new Date(NOW - 20 * DAY).toISOString()),
    record('referenced', 'user', new Date(NOW - 100 * DAY).toISOString(), new Date(NOW - 1 * DAY).toISOString()),
  ]
  const expired = selectExpiredRecords(records, NOW, policy)
  assert.deepEqual(expired.map(item => item.id).sort(), ['old-failure', 'old-global'])
})

test('keeps records exactly at the threshold and skips invalid timestamps', () => {
  const records = [
    record('exact', 'global', new Date(NOW - 90 * DAY).toISOString()),
    { id: 'bad', scope: 'global', category: 'preference', content: 'bad', createdAt: 'nope', updatedAt: 'nope', provenance: { source: 'session' }, schemaVersion: 1 },
    { id: 'missing', scope: 'global', category: 'preference', content: 'missing', provenance: { source: 'session' }, schemaVersion: 1 },
  ]
  const expired = selectExpiredRecords(records, NOW, policy)
  assert.deepEqual(expired, [])
})

test('returns nothing when retention is disabled', () => {
  const records = [record('old-global', 'global', new Date(NOW - 100 * DAY).toISOString())]
  assert.deepEqual(selectExpiredRecords(records, NOW, { ...policy, retentionEnabled: false }), [])
})

function setup() {
  let listener
  const ctx = {
    on(name, callback) {
      assert.equal(name, 'agent/session-start')
      listener = callback
      return () => {
        listener = undefined
        return true
      }
    },
    emit(name, payload) {
      assert.equal(name, 'agent/session-start')
      listener?.(payload)
    },
  }
  const entries = []
  const deleted = []
  const storage = {
    table: {
      entries: () => entries,
      delete: async id => {
        const index = entries.findIndex(([key]) => key === id)
        if (index === -1) return false
        entries.splice(index, 1)
        deleted.push(id)
        return true
      },
    },
  }
  const settings = {
    get: () => ({
      enabled: true,
      defaultLimit: 8,
      projectMemoryEnabled: true,
      automaticCapture: false,
      capturePreferences: true,
      captureConventions: true,
      captureCorrections: true,
      captureToolContext: true,
      captureMaxPerSession: 5,
      retentionEnabled: true,
      retentionDays: 90,
      failureRetentionDays: 30,
      automaticInjection: false,
      injectionLimit: 5,
      injectionMaxChars: 3000,
      includeUserMemory: true,
      includeProjectMemory: true,
    }),
  }
  const warnings = []
  const logger = { warn: message => warnings.push(message) }
  return { ctx, storage, settings, logger, warnings, deleted, entries }
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve))
}

test('removes expired records and keeps fresh ones', async () => {
  const state = setup()
  state.entries.push(
    ['expired', record('expired', 'global', new Date(NOW - 200 * DAY).toISOString())],
    ['fresh', record('fresh', 'global', new Date(NOW - 1 * DAY).toISOString())],
  )
  installRetention(state.ctx, state.storage, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  await tick()

  assert.deepEqual(state.deleted, ['expired'])
  assert.ok(state.warnings.some(message => /retention removed 1/.test(message)))
  assert.equal(state.warnings.some(message => message.includes('content ')), false)
})

test('throttles sweeps and tolerates per-record delete failures', async () => {
  const state = setup()
  let deleteCount = 0
  state.storage.table.delete = async () => {
    deleteCount += 1
    if (deleteCount === 1) throw new Error('boom')
    return true
  }
  state.entries.push(
    ['a', record('a', 'global', new Date(NOW - 200 * DAY).toISOString())],
    ['b', record('b', 'failure', new Date(NOW - 100 * DAY).toISOString())],
  )
  const dispose = installRetention(state.ctx, state.storage, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  state.ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  state.ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  await tick()

  assert.equal(deleteCount, 2)
  assert.ok(state.warnings.some(message => /retention removed 1/.test(message)))
  dispose()
  state.ctx.emit('agent/session-start', { agent: {}, source: 'startup' })
  await tick()
  assert.equal(deleteCount, 2)
})