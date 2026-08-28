import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMemorySettings } from '../src/host/settings.ts'

const valid = {
  enabled: true,
  defaultLimit: 8,
  projectMemoryEnabled: true,
  automaticCapture: false,
  capturePreferences: true,
  captureConventions: true,
  captureCorrections: true,
  captureToolContext: true,
  captureMaxPerSession: 5,
  retentionEnabled: true,
  retentionDays: 90,
  failureRetentionDays: 30,
  automaticInjection: false,
  injectionLimit: 5,
  injectionMaxChars: 3000,
  includeUserMemory: true,
  includeProjectMemory: true,
  automaticReview: false,
  reviewMaxPerSession: 5,
  reviewMaxInputChars: 12000,
}

test('accepts bounded memory settings', () => {
  assert.doesNotThrow(() => validateMemorySettings(valid))
  assert.doesNotThrow(() => validateMemorySettings({ ...valid, automaticCapture: true, captureMaxPerSession: 20 }))
})

test('rejects unsafe setting limits', () => {
  assert.throws(() => validateMemorySettings({ ...valid, defaultLimit: 21 }), /defaultLimit/)
  assert.throws(() => validateMemorySettings({ ...valid, retentionDays: 3651 }), /retentionDays/)
  assert.throws(() => validateMemorySettings({ ...valid, injectionLimit: 0 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...valid, injectionLimit: 11 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...valid, injectionMaxChars: 499 }), /injectionMaxChars/)
  assert.throws(() => validateMemorySettings({ ...valid, injectionMaxChars: 8001 }), /injectionMaxChars/)
  assert.throws(() => validateMemorySettings({ ...valid, captureMaxPerSession: 0 }), /captureMaxPerSession/)
  assert.throws(() => validateMemorySettings({ ...valid, captureMaxPerSession: 21 }), /captureMaxPerSession/)
  assert.throws(() => validateMemorySettings({ ...valid, failureRetentionDays: 0 }), /failureRetentionDays/)
  assert.throws(() => validateMemorySettings({ ...valid, failureRetentionDays: 3651 }), /failureRetentionDays/)
  assert.throws(() => validateMemorySettings({ ...valid, reviewMaxPerSession: 0 }), /reviewMaxPerSession/)
  assert.throws(() => validateMemorySettings({ ...valid, reviewMaxPerSession: 21 }), /reviewMaxPerSession/)
  assert.throws(() => validateMemorySettings({ ...valid, reviewMaxInputChars: 1999 }), /reviewMaxInputChars/)
  assert.throws(() => validateMemorySettings({ ...valid, reviewMaxInputChars: 30001 }), /reviewMaxInputChars/)
})