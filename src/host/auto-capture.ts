import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { MemoryRecord } from '../core/types.ts'
import { CAPTURE_MAX_CHARS, detectCaptureCandidates } from '../core/capture-rules.ts'
import type { MemoryStorage } from './storage.ts'
import type { MemorySettings } from './settings.ts'

export interface AutoCaptureRepository {
  save(input: {
    scope: MemoryRecord['scope']
    category: MemoryRecord['category']
    content: string
    projectKey?: string
    provenance?: MemoryRecord['provenance']
  }): Promise<MemoryRecord>
}

type Entries = Array<[string, MemoryRecord]>

interface SessionCaptureState {
  lastUserSeq: number
  lastToolCall?: { callId: string; name: string }
  lastFailure?: { toolName: string; errorSeq: number }
}

function newState(): SessionCaptureState {
  return { lastUserSeq: -1 }
}

function isUserMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message' && event.data.source?.kind === 'user'
}

function isToolCall(event: SessionEvent): event is SessionEvent<'tool/call'> {
  return event.type === 'tool/call'
}

function isToolResult(event: SessionEvent): event is SessionEvent<'tool/result'> {
  return event.type === 'tool/result'
}

function extractText(event: SessionEvent<'user/message'>): string | undefined {
  let text = ''
  for (const block of event.data.content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type !== 'text') continue
    if (typeof candidate.text === 'string') text += candidate.text
  }
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return trimmed.length > CAPTURE_MAX_CHARS ? trimmed.slice(0, CAPTURE_MAX_CHARS) : trimmed
}

function hasEventCandidate(entries: Entries, sessionId: string, seq: number, scope: MemoryRecord['scope'], category: MemoryRecord['category']): boolean {
  for (const [, record] of entries) {
    if (record.provenance?.source !== 'session') continue
    if (record.provenance.sessionId !== sessionId) continue
    if (record.provenance.eventSeq !== seq) continue
    if (record.scope !== scope) continue
    if (record.category !== category) continue
    return true
  }
  return false
}

function hasContentDuplicate(entries: Entries, scope: MemoryRecord['scope'], projectKey: string | undefined, content: string): boolean {
  for (const [, record] of entries) {
    if (record.scope !== scope) continue
    if (record.projectKey !== projectKey) continue
    if (record.content === content) return true
  }
  return false
}

function countSessionCaptures(entries: Entries, sessionId: string): number {
  let count = 0
  for (const [, record] of entries) {
    if (record.provenance?.source !== 'session') continue
    if (record.provenance.sessionId !== sessionId) continue
    if (record.provenance.eventSeq === undefined) continue
    count += 1
  }
  return count
}

async function handleCapture(
  session: Session,
  event: SessionEvent,
  state: SessionCaptureState,
  storage: MemoryStorage,
  repository: AutoCaptureRepository,
  settings: { get(): MemorySettings },
): Promise<void> {
  if (isToolCall(event)) {
    state.lastToolCall = { callId: event.data.callId, name: event.data.name }
    return
  }
  if (isToolResult(event)) {
    if (event.data.error !== undefined) {
      const callId = (event.data.message as { source?: { callId?: unknown } } | undefined)?.source?.callId
      if (typeof callId === 'string' && state.lastToolCall?.callId === callId) {
        state.lastFailure = { toolName: state.lastToolCall.name, errorSeq: event.seq }
      }
    }
    state.lastToolCall = undefined
    return
  }
  if (!isUserMessage(event)) return

  const value = settings.get()
  if (!value.enabled || !value.automaticCapture) {
    state.lastUserSeq = event.seq
    return
  }

  const text = extractText(event)
  if (text === undefined) {
    state.lastUserSeq = event.seq
    return
  }
  const candidates = detectCaptureCandidates(text)
  if (candidates.length === 0) {
    state.lastUserSeq = event.seq
    return
  }
  const candidate = candidates[0]

  const enabledForCategory = candidate.category === 'correction'
    ? value.captureCorrections
    : candidate.category === 'convention'
      ? value.captureConventions
      : value.capturePreferences
  if (!enabledForCategory) {
    state.lastUserSeq = event.seq
    return
  }

  let projectKey: string | undefined
  if (candidate.scope === 'project') {
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      state.lastUserSeq = event.seq
      return
    }
    projectKey = cwd
  }

  const seq = event.seq
  const entries: Entries = [...storage.table.entries()].map(([key, record]) => [key, record])
  const underCap = countSessionCaptures(entries, session.id) < value.captureMaxPerSession
  if (underCap) {
    const dupe = hasEventCandidate(entries, session.id, seq, candidate.scope, candidate.category)
      || hasContentDuplicate(entries, candidate.scope, projectKey, candidate.text)
    if (!dupe) {
      await repository.save({
        scope: candidate.scope,
        category: candidate.category,
        content: candidate.text,
        projectKey,
        provenance: { source: 'session', sessionId: session.id, eventSeq: seq, projectKey },
      })
    }
  }

  if (
    candidate.scope === 'failure'
    && candidate.category === 'correction'
    && value.captureToolContext
    && state.lastFailure !== undefined
    && state.lastFailure.errorSeq > state.lastUserSeq
  ) {
    const toolContent = `用户在对工具 ${state.lastFailure.toolName} 失败后纠正：${candidate.text}`
    const toolEntries: Entries = [...storage.table.entries()].map(([key, record]) => [key, record])
    if (countSessionCaptures(toolEntries, session.id) < value.captureMaxPerSession) {
      const dupe = hasEventCandidate(toolEntries, session.id, seq, 'failure', 'tool-quirk')
        || hasContentDuplicate(toolEntries, 'failure', projectKey, toolContent)
      if (!dupe) {
        await repository.save({
          scope: 'failure',
          category: 'tool-quirk',
          content: toolContent,
          projectKey,
          provenance: { source: 'session', sessionId: session.id, eventSeq: seq, projectKey },
        })
      }
    }
  }

  state.lastUserSeq = seq
}

export function installAutoCapture(
  ctx: Context,
  storage: MemoryStorage,
  repository: AutoCaptureRepository,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean {
  const pending = new Map<string, Promise<unknown>>()
  const stateBySession = new Map<string, SessionCaptureState>()
  const onEvent = (session: Session, event: SessionEvent): void => {
    const task = (pending.get(session.id) ?? Promise.resolve())
      .then(() => {
        const state = stateBySession.get(session.id) ?? newState()
        stateBySession.set(session.id, state)
        return handleCapture(session, event, state, storage, repository, settings)
      })
      .catch(() => {
        logger.warn('dsh-hermes-memory: automatic capture skipped')
      })
    pending.set(session.id, task)
    void task.finally(() => {
      if (pending.get(session.id) === task) pending.delete(session.id)
    })
  }
  return ctx.on('session/event', onEvent)
}