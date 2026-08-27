import { randomUUID } from 'node:crypto'
import type {
  MemoryInput,
  MemoryRecord,
  MemorySearchInput,
  MemorySearchResult,
  MemoryListInput,
  MemoryListResult,
  MemoryStatsResult,
  MemoryScope,
  ScanResult,
} from './types.ts'
import { scanContent } from './content-scanner.ts'
import { validateMemoryInput, validateSearchInput, validateListInput } from './validation.ts'

export class MemoryBlockedError extends Error {
  readonly code = 'blocked_content'
  constructor(readonly scan: ScanResult) {
    super(`memory content blocked: ${scan.reason ?? 'unsafe content'}`)
  }
}

export class MemoryNotFoundError extends Error {
  readonly code = 'not_found'
  constructor() {
    super('memory record was not found')
  }
}

export interface MemoryRepository {
  save(input: MemoryInput): Promise<MemoryRecord>
  search(input: MemorySearchInput): Promise<MemorySearchResult>
  list(input: MemoryListInput): Promise<MemoryListResult>
  getStats(projectKey?: string): Promise<MemoryStatsResult>
  markReferenced(ids: readonly string[], at?: string): Promise<void>
  replace(id: string, content: string, category?: MemoryInput['category']): Promise<MemoryRecord>
  remove(id: string): Promise<MemoryRecord>
}

function score(record: MemoryRecord, query: string): number {
  const normalized = query.toLocaleLowerCase()
  const content = record.content.toLocaleLowerCase()
  let result = 0
  let offset = content.indexOf(normalized)
  while (offset >= 0) {
    result += offset === 0 ? 4 : 1
    offset = content.indexOf(normalized, offset + normalized.length)
  }
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (content.includes(token)) result += 1
  }
  return result
}

export function listMemoryRecords(records: Iterable<MemoryRecord>, input: MemoryListInput = {}): MemoryListResult {
  const normalized = validateListInput(input)
  const candidates = [...records]
    .filter(record => !normalized.scope || record.scope === normalized.scope)
    .filter(record => !normalized.category || record.category === normalized.category)
    .filter(record => normalized.projectKey === undefined
      ? record.scope !== 'project'
      : record.scope !== 'project' || record.projectKey === normalized.projectKey)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))

  return {
    total: candidates.length,
    records: candidates.slice(0, normalized.limit).map(record => structuredClone(record)),
  }
}

export function summarizeMemoryRecords(records: Iterable<MemoryRecord>, projectKey?: string): MemoryStatsResult {
  const byScope: Record<MemoryScope, { count: number; chars: number }> = {
    global: { count: 0, chars: 0 },
    user: { count: 0, chars: 0 },
    project: { count: 0, chars: 0 },
    failure: { count: 0, chars: 0 },
  }
  for (const record of records) {
    if (record.scope === 'project' && record.projectKey !== projectKey) continue
    const bucket = byScope[record.scope]
    bucket.count += 1
    bucket.chars += record.content.length
  }
  const total = Object.values(byScope).reduce((sum, bucket) => sum + bucket.count, 0)
  const totalChars = Object.values(byScope).reduce((sum, bucket) => sum + bucket.chars, 0)
  return { total, totalChars, byScope }
}

export function rankMemoryRecords(records: Iterable<MemoryRecord>, input: MemorySearchInput): MemorySearchResult {
  const normalized = validateSearchInput(input)
  const candidates = [...records]
    .filter(record => !normalized.scope || record.scope === normalized.scope)
    .filter(record => !normalized.category || record.category === normalized.category)
    .filter(record => normalized.projectKey === undefined || record.projectKey === normalized.projectKey)
    .map(record => ({ record, score: score(record, normalized.query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))

  return {
    total: candidates.length,
    records: candidates.slice(0, normalized.limit).map(item => structuredClone(item.record)),
  }
}


export class InMemoryRepository implements MemoryRepository {
  private readonly records = new Map<string, MemoryRecord>()

  constructor(initialRecords: readonly MemoryRecord[] = []) {
    for (const record of initialRecords) this.records.set(record.id, structuredClone(record))
  }

  async save(input: MemoryInput): Promise<MemoryRecord> {
    const normalized = validateMemoryInput(input)
    const scan = scanContent(normalized.content)
    if (!scan.allowed) throw new MemoryBlockedError(scan)
    const now = new Date().toISOString()
    const record: MemoryRecord = {
      id: randomUUID(),
      scope: normalized.scope,
      category: normalized.category,
      content: normalized.content,
      projectKey: normalized.projectKey,
      createdAt: now,
      updatedAt: now,
      provenance: normalized.provenance ?? {
        source: 'explicit',
        projectKey: normalized.projectKey,
      },
      schemaVersion: 1,
    }
    this.records.set(record.id, record)
    return structuredClone(record)
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult> {
    return rankMemoryRecords(this.records.values(), input)
  }

  async list(input: MemoryListInput = {}): Promise<MemoryListResult> {
    return listMemoryRecords(this.records.values(), input)
  }

  async getStats(projectKey?: string): Promise<MemoryStatsResult> {
    return summarizeMemoryRecords(this.records.values(), projectKey)
  }

  async markReferenced(ids: readonly string[], at = new Date().toISOString()): Promise<void> {
    for (const id of new Set(ids)) {
      const existing = this.records.get(id)
      if (!existing || (existing.lastReferencedAt !== undefined && existing.lastReferencedAt >= at)) continue
      this.records.set(id, { ...existing, lastReferencedAt: at })
    }
  }

  async replace(id: string, content: string, category?: MemoryInput['category']): Promise<MemoryRecord> {
    const existing = this.records.get(id)
    if (!existing) throw new MemoryNotFoundError()
    const normalized = validateMemoryInput({
      scope: existing.scope,
      category: category ?? existing.category,
      content,
      projectKey: existing.projectKey,
      provenance: existing.provenance,
    })
    const scan = scanContent(normalized.content)
    if (!scan.allowed) throw new MemoryBlockedError(scan)
    const updated: MemoryRecord = {
      ...existing,
      category: normalized.category,
      content: normalized.content,
      updatedAt: new Date().toISOString(),
    }
    this.records.set(id, updated)
    return structuredClone(updated)
  }

  async remove(id: string): Promise<MemoryRecord> {
    const existing = this.records.get(id)
    if (!existing) throw new MemoryNotFoundError()
    this.records.delete(id)
    return structuredClone(existing)
  }
}
