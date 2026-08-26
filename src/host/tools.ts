import type { ToolExecution, ToolResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MemoryRepository } from '../core/memory-repository.ts'
import { MemoryBlockedError, MemoryNotFoundError } from '../core/memory-repository.ts'
import { MemoryValidationError } from '../core/validation.ts'
import type { MemoryCategory, MemoryScope } from '../core/types.ts'
import { authorizeProjectKey, resolveWorkspace } from './workspace.ts'

export interface ToolContext {
  repository: MemoryRepository
}

export interface MemoryToolResult {
  success: boolean
  operation: 'save' | 'search' | 'replace' | 'remove'
  record?: unknown
  records?: unknown[]
  total?: number
  error?: { code: string; message: string }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'memory operation failed'
}

export function mapMemoryError(error: unknown): { code: string; message: string } {
  if (error instanceof MemoryValidationError) return { code: 'invalid_args', message: error.message }
  if (error instanceof MemoryBlockedError) return { code: 'blocked_content', message: 'content was blocked by the memory safety scanner' }
  if (error instanceof MemoryNotFoundError) return { code: 'not_found', message: error.message }
  if (error instanceof Error && error.message.includes('not authorized')) return { code: 'unauthorized_scope', message: error.message }
  return { code: 'storage_unavailable', message: messageOf(error) }
}

function currentProject(exec: ToolRunContext): string | undefined {
  return resolveWorkspace(exec).projectKey
}

export async function saveMemory(args: {
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
}, exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const projectKey = args.scope === 'project' ? authorizeProjectKey(args.projectKey, resolveWorkspace(exec)) : undefined
    const record = await context.repository.save({ ...args, projectKey, provenance: { source: 'tool', projectKey } })
    return { success: true, operation: 'save', record }
  } catch (error) {
    return { success: false, operation: 'save', error: mapMemoryError(error) }
  }
}

export async function searchMemory(args: {
  query: string
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}, exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const projectKey = args.projectKey === undefined ? currentProject(exec) : authorizeProjectKey(args.projectKey, resolveWorkspace(exec))
    const result = await context.repository.search({ ...args, projectKey })
    return { success: true, operation: 'search', records: result.records, total: result.total }
  } catch (error) {
    return { success: false, operation: 'search', error: mapMemoryError(error) }
  }
}

export async function replaceMemory(args: {
  id: string
  content: string
  category?: MemoryCategory
}, _exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const record = await context.repository.replace(args.id, args.content, args.category)
    return { success: true, operation: 'replace', record }
  } catch (error) {
    return { success: false, operation: 'replace', error: mapMemoryError(error) }
  }
}

export async function removeMemory(args: { id: string }, _exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const record = await context.repository.remove(args.id)
    return { success: true, operation: 'remove', record }
  } catch (error) {
    return { success: false, operation: 'remove', error: mapMemoryError(error) }
  }
}

export function renderMemoryResult(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function presentMemoryCall(_args: unknown): undefined {
  return undefined
}

export function presentMemoryResult(_args: unknown, _result: ToolResult): undefined {
  return undefined
}

export function memoryToolExecution(exec: ToolExecution): ToolRunContext {
  return exec as ToolRunContext
}
