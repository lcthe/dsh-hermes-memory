import assert from 'node:assert/strict'
import test from 'node:test'
import { executeConsolidation, prepareConsolidation } from '../src/host/consolidation-executor.ts'

const record = (id, content, updatedAt = `2026-09-04T10:00:0${id}Z`) => ({
  id, scope: 'user', category: 'preference', content, createdAt: updatedAt, updatedAt,
  provenance: { source: 'explicit' }, schemaVersion: 1,
})

function table(initial, failPutAt = 0) {
  const values = new Map(initial.map(value => [value.id, structuredClone(value)]))
  let puts = 0
  return {
    get: id => values.get(id),
    entries: () => values.entries(),
    async put(id, value) { puts += 1; if (puts === failPutAt) throw new Error('put failed'); values.set(id, structuredClone(value)) },
    async delete(id) { return values.delete(id) },
  }
}

function states() {
  let current
  return {
    async put(value) { current = structuredClone(value) },
    async get() { return current && structuredClone(current) },
    async list() { return current ? [structuredClone(current)] : [] },
    async markReplacementsWritten() { current = { ...current, status: 'replacements-written' } },
    async markCompleted() { current = { ...current, status: 'completed' } },
    async markFailed() { current = { ...current, status: 'failed' } },
  }
}

test('prepares deterministic replacement state and checks projected size', async () => {
  const source = [record('a', 'alpha'), record('b', 'beta')]
  const state = await prepareConsolidation({
    id: 'run-1', scope: 'user', records: source, plan: { groups: [{ sourceIds: ['a', 'b'], category: 'preference', content: 'alpha beta' }] }, targetChars: 20,
  })
  assert.equal(state?.sourceVersions.a, source[0].updatedAt)
  assert.equal(state?.groups[0].content, 'alpha beta')
})

test('never deletes a source when a replacement write fails', async () => {
  const tableValue = table([record('a', 'alpha'), record('b', 'beta')], 1)
  const stateStore = states()
  const state = await prepareConsolidation({ id: 'run-2', scope: 'user', records: [tableValue.get('a'), tableValue.get('b')], plan: { groups: [{ sourceIds: ['a', 'b'], category: 'preference', content: 'merged' }] }, targetChars: 20 })
  await stateStore.put(state)
  await assert.rejects(() => executeConsolidation(state, { table: tableValue, states: stateStore }))
  assert.ok(tableValue.get('a'))
  assert.ok(tableValue.get('b'))
})

test('resumes replacements-written by deleting unchanged sources', async () => {
  const tableValue = table([record('a', 'alpha'), record('b', 'beta')])
  const stateStore = states()
  const state = await prepareConsolidation({ id: 'run-3', scope: 'user', records: [tableValue.get('a'), tableValue.get('b')], plan: { groups: [{ sourceIds: ['a', 'b'], category: 'preference', content: 'merged' }] }, targetChars: 20 })
  await stateStore.put({ ...state, status: 'replacements-written' })
  await executeConsolidation({ ...state, status: 'replacements-written' }, { table: tableValue, states: stateStore })
  assert.equal((await stateStore.get()).status, 'completed')
  assert.equal(tableValue.get('a'), undefined)
  assert.equal(tableValue.get('b'), undefined)
})
