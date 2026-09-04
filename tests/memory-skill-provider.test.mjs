import assert from 'node:assert/strict'
import test from 'node:test'
import { installMemorySkillProvider } from '../src/host/memory-skill-provider.ts'

const skill = { id: '1', name: 'project-skill', description: 'Project', content: 'body', scope: 'project', projectKey: '/repo-a', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z', provenance: { source: 'explicit' }, schemaVersion: 1 }
test('lists matching user and project skills and refuses foreign project loads', async () => {
  let provider
  const ctx = { skills: { registerProvider(factory) { provider = factory({ invalidate() {} }); return () => undefined } } }
  const store = { async list() { return [skill, { ...skill, id: '2', name: 'user-skill', scope: 'user', projectKey: undefined }] }, async get(id) { return id === '1' ? skill : undefined } }
  installMemorySkillProvider(ctx, store)
  assert.deepEqual((await provider.list({ cwd: '/repo-a' })).map(item => item.name), ['project-skill', 'user-skill'])
  const candidate = (await provider.list({ cwd: '/repo-a' }))[0]
  assert.equal(await provider.get(candidate, { cwd: '/repo-b' }), undefined)
})
