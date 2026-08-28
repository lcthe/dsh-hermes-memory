import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewOperations } from '../src/host/review-runner.ts'

function setup() {
  const saved = []
  const repository = {
    async save(input) { saved.push(input); return { ...input, id: `m-${saved.length}` } },
    async search() { return { records: [], total: 0 } },
  }
  return { saved, repository, budget: { maxOperations: 5, maxContentChars: 1000, maxInputChars: 12000 } }
}

test('saves a validated project candidate with provenance', async () => {
  const { saved, repository, budget } = setup()
  const result = await applyReviewOperations({ operations: [{ kind: 'save', scope: 'project', category: 'convention', content: 'use pnpm' }] }, { sessionId: 's1', projectKey: '/repo', flushedSeq: 3 }, { repository, budget })
  assert.deepEqual(result, { accepted: 1, skipped: 0, failed: 0 })
  assert.equal(saved[0].provenance.sessionId, 's1')
  assert.equal(saved[0].provenance.flushedSeq, 3)
})

test('skips project candidate without authorized project', async () => {
  const { saved, repository, budget } = setup()
  const result = await applyReviewOperations({ operations: [{ kind: 'save', scope: 'project', category: 'convention', content: 'use pnpm' }] }, { sessionId: 's1', flushedSeq: 3 }, { repository, budget })
  assert.equal(result.skipped, 1)
  assert.equal(saved.length, 0)
})

test('skips invalid scope-category and scanner-blocked content', async () => {
  const { saved, repository, budget } = setup()
  const result = await applyReviewOperations({ operations: [
    { kind: 'save', scope: 'failure', category: 'preference', content: 'x' },
    { kind: 'save', scope: 'user', category: 'preference', content: '-----BEGIN PRIVATE KEY-----' },
  ] }, { sessionId: 's1', flushedSeq: 3 }, { repository, budget })
  assert.equal(result.skipped, 2)
  assert.equal(saved.length, 0)
})

test('skips an identical existing record', async () => {
  const { saved, repository, budget } = setup()
  repository.search = async () => ({ total: 1, records: [{ scope: 'user', category: 'preference', content: 'use Chinese' }] })
  const result = await applyReviewOperations({ operations: [{ kind: 'save', scope: 'user', category: 'preference', content: 'use Chinese' }] }, { sessionId: 's1', flushedSeq: 3 }, { repository, budget })
  assert.equal(result.skipped, 1)
  assert.equal(saved.length, 0)
})

test('continues after an individual save failure', async () => {
  const { saved, repository, budget } = setup()
  let calls = 0
  repository.save = async input => { calls += 1; if (calls === 1) throw new Error('disk'); saved.push(input); return input }
  const result = await applyReviewOperations({ operations: [
    { kind: 'save', scope: 'user', category: 'preference', content: 'first' },
    { kind: 'save', scope: 'user', category: 'preference', content: 'second' },
  ] }, { sessionId: 's1', flushedSeq: 3 }, { repository, budget })
  assert.deepEqual(result, { accepted: 1, skipped: 0, failed: 1 })
})
