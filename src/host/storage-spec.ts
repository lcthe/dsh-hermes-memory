import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryRecord } from '../core/types.ts'

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  scope: z.union([z.literal('global'), z.literal('user'), z.literal('project'), z.literal('failure')]),
  category: z.union([
    z.literal('preference'),
    z.literal('convention'),
    z.literal('insight'),
    z.literal('failure'),
    z.literal('correction'),
    z.literal('tool-quirk'),
  ]),
  content: z.string().min(1),
  projectKey: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastReferencedAt: z.string().datetime().optional(),
  provenance: z.object({
    source: z.union([z.literal('explicit'), z.literal('session'), z.literal('tool'), z.literal('import')]),
    sessionId: z.string().min(1).optional(),
    eventSeq: z.number().int().nonnegative().optional(),
    projectKey: z.string().min(1).optional(),
  }),
  schemaVersion: z.literal(1),
}) satisfies z.ZodType<MemoryRecord>

export const memoryDomainSpec = defineDomain({
  name: 'dsh_hermes_memory',
  version: 1,
  tables: {
    memories: domainTable<string, MemoryRecord>(memoryRecordSchema),
  },
})
