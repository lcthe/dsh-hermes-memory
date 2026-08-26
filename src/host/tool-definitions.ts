import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MEMORY_CATEGORIES, MEMORY_SCOPES } from '../core/types.ts'
import { searchSessionMemory } from './session-search.ts'
import {
  removeMemory,
  renderMemoryResult,
  replaceMemory,
  saveMemory,
  searchMemory,
  type ToolContext,
} from './tools.ts'

const scopeSchema = { type: 'string', enum: MEMORY_SCOPES } as const
const categorySchema = { type: 'string', enum: MEMORY_CATEGORIES } as const
const outputSchema = {
  type: 'object',
  additionalProperties: true,
} as const

function asJsonResult(value: unknown): Record<string, JsonValue> {
  return value as Record<string, JsonValue>
}

export function createMemoryTools(context: ToolContext) {
  return [
    defineTool({
      name: 'memory_save',
      description: 'Save one safe, scoped memory for future DSH sessions.',
      parameters: {
        scope: { ...scopeSchema, required: true },
        category: { ...categorySchema, required: true },
        content: { type: 'string', required: true },
        projectKey: { type: 'string' },
      },
      output: { schema: outputSchema, render: renderMemoryResult },
      execute: async (args, exec) => asJsonResult(await saveMemory(args, exec, context)),
    }),
    defineTool({
      name: 'memory_search',
      description: 'Search safe persistent memories visible to the current DSH workspace.',
      parameters: {
        query: { type: 'string', required: true },
        scope: scopeSchema,
        category: categorySchema,
        projectKey: { type: 'string' },
        limit: { type: 'integer' },
      },
      output: { schema: outputSchema, render: renderMemoryResult },
      execute: async (args, exec) => asJsonResult(await searchMemory(args, exec, context)),
    }),
    defineTool({
      name: 'memory_replace',
      description: 'Replace the content of one persistent memory by stable ID.',
      parameters: {
        id: { type: 'string', required: true },
        content: { type: 'string', required: true },
        category: categorySchema,
      },
      output: { schema: outputSchema, render: renderMemoryResult },
      execute: async (args, exec) => asJsonResult(await replaceMemory(args, exec, context)),
    }),
    defineTool({
      name: 'memory_remove',
      description: 'Remove one persistent memory by stable ID.',
      parameters: {
        id: { type: 'string', required: true },
      },
      output: { schema: outputSchema, render: renderMemoryResult },
      execute: async (args, exec) => asJsonResult(await removeMemory(args, exec, context)),
    }),
    defineTool({
      name: 'session_memory_search',
      description: 'Search historical DSH sessions through the native session query service.',
      parameters: {
        query: { type: 'string', required: true },
        role: { type: 'string', enum: ['user', 'assistant'] },
        project: { type: 'string' },
        limit: { type: 'integer' },
        snippetChars: { type: 'integer' },
      },
      output: { schema: outputSchema, render: renderMemoryResult },
      execute: async (args, exec) => asJsonResult(await searchSessionMemory(context.sessionQuery, exec, args)),
    }),
  ]
}

export type MemoryTool = ReturnType<typeof createMemoryTools>[number]
export type MemoryToolExecutor = (args: unknown, exec: ToolRunContext) => Promise<unknown>
