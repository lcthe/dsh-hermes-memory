import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ReviewBudget, ReviewProjection } from './review-types.ts'
import { REVIEW_OUTPUT_SCHEMA, validateReviewOutput } from './review-schema.ts'
import { buildReviewSystemPrompt, buildReviewUserPrompt } from './review-prompt.ts'
import {
  completeReviewState,
  failReviewState,
  newReviewState,
  shouldStartReview,
} from './review-state.ts'
import type { MemorySettings } from './settings.ts'
import type { MemoryStorage } from './storage.ts'
import { applyReviewOperations } from './review-runner.ts'
import { scanContent } from '../core/content-scanner.ts'

const MIN_REVIEW_INPUT_CHARS = 6

interface JobHooks {
  cancel(reason?: string): void
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>
}

type AgentLike = NonNullable<Context['agent']>

interface JobRegistryLike {
  start(spec: {
    kind: string
    label: string
    owner?: AgentLike
    run(): JobHooks
  }): string
  kill(id: string, caller?: AgentLike, reason?: string): 'requested' | 'already-finished'
  wait(id: string, timeoutMs: number, caller?: AgentLike, signal?: AbortSignal): Promise<unknown>
}

interface SubagentRunLike {
  result: Promise<{
    stopReason: string
    structured?: unknown
  }>
  dispose(): Promise<void>
}

interface SubagentRuntimeLike {
  list(): string[]
  getProvider(name: string): { capabilities: { outputSchema: boolean } } | undefined
  start(name: string, request: {
    label: string
    prompt: Array<{ type: 'text'; text: string }>
    parent: AgentLike
    signal: AbortSignal
    outputSchema: object
  }): Promise<SubagentRunLike>
}

interface ReviewContext extends Context {}

interface ActiveReview {
  controller: AbortController
  jobId: string
  owner: AgentLike
}

export interface AutoReviewScheduleInput {
  enabled: boolean
  automaticReview: boolean
  flushedSeq: number
  hasProvider: boolean
  current: Parameters<typeof shouldStartReview>[0]
}

export function shouldScheduleReview(input: AutoReviewScheduleInput): boolean {
  if (!input.enabled || !input.automaticReview || !input.hasProvider) return false
  return shouldStartReview(input.current, input.flushedSeq)
}

function textFromEvent(event: SessionEvent): string {
  const data = event.data as { content?: unknown; message?: unknown }
  const values: unknown[] = []
  if (Array.isArray(data.content)) values.push(...data.content)
  if (Array.isArray(data.message)) values.push(...data.message)
  if (typeof data.message === 'object' && data.message !== null) {
    const message = data.message as { content?: unknown }
    if (Array.isArray(message.content)) values.push(...message.content)
  }
  let result = ''
  for (const block of values) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') result += candidate.text
  }
  return result
}

function safeProjectionText(value: string, maxChars: number): string {
  const trimmed = value.slice(0, maxChars)
  return scanContent(trimmed).allowed ? trimmed : '[content omitted by safety scanner]'
}

function sessionProjection(session: Session, budget: ReviewBudget): ReviewProjection {
  const users: string[] = []
  const assistants: string[] = []
  const failures: string[] = []
  for (const event of session.events) {
    if (event.type === 'user/message') users.push(textFromEvent(event))
    if (event.type === 'assistant/message') assistants.push(textFromEvent(event))
    if (event.type === 'tool/result') {
      const data = event.data as { error?: unknown; message?: unknown }
      if (data.error !== undefined) {
        const message = typeof data.error === 'string'
          ? data.error
          : typeof data.message === 'string' ? data.message : 'tool failure'
        failures.push(message.slice(0, 500))
      }
    }
  }
  const projectKey = typeof session.header.cwd === 'string' ? session.header.cwd : undefined
  return {
    sessionId: String(session.id),
    projectKey,
    userText: safeProjectionText(users.filter(Boolean).join('\n'), budget.maxInputChars),
    assistantText: safeProjectionText(assistants.filter(Boolean).join('\n'), budget.maxInputChars),
    failures: failures.map(value => safeProjectionText(value, 500)).filter(value => value !== '[content omitted by safety scanner]'),
  }
}

function pickProvider(subagents: SubagentRuntimeLike): string | undefined {
  for (const name of subagents.list()) {
    if (subagents.getProvider(name)?.capabilities.outputSchema) return name
  }
  return undefined
}

function toBudget(settings: MemorySettings): ReviewBudget {
  return {
    maxOperations: settings.reviewMaxPerSession ?? 5,
    maxContentChars: 1_000,
    maxInputChars: settings.reviewMaxInputChars ?? 12_000,
  }
}

export function installAutoReview(
  rawCtx: Context,
  storage: MemoryStorage,
  repository: Parameters<typeof applyReviewOperations>[2]['repository'],
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => void {
  const ctx = rawCtx as ReviewContext
  const active = new Map<string, ActiveReview>()

  const schedule = (session: Session): void => {
    try {
      const currentSettings = settings.get()
      const subagents = ctx.get('subagents') as SubagentRuntimeLike | undefined
      const jobs = ctx.get('jobs') as JobRegistryLike | undefined
      const agents = ctx.get('agents') as { get(id: string): AgentLike | undefined } | undefined
      const owner = agents?.get(String(session.id) as SessionId)
      if (subagents === undefined || jobs === undefined || owner === undefined) return
      const provider = pickProvider(subagents)
      const budget = toBudget(currentSettings)
      const flushedSeq = session.events.at(-1)?.seq ?? -1
      const currentPromise = storage.reviews.get(String(session.id))
      void currentPromise.then(current => {
        if (!shouldScheduleReview({
          enabled: currentSettings.enabled,
          automaticReview: currentSettings.automaticReview,
          flushedSeq,
          hasProvider: provider !== undefined,
          current,
        })) return
        if (active.has(String(session.id))) return

        const controller = new AbortController()
        const sessionKey = String(session.id)
        const now = new Date().toISOString()
        const running = newReviewState(String(session.id), flushedSeq, now)
        const projection = sessionProjection(session, budget)
        const inputChars = projection.userText.length
          + projection.assistantText.length
          + projection.failures.join('').length
        if (inputChars < MIN_REVIEW_INPUT_CHARS) return
        let resolveDone!: (value: { status: 'completed' | 'killed' | 'failed'; detail?: string }) => void
        const done = new Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>(resolve => { resolveDone = resolve })
        const jobId = jobs.start({
          kind: 'subagent',
          label: 'Hermes memory review',
          owner,
          run: () => ({
            cancel: reason => controller.abort(reason),
            done,
          }),
        })
        active.set(sessionKey, { controller, jobId, owner })

        void (async () => {
          await storage.reviews.put(running)
          try {
            const run = await subagents.start(provider!, {
              label: 'Hermes memory review',
              prompt: [{
                type: 'text',
                text: `${buildReviewSystemPrompt()}\n\n${buildReviewUserPrompt(projection, budget)}`,
              }],
              parent: owner,
              signal: controller.signal,
              outputSchema: REVIEW_OUTPUT_SCHEMA,
            })
            try {
              const result = await run.result
              if (result.stopReason !== 'completed' || result.structured === undefined) {
                await storage.reviews.put(failReviewState(running, `subagent_${result.stopReason}`, new Date().toISOString()))
                resolveDone({ status: result.stopReason === 'aborted' ? 'killed' : 'failed', detail: result.stopReason })
                return
              }
              const validated = validateReviewOutput(result.structured, budget)
              if (!validated.ok) {
                await storage.reviews.put(failReviewState(running, `invalid_output_${validated.reason}`, new Date().toISOString()))
                resolveDone({ status: 'failed', detail: validated.reason })
                return
              }
              const outcome = await applyReviewOperations(validated.output, {
                sessionId: String(session.id),
                projectKey: projection.projectKey,
                flushedSeq,
              }, { repository, budget })
              await storage.reviews.put(completeReviewState(running, flushedSeq, new Date().toISOString()))
              logger.warn(`dsh-hermes-memory: review completed accepted=${outcome.accepted} skipped=${outcome.skipped} failed=${outcome.failed}`)
              resolveDone({ status: 'completed' })
            } finally {
              await run.dispose().catch(() => undefined)
            }
          } catch {
            await storage.reviews.put(failReviewState(running, 'review_failed', new Date().toISOString())).catch(() => undefined)
            resolveDone({ status: 'failed', detail: 'review_failed' })
            logger.warn('dsh-hermes-memory: background review skipped')
          } finally {
            active.delete(sessionKey)
          }
        })().catch(() => {
          active.delete(sessionKey)
          resolveDone({ status: 'failed', detail: 'review_failed' })
        })
      }).catch(() => {
        logger.warn('dsh-hermes-memory: background review skipped')
      })
    } catch {
      logger.warn('dsh-hermes-memory: background review skipped')
    }
  }

  const disposeFlush = ctx.on('session/flush', (session: Session) => {
    schedule(session)
  })
  return () => {
    disposeFlush()
    const jobs = ctx.get('jobs') as JobRegistryLike | undefined
    for (const review of active.values()) {
      review.controller.abort('plugin disposed')
      try { jobs?.kill(review.jobId, review.owner, 'plugin disposed') } catch { /* already detached */ }
      void jobs?.wait(review.jobId, 5_000, review.owner).catch(() => undefined)
    }
    active.clear()
  }
}
