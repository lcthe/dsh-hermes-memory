export type StoredSkillScope = 'user' | 'project'
export interface StoredSkill {
  id: string
  name: string
  description: string
  content: string
  scope: StoredSkillScope
  projectKey?: string
  createdAt: string
  updatedAt: string
  provenance: { source: 'explicit' | 'session'; sessionId?: string; flushedSeq?: number }
  schemaVersion: 1
}

export interface SkillStore {
  create(input: Omit<StoredSkill, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>): Promise<StoredSkill>
  list(projectKey?: string): Promise<StoredSkill[]>
  get(id: string): Promise<StoredSkill | undefined>
  update(id: string, patch: { description?: string; content?: string }): Promise<StoredSkill>
  remove(id: string): Promise<StoredSkill>
}
