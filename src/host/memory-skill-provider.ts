import type { Context } from '@deepseek-ai/cordis'
import type { SkillStore, StoredSkill } from './skill-types.ts'

interface SkillRegistry {
  registerProvider(factory: (control: { invalidate(): void }) => { name: string; list(options: { cwd?: string }): Promise<unknown[]>; get(candidate: { locator?: unknown }, options: { cwd?: string }): Promise<unknown> }): () => void
}

function visible(skill: StoredSkill, cwd?: string): boolean {
  return skill.scope === 'user' || skill.projectKey === cwd
}

export function installMemorySkillProvider(ctx: Context, store: SkillStore): () => void {
  const skills = (ctx as Context & { skills?: SkillRegistry }).skills
  if (!skills) return () => undefined
  return skills.registerProvider(control => ({
    name: 'hermes-memory',
    async list(options) {
      return (await store.list(options.cwd)).filter(skill => visible(skill, options.cwd)).map(skill => ({
        name: skill.name, description: skill.description, source: skill.scope === 'project' ? 'project-dsh' : 'user-dsh', provider: 'hermes-memory', rank: skill.scope === 'project' ? 450 : 500, locator: skill.id,
        invocation: { modelInvocable: true, userInvocable: true },
      }))
    },
    async get(candidate, options) {
      const skill = await store.get(String(candidate.locator))
      if (!skill || !visible(skill, options.cwd)) return undefined
      return { name: skill.name, description: skill.description, content: skill.content, source: skill.scope === 'project' ? 'project-dsh' : 'user-dsh', provider: 'hermes-memory', invocation: { modelInvocable: true, userInvocable: true } }
    },
  }))
}
