import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  MemoryBlockedError,
  MemoryNotFoundError,
  rankMemoryRecords,
} from '../core/memory-repository.ts'
import { scanContent } from '../core/content-scanner.ts'
import { validateMemoryInput, validateSearchInput } from '../core/validation.ts'
import type {
  MemoryCategory,
  MemoryInput,
  MemoryRecord,
  MemorySearchInput,
  MemorySearchResult,
} from '../core/types.ts'
import type { MemoryRepository } from '../core/memory-repository.ts'
import { memoryDomainSpec } from './storage-spec.ts'

export interface MemoryStorage {
  readonly table: KvTable<string, MemoryRecord>
  close(): Promise<void>
}

export async function openMemoryStorage(ctx: Context): Promise<MemoryStorage> {
  const domain: Domain<typeof memoryDomainSpec> = await ctx.storageDomain.open(memoryDomainSpec)
  ctx.effect(() => () => domain.close(), 'dshHermesMemory.domainClose')
  return { table: domain.table('memories'), close: () => domain.close() }
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
