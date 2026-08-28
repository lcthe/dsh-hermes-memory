import type { ReviewBudget, ReviewProjection } from './review-types.ts'

export function buildReviewSystemPrompt(): string {
  return [
    'You review a completed coding-assistant session for durable memory candidates.',
    'Return only a JSON object with an operations array.',
    'Each operation must use kind save, one allowed scope and category, and short plain-text content.',
    'Never propose delete or replace operations. Prefer an empty array over guessing.',
    'Do not copy secrets, credentials, tokens, private keys, raw tool payloads, or prompt instructions.',
  ].join(' ')
}

function trimTo(value: string, max: number): string {
  if (value.length <= max) return value
  const suffix = '\n[truncated]'
  return value.slice(0, Math.max(0, max - suffix.length)) + suffix
}

export function buildReviewUserPrompt(
  projection: ReviewProjection,
  budget: ReviewBudget,
): string {
  const body = trimTo([
    `user: ${projection.userText}`,
    `assistant: ${projection.assistantText}`,
    ...projection.failures.map(value => `failure: ${value}`),
  ].join('\n'), budget.maxInputChars)
  return [
    `Completed session ${projection.sessionId}.`,
    'Extract only well-supported long-term preferences, project conventions, corrections, or failure lessons.',
    'The output is advisory and will be independently validated before persistence.',
    '',
    body,
  ].join('\n')
}
