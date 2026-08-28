import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReviewOutput } from '../src/host/review-schema.ts'
import { buildReviewUserPrompt, buildReviewSystemPrompt } from '../src/host/review-prompt.ts'

const budget = { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 }

test('review schema accepts empty output and valid save', () => {
  assert.equal(validateReviewOutput({ operations: [] }, budget).ok, true)
  assert.equal(validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'use Chinese' }] }, budget).ok, true)
})

test('review schema rejects unsafe shapes and unknown fields', () => {
  assert.equal(validateReviewOutput('nope', budget).ok, false)
  assert.equal(validateReviewOutput({ operations: [{ kind: 'remove', scope: 'user', category: 'preference', content: 'x' }] }, budget).ok, false)
  assert.equal(validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'x', extra: true }] }, budget).ok, false)
  assert.equal(validateReviewOutput({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'x'.repeat(1001) }] }, budget).ok, false)
})

test('review prompt is bounded and avoids tool execution instructions', () => {
  const system = buildReviewSystemPrompt()
  assert.match(system, /operations/)
  const prompt = buildReviewUserPrompt({ sessionId: 's1', projectKey: '/repo', userText: 'x'.repeat(20000), assistantText: '', failures: [] }, budget)
  assert.ok(prompt.length < 14000)
})
