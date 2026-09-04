import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldScheduleConsolidation } from '../src/host/auto-consolidation.ts'

test('schedules only when enabled, above threshold, and not already active', () => {
  const base = { enabled: true, automaticConsolidation: true, totalChars: 40_000, thresholdChars: 40_000, active: false, hasProvider: true }
  assert.equal(shouldScheduleConsolidation(base), true)
  assert.equal(shouldScheduleConsolidation({ ...base, enabled: false }), false)
  assert.equal(shouldScheduleConsolidation({ ...base, totalChars: 39_999 }), false)
  assert.equal(shouldScheduleConsolidation({ ...base, active: true }), false)
  assert.equal(shouldScheduleConsolidation({ ...base, hasProvider: false }), false)
})
