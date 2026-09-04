import type { MemoryRecord } from '../core/types.ts'

export const CONSOLIDATION_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['groups'], properties: {
    groups: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['sourceIds', 'category', 'content'], properties: {
        sourceIds: { type: 'array', minItems: 2, items: { type: 'string' } },
        category: { type: 'string', enum: ['preference', 'convention', 'insight', 'failure', 'correction', 'tool-quirk'] },
        content: { type: 'string', maxLength: 2000 },
      },
    } },
  },
} as const

export function buildConsolidationPrompt(records: readonly MemoryRecord[], targetChars: number): string {
  const input = records.map(record => ({ id: record.id, scope: record.scope, category: record.category, content: record.content, projectKey: record.projectKey }))
  return [
    'Consolidate only the supplied ordinary memory records.',
    'Return JSON matching the output schema. Group only records that express the same or overlapping fact.',
    'Do not invent facts, change scope, include standing context, or include records in more than one group.',
    'Each group needs at least two sourceIds. Omit records that should remain unchanged.',
    `The projected total must fit within ${targetChars} characters.`,
    JSON.stringify(input),
  ].join('\n\n')
}
