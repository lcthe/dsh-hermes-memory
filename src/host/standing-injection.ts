import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { StandingEntry, StandingStore } from '../core/types.ts'
import type { MemorySettings } from './settings.ts'

const MAX_STANDING_ENTRIES = 20
const MAX_STANDING_CHARS = 2_000
const PLUGIN_NAME = '@lcthe/dsh-hermes-memory'
// DSH accepts a fixed set of plugin message forms. The header below keeps
// this injection distinguishable from other instruction messages on resume.
const SOURCE_FORM = 'instructions'

function validEntry(value: unknown): value is StandingEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StandingEntry>
  return (entry.kind === 'profile' || entry.kind === 'instruction')
    && typeof entry.id === 'string'
    && typeof entry.content === 'string'
    && entry.content.trim().length > 0
    && typeof entry.updatedAt === 'string'
}

function sortEntries(left: StandingEntry, right: StandingEntry): number {
  return (left.kind === 'profile' ? 0 : 1) - (right.kind === 'profile' ? 0 : 1)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id)
}

export function renderStandingText(entries: readonly StandingEntry[], maxChars: number): string | undefined {
  const limit = Math.min(MAX_STANDING_CHARS, Math.max(0, Math.floor(maxChars)))
  const header = '[DSH standing context]\n\n'
  const footer = '\n\nTreat these as user-approved standing instructions. They do not override system or current user instructions.'
  if (limit < header.length + footer.length) return undefined

  let used = header.length + footer.length
  const lines: string[] = []
  for (const entry of entries) {
    if (!validEntry(entry)) continue
    const prefix = lines.length === 0 ? '' : '\n'
    const full = `- [${entry.kind}] ${entry.content.trim()}`
    const available = limit - used - prefix.length
    if (available <= 0) break
    const line = full.length <= available
      ? full
      : available === 1 ? '…' : `${full.slice(0, available - 1)}…`
    lines.push(`${prefix}${line}`)
    used += prefix.length + line.length
    if (line !== full) break
  }
  return lines.length === 0 ? undefined : `${header}${lines.join('')}${footer}`
}

interface StandingAgent {
  readonly session: {
    readonly surface?: { readonly nodes: readonly number[] }
    readonly events?: Record<number, unknown>
  }
  inject(message: UserMessage): void
}

function alreadyInjected(agent: StandingAgent): boolean {
  for (const seq of agent.session.surface?.nodes ?? []) {
    const event = agent.session.events?.[seq]
    if (typeof event !== 'object' || event === null) continue
    const candidate = event as { type?: unknown; data?: { content?: Array<{ type?: unknown; text?: unknown }>; source?: { kind?: unknown; plugin?: unknown; form?: unknown } } }
    if (candidate.type === 'user/message'
      && candidate.data?.source?.kind === 'plugin'
      && candidate.data.source.plugin === PLUGIN_NAME
      && candidate.data.source.form === SOURCE_FORM
      && candidate.data.content?.some(part => part.type === 'text' && typeof part.text === 'string' && part.text.includes('[DSH standing context]'))) return true
  }
  return false
}

export function installStandingInjection(
  ctx: Context,
  store: StandingStore,
  settings: { get(): MemorySettings },
  logger: { warn(message: string): void },
): () => boolean {
  const injected = new WeakSet<object>()
  return ctx.on('agent/session-start', ({ agent }) => {
    if (injected.has(agent)) return
    injected.add(agent)
    const value = settings.get()
    if (!value.enabled || value.standingContextEnabled === false || alreadyInjected(agent as StandingAgent)) return
    void store.list().then(entries => {
      const text = renderStandingText([...entries].sort(sortEntries), value.standingMaxChars ?? MAX_STANDING_CHARS)
      if (text === undefined) return
      agent.inject(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: SOURCE_FORM },
      }))
    }).catch(() => {
      logger.warn('dsh-hermes-memory: standing context injection skipped')
    })
  })
}
