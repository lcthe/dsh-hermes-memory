import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ConsolidationState, ConsolidationStateStore, ConsolidationStatus } from './consolidation-types.ts'

function transition(state: ConsolidationState, expected: ConsolidationStatus, status: ConsolidationStatus): ConsolidationState {
  if (state.status !== expected) throw new Error(`invalid consolidation transition from ${state.status}`)
  return { ...structuredClone(state), status, updatedAt: new Date().toISOString() }
}

export function createConsolidationStateStore(table: KvTable<string, ConsolidationState>): ConsolidationStateStore {
  const update = async (id: string, expected: ConsolidationStatus, status: ConsolidationStatus): Promise<void> => {
    const current = table.get(id)
    if (!current) throw new Error('consolidation state was not found')
    await table.put(id, transition(current, expected, status))
  }
  return {
    async put(state) { await table.put(state.id, structuredClone(state)) },
    async get(id) { const state = table.get(id); return state === undefined ? undefined : structuredClone(state) },
    async list() { return [...table.entries()].map(([, state]) => structuredClone(state)) },
    markReplacementsWritten: id => update(id, 'prepared', 'replacements-written'),
    markCompleted: id => update(id, 'replacements-written', 'completed'),
    markFailed: async id => {
      const current = table.get(id)
      if (!current) throw new Error('consolidation state was not found')
      if (current.status === 'completed') throw new Error('completed consolidation cannot fail')
      await table.put(id, { ...structuredClone(current), status: 'failed', updatedAt: new Date().toISOString() })
    },
  }
}
