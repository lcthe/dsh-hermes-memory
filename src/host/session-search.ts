import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionQueryEngine, SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import { validateSearchInput } from '../core/validation.ts'
import { authorizeProjectKey, resolveWorkspace } from './workspace.ts'

export interface SessionMemorySearchArgs {
  query: string
  role?: 'user' | 'assistant'
  project?: string
  limit?: number
  snippetChars?: number
}

export interface SessionMemorySearchResult {
  success: boolean
  total: number
  results: Array<{
    sessionId: string
    project?: string
    role: 'user' | 'assistant'
    date?: string
    snippet: string
  }>
  error?: { code: string; message: string }
}

const MAX_SNIPPET_CHARS = 2_000

function normalize(args: SessionMemorySearchArgs): Required<Pick<SessionMemorySearchArgs, 'query' | 'limit' | 'snippetChars'>> & Omit<SessionMemorySearchArgs, 'query' | 'limit' | 'snippetChars'> {
  const base = validateSearchInput({ query: args.query, limit: args.limit })
  const snippetChars = args.snippetChars ?? 400
  if (!Number.isInteger(snippetChars) || snippetChars < 1) throw new Error('snippetChars is invalid')
  return { ...args, query: base.query, limit: base.limit, snippetChars: Math.min(snippetChars, MAX_SNIPPET_CHARS) }
}

function roleOf(hit: SessionSearchHit): 'user' | 'assistant' {
  return hit.bestMatch.type.includes('user') ? 'user' : 'assistant'
}

export async function searchSessionMemory(
  sessionQuery: SessionQueryEngine,
  exec: ToolRunContext,
  args: SessionMemorySearchArgs,
): Promise<SessionMemorySearchResult> {
  try {
    const normalized = normalize(args)
    const workspace = resolveWorkspace(exec)
    const project = authorizeProjectKey(normalized.project, workspace)
    const sessionFilters = project === undefined ? undefined : [{ kind: 'cwd', values: [project] }] as const
    const eventFilters = normalized.role === undefined ? undefined : [{ kind: 'type', values: [`${normalized.role}/message`] }] as const
    const page = await sessionQuery.searchSessions({
      query: normalized.query,
      sessionFilters,
      eventFilters,
      limit: normalized.limit,
    }, { signal: exec.signal })
    return {
      success: true,
      total: page.items.length,
      results: page.items.map((hit: SessionSearchHit) => ({
        sessionId: String(hit.header.id),
        project: hit.header.cwd,
        role: roleOf(hit),
        date: new Date(hit.bestMatch.time).toISOString(),
        snippet: hit.bestMatch.snippet.slice(0, normalized.snippetChars),
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'session query failed'
    const code = message.includes('not authorized')
      ? 'session_scope_denied'
      : message.includes('required') || message.includes('invalid')
        ? 'invalid_args'
        : 'session_query_failed'
    return { success: false, total: 0, results: [], error: { code, message: code === 'session_query_failed' ? 'session query failed' : message } }
  }
}
