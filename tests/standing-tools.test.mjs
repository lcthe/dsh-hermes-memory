import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryTools } from '../src/host/tool-definitions.ts'
import { listStanding, pinStanding, unpinStanding } from '../src/host/tools.ts'

function exec() {
  return { agent: { session: { id: 'session-1', header: { cwd: '/repo' } } } }
}

function context() {
  const records = new Map()
  const standing = {
    add: async (input, limits) => {
      assert.deepEqual(limits, { maxEntries: 20, maxChars: 2_000 })
      const entry = { id: 'standing-1', ...input, createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z', provenance: { source: 'explicit', sessionId: 'session-1' }, schemaVersion: 1 }
      records.set(entry.id, entry)
      return entry
    },
    list: async () => [...records.values()],
    remove: async (id) => {
      const entry = records.get(id)
      if (!entry) throw new Error('standing entry was not found')
      records.delete(id)
      return entry
    },
  }
  return { standing, settings: { get: () => ({ standingMaxEntries: 20, standingMaxChars: 2_000 }) } }
}

test('registers standing memory tools', () => {
  const names = createMemoryTools({ repository: {}, sessionQuery: {}, standing: context().standing, settings: context().settings }).map(tool => tool.name)
  assert.deepEqual(names.slice(-3), ['memory_pin', 'memory_pins', 'memory_unpin'])
})

test('pins, lists, and unpins explicit standing context', async () => {
  const state = context()
  const added = await pinStanding({ kind: 'instruction', content: 'Act as maintainer.' }, exec(), state)
  assert.equal(added.success, true)
  assert.equal(added.record.provenance.sessionId, 'session-1')
  assert.equal((await listStanding({}, exec(), state)).total, 1)
  assert.equal((await unpinStanding({ id: 'standing-1' }, exec(), state)).success, true)
})

test('returns a stable error when standing storage is unavailable', async () => {
  const result = await pinStanding({ kind: 'instruction', content: 'Act as maintainer.' }, exec(), { settings: context().settings })
  assert.equal(result.error?.code, 'storage_unavailable')
})
