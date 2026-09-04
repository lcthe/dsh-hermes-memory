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
  flushedSeq?: number
  projectKey?: string
}

export interface SessionWatermark {
  sessionId: string
  lastEventSeq: number
  lastFlushedSeq: number
  updatedAt: string
  schemaVersion: 1
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

export type StandingKind = 'profile' | 'instruction'

export interface StandingProvenance {
  source: 'explicit'
  sessionId?: string
  eventSeq?: number
}

export interface StandingEntry {
  id: string
  kind: StandingKind
  content: string
  createdAt: string
  updatedAt: string
  provenance: StandingProvenance
  schemaVersion: 1
}

export interface StandingInput {
  kind: StandingKind
  content: string
  provenance?: StandingProvenance
}

export interface StandingLimits {
  maxEntries: number
  maxChars: number
}

export interface StandingStore {
  add(input: StandingInput, limits: StandingLimits): Promise<StandingEntry>
  list(): Promise<StandingEntry[]>
  remove(id: string): Promise<StandingEntry>
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

export interface MemoryListInput {
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}

export interface MemoryListResult {
  records: MemoryRecord[]
  total: number
}

export interface MemoryStatsBucket {
  count: number
  chars: number
}

export interface MemoryStatsResult {
  total: number
  totalChars: number
  byScope: Record<MemoryScope, MemoryStatsBucket>
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
