import { randomUUID } from 'node:crypto'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { MemoryBlockedError, MemoryNotFoundError } from '../core/memory-repository.ts'
import { scanContent } from '../core/content-scanner.ts'
import { MemoryValidationError } from '../core/validation.ts'
import type { StandingEntry, StandingInput, StandingKind, StandingLimits, StandingStore } from '../core/types.ts'

export const MAX_STANDING_ENTRIES = 20
export const MAX_STANDING_CHARS = 2_000
export const MAX_STANDING_ENTRY_CHARS = 500

function normalizeInput(input: StandingInput): StandingInput {
  if (!input || typeof input !== 'object') throw new MemoryValidationError('standing input is required')
  if (input.kind !== 'profile' && input.kind !== 'instruction') {
    throw new MemoryValidationError('standing kind is invalid')
  }
  if (typeof input.content !== 'string') throw new MemoryValidationError('standing content is required')

  const content = input.content.trim()
  if (!content) throw new MemoryValidationError('standing content is required')
  if (content.length > MAX_STANDING_ENTRY_CHARS) {
    throw new MemoryValidationError(`standing content exceeds ${MAX_STANDING_ENTRY_CHARS} characters`)
  }

  const provenance = input.provenance
  if (provenance !== undefined) {
    if (provenance.source !== 'explicit') throw new MemoryValidationError('standing provenance is invalid')
    if (provenance.sessionId !== undefined && (!provenance.sessionId || typeof provenance.sessionId !== 'string')) {
      throw new MemoryValidationError('standing session ID is invalid')
    }
    if (provenance.eventSeq !== undefined && (!Number.isSafeInteger(provenance.eventSeq) || provenance.eventSeq < 0)) {
      throw new MemoryValidationError('standing event sequence is invalid')
    }
  }

  return {
    kind: input.kind,
    content,
    provenance: provenance === undefined ? { source: 'explicit' } : structuredClone(provenance),
  }
}

function validateLimits(limits: StandingLimits): StandingLimits {
  if (!limits || typeof limits !== 'object') throw new MemoryValidationError('standing limits are required')
  if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1 || limits.maxEntries > MAX_STANDING_ENTRIES) {
    throw new MemoryValidationError(`standing entry limit must be an integer from 1 to ${MAX_STANDING_ENTRIES}`)
  }
  if (!Number.isSafeInteger(limits.maxChars) || limits.maxChars < 1 || limits.maxChars > MAX_STANDING_CHARS) {
    throw new MemoryValidationError(`standing character budget must be an integer from 1 to ${MAX_STANDING_CHARS}`)
  }
  return limits
}

function compareEntries(left: StandingEntry, right: StandingEntry): number {
  return (left.kind === 'profile' ? 0 : 1) - (right.kind === 'profile' ? 0 : 1)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id)
}

function orderedEntries(table: KvTable<string, StandingEntry>): StandingEntry[] {
  return [...table.entries()]
    .map(([, entry]) => entry)
    .sort(compareEntries)
}

class TableStandingStore implements StandingStore {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly table: KvTable<string, StandingEntry>) {}

  async add(input: StandingInput, limits: StandingLimits): Promise<StandingEntry> {
    const validatedLimits = validateLimits(limits)
    const normalized = normalizeInput(input)
    const scan = scanContent(normalized.content)
    if (!scan.allowed) throw new MemoryBlockedError(scan)

    return this.enqueue(async () => {
      const entries = orderedEntries(this.table)
      if (entries.some(entry => entry.kind === normalized.kind && entry.content === normalized.content)) {
        throw new MemoryValidationError('standing entry already exists')
      }
      if (entries.length >= validatedLimits.maxEntries) {
        throw new MemoryValidationError(`standing entry limit is ${validatedLimits.maxEntries}`)
      }
      const totalChars = entries.reduce((total, entry) => total + entry.content.length, 0)
      if (totalChars + normalized.content.length > validatedLimits.maxChars) {
        throw new MemoryValidationError(`standing character budget is ${validatedLimits.maxChars}`)
      }

      const now = new Date().toISOString()
      const entry: StandingEntry = {
        id: randomUUID(),
        kind: normalized.kind as StandingKind,
        content: normalized.content,
        createdAt: now,
        updatedAt: now,
        provenance: normalized.provenance ?? { source: 'explicit' },
        schemaVersion: 1,
      }
      await this.table.put(entry.id, entry)
      return structuredClone(entry)
    })
  }

  list(): Promise<StandingEntry[]> {
    return this.writeChain.then(() => orderedEntries(this.table).map(entry => structuredClone(entry)))
  }

  remove(id: string): Promise<StandingEntry> {
    return this.enqueue(async () => {
      const existing = this.table.get(id)
      if (!existing) throw new MemoryNotFoundError()
      if (!await this.table.delete(id)) throw new MemoryNotFoundError()
      return structuredClone(existing)
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(job)
    this.writeChain = result.then(() => undefined, () => undefined)
    return result
  }
}

export function createStandingStore(table: KvTable<string, StandingEntry>): StandingStore {
  return new TableStandingStore(table)
}
