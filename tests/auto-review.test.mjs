import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldScheduleReview } from '../src/host/auto-review.ts'

const base = { enabled: true, automaticReview: true, flushedSeq: 3, hasProvider: true }

test('does not schedule when disabled or provider unavailable', () => {
  assert.equal(shouldScheduleReview({ ...base, enabled: false, current: undefined }), false)
  assert.equal(shouldScheduleReview({ ...base, hasProvider: false, current: undefined }), false)
})

test('does not schedule running or same completed watermark', () => {
  assert.equal(shouldScheduleReview({ ...base, current: { sessionId: 's1', requestedFlushedSeq: 3, completedFlushedSeq: -1, status: 'running', attempt: 1, updatedAt: 'x', schemaVersion: 1 } }), false)
  assert.equal(shouldScheduleReview({ ...base, current: { sessionId: 's1', requestedFlushedSeq: 3, completedFlushedSeq: 3, status: 'completed', attempt: 1, updatedAt: 'x', schemaVersion: 1 } }), false)
})

test('schedules a newer flush and retries failed state only when newer', () => {
  const completed = { sessionId: 's1', requestedFlushedSeq: 2, completedFlushedSeq: 2, status: 'completed', attempt: 1, updatedAt: 'x', schemaVersion: 1 }
  assert.equal(shouldScheduleReview({ ...base, current: completed }), true)
  const failed = { ...completed, requestedFlushedSeq: 3, completedFlushedSeq: -1, status: 'failed' }
  assert.equal(shouldScheduleReview({ ...base, current: failed }), false)
  assert.equal(shouldScheduleReview({ ...base, flushedSeq: 4, current: failed }), true)
})

test('does not schedule a negative flush watermark', () => {
  assert.equal(shouldScheduleReview({ ...base, flushedSeq: -1, current: undefined }), false)
})
