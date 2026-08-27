import type { ToolExecution, ToolResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { MemoryRepository } from '../core/memory-repository.ts'
import { MemoryBlockedError, MemoryNotFoundError } from '../core/memory-repository.ts'
import { MemoryValidationError } from '../core/validation.ts'
import type { MemoryCategory, MemoryScope } from '../core/types.ts'
import { MAX_LIST_CONTENT_CHARS } from '../core/validation.ts'
import { authorizeProjectKey, resolveWorkspace } from './workspace.ts'

export interface ToolContext {
  repository: MemoryRepository
  sessionQuery: SessionQueryEngine
  logger?: { warn(message: string): void }
}

export interface MemoryToolResult {
  success: boolean
  operation: 'save' | 'search' | 'list' | 'stats' | 'replace' | 'remove'
  record?: unknown
  records?: unknown[]
  total?: number
  stats?: unknown
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

function currentSessionId(exec: ToolRunContext): string | undefined {
  const id = exec.agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export async function saveMemory(args: {
  scope: MemoryScope
  category: MemoryCategory
  content: string
  projectKey?: string
}, exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const sessionId = currentSessionId(exec)
    const projectKey = args.scope === 'project'
      ? authorizeProjectKey(args.projectKey, resolveWorkspace(exec))
      : undefined
    const record = await context.repository.save({
      ...args,
      projectKey,
      provenance: { source: 'tool', ...(sessionId ? { sessionId } : {}), projectKey },
    })
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
    if (result.records.length > 0) {
      void context.repository.markReferenced(result.records.map(record => record.id)).catch(() => {
        context.logger?.warn('dsh-hermes-memory: memory reference timestamp update skipped')
      })
    }
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

export async function listMemory(args: {
  scope?: MemoryScope
  category?: MemoryCategory
  projectKey?: string
  limit?: number
}, exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const projectKey = args.projectKey === undefined ? currentProject(exec) : authorizeProjectKey(args.projectKey, resolveWorkspace(exec))
    const result = await context.repository.list({ ...args, projectKey })
    return {
      success: true,
      operation: 'list',
      records: result.records.map(record => ({
        ...record,
        content: record.content.length <= MAX_LIST_CONTENT_CHARS
          ? record.content
          : `${record.content.slice(0, MAX_LIST_CONTENT_CHARS - 1)}…`,
      })),
      total: result.total,
    }
  } catch (error) {
    return { success: false, operation: 'list', error: mapMemoryError(error) }
  }
}

export async function statsMemory(args: { projectKey?: string }, exec: ToolRunContext, context: ToolContext): Promise<MemoryToolResult> {
  try {
    const projectKey = args.projectKey === undefined ? currentProject(exec) : authorizeProjectKey(args.projectKey, resolveWorkspace(exec))
    const stats = await context.repository.getStats(projectKey)
    return { success: true, operation: 'stats', stats }
  } catch (error) {
    return { success: false, operation: 'stats', error: mapMemoryError(error) }
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
