import assert from 'node:assert/strict'
import test from 'node:test'
import { installStandingInjection, renderStandingText } from '../src/host/standing-injection.ts'

const entries = [
  { id: 'instruction', kind: 'instruction', content: 'Act as the DSH maintainer.', createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z', provenance: { source: 'explicit' }, schemaVersion: 1 },
  { id: 'profile', kind: 'profile', content: 'The user prefers Chinese.', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z', provenance: { source: 'explicit' }, schemaVersion: 1 },
]

function setup({ enabled = true, standingContextEnabled = true, recorded = false } = {}) {
  let listener
  const ctx = {
    on(name, callback) {
      assert.equal(name, 'agent/session-start')
      listener = callback
      return () => { listener = undefined }
    },
    emit(name, payload) {
      assert.equal(name, 'agent/session-start')
      listener?.(payload)
    },
  }
  const agent = {
    session: {
      header: { cwd: '/repo' },
      surface: { nodes: recorded ? [1] : [] },
      events: recorded ? { 1: { type: 'user/message', data: { content: [{ type: 'text', text: '[DSH standing context]' }], source: { kind: 'plugin', plugin: '@lcthe/dsh-hermes-memory', form: 'instructions' } } } } : {},
    },
    messages: [],
    inject(message) { this.messages.push(message) },
  }
  const settings = { get: () => ({ enabled, standingContextEnabled, standingMaxEntries: 20, standingMaxChars: 2_000 }) }
  const store = { list: async () => entries }
  return { ctx, agent, settings, store, logger: { warn() {} } }
}

test('renders bounded profile and instruction context', () => {
  const text = renderStandingText(entries, 2_000)
  assert.match(text, /The user prefers Chinese/)
  assert.match(text, /Act as the DSH maintainer/)
  assert.match(text, /standing instructions/)
  assert.ok(text.length <= 2_000)
})

test('injects standing context even when ordinary injection is disabled', async () => {
  const state = setup()
  installStandingInjection(state.ctx, state.store, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'startup' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.agent.messages.length, 1)
  assert.equal(state.agent.messages[0].source.form, 'instructions')
  assert.match(state.agent.messages[0].content[0].text, /Act as the DSH maintainer/)
})

test('does not duplicate standing context on resume', async () => {
  const state = setup({ recorded: true })
  installStandingInjection(state.ctx, state.store, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'resume' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.agent.messages.length, 0)
})

test('skips injection when disabled or empty', async () => {
  const disabled = setup({ enabled: false })
  installStandingInjection(disabled.ctx, disabled.store, disabled.settings, disabled.logger)
  disabled.ctx.emit('agent/session-start', { agent: disabled.agent, source: 'startup' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disabled.agent.messages.length, 0)
  const empty = setup()
  empty.store.list = async () => []
  installStandingInjection(empty.ctx, empty.store, empty.settings, empty.logger)
  empty.ctx.emit('agent/session-start', { agent: empty.agent, source: 'startup' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(empty.agent.messages.length, 0)
})
