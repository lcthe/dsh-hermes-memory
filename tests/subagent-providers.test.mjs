import assert from 'node:assert/strict'
import test from 'node:test'
import { listProviderNames, pickOutputSchemaProvider } from '../src/host/subagent-providers.ts'

function provider(outputSchema) {
  return { capabilities: { outputSchema } }
}

test('uses list() when the host still exposes it', () => {
  const named = new Map([['alpha', provider(false)], ['beta', provider(true)]])
  const subagents = {
    list: () => ['alpha', 'beta'],
    getProvider: name => named.get(name),
    providers: new Map([['ignored', provider(true)]]),
  }
  assert.deepEqual(listProviderNames(subagents), ['alpha', 'beta'])
  assert.equal(pickOutputSchemaProvider(subagents), 'beta')
})

test('falls back to the providers map when list() was removed', () => {
  const named = new Map([['spawn', provider(true)]])
  const subagents = { getProvider: name => named.get(name), providers: named }
  assert.deepEqual(listProviderNames(subagents), ['spawn'])
  assert.equal(pickOutputSchemaProvider(subagents), 'spawn')
})

test('returns undefined instead of throwing when no provider can be discovered', () => {
  assert.equal(pickOutputSchemaProvider(undefined), undefined)
  assert.equal(pickOutputSchemaProvider({ getProvider: () => undefined }), undefined)
  assert.deepEqual(listProviderNames(undefined), [])
})

test('a throwing list() does not escape before the map fallback', () => {
  const named = new Map([['ok', provider(true)]])
  const subagents = {
    list: () => { throw new Error('boom') },
    getProvider: name => named.get(name),
    providers: named,
  }
  assert.equal(pickOutputSchemaProvider(subagents), 'ok')
})
