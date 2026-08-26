import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WatermarkRepository } from './watermarks.ts'

export function extractSessionSequence(event: SessionEvent): number | undefined {
  return Number.isSafeInteger(event.seq) && event.seq >= 0 ? event.seq : undefined
}

export function installSessionCapture(
  ctx: Context,
  repository: WatermarkRepository,
): () => void {
  const pending = new Map<string, Promise<unknown>>()
  const onEvent = (session: Session, event: SessionEvent): void => {
    const seq = extractSessionSequence(event)
    if (seq === undefined) return
    const task = (pending.get(session.id) ?? Promise.resolve())
      .then(() => repository.observeEvent(session.id, seq))
      .catch((error: unknown) => {
        ctx.logger.warn(`dsh-hermes-memory: session watermark update failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    pending.set(session.id, task)
    void task.finally(() => {
      if (pending.get(session.id) === task) pending.delete(session.id)
    })
  }

  const onFlush = async (session: Session): Promise<void> => {
    try {
      await pending.get(session.id)
      const watermark = await repository.read(session.id)
      if (watermark === undefined || watermark.lastEventSeq < 0) return
      await repository.observeFlush(session.id, watermark.lastEventSeq)
    } catch (error: unknown) {
      ctx.logger.warn(`dsh-hermes-memory: session watermark flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const disposeEvent = ctx.on('session/event', onEvent)
  const disposeFlush = ctx.on('session/flush', onFlush)
  return () => {
    disposeEvent()
    disposeFlush()
  }
}
