import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryBlockedError,
  MemoryNotFoundError,
  rankMemoryRecords,
  listMemoryRecords,
  summarizeMemoryRecords,
} from '../core/memory-repository.ts'
import { scanContent } from '../core/content-scanner.ts'
import { validateMemoryInput, validateSearchInput } from '../core/validation.ts'
import type {
  MemoryCategory,
  MemoryInput,
  MemoryRecord,
  MemorySearchInput,
  MemorySearchResult,
  MemoryListInput,
  MemoryListResult,
  MemoryStatsResult,
} from '../core/types.ts'
import type { MemoryRepository } from '../core/memory-repository.ts'
import { TableWatermarkRepository, type WatermarkRepository } from './watermarks.ts'
import { createReviewStateStore, type ReviewStateStore } from './review-state.ts'
import { memoryDomainSpec } from './storage-spec.ts'

export interface MemoryStorage {
  readonly table: KvTable<string, MemoryRecord>
  readonly watermarks: WatermarkRepository
  readonly reviews: ReviewStateStore
  close(): Promise<void>
}

export async function openMemoryStorage(ctx: Context): Promise<MemoryStorage> {
  const domain: Domain<typeof memoryDomainSpec> = await ctx.storageDomain.open(memoryDomainSpec)
  ctx.effect(() => () => domain.close(), 'dshHermesMemory.domainClose')
  return {
    table: domain.table('memories'),
    watermarks: new TableWatermarkRepository(domain.table('watermarks')),
    reviews: createReviewStateStore(domain.table('reviews')),
    close: () => domain.close(),
  }
}

export class StorageMemoryRepository implements MemoryRepository {
  constructor(private readonly storage: MemoryStorage) {}

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
      provenance: normalized.provenance ?? { source: 'explicit', projectKey: normalized.projectKey },
      schemaVersion: 1,
    }
    await this.storage.table.put(record.id, record)
    return structuredClone(record)
  }

  async search(input: MemorySearchInput): Promise<MemorySearchResult> {
    return rankMemoryRecords([...this.storage.table.entries()].map(([, record]) => record), input)
  }

  async list(input: MemoryListInput = {}): Promise<MemoryListResult> {
    return listMemoryRecords([...this.storage.table.entries()].map(([, record]) => record), input)
  }

  async getStats(projectKey?: string): Promise<MemoryStatsResult> {
    return summarizeMemoryRecords([...this.storage.table.entries()].map(([, record]) => record), projectKey)
  }

  async markReferenced(ids: readonly string[], at = new Date().toISOString()): Promise<void> {
    let firstError: unknown
    for (const id of new Set(ids)) {
      const existing = this.storage.table.get(id)
      if (!existing || (existing.lastReferencedAt !== undefined && existing.lastReferencedAt >= at)) continue
      try {
        await this.storage.table.put(id, { ...existing, lastReferencedAt: at })
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw new Error('memory reference timestamp update failed')
  }

  async replace(id: string, content: string, category?: MemoryCategory): Promise<MemoryRecord> {
    const existing = this.storage.table.get(id)
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
    const updated: MemoryRecord = { ...existing, category: normalized.category, content: normalized.content, updatedAt: new Date().toISOString() }
    await this.storage.table.put(id, updated)
    return structuredClone(updated)
  }

  async remove(id: string): Promise<MemoryRecord> {
    const existing = this.storage.table.get(id)
    if (!existing) throw new MemoryNotFoundError()
    const deleted = await this.storage.table.delete(id)
    if (!deleted) throw new MemoryNotFoundError()
    return structuredClone(existing)
  }
}
