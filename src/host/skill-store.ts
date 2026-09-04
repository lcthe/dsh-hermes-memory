import { randomUUID } from 'node:crypto'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { scanContent } from '../core/content-scanner.ts'
import type { SkillStore, StoredSkill } from './skill-types.ts'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_DESCRIPTION = 160
const MAX_CONTENT = 8_000

function validate(input: { name?: string; description?: string; content?: string }): void {
  if (input.name !== undefined && !NAME.test(input.name)) throw new Error('skill name must be kebab-case')
  if (input.description !== undefined && (input.description.trim().length === 0 || input.description.length > MAX_DESCRIPTION)) throw new Error('skill description is invalid')
  if (input.content !== undefined && (input.content.trim().length === 0 || input.content.length > MAX_CONTENT || !scanContent(input.content).allowed)) throw new Error('skill content is invalid or unsafe')
}

export function createSkillStore(table: KvTable<string, StoredSkill>): SkillStore {
  return {
    async create(input) {
      validate(input)
      const existing = (await this.list(input.projectKey)).find(skill => skill.name === input.name && skill.scope === input.scope)
      if (existing) throw new Error('skill name already exists in this scope')
      const now = new Date().toISOString()
      const skill: StoredSkill = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now, schemaVersion: 1 }
      await table.put(skill.id, skill)
      return structuredClone(skill)
    },
    async list(projectKey) {
      return [...table.entries()].map(([, skill]) => skill).filter(skill => skill.scope === 'user' || skill.projectKey === projectKey).sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)).map(skill => structuredClone(skill))
    },
    async get(id) { const skill = table.get(id); return skill && structuredClone(skill) },
    async update(id, patch) {
      validate(patch)
      const skill = table.get(id)
      if (!skill) throw new Error('skill was not found')
      const updated = { ...skill, ...patch, updatedAt: new Date().toISOString() }
      await table.put(id, updated)
      return structuredClone(updated)
    },
    async remove(id) {
      const skill = table.get(id)
      if (!skill || !(await table.delete(id))) throw new Error('skill was not found')
      return structuredClone(skill)
    },
  }
}
