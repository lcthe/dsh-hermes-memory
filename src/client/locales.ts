export const NS = 'hermes-memory'

export const zh = {
  tab: '记忆',
  description: '管理 DSH 的持久记忆、安全扫描和检索策略。',
  enabled: '启用记忆工具',
  projectMemoryEnabled: '启用项目记忆',
  automaticCapture: '自动捕获（V1 暂不可用）',
  automaticInjection: '新会话自动注入记忆',
  includeUserMemory: '注入用户记忆',
  includeProjectMemory: '注入项目记忆',
  injectionLimit: '最多注入条数',
  injectionMaxChars: '注入内容最大字符数',
  injectionNote: '自动注入默认关闭；开启后只在会话启动时注入有限的参考记忆，不会自动捕获新记忆。',
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
  automaticInjection: 'Inject memory at session start',
  includeUserMemory: 'Include user memories',
  includeProjectMemory: 'Include project memories',
  injectionLimit: 'Maximum injected entries',
  injectionMaxChars: 'Maximum injected characters',
  injectionNote: 'Automatic injection is off by default. When enabled, a bounded reference context is added once at session start; new memories are not captured automatically.',
  defaultLimit: 'Default retrieval limit',
  retentionDays: 'Retention days',
  disabledNote: 'When disabled, memory tools are not registered for the current Agent.',
  automaticNote: 'Automatic capture will be added in a later version and remains off.',
} as const

export type MemoryLocaleKey = keyof typeof zh
