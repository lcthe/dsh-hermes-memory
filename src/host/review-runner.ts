import type { MemoryInput, MemoryRecord } from '../core/types.ts'
import { validateMemoryInput } from '../core/validation.ts'
import type { MemoryRepository } from '../core/memory-repository.ts'
import { scanContent } from '../core/content-scanner.ts'
import type { ReviewBudget, ReviewOperation, ReviewOutput } from './review-types.ts'

export interface ReviewRunContext {
  sessionId: string
  projectKey?: string
  flushedSeq: number
}

export interface ReviewRunResult {
  accepted: number
  skipped: number
  failed: number
}

export interface ReviewRunDeps {
  scanner?: Pick<typeof import('../core/content-scanner.ts'), 'scanContent'>
  repository: Pick<MemoryRepository, 'save' | 'search'>
  budget: ReviewBudget
}

function sameRecord(record: MemoryRecord, input: MemoryInput): boolean {
  return record.scope === input.scope
    && record.category === input.category
    && record.projectKey === input.projectKey
    && record.content === input.content
}

export async function applyReviewOperations(
  output: ReviewOutput,
  context: ReviewRunContext,
  deps: ReviewRunDeps,
): Promise<ReviewRunResult> {
  let accepted = 0
  let skipped = 0
  let failed = 0
  let chars = 0

  for (const operation of output.operations) {
    try {
      if (operation.scope === 'project' && !context.projectKey) {
        skipped += 1
        continue
      }
      if (operation.scope === 'failure'
        && !['failure', 'correction', 'tool-quirk'].includes(operation.category)) {
        skipped += 1
        continue
      }
      if (operation.scope !== 'failure'
        && operation.category === 'tool-quirk') {
        skipped += 1
        continue
      }
      if (chars + operation.content.length > deps.budget.maxContentChars * deps.budget.maxOperations) {
        skipped += 1
        continue
      }
      const projectKey = operation.scope === 'project' ? context.projectKey : undefined
      const input: MemoryInput = {
        scope: operation.scope,
        category: operation.category,
        content: operation.content,
        ...(projectKey ? { projectKey } : {}),
        provenance: {
          source: 'session',
          sessionId: context.sessionId,
          flushedSeq: context.flushedSeq,
          ...(projectKey ? { projectKey } : {}),
        },
      }
      const normalized = validateMemoryInput(input)
      const scan = scanContent(normalized.content)
      if (!scan.allowed) {
        skipped += 1
        continue
      }
      const existing = await deps.repository.search({
        query: normalized.content,
        scope: normalized.scope,
        category: normalized.category,
        projectKey: normalized.projectKey,
        limit: 20,
      })
      if (existing.records.some(record => sameRecord(record, normalized))) {
        skipped += 1
        continue
      }
      await deps.repository.save(normalized)
      accepted += 1
      chars += normalized.content.length
    } catch {
      failed += 1
    }
  }

  return { accepted, skipped, failed }
}
