import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

import { MEMORY_SETTINGS_NAME } from '../settings-contract.ts'

export { MEMORY_SETTINGS_NAME }
export const MEMORY_SETTINGS_NS = settingsNamespace(MEMORY_SETTINGS_NAME)

export interface MemorySettings {
  enabled: boolean
  defaultLimit: number
  projectMemoryEnabled: boolean
  automaticCapture: boolean
  retentionDays: number
}

export const MemorySettingsSchema: z<MemorySettings> = z.object({
  enabled: z.boolean().default(true),
  defaultLimit: z.number().default(8),
  projectMemoryEnabled: z.boolean().default(true),
  automaticCapture: z.boolean().default(false),
  retentionDays: z.number().default(90),
})

export function validateMemorySettings(value: MemorySettings): void {
  if (!Number.isInteger(value.defaultLimit) || value.defaultLimit < 1 || value.defaultLimit > 20) {
    throw new Error('memory defaultLimit must be an integer from 1 to 20')
  }
  if (!Number.isInteger(value.retentionDays) || value.retentionDays < 0 || value.retentionDays > 3650) {
    throw new Error('memory retentionDays must be an integer from 0 to 3650')
  }
}
