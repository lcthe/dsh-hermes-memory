import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export interface WorkspaceContext {
  projectKey?: string
  cwd?: string
}

export function resolveWorkspace(exec: ToolRunContext): WorkspaceContext {
  const cwd = typeof exec.agent?.session?.header?.cwd === 'string'
    ? exec.agent.session.header.cwd
    : undefined
  return {
    cwd,
    projectKey: cwd ? cwd : undefined,
  }
}

export function authorizeProjectKey(requested: string | undefined, current: WorkspaceContext): string | undefined {
  if (requested !== undefined && requested !== current.projectKey) {
    throw new Error('project memory is not authorized for this workspace')
  }
  return current.projectKey
}
