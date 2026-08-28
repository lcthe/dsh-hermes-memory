import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ReviewState } from './review-types.ts'

export interface ReviewStateStore {
  get(sessionId: string): Promise<ReviewState | undefined>
  put(state: ReviewState): Promise<void>
}

export function createReviewStateStore(table: KvTable<string, ReviewState>): ReviewStateStore {
  return {
    async get(sessionId) {
      return table.get(sessionId)
    },
    async put(state) {
      await table.put(state.sessionId, state)
    },
  }
}

export function newReviewState(
  sessionId: string,
  requestedFlushedSeq: number,
  nowIso: string,
): ReviewState {
  return {
    sessionId,
    requestedFlushedSeq,
    completedFlushedSeq: -1,
    status: 'running',
    attempt: 1,
    updatedAt: nowIso,
    schemaVersion: 1,
  }
}

export function shouldStartReview(
  current: ReviewState | undefined,
  flushedSeq: number,
): boolean {
  if (!Number.isSafeInteger(flushedSeq) || flushedSeq < 0) return false
  if (current === undefined) return true
  if (current.status === 'running') return false
  if (current.status === 'completed') return flushedSeq > current.completedFlushedSeq
  return flushedSeq > current.requestedFlushedSeq
}

export function completeReviewState(
  current: ReviewState,
  flushedSeq: number,
  nowIso: string,
): ReviewState {
  return {
    ...current,
    status: 'completed',
    completedFlushedSeq: Math.max(current.completedFlushedSeq, flushedSeq),
    updatedAt: nowIso,
    lastErrorCode: undefined,
  }
}

export function failReviewState(
  current: ReviewState,
  errorCode: string,
  nowIso: string,
): ReviewState {
  return {
    ...current,
    status: 'failed',
    lastErrorCode: errorCode,
    updatedAt: nowIso,
  }
}
