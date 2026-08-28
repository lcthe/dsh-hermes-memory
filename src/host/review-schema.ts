import type { ReviewBudget, ReviewCategory, ReviewOperation, ReviewOutput, ReviewScope } from './review-types.ts'

const SCOPES: readonly ReviewScope[] = ['global', 'user', 'project', 'failure']
const CATEGORIES: readonly ReviewCategory[] = [
  'preference',
  'convention',
  'insight',
  'failure',
  'correction',
  'tool-quirk',
]

export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'scope', 'category', 'content'],
        properties: {
          kind: { type: 'string', const: 'save' },
          scope: { type: 'string', enum: [...SCOPES] },
          category: { type: 'string', enum: [...CATEGORIES] },
          content: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateReviewOutput(
  value: unknown,
  budget: ReviewBudget,
): { ok: true; output: ReviewOutput } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'invalid_root' }
  if (!Object.keys(value).every(key => key === 'operations')) return { ok: false, reason: 'unknown_field' }
  const raw = value.operations
  if (!Array.isArray(raw)) return { ok: false, reason: 'invalid_operations' }
  if (raw.length > budget.maxOperations) return { ok: false, reason: 'too_many_operations' }

  const operations: ReviewOperation[] = []
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, reason: 'invalid_operation' }
    if (!Object.keys(item).every(key => ['kind', 'scope', 'category', 'content', 'reason'].includes(key))) {
      return { ok: false, reason: 'unknown_operation_field' }
    }
    if (item.kind !== 'save') return { ok: false, reason: 'invalid_kind' }
    if (typeof item.scope !== 'string' || !SCOPES.includes(item.scope as ReviewScope)) {
      return { ok: false, reason: 'invalid_scope' }
    }
    if (typeof item.category !== 'string' || !CATEGORIES.includes(item.category as ReviewCategory)) {
      return { ok: false, reason: 'invalid_category' }
    }
    if (typeof item.content !== 'string' || item.content.trim().length === 0) {
      return { ok: false, reason: 'invalid_content' }
    }
    if (item.content.length > budget.maxContentChars) return { ok: false, reason: 'content_too_long' }
    if (item.reason !== undefined && typeof item.reason !== 'string') {
      return { ok: false, reason: 'invalid_reason' }
    }
    operations.push({
      kind: 'save',
      scope: item.scope as ReviewScope,
      category: item.category as ReviewCategory,
      content: item.content.trim(),
      ...(typeof item.reason === 'string' && item.reason.trim()
        ? { reason: item.reason.trim().slice(0, 500) }
        : {}),
    })
  }
  return { ok: true, output: { operations } }
}
