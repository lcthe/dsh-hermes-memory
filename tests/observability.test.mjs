import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemoryRepository } from '../src/core/memory-repository.ts'

function record(id, scope, category, content, updatedAt, projectKey) {
  return {
    id,
    scope,
    category,
    content,
    projectKey,
    createdAt: updatedAt,
    updatedAt,
    provenance: { source: 'tool' },
    schemaVersion: 1,
  }
}

const records = [
  record('global', 'global', 'preference', 'Answer in Chinese', '2026-08-27T10:00:00.000Z'),
  record('project', 'project', 'convention', 'Use pnpm', '2026-08-27T11:00:00.000Z', '/repo'),
  record('failure', 'failure', 'failure', 'Do not retry blindly', '2026-08-27T12:00:00.000Z'),
  record('other', 'project', 'convention', 'Other project', '2026-08-27T13:00:00.000Z', '/other'),
]

test('lists visible records with filters, stable ordering, and bounds', async () => {
  const repository = new InMemoryRepository(records)
  const listed = await repository.list({ projectKey: '/repo', limit: 50 })
  assert.deepEqual(listed.records.map(item => item.id), ['failure', 'project', 'global'])
  assert.equal(listed.total, 3)
  assert.equal((await repository.list({ scope: 'project', projectKey: '/repo' })).records[0].id, 'project')
  assert.equal((await repository.list({ projectKey: '/repo' })).records.some(item => item.id === 'other'), false)
})

test('summarizes counts and characters without unauthorized projects', async () => {
  const repository = new InMemoryRepository(records)
  const stats = await repository.getStats('/repo')
  assert.deepEqual(stats.byScope.project, { count: 1, chars: 8 })
  assert.equal(stats.byScope.global.count, 1)
  assert.equal(stats.byScope.failure.count, 1)
  assert.equal(stats.byScope.user.count, 0)
  assert.equal(stats.total, 3)
  assert.equal(stats.totalChars, 'Answer in Chinese'.length + 'Use pnpm'.length + 'Do not retry blindly'.length)
})

test('advances reference timestamps monotonically and ignores unknown ids', async () => {
  const repository = new InMemoryRepository(records)
  await repository.markReferenced(['global', 'missing'], '2026-08-27T15:00:00.000Z')
  await repository.markReferenced(['global'], '2026-08-27T14:00:00.000Z')
  const saved = (await repository.list({ projectKey: '/repo', limit: 50 })).records.find(item => item.id === 'global')
  assert.equal(saved.lastReferencedAt, '2026-08-27T15:00:00.000Z')
  assert.equal(saved.updatedAt, '2026-08-27T10:00:00.000Z')
})
