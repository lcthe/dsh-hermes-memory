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
  }))
})

test('rejects unsafe setting limits', () => {
  assert.throws(() => validateMemorySettings({
    enabled: true,
    defaultLimit: 21,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 90,
  }), /defaultLimit/)
  assert.throws(() => validateMemorySettings({
    enabled: true,
    defaultLimit: 8,
    projectMemoryEnabled: true,
    automaticCapture: false,
    retentionDays: 3651,
  }), /retentionDays/)
})
