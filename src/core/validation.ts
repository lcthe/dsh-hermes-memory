import {
  MEMORY_CATEGORIES,
  MEMORY_SCOPES,
  type MemoryCategory,
  type MemoryInput,
  type MemoryScope,
  type MemorySearchInput,
} from './types.ts'

export const MAX_MEMORY_CONTENT_LENGTH = 5_000
export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 20

export class MemoryValidationError extends Error {
  readonly code = 'invalid_args'
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && MEMORY_SCOPES.includes(value as MemoryScope)
}

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && MEMORY_CATEGORIES.includes(value as MemoryCategory)
}

export function validateMemoryInput(input: MemoryInput): MemoryInput {
  if (!input || typeof input !== 'object') throw new MemoryValidationError('memory input is required')
  if (!isMemoryScope(input.scope)) throw new MemoryValidationError('memory scope is invalid')
  if (!isMemoryCategory(input.category)) throw new MemoryValidationError('memory category is invalid')
  if (typeof input.content !== 'string') throw new MemoryValidationError('memory content is required')

  const content = input.content.trim()
  if (!content) throw new MemoryValidationError('memory content is required')
  if (content.length > MAX_MEMORY_CONTENT_LENGTH) {
    throw new MemoryValidationError(`memory content exceeds ${MAX_MEMORY_CONTENT_LENGTH} characters`)
  }

  const projectKey = input.projectKey?.trim() || undefined
  if (input.scope === 'project' && !projectKey) {
    throw new MemoryValidationError('project memory requires a project key')
  }

  return { ...input, content, projectKey }
}

export function validateSearchInput(input: MemorySearchInput): Required<Pick<MemorySearchInput, 'query' | 'limit'>> & Omit<MemorySearchInput, 'query' | 'limit'> {
  if (!input || typeof input !== 'object') throw new MemoryValidationError('search input is required')
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw new MemoryValidationError('search query is required')
  if (input.scope !== undefined && !isMemoryScope(input.scope)) throw new MemoryValidationError('memory scope is invalid')
  if (input.category !== undefined && !isMemoryCategory(input.category)) throw new MemoryValidationError('memory category is invalid')
  const rawLimit = input.limit ?? DEFAULT_SEARCH_LIMIT
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new MemoryValidationError('search limit is invalid')
  const limit = Math.min(rawLimit, MAX_SEARCH_LIMIT)
  return { ...input, query, limit }
}
