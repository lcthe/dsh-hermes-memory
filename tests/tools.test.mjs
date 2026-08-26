import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemoryRepository } from '../src/core/memory-repository.ts'
import { removeMemory, saveMemory, searchMemory } from '../src/host/tools.ts'

function exec(cwd = '/workspace/project') {
  return { agent: { session: { header: { cwd } } } }
}

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
