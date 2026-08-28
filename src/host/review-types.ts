import type { MemoryCategory, MemoryScope } from '../core/types.ts'

export type ReviewStatus = 'running' | 'completed' | 'failed'

export interface ReviewState {
  sessionId: string
  requestedFlushedSeq: number
  completedFlushedSeq: number
  status: ReviewStatus
  attempt: number
  lastErrorCode?: string
  updatedAt: string
  schemaVersion: 1
}

export type ReviewOperationKind = 'save'
export type ReviewScope = MemoryScope
export type ReviewCategory = MemoryCategory

export interface ReviewOperation {
  kind: ReviewOperationKind
  scope: ReviewScope
  category: ReviewCategory
  content: string
  reason?: string
}

export interface ReviewOutput {
  operations: ReviewOperation[]
}

export interface ReviewProjection {
  sessionId: string
  projectKey?: string
  userText: string
  assistantText: string
  failures: string[]
}

export interface ReviewBudget {
  maxOperations: number
  maxContentChars: number
  maxInputChars: number
}
