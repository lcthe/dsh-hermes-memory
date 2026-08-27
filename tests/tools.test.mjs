import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemoryRepository } from '../src/core/memory-repository.ts'
import { listMemory, removeMemory, saveMemory, searchMemory, statsMemory } from '../src/host/tools.ts'

function exec(cwd = '/workspace/project') {
  return { agent: { session: { header: { cwd } } } }
}

test('search marks referenced timestamps without blocking the result', async () => {
  const repository = new InMemoryRepository([
    {
      id: 'global', scope: 'project', category: 'preference', content: 'Answer in Chinese', projectKey: '/workspace/project',
      createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z',
      provenance: { source: 'tool' }, schemaVersion: 1,
    },
  ])
  const context = { repository, logger: { warn() {} } }
  const result = await searchMemory({ query: 'Chinese' }, exec(), context)
  assert.equal(result.success, true)
  assert.equal(result.total, 1)
  await new Promise(resolve => setImmediate(resolve))
  const listed = await listMemory({ limit: 50 }, exec(), context)
  assert.ok(listed.records[0].lastReferencedAt)
  assert.equal(listed.records[0].updatedAt, '2026-08-27T10:00:00.000Z')
})

test('list and stats do not mark referenced timestamps', async () => {
  const repository = new InMemoryRepository([
    {
      id: 'global', scope: 'global', category: 'preference', content: 'Answer in Chinese',
      createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z',
      provenance: { source: 'tool' }, schemaVersion: 1,
    },
  ])
  const context = { repository, logger: { warn() {} } }
  await listMemory({ limit: 50 }, exec(), context)
  await statsMemory({}, exec(), context)
  const listed = await listMemory({ limit: 50 }, exec(), context)
  assert.equal(listed.records[0].lastReferencedAt, undefined)
})

test('list and stats tools preserve workspace scope', async () => {
  const repository = new InMemoryRepository([
    {
      id: 'global', scope: 'global', category: 'preference', content: 'Answer in Chinese',
      createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z',
      provenance: { source: 'tool' }, schemaVersion: 1,
    },
    {
      id: 'project', scope: 'project', category: 'convention', content: 'Use pnpm', projectKey: '/workspace/project',
      createdAt: '2026-08-27T11:00:00.000Z', updatedAt: '2026-08-27T11:00:00.000Z',
      provenance: { source: 'tool' }, schemaVersion: 1,
    },
    {
      id: 'other', scope: 'project', category: 'convention', content: 'Other project', projectKey: '/other/project',
      createdAt: '2026-08-27T12:00:00.000Z', updatedAt: '2026-08-27T12:00:00.000Z',
      provenance: { source: 'tool' }, schemaVersion: 1,
    },
  ])
  const context = { repository }

  const listed = await listMemory({ limit: 50 }, exec(), context)
  assert.equal(listed.success, true)
  assert.equal(listed.total, 2)
  assert.deepEqual(listed.records.map((record) => record.id), ['project', 'global'])
  assert.equal(listed.records.some((record) => record.id === 'other'), false)

  const stats = await statsMemory({}, exec(), context)
  assert.equal(stats.success, true)
  assert.equal(stats.stats.byScope.project.count, 1)
  assert.equal(stats.stats.byScope.global.count, 1)
  assert.equal(stats.stats.total, 2)
})

test('list and stats reject an unauthorized project key', async () => {
  const repository = new InMemoryRepository()
  const context = { repository }
  const listed = await listMemory({ projectKey: '/other/project' }, exec(), context)
  assert.equal(listed.success, false)
  assert.equal(listed.error?.code, 'unauthorized_scope')
  const stats = await statsMemory({ projectKey: '/other/project' }, exec(), context)
  assert.equal(stats.success, false)
  assert.equal(stats.error?.code, 'unauthorized_scope')
})

test('save and search tools preserve workspace scope', async () => {
  const repository = new InMemoryRepository()
  const context = { repository }
  const saved = await saveMemory({ scope: 'project', category: 'convention', content: 'Use pnpm', projectKey: '/workspace/project' }, exec(), context)
  assert.equal(saved.success, true)

  const result = await searchMemory({ query: 'pnpm' }, exec(), context)
  assert.equal(result.success, true)
  assert.equal(result.total, 1)
})

test('project tools reject a different workspace key', async () => {
  const repository = new InMemoryRepository()
  const result = await saveMemory({ scope: 'project', category: 'convention', content: 'private rule', projectKey: '/other/project' }, exec(), { repository })
  assert.equal(result.success, false)
  assert.equal(result.error?.code, 'unauthorized_scope')
})

test('remove maps missing ids to a stable error', async () => {
  const result = await removeMemory({ id: 'missing' }, exec(), { repository: new InMemoryRepository() })
  assert.deepEqual(result.error, { code: 'not_found', message: 'memory record was not found' })
})
