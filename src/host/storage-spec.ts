import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryRecord, SessionWatermark } from '../core/types.ts'
import type { ReviewState } from './review-types.ts'

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
    flushedSeq: z.number().int().nonnegative().optional(),
    projectKey: z.string().min(1).optional(),
  }),
  schemaVersion: z.literal(1),
}) satisfies z.ZodType<MemoryRecord>

export const sessionWatermarkSchema = z.object({
  sessionId: z.string().min(1),
  lastEventSeq: z.number().int().gte(-1),
  lastFlushedSeq: z.number().int().gte(-1),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
}) satisfies z.ZodType<SessionWatermark>

export const reviewStateSchema = z.object({
  sessionId: z.string().min(1),
  requestedFlushedSeq: z.number().int().nonnegative(),
  completedFlushedSeq: z.number().int().gte(-1),
  status: z.union([z.literal('running'), z.literal('completed'), z.literal('failed')]),
  attempt: z.number().int().positive(),
  lastErrorCode: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
}) satisfies z.ZodType<ReviewState>

export const memoryDomainSpec = defineDomain({
  name: 'dsh_hermes_memory',
  version: 1,
  tables: {
    memories: domainTable<string, MemoryRecord>(memoryRecordSchema),
    watermarks: domainTable<string, SessionWatermark>(sessionWatermarkSchema),
    reviews: domainTable<string, ReviewState>(reviewStateSchema),
  },
})
