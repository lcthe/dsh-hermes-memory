import type { ScanResult } from './types.ts'

interface Rule {
  id: string
  reason: NonNullable<ScanResult['reason']>
  pattern: RegExp
}

const RULES: readonly Rule[] = [
  { id: 'secret-api-key', reason: 'secret', pattern: /(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{16,})/ },
  { id: 'secret-bearer-token', reason: 'secret', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { id: 'secret-private-key', reason: 'secret', pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/ },
  { id: 'secret-connection-string', reason: 'secret', pattern: /(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/i },
  { id: 'invisible-control', reason: 'invisible-character', pattern: /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/ },
  { id: 'prompt-injection-override', reason: 'prompt-injection', pattern: /ignore\s+(?:all|any|the)?\s*(?:previous|prior|above|earlier)?\s*(?:instructions|rules|directions)/i },
  { id: 'prompt-injection-system-role', reason: 'prompt-injection', pattern: /(?:system|developer)\s+(?:message|instruction)\s*:/i },
  { id: 'exfiltration-sensitive-path', reason: 'exfiltration', pattern: /(?:cat|curl|wget)\s+[^\n]*(?:\.ssh|\.env|credentials|secret)/i },
]

export function scanContent(content: string): ScanResult {
  for (const rule of RULES) {
    if (rule.pattern.test(content)) return { allowed: false, reason: rule.reason, ruleId: rule.id }
  }
  return { allowed: true }
}
