import type { Context } from '@deepseek-ai/cordis'
import type { MemoryRecord } from '../core/types.ts'
import type { MemoryStorage } from './storage.ts'
import type { MemorySettings } from './settings.ts'

export interface RetentionPolicy {
  retentionEnabled: boolean
  retentionDays: number
  failureRetentionDays: number
}

const DAY_MS = 86_400_000
const RETENTION_THROTTLE_MS = 60 * 60 * 1_000

function anchorOf(record: MemoryRecord): number | undefined {
  const value = record.lastReferencedAt ?? record.updatedAt
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function selectExpiredRecords(
  records: Iterable<MemoryRecord>,
  now: number,
  policy: RetentionPolicy,
): MemoryRecord[] {
  if (!policy.retentionEnabled) return []
  const expired: MemoryRecord[] = []
  for (const record of records) {
    const anchor = anchorOf(record)
    if (anchor === undefined) continue
    const thresholdDays = record.scope === 'failure'
      ? policy.failureRetentionDays
      : policy.retentionDays
    if (now - anchor > thresholdDays * DAY_MS) expired.push(record)
  }
  return expired
}

async function runSweep(
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): Promise<void> {
  const value = settings.get()
  if (!value.enabled || !value.retentionEnabled) return
  const records = [...storage.table.entries()].map(([, record]) => record)
  const expired = selectExpiredRecords(records, Date.now(), {
    retentionEnabled: true,
    retentionDays: value.retentionDays,
    failureRetentionDays: value.failureRetentionDays,
  })
  if (expired.length === 0) return

  let removed = 0
  for (const record of expired) {
    try {
      const deleted = await storage.table.delete(record.id)
      if (deleted) removed += 1
    } catch {
      // 单个记录失败不阻塞其他删除，也不记录正文
    }
  }
  logger.warn(`dsh-hermes-memory: retention removed ${removed} expired memories`)
}

export function installRetention(
  ctx: Context,
  storage: MemoryStorage,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean {
  let lastSweepAt = 0
  let inFlight = false

  const sweep = (): void => {
    if (inFlight) return
    const now = Date.now()
    if (now - lastSweepAt < RETENTION_THROTTLE_MS) return
    lastSweepAt = now
    inFlight = true
    void runSweep(storage, settings, logger)
      .catch(() => logger.warn('dsh-hermes-memory: retention sweep failed'))
      .finally(() => { inFlight = false })
  }

  sweep()
  return ctx.on('agent/session-start', sweep)
}