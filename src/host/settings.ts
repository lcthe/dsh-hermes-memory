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
  captureToolContext: boolean
  captureMaxPerSession: number
  retentionEnabled: boolean
  retentionDays: number
  failureRetentionDays: number
  automaticInjection: boolean
  injectionLimit: number
  injectionMaxChars: number
  includeUserMemory: boolean
  includeProjectMemory: boolean
  standingContextEnabled: boolean
  standingMaxEntries: number
  standingMaxChars: number
  automaticConsolidation: boolean
  consolidationThresholdChars: number
  consolidationTargetChars: number
  consolidationMaxRecords: number
  consolidationMaxReplacements: number
  automaticReview: boolean
  reviewMaxPerSession: number
  reviewMaxInputChars: number
}

export const MemorySettingsSchema: z<MemorySettings> = z.object({
  enabled: z.boolean().default(true),
  defaultLimit: z.number().default(8),
  projectMemoryEnabled: z.boolean().default(true),
  automaticCapture: z.boolean().default(false),
  capturePreferences: z.boolean().default(true),
  captureConventions: z.boolean().default(true),
  captureCorrections: z.boolean().default(true),
  captureToolContext: z.boolean().default(true),
  captureMaxPerSession: z.number().default(5),
  retentionEnabled: z.boolean().default(true),
  retentionDays: z.number().default(90),
  failureRetentionDays: z.number().default(30),
  automaticInjection: z.boolean().default(false),
  injectionLimit: z.number().default(5),
  injectionMaxChars: z.number().default(3_000),
  includeUserMemory: z.boolean().default(true),
  includeProjectMemory: z.boolean().default(true),
  standingContextEnabled: z.boolean().default(true),
  standingMaxEntries: z.number().default(20),
  standingMaxChars: z.number().default(2_000),
  automaticConsolidation: z.boolean().default(false),
  consolidationThresholdChars: z.number().default(40_000),
  consolidationTargetChars: z.number().default(28_000),
  consolidationMaxRecords: z.number().default(100),
  consolidationMaxReplacements: z.number().default(20),
  automaticReview: z.boolean().default(false),
  reviewMaxPerSession: z.number().default(5),
  reviewMaxInputChars: z.number().default(12_000),
})

export function validateMemorySettings(value: MemorySettings): void {
  const reviewMaxPerSession = value.reviewMaxPerSession ?? 5
  const reviewMaxInputChars = value.reviewMaxInputChars ?? 12_000
  const standingMaxEntries = value.standingMaxEntries ?? 20
  const standingMaxChars = value.standingMaxChars ?? 2_000
  const consolidationThresholdChars = value.consolidationThresholdChars ?? 40_000
  const consolidationTargetChars = value.consolidationTargetChars ?? 28_000
  const consolidationMaxRecords = value.consolidationMaxRecords ?? 100
  const consolidationMaxReplacements = value.consolidationMaxReplacements ?? 20
  if (!Number.isInteger(value.defaultLimit) || value.defaultLimit < 1 || value.defaultLimit > 20) {
    throw new Error('memory defaultLimit must be an integer from 1 to 20')
  }
  if (!Number.isInteger(value.retentionDays) || value.retentionDays < 0 || value.retentionDays > 3650) {
    throw new Error('memory retentionDays must be an integer from 0 to 3650')
  }
  if (!Number.isInteger(value.captureMaxPerSession) || value.captureMaxPerSession < 1 || value.captureMaxPerSession > 20) {
    throw new Error('memory captureMaxPerSession must be an integer from 1 to 20')
  }
  if (!Number.isInteger(value.failureRetentionDays) || value.failureRetentionDays < 1 || value.failureRetentionDays > 3650) {
    throw new Error('memory failureRetentionDays must be an integer from 1 to 3650')
  }
  if (!Number.isInteger(value.injectionLimit) || value.injectionLimit < 1 || value.injectionLimit > 10) {
    throw new Error('memory injectionLimit must be an integer from 1 to 10')
  }
  if (!Number.isInteger(value.injectionMaxChars) || value.injectionMaxChars < 500 || value.injectionMaxChars > 8000) {
    throw new Error('memory injectionMaxChars must be an integer from 500 to 8000')
  }
  if (!Number.isInteger(reviewMaxPerSession) || reviewMaxPerSession < 1 || reviewMaxPerSession > 20) {
    throw new Error('memory reviewMaxPerSession must be an integer from 1 to 20')
  }
  if (!Number.isInteger(reviewMaxInputChars) || reviewMaxInputChars < 2_000 || reviewMaxInputChars > 30_000) {
    throw new Error('memory reviewMaxInputChars must be an integer from 2000 to 30000')
  }
  if (!Number.isInteger(standingMaxEntries) || standingMaxEntries < 1 || standingMaxEntries > 20) {
    throw new Error('memory standingMaxEntries must be an integer from 1 to 20')
  }
  if (!Number.isInteger(standingMaxChars) || standingMaxChars < 100 || standingMaxChars > 2_000) {
    throw new Error('memory standingMaxChars must be an integer from 100 to 2000')
  }
  if (!Number.isInteger(consolidationThresholdChars) || consolidationThresholdChars < 1_000 || consolidationThresholdChars > 1_000_000) {
    throw new Error('memory consolidationThresholdChars must be an integer from 1000 to 1000000')
  }
  if (!Number.isInteger(consolidationTargetChars) || consolidationTargetChars < 1_000 || consolidationTargetChars >= consolidationThresholdChars) {
    throw new Error('memory consolidationTargetChars must be below consolidationThresholdChars')
  }
  if (!Number.isInteger(consolidationMaxRecords) || consolidationMaxRecords < 2 || consolidationMaxRecords > 100) {
    throw new Error('memory consolidationMaxRecords must be an integer from 2 to 100')
  }
  if (!Number.isInteger(consolidationMaxReplacements) || consolidationMaxReplacements < 1 || consolidationMaxReplacements > 20) {
    throw new Error('memory consolidationMaxReplacements must be an integer from 1 to 20')
  }
}
