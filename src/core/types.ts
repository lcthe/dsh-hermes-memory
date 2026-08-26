export const MEMORY_SCOPES = ['global', 'user', 'project', 'failure'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const MEMORY_CATEGORIES = [
  'preference',
  'convention',
  'insight',
  'failure',
  'correction',
  'tool-quirk',
] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export type MemorySource = 'explicit' | 'session' | 'tool' | 'import'

export interface MemoryProvenance {
  source: MemorySource
  sessionId?: string
  eventSeq?: number
  projectKey?: string
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
  createdAt: string
  updatedAt: string
  lastReferencedAt?: string
  provenance: MemoryProvenance
  schemaVersion: 1
}

export interface MemoryInput {
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
  provenance?: MemoryProvenance
}

export interface MemorySearchInput {
  query: string
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}

export interface MemorySearchResult {
  records: MemoryRecord[]
  total: number
}

export interface ScanResult {
  allowed: boolean
  reason?: 'secret' | 'invisible-character' | 'prompt-injection' | 'exfiltration'
  ruleId?: string
}
