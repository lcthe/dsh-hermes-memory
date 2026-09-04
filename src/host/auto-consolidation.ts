import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { MemoryRepository } from '../core/memory-repository.ts'
import type { MemoryStorage } from './storage.ts'
import type { MemorySettings } from './settings.ts'
import type { ConsolidationState } from './consolidation-types.ts'
import { executeConsolidation } from './consolidation-executor.ts'
import { runConsolidation } from './consolidation-runner.ts'

export interface AutoConsolidationScheduleInput {
  enabled: boolean
  automaticConsolidation: boolean
  totalChars: number
  thresholdChars: number
  active: boolean
  hasProvider: boolean
}

export function shouldScheduleConsolidation(input: AutoConsolidationScheduleInput): boolean {
  return input.enabled && input.automaticConsolidation && input.hasProvider && !input.active
    && input.totalChars >= input.thresholdChars
}

interface Subagents {
  list(): string[]
  getProvider(name: string): { capabilities: { outputSchema: boolean } } | undefined
  start: Parameters<typeof runConsolidation>[0]['subagents']['start']
}

function providerOf(subagents: Subagents): string | undefined {
  return subagents.list().find(name => subagents.getProvider(name)?.capabilities.outputSchema)
}

export function installAutoConsolidation(
  rawCtx: Context,
  storage: MemoryStorage,
  repository: MemoryRepository,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => void {
  const ctx = rawCtx as Context
  const active = new Set<string>()
  const schedule = (session: Session): void => {
    const value = settings.get()
    const subagents = ctx.get('subagents') as Subagents | undefined
    const agents = ctx.get('agents') as { get(id: string): NonNullable<Context['agent']> | undefined } | undefined
    const provider = subagents && providerOf(subagents)
    const owner = agents?.get(String(session.id))
    if (!provider || !owner || !value.enabled || !value.automaticConsolidation) return
    const key = String(session.id)
    if (active.has(key)) return
    void repository.getStats().then(stats => {
      if (!shouldScheduleConsolidation({
        enabled: value.enabled, automaticConsolidation: value.automaticConsolidation,
        totalChars: stats.totalChars, thresholdChars: value.consolidationThresholdChars ?? 40_000,
        active: active.has(key), hasProvider: provider !== undefined,
      })) return
      return repository.list({ limit: value.consolidationMaxRecords ?? 100 }).then(result => {
        const records = result.records.filter(record => record.scope === 'user').slice(0, value.consolidationMaxRecords ?? 100)
        if (records.length < 2) return
        active.add(key)
        return runConsolidation({
          id: `auto-${key}-${session.events.at(-1)?.seq ?? 0}`, scope: 'user', records,
          targetChars: value.consolidationTargetChars ?? 28_000, provider, parent: owner, subagents,
          storage: { table: storage.table, states: storage.consolidations },
        }).finally(() => { active.delete(key) })
      })
    }).catch(() => logger.warn('dsh-hermes-memory: automatic consolidation skipped'))
  }
  const runExisting = async (state: ConsolidationState): Promise<void> => {
    const current = await storage.consolidations.get(state.id)
    if (!current) return
    await executeConsolidation(current, { table: storage.table, states: storage.consolidations })
  }
  void storage.consolidations.list().then(states => Promise.all(states.filter(state => state.status === 'prepared' || state.status === 'replacements-written').map(state => runExisting(state)))).catch(() => logger.warn('dsh-hermes-memory: consolidation recovery skipped'))
  const dispose = ctx.on('session/flush', schedule)
  return dispose
}
