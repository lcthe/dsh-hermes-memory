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

function isUserMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message' && event.data.source?.kind === 'user'
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

function hasEventCandidate(entries: Entries, sessionId: string, seq: number, scope: MemoryRecord['scope']): boolean {
  for (const [, record] of entries) {
    if (record.provenance?.source !== 'session') continue
    if (record.provenance.sessionId !== sessionId) continue
    if (record.provenance.eventSeq !== seq) continue
    if (record.scope === scope) return true
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
  storage: MemoryStorage,
  repository: AutoCaptureRepository,
  settings: { get(): MemorySettings },
): Promise<void> {
  if (!isUserMessage(event)) return
  const value = settings.get()
  if (!value.enabled || !value.automaticCapture) return
  const text = extractText(event)
  if (text === undefined) return
  const candidates = detectCaptureCandidates(text)
  if (candidates.length === 0) return
  const candidate = candidates[0]

  const enabledForCategory = candidate.category === 'correction'
    ? value.captureCorrections
    : candidate.category === 'convention'
      ? value.captureConventions
      : value.capturePreferences
  if (!enabledForCategory) return

  let projectKey: string | undefined
  if (candidate.scope === 'project') {
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) return
    projectKey = cwd
  }

  const entries: Entries = [...storage.table.entries()].map(([key, record]) => [key, record])
  if (hasEventCandidate(entries, session.id, event.seq, candidate.scope)) return
  if (hasContentDuplicate(entries, candidate.scope, projectKey, candidate.text)) return
  if (countSessionCaptures(entries, session.id) >= value.captureMaxPerSession) return

  await repository.save({
    scope: candidate.scope,
    category: candidate.category,
    content: candidate.text,
    projectKey,
    provenance: { source: 'session', sessionId: session.id, eventSeq: event.seq, projectKey },
  })
}

export function installAutoCapture(
  ctx: Context,
  storage: MemoryStorage,
  repository: AutoCaptureRepository,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean {
  const pending = new Map<string, Promise<unknown>>()
  const onEvent = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'user/message') return
    const task = (pending.get(session.id) ?? Promise.resolve())
      .then(() => handleCapture(session, event, storage, repository, settings))
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