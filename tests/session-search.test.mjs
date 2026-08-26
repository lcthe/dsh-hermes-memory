import assert from 'node:assert/strict'
import test from 'node:test'
import { searchSessionMemory } from '../src/host/session-search.ts'

function exec(cwd = '/workspace/project') {
  return { signal: new AbortController().signal, agent: { session: { header: { cwd } } } }
}

function query(items) {
  return { searchSessions: async () => ({ items }) }
}

const hit = {
  header: { id: 'session-a', cwd: '/workspace/project' },
  live: false,
  persisted: true,
  bestMatch: { type: 'user/message', time: 1_700_000_000_000, snippet: 'A'.repeat(100) },
}

test('projects bounded session query results', async () => {
  const result = await searchSessionMemory(query([hit]), exec(), { query: 'A', snippetChars: 12 })
  assert.equal(result.success, true)
  assert.equal(result.results[0]?.snippet.length, 12)
  assert.equal(result.results[0]?.role, 'user')
})

test('rejects a project outside the current workspace', async () => {
  const result = await searchSessionMemory(query([]), exec(), { query: 'x', project: '/other' })
  assert.equal(result.success, false)
  assert.equal(result.error?.code, 'session_scope_denied')
})

test('maps provider failures without exposing raw errors', async () => {
  const result = await searchSessionMemory({ searchSessions: async () => { throw new Error('/private/path') } }, exec(), { query: 'x' })
  assert.equal(result.success, false)
  assert.equal(result.error?.code, 'session_query_failed')
  assert.equal(result.error?.message, 'session query failed')
})
