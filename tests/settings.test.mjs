import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMemorySettings } from '../src/host/settings.ts'

test('accepts bounded memory settings', () => {
  assert.doesNotThrow(() => validateMemorySettings({
    enabled: true,
    defaultLimit: 8,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 90,
    automaticInjection: false,
    injectionLimit: 5,
    injectionMaxChars: 3000,
    includeUserMemory: true,
    includeProjectMemory: true,
  }))
})

test('rejects unsafe setting limits', () => {
  const base = {
    enabled: true,
    defaultLimit: 8,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 90,
    automaticInjection: true,
    injectionLimit: 5,
    injectionMaxChars: 3000,
    includeUserMemory: true,
    includeProjectMemory: true,
  }
  assert.throws(() => validateMemorySettings({ ...base, defaultLimit: 21 }), /defaultLimit/)
  assert.throws(() => validateMemorySettings({ ...base, retentionDays: 3651 }), /retentionDays/)
  assert.throws(() => validateMemorySettings({ ...base, injectionLimit: 0 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...base, injectionLimit: 11 }), /injectionLimit/)
  assert.throws(() => validateMemorySettings({ ...base, injectionMaxChars: 499 }), /injectionMaxChars/)
  assert.throws(() => validateMemorySettings({ ...base, injectionMaxChars: 8001 }), /injectionMaxChars/)
})
