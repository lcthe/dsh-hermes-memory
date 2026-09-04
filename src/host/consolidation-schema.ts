import { z } from 'zod'
import type { ConsolidationPlan } from './consolidation-types.ts'

const categories = ['preference', 'convention', 'insight', 'failure', 'correction', 'tool-quirk'] as const
const groupSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(2),
  category: z.enum(categories),
  content: z.string().trim().min(1).max(2_000),
}).strict()
const planSchema = z.object({ groups: z.array(groupSchema).max(20) }).strict()

export function parseConsolidationOutput(value: unknown): ConsolidationPlan {
  const parsed = planSchema.parse(value)
  const ids = new Set<string>()
  for (const group of parsed.groups) {
    for (const id of group.sourceIds) {
      if (ids.has(id)) throw new Error('consolidation source appears in multiple groups')
      ids.add(id)
    }
  }
  return structuredClone(parsed)
}
