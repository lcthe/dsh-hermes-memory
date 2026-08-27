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
  capturePreferences: boolean
  captureConventions: boolean
  captureCorrections: boolean
  captureMaxPerSession: number
  retentionDays: number
  automaticInjection: boolean
  injectionLimit: number
  injectionMaxChars: number
  includeUserMemory: boolean
  includeProjectMemory: boolean
}

export const MemorySettingsSchema: z<MemorySettings> = z.object({
  enabled: z.boolean().default(true),
  defaultLimit: z.number().default(8),
  projectMemoryEnabled: z.boolean().default(true),
  automaticCapture: z.boolean().default(false),
  capturePreferences: z.boolean().default(true),
  captureConventions: z.boolean().default(true),
  captureCorrections: z.boolean().default(true),
  captureMaxPerSession: z.number().default(5),
  retentionDays: z.number().default(90),
  automaticInjection: z.boolean().default(false),
  injectionLimit: z.number().default(5),
  injectionMaxChars: z.number().default(3_000),
  includeUserMemory: z.boolean().default(true),
  includeProjectMemory: z.boolean().default(true),
})

export function validateMemorySettings(value: MemorySettings): void {
  if (!Number.isInteger(value.defaultLimit) || value.defaultLimit < 1 || value.defaultLimit > 20) {
    throw new Error('memory defaultLimit must be an integer from 1 to 20')
  }
  if (!Number.isInteger(value.retentionDays) || value.retentionDays < 0 || value.retentionDays > 3650) {
    throw new Error('memory retentionDays must be an integer from 0 to 3650')
  }
  if (!Number.isInteger(value.captureMaxPerSession) || value.captureMaxPerSession < 1 || value.captureMaxPerSession > 20) {
    throw new Error('memory captureMaxPerSession must be an integer from 1 to 20')
  }
  if (!Number.isInteger(value.injectionLimit) || value.injectionLimit < 1 || value.injectionLimit > 10) {
    throw new Error('memory injectionLimit must be an integer from 1 to 10')
  }
  if (!Number.isInteger(value.injectionMaxChars) || value.injectionMaxChars < 500 || value.injectionMaxChars > 8000) {
    throw new Error('memory injectionMaxChars must be an integer from 500 to 8000')
  }
}
