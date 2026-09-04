import assert from 'node:assert/strict'
import test from 'node:test'
import { createConsolidationStateStore } from '../src/host/consolidation-state.ts'

function table() {
  const values = new Map()
  return {
    get: id => values.get(id),
    entries: () => values.entries(),
    async put(id, value) { values.set(id, structuredClone(value)) },
    async delete(id) { return values.delete(id) },
  }
}

const state = {
  id: 'run-1', scope: 'user', groups: [{ sourceIds: ['a', 'b'], category: 'preference', content: 'Use Chinese.' }],
  sourceVersions: { a: 'one', b: 'two' }, status: 'prepared', updatedAt: '2026-09-04T10:00:00.000Z', schemaVersion: 1,
}

test('advances prepared through replacements-written to completed', async () => {
  const store = createConsolidationStateStore(table())
  await store.put(state)
  await store.markReplacementsWritten(state.id)
  await store.markCompleted(state.id)
  assert.equal((await store.get(state.id))?.status, 'completed')
})

test('rejects invalid state transitions', async () => {
  const store = createConsolidationStateStore(table())
  await store.put(state)
  await assert.rejects(() => store.markCompleted(state.id))
})
