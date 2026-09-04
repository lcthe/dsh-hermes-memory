import type { MemoryCategory, MemoryScope } from '../core/types.ts'

export interface ConsolidationGroup {
  sourceIds: string[]
  category: MemoryCategory
  content: string
}

export interface ConsolidationPlan {
  groups: ConsolidationGroup[]
}

export type ConsolidationStatus = 'prepared' | 'replacements-written' | 'completed' | 'failed'

export interface ConsolidationState {
  id: string
  scope: MemoryScope
  projectKey?: string
  groups: ConsolidationGroup[]
  sourceVersions: Record<string, string>
  status: ConsolidationStatus
  updatedAt: string
  schemaVersion: 1
}

export interface ConsolidationStateStore {
  put(state: ConsolidationState): Promise<void>
  get(id: string): Promise<ConsolidationState | undefined>
  list(): Promise<ConsolidationState[]>
  markReplacementsWritten(id: string): Promise<void>
  markCompleted(id: string): Promise<void>
  markFailed(id: string): Promise<void>
}
