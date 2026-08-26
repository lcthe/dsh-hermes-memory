import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionWatermark } from '../core/types.ts'

export interface WatermarkRepository {
  read(sessionId: string): Promise<SessionWatermark | undefined>
  observeEvent(sessionId: string, seq: number): Promise<SessionWatermark>
  observeFlush(sessionId: string, seq: number): Promise<SessionWatermark>
}

function now(): string {
  return new Date().toISOString()
}

function initial(sessionId: string): SessionWatermark {
  return { sessionId, lastEventSeq: -1, lastFlushedSeq: -1, updatedAt: now(), schemaVersion: 1 }
}

function assertSeq(seq: number): void {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('watermark sequence must be a non-negative safe integer')
}

export class TableWatermarkRepository implements WatermarkRepository {
  constructor(private readonly table: KvTable<string, SessionWatermark>) {}

  async read(sessionId: string): Promise<SessionWatermark | undefined> {
    const value = this.table.get(sessionId)
    return value === undefined ? undefined : structuredClone(value)
  }

  async observeEvent(sessionId: string, seq: number): Promise<SessionWatermark> {
    assertSeq(seq)
    const current = this.table.get(sessionId) ?? initial(sessionId)
    if (seq <= current.lastEventSeq) return structuredClone(current)
    const next = { ...current, lastEventSeq: seq, updatedAt: now() }
    await this.table.put(sessionId, next)
    return structuredClone(next)
  }

  async observeFlush(sessionId: string, seq: number): Promise<SessionWatermark> {
    assertSeq(seq)
    const current = this.table.get(sessionId) ?? initial(sessionId)
    if (seq > current.lastEventSeq) throw new Error('flush sequence cannot exceed observed event sequence')
    if (seq <= current.lastFlushedSeq) return structuredClone(current)
    const next = { ...current, lastFlushedSeq: seq, updatedAt: now() }
    await this.table.put(sessionId, next)
    return structuredClone(next)
  }
}

export class InMemoryWatermarkRepository implements WatermarkRepository {
  private readonly values = new Map<string, SessionWatermark>()
  private readonly table = {
    get: (key: string) => this.values.get(key),
    put: async (key: string, value: SessionWatermark) => { this.values.set(key, value) },
  } as unknown as KvTable<string, SessionWatermark>
  private readonly delegate = new TableWatermarkRepository(this.table)

  read(sessionId: string): Promise<SessionWatermark | undefined> { return this.delegate.read(sessionId) }
  observeEvent(sessionId: string, seq: number): Promise<SessionWatermark> { return this.delegate.observeEvent(sessionId, seq) }
  observeFlush(sessionId: string, seq: number): Promise<SessionWatermark> { return this.delegate.observeFlush(sessionId, seq) }
}
