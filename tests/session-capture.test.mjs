import assert from 'node:assert/strict'
import test from 'node:test'
import { extractSessionSequence } from '../src/host/session-capture.ts'

test('extracts only safe non-negative event sequences', () => {
  assert.equal(extractSessionSequence({ seq: 4 }), 4)
  assert.equal(extractSessionSequence({ seq: -1 }), undefined)
  assert.equal(extractSessionSequence({ seq: '4' }), undefined)
})
