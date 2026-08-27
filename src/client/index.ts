import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MemorySettingsSection } from './MemorySettings.tsx'
import { en, NS, zh } from './locales.ts'
import type { MemoryLocaleKey } from './locales.ts'
import type { MemorySettings } from '../host/settings.ts'
import { MEMORY_SETTINGS_NAME } from '../settings-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'hermes-memory': MemoryLocaleKey
  }
}

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-hermes-memory: dictionaries')
  const t = ctx.locale.bind(NS)

  const scope = ctx.settingsScope.bind<MemorySettings>({ namespace: MEMORY_SETTINGS_NAME })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'hermes-memory',
    order: 45,
    label: () => t('tab'),
    locale: NS,
    inject: () => ({
      t,
      read: () => scope.getSnapshot().value ?? {
        enabled: true,
        defaultLimit: 8,
        projectMemoryEnabled: true,
        automaticCapture: false,
        capturePreferences: true,
        captureConventions: true,
        captureCorrections: true,
        captureMaxPerSession: 5,
        retentionDays: 90,
        automaticInjection: false,
        injectionLimit: 5,
        injectionMaxChars: 3000,
        includeUserMemory: true,
        includeProjectMemory: true,
      },
      update: async (patch: Partial<MemorySettings>) => {
        for (const [field, value] of Object.entries(patch)) await scope.set(field, value)
      },
    }),
  }, MemorySettingsSection))
}
