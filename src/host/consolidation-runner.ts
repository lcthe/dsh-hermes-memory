import type { Context } from '@deepseek-ai/cordis'
import type { MemoryRecord } from '../core/types.ts'
import { parseConsolidationOutput } from './consolidation-schema.ts'
import { buildConsolidationPrompt, CONSOLIDATION_OUTPUT_SCHEMA } from './consolidation-prompt.ts'
import { executeConsolidation, prepareConsolidation, type ConsolidationStorage } from './consolidation-executor.ts'

interface SubagentRun { result: Promise<{ stopReason: string; structured?: unknown }>; dispose(): Promise<void> }
type Agent = NonNullable<Context['agent']>
interface Subagents {
  start(name: string, request: { label: string; prompt: Array<{ type: 'text'; text: string }>; parent: Agent; signal: AbortSignal; outputSchema: object }): Promise<SubagentRun>
}

export async function runConsolidation(input: {
  id: string
  scope: MemoryRecord['scope']
  projectKey?: string
  records: readonly MemoryRecord[]
  targetChars: number
  provider: string
  parent: Agent
  subagents: Subagents
  storage: ConsolidationStorage
}): Promise<'completed' | 'empty' | 'failed'> {
  const controller = new AbortController()
  const run = await input.subagents.start(input.provider, {
    label: 'Hermes memory consolidation', parent: input.parent, signal: controller.signal,
    prompt: [{ type: 'text', text: buildConsolidationPrompt(input.records, input.targetChars) }],
    outputSchema: CONSOLIDATION_OUTPUT_SCHEMA,
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed' || result.structured === undefined) return 'failed'
    const plan = parseConsolidationOutput(result.structured)
    if (plan.groups.length === 0) return 'empty'
    const state = await prepareConsolidation({ ...input, plan })
    if (!state) return 'empty'
    await input.storage.states.put(state)
    await executeConsolidation(state, input.storage)
    return 'completed'
  } finally {
    await run.dispose()
  }
}
