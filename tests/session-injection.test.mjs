import assert from 'node:assert/strict'
import test from 'node:test'
import { installMemoryInjection } from '../src/host/memory-injection.ts'

function record(id, content = 'Answer in Chinese') {
  return {
    id,
    scope: 'global',
    category: 'preference',
    content,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
    provenance: { source: 'tool' },
    schemaVersion: 1,
  }
}

function setup({ enabled = true, automaticInjection = true, entries = [['one', record('one')]] } = {}) {
  let listener
  const ctx = {
    on(name, callback) {
      assert.equal(name, 'agent/session-start')
      listener = callback
      return () => {
        listener = undefined
        return true
      }
    },
    emit(name, payload) {
      assert.equal(name, 'agent/session-start')
      listener?.(payload)
    },
  }
  const storage = { table: { entries: () => entries } }
  const settings = {
    get: () => ({
      enabled,
      defaultLimit: 8,
      projectMemoryEnabled: true,
      automaticCapture: false,
      retentionDays: 90,
      automaticInjection,
      injectionLimit: 5,
      injectionMaxChars: 3000,
      includeUserMemory: true,
      includeProjectMemory: true,
    }),
  }
  const warnings = []
  const logger = { warn: message => warnings.push(message) }
  const agent = {
    session: { header: { cwd: '/repo' }, surface: { nodes: [] }, events: {} },
    messages: [],
    inject(message) { this.messages.push(message) },
  }
  return { ctx, storage, settings, logger, warnings, agent }
}

test('injects one bounded message per agent lifecycle', () => {
  const state = setup()
  const dispose = installMemoryInjection(state.ctx, state.storage, state.settings, state.logger)

  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'startup' })
  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'resume' })

  assert.equal(state.agent.messages.length, 1)
  assert.equal(state.agent.messages[0].source.kind, 'plugin')
  assert.equal(state.agent.messages[0].source.plugin, '@lcthe/dsh-hermes-memory')
  assert.equal(state.agent.messages[0].source.form, 'recall')
  assert.match(state.agent.messages[0].content[0].text, /Answer in Chinese/)

  dispose()
  const secondAgent = {
    session: { header: { cwd: '/repo' }, surface: { nodes: [] }, events: {} },
    messages: [],
    inject(message) { this.messages.push(message) },
  }
  state.ctx.emit('agent/session-start', { agent: secondAgent, source: 'startup' })
  assert.equal(secondAgent.messages.length, 0)
})

test('does not duplicate an existing recall message on resume', () => {
  const state = setup()
  state.agent.session.surface.nodes = [1]
  state.agent.session.events[1] = {
    type: 'user/message',
    data: {
      source: {
        kind: 'plugin',
        plugin: '@lcthe/dsh-hermes-memory',
        form: 'recall',
      },
    },
  }
  installMemoryInjection(state.ctx, state.storage, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'resume' })
  assert.equal(state.agent.messages.length, 0)
})

test('does not inject when disabled or when no candidates exist', () => {
  const disabled = setup({ automaticInjection: false })
  installMemoryInjection(disabled.ctx, disabled.storage, disabled.settings, disabled.logger)
  disabled.ctx.emit('agent/session-start', { agent: disabled.agent, source: 'startup' })
  assert.equal(disabled.agent.messages.length, 0)

  const empty = setup({ entries: [] })
  installMemoryInjection(empty.ctx, empty.storage, empty.settings, empty.logger)
  empty.ctx.emit('agent/session-start', { agent: empty.agent, source: 'startup' })
  assert.equal(empty.agent.messages.length, 0)
})

test('contains injection failures and logs only a stable warning', () => {
  const state = setup()
  state.agent.inject = () => { throw new Error('secret text should not be logged') }
  installMemoryInjection(state.ctx, state.storage, state.settings, state.logger)

  assert.doesNotThrow(() => state.ctx.emit('agent/session-start', { agent: state.agent, source: 'startup' }))
  assert.deepEqual(state.warnings, ['dsh-hermes-memory: startup memory injection skipped'])
  assert.equal(state.warnings.some(message => message.includes('secret')), false)
})

test('skips malformed entries while preserving valid candidates', () => {
  const state = setup({
    entries: [
      ['bad', { id: 'bad', scope: 'global', content: '', updatedAt: 'bad' }],
      ['good', record('good', 'Use pnpm')],
    ],
  })
  installMemoryInjection(state.ctx, state.storage, state.settings, state.logger)
  state.ctx.emit('agent/session-start', { agent: state.agent, source: 'startup' })

  assert.equal(state.agent.messages.length, 1)
  assert.match(state.agent.messages[0].content[0].text, /Use pnpm/)
})
