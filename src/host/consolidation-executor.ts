import { createHash } from 'node:crypto'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryRecord, MemoryCategory, MemoryScope } from '../core/types.ts'
import type { ConsolidationGroup, ConsolidationState, ConsolidationPlan, ConsolidationStateStore } from './consolidation-types.ts'
import { scanContent } from '../core/content-scanner.ts'

const MAX_REPLACEMENT_CHARS = 2_000

export interface ConsolidationRequest {
  id: string
  scope: MemoryScope
  projectKey?: string
  records: readonly MemoryRecord[]
  plan: ConsolidationPlan
  targetChars: number
}

export interface ConsolidationStorage {
  table: KvTable<string, MemoryRecord>
  states: ConsolidationStateStore
}

function replacementId(runId: string, index: number): string {
  return `consolidated-${createHash('sha256').update(`${runId}:${index}`).digest('hex').slice(0, 32)}`
}

function validateGroup(group: ConsolidationGroup, records: Map<string, MemoryRecord>, request: ConsolidationRequest): void {
  if (group.content.length > MAX_REPLACEMENT_CHARS || !scanContent(group.content).allowed) throw new Error('consolidation content is unsafe or too long')
  for (const id of group.sourceIds) {
    const record = records.get(id)
    if (!record || record.scope !== request.scope || record.projectKey !== request.projectKey) throw new Error('consolidation source is outside the authorized snapshot')
  }
}

export async function prepareConsolidation(request: ConsolidationRequest): Promise<ConsolidationState | undefined> {
  const records = new Map(request.records.map(record => [record.id, record]))
  const ids = new Set<string>()
  let sourceChars = 0
  for (const record of request.records) sourceChars += record.content.length
  let replacementChars = 0
  for (const group of request.plan.groups) {
    validateGroup(group, records, request)
    for (const id of group.sourceIds) {
      if (ids.has(id)) throw new Error('consolidation source appears in multiple groups')
      ids.add(id)
    }
    replacementChars += group.content.length
  }
  const projected = sourceChars - [...ids].reduce((sum, id) => sum + records.get(id)!.content.length, 0) + replacementChars
  if (projected > request.targetChars) return undefined
  const sourceVersions: Record<string, string> = {}
  for (const id of ids) sourceVersions[id] = records.get(id)!.updatedAt
  return { id: request.id, scope: request.scope, projectKey: request.projectKey, groups: structuredClone(request.plan.groups), sourceVersions, status: 'prepared', updatedAt: new Date().toISOString(), schemaVersion: 1 }
}

function replacementRecord(state: ConsolidationState, group: ConsolidationGroup, index: number, now: string): MemoryRecord {
  const sourceId = group.sourceIds[0]
  return {
    id: replacementId(state.id, index), scope: state.scope, category: group.category as MemoryCategory, content: group.content,
    projectKey: state.projectKey, createdAt: now, updatedAt: now,
    provenance: { source: 'consolidation', projectKey: state.projectKey }, schemaVersion: 1,
  }
}

export async function executeConsolidation(state: ConsolidationState, storage: ConsolidationStorage): Promise<void> {
  if (state.status === 'prepared') {
    const now = new Date().toISOString()
    for (const [index, group] of state.groups.entries()) {
      const replacement = replacementRecord(state, group, index, now)
      if (!scanContent(replacement.content).allowed) throw new Error('consolidation replacement was blocked')
      await storage.table.put(replacement.id, replacement)
    }
    await storage.states.markReplacementsWritten(state.id)
  }
  if (state.status === 'failed') return
  const current = await storage.states.get(state.id)
  if (!current || current.status !== 'replacements-written') throw new Error('consolidation replacements were not durable')
  for (const [id, version] of Object.entries(current.sourceVersions)) {
    const source = storage.table.get(id)
    if (!source || source.updatedAt !== version) {
      await storage.states.markFailed(current.id)
      throw new Error('consolidation source changed during execution')
    }
  }
  for (const id of Object.keys(current.sourceVersions)) await storage.table.delete(id)
  await storage.states.markCompleted(current.id)
}
