import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `loader/volatile-update` Context merge into this program.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'

import { MEMORY_SETTINGS_NAME } from '../settings-contract.ts'

export { MEMORY_SETTINGS_NAME }

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

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  defaultLimit: z.number().step(1).min(1).max(20).default(8).volatile(),
  projectMemoryEnabled: z.boolean().default(true).volatile(),
  automaticCapture: z.boolean().default(false).volatile(),
  capturePreferences: z.boolean().default(true).volatile(),
  captureConventions: z.boolean().default(true).volatile(),
  captureCorrections: z.boolean().default(true).volatile(),
  captureToolContext: z.boolean().default(true).volatile(),
  captureMaxPerSession: z.number().step(1).min(1).max(20).default(5).volatile(),
  retentionEnabled: z.boolean().default(true).volatile(),
  retentionDays: z.number().step(1).min(0).max(3650).default(90).volatile(),
  failureRetentionDays: z.number().step(1).min(1).max(3650).default(30).volatile(),
  automaticInjection: z.boolean().default(false).volatile(),
  injectionLimit: z.number().step(1).min(1).max(10).default(5).volatile(),
  injectionMaxChars: z.number().step(1).min(500).max(8_000).default(3_000).volatile(),
  includeUserMemory: z.boolean().default(true).volatile(),
  includeProjectMemory: z.boolean().default(true).volatile(),
  standingContextEnabled: z.boolean().default(true).volatile(),
  standingMaxEntries: z.number().step(1).min(1).max(20).default(20).volatile(),
  standingMaxChars: z.number().step(1).min(100).max(2_000).default(2_000).volatile(),
  automaticConsolidation: z.boolean().default(false).volatile(),
  consolidationThresholdChars: z.number().step(1).min(1_000).max(1_000_000).default(40_000).volatile(),
  consolidationTargetChars: z.number().step(1).min(1_000).max(1_000_000).default(28_000).volatile(),
  consolidationMaxRecords: z.number().step(1).min(2).max(100).default(100).volatile(),
  consolidationMaxReplacements: z.number().step(1).min(1).max(20).default(20).volatile(),
  automaticReview: z.boolean().default(false).volatile(),
  reviewMaxPerSession: z.number().step(1).min(1).max(20).default(5).volatile(),
  reviewMaxInputChars: z.number().step(1).min(2_000).max(30_000).default(12_000).volatile(),
})

/**
 * Resolved plugin Config: every field is a live reference, so consumers read
 * `.get()` when starting an operation instead of caching a snapshot.
 */
export type MemoryConfig = Schemastery.TypeT<typeof Config>

/** One resolved settings snapshot, detached from the live references. */
export function readMemorySettings(config: MemoryConfig): MemorySettings {
  return {
    enabled: config.enabled.get(),
    defaultLimit: config.defaultLimit.get(),
    projectMemoryEnabled: config.projectMemoryEnabled.get(),
    automaticCapture: config.automaticCapture.get(),
    capturePreferences: config.capturePreferences.get(),
    captureConventions: config.captureConventions.get(),
    captureCorrections: config.captureCorrections.get(),
    captureToolContext: config.captureToolContext.get(),
    captureMaxPerSession: config.captureMaxPerSession.get(),
    retentionEnabled: config.retentionEnabled.get(),
    retentionDays: config.retentionDays.get(),
    failureRetentionDays: config.failureRetentionDays.get(),
    automaticInjection: config.automaticInjection.get(),
    injectionLimit: config.injectionLimit.get(),
    injectionMaxChars: config.injectionMaxChars.get(),
    includeUserMemory: config.includeUserMemory.get(),
    includeProjectMemory: config.includeProjectMemory.get(),
    standingContextEnabled: config.standingContextEnabled.get(),
    standingMaxEntries: config.standingMaxEntries.get(),
    standingMaxChars: config.standingMaxChars.get(),
    automaticConsolidation: config.automaticConsolidation.get(),
    consolidationThresholdChars: config.consolidationThresholdChars.get(),
    consolidationTargetChars: config.consolidationTargetChars.get(),
    consolidationMaxRecords: config.consolidationMaxRecords.get(),
    consolidationMaxReplacements: config.consolidationMaxReplacements.get(),
    automaticReview: config.automaticReview.get(),
    reviewMaxPerSession: config.reviewMaxPerSession.get(),
    reviewMaxInputChars: config.reviewMaxInputChars.get(),
  }
}

/** Live settings face the runtime installers consume. */
export interface MemorySettingsSource {
  get(): MemorySettings
  watch(listener: () => void): () => void
}

/**
 * Bind the plugin's own Config section: reads resolve the current volatile
 * references, and `watch` follows the Loader's live configuration updates.
 * @param ctx - plugin context carrying the Loader's update event.
 * @param config - resolved plugin Config.
 * @returns the settings face shared by every installer.
 */
export function createMemorySettingsSource(ctx: Context, config: MemoryConfig): MemorySettingsSource {
  return {
    get: () => readMemorySettings(config),
    watch: listener => ctx.on('loader/volatile-update', () => { listener() }),
  }
}

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
