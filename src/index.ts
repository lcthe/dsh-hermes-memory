import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { openMemoryStorage, StorageMemoryRepository } from './host/storage.ts'
import { createMemoryTools } from './host/tool-definitions.ts'
import { installSessionCapture } from './host/session-capture.ts'
import { validateMemorySettings, MemorySettingsSchema, MEMORY_SETTINGS_NS } from './host/settings.ts'

export const name = '@lcthe/dsh-hermes-memory'
export const inject = ['storageDomain', 'tools', 'settings', 'sessionQuery']

export async function apply(ctx: Context): Promise<void> {
  const settings = ctx.settings.register(MEMORY_SETTINGS_NS, MemorySettingsSchema, {
    applies: 'live',
    validate: validateMemorySettings,
  })
  const storage = await openMemoryStorage(ctx)
  const repository = new StorageMemoryRepository(storage)
  const tools = createMemoryTools({ repository, sessionQuery: ctx.sessionQuery })
  const disposeSessionCapture = installSessionCapture(ctx, storage.watermarks)

  let disposers: Array<() => void> = []
  const syncTools = (): void => {
    for (const dispose of disposers) dispose()
    disposers = settings.get().enabled
      ? tools.map(tool => ctx.tools.register(tool as ToolDefinition))
      : []
  }
  syncTools()
  const stopWatch = settings.watch(() => { syncTools() })
  ctx.effect(() => () => {
    stopWatch()
    disposeSessionCapture()
    for (const dispose of disposers) dispose()
  }, 'dshHermesMemory.tools')
}
