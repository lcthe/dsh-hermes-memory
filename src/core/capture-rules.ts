import type { MemoryCategory, MemoryScope } from './types.ts'

export interface CaptureCandidate {
  scope: MemoryScope
  category: MemoryCategory
  text: string
}

export const CAPTURE_MIN_CHARS = 6
export const CAPTURE_MAX_CHARS = 1_000

const CORRECTION_SIGNALS = [
  '不对',
  '错了',
  '搞错了',
  '不是这样',
  '应该是',
  '应该用',
  '其实',
  '不要再',
  '以后别',
]

const CONVENTION_SIGNALS = [
  '这个项目',
  '本项目',
  '我们项目',
  '项目里',
]

const PREFERENCE_SIGNALS = [
  '以后',
  '下次',
  '请记住',
  '记住',
  '记得',
]

function hasSignal(text: string, signals: readonly string[]): boolean {
  return signals.some(signal => text.includes(signal))
}

export function detectCaptureCandidates(text: string): CaptureCandidate[] {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (trimmed.length < CAPTURE_MIN_CHARS || trimmed.length > CAPTURE_MAX_CHARS) return []

  if (hasSignal(trimmed, CORRECTION_SIGNALS)) {
    return [{ scope: 'failure', category: 'correction', text: trimmed }]
  }
  if (hasSignal(trimmed, CONVENTION_SIGNALS)) {
    return [{ scope: 'project', category: 'convention', text: trimmed }]
  }
  if (hasSignal(trimmed, PREFERENCE_SIGNALS)) {
    return [{ scope: 'user', category: 'preference', text: trimmed }]
  }
  return []
}