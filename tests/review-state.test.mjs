import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  completeReviewState,
  failReviewState,
  newReviewState,
  shouldStartReview,
} from '../src/host/review-state.ts'

test('new state starts at the first flush watermark', () => {
  const state = newReviewState('s1', 0, '2026-08-28T00:00:00.000Z')
  assert.equal(state.status, 'running')
  assert.equal(state.completedFlushedSeq, -1)
  assert.equal(state.attempt, 1)
})

test('scheduling is monotonic and does not duplicate running/completed work', () => {
  assert.equal(shouldStartReview(undefined, 0), true)
  const running = newReviewState('s1', 2, '2026-08-28T00:00:00.000Z')
  assert.equal(shouldStartReview(running, 3), false)
  const completed = completeReviewState(running, 2, '2026-08-28T00:00:01.000Z')
  assert.equal(shouldStartReview(completed, 2), false)
  assert.equal(shouldStartReview(completed, 3), true)
})

test('failed review retries only after a newer flush', () => {
  const failed = failReviewState(newReviewState('s1', 4, '2026-08-28T00:00:00.000Z'), 'model_error', '2026-08-28T00:00:01.000Z')
  assert.equal(shouldStartReview(failed, 4), false)
  assert.equal(shouldStartReview(failed, 5), true)
  assert.equal(failed.lastErrorCode, 'model_error')
})

test('completion advances watermark and clears old error', () => {
  const state = failReviewState(newReviewState('s1', 1, '2026-08-28T00:00:00.000Z'), 'temporary', '2026-08-28T00:00:01.000Z')
  const completed = completeReviewState(state, 3, '2026-08-28T00:00:02.000Z')
  assert.equal(completed.status, 'completed')
  assert.equal(completed.completedFlushedSeq, 3)
  assert.equal(completed.lastErrorCode, undefined)
})
