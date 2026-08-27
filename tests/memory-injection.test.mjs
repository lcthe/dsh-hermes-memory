import assert from 'node:assert/strict'
import test from 'node:test'
import { renderInjectionText, selectInjectionRecords } from '../src/host/memory-injection.ts'

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

const defaults = {
  automaticInjection: true,
  injectionLimit: 5,
  injectionMaxChars: 3000,
  includeUserMemory: true,
  includeProjectMemory: true,
  projectMemoryEnabled: true,
}

test('selects authorized records with deterministic scope priority', () => {
  const records = [
    record('global-new', 'global', 'preference', 'Answer in Chinese', '2026-08-27T10:00:00.000Z'),
    record('user-old', 'user', 'preference', 'Use concise answers', '2026-08-26T10:00:00.000Z'),
    record('project-new', 'project', 'convention', 'Use pnpm', '2026-08-27T11:00:00.000Z', '/repo'),
    record('failure', 'failure', 'failure', 'Do not retry this tool blindly', '2026-08-27T12:00:00.000Z'),
    record('other-project', 'project', 'convention', 'Other project', '2026-08-27T13:00:00.000Z', '/other'),
  ]

  assert.deepEqual(
    selectInjectionRecords(records, defaults, { cwd: '/repo' }).map(item => item.id),
    ['project-new', 'user-old', 'global-new'],
  )
  assert.deepEqual(
    selectInjectionRecords(records, { ...defaults, includeProjectMemory: false }, { cwd: '/repo' }).map(item => item.id),
    ['user-old', 'global-new'],
  )
  assert.equal(selectInjectionRecords(records, defaults, { cwd: '/other' }).some(item => item.id === 'project-new'), false)
  assert.equal(selectInjectionRecords(records, defaults, {}).some(item => item.scope === 'failure'), false)
})

test('honors injection limit and skips malformed records', () => {
  const records = [
    record('b', 'global', 'preference', 'B', '2026-08-27T10:00:00.000Z'),
    record('a', 'global', 'preference', 'A', '2026-08-27T10:00:00.000Z'),
    { id: 'bad', scope: 'global', content: '', updatedAt: 'bad' },
  ]
  assert.deepEqual(
    selectInjectionRecords(records, { ...defaults, injectionLimit: 1 }, {}).map(item => item.id),
    ['a'],
  )
})

test('renders bounded reference-only text without internal fields', () => {
  const text = renderInjectionText([
    record('project-id', 'project', 'convention', 'Use pnpm', '2026-08-27T11:00:00.000Z', '/repo'),
    record('user-id', 'user', 'preference', 'Answer in Chinese', '2026-08-27T10:00:00.000Z'),
  ], 3000)

  assert.ok(text)
  assert.match(text, /^\[DSH memory context — reference only\]/)
  assert.match(text, /\[project\/convention\] Use pnpm/)
  assert.match(text, /\[user\/preference\] Answer in Chinese/)
  assert.match(text, /reference context/)
  assert.equal(text.includes('project-id'), false)
  assert.equal(text.includes('/repo'), false)
  assert.equal(text.includes('provenance'), false)
  assert.ok(text.length <= 3000)
})

test('truncates entries to the total character budget and handles empty input', () => {
  assert.equal(renderInjectionText([], 3000), undefined)
  const text = renderInjectionText([
    record('long', 'global', 'insight', 'x'.repeat(1000), '2026-08-27T10:00:00.000Z'),
  ], 500)
  assert.ok(text)
  assert.ok(text.length <= 500)
  assert.match(text, /…|reference context/)
})
