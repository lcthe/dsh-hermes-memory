export const NS = 'hermes-memory'

export const zh = {
  tab: '记忆',
  description: '管理 DSH 的持久记忆、安全扫描和检索策略。',
  enabled: '启用记忆工具',
  projectMemoryEnabled: '启用项目记忆',
  automaticCapture: '自动捕获（V1 暂不可用）',
  defaultLimit: '默认检索条数',
  retentionDays: '保留天数',
  disabledNote: '关闭后，记忆工具不会注册到当前 Agent。',
  automaticNote: '自动捕获将在后续版本提供，当前保持关闭。',
} as const

export const en = {
  tab: 'Memory',
  description: 'Manage persistent DSH memory, safety scanning, and retrieval policy.',
  enabled: 'Enable memory tools',
  projectMemoryEnabled: 'Enable project memory',
  automaticCapture: 'Automatic capture (not available in V1)',
  defaultLimit: 'Default retrieval limit',
  retentionDays: 'Retention days',
  disabledNote: 'When disabled, memory tools are not registered for the current Agent.',
  automaticNote: 'Automatic capture will be added in a later version and remains off.',
} as const

export type MemoryLocaleKey = keyof typeof zh
