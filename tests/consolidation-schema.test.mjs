import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConsolidationOutput } from '../src/host/consolidation-schema.ts'

const base = { groups: [{ sourceIds: ['a', 'b'], category: 'preference', content: 'Use Chinese.' }] }

test('parses bounded consolidation groups', () => {
  assert.deepEqual(parseConsolidationOutput(base), base)
})

test('rejects repeated source ids across groups', () => {
  assert.throws(() => parseConsolidationOutput({ groups: [
    base.groups[0],
    { sourceIds: ['b', 'c'], category: 'insight', content: 'Another fact.' },
  ] }))
})

test('rejects malformed or oversized model output', () => {
  assert.throws(() => parseConsolidationOutput({ groups: [{ sourceIds: ['a'], category: 'preference', content: 'x' }] }))
  assert.throws(() => parseConsolidationOutput({ ...base, extra: true }))
  assert.throws(() => parseConsolidationOutput({ groups: Array.from({ length: 21 }, (_, i) => ({ sourceIds: [`a${i}`, `b${i}`], category: 'preference', content: 'x' })) }))
})
