import type { HardnessService, CapabilityId } from '@deepseek-ai/dsh-hardness/src/types.ts'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'

/** Project skill summaries into reversible HARDNESS registrations. */
export async function indexSkills(skills: SkillRegistry, hardness: HardnessService): Promise<() => void> {
  const summaries = await skills.list()
  const disposers = summaries.map(skill => hardness.register({
    id: `skill:${skill.name}` as CapabilityId,
    kind: 'skill',
    name: skill.name,
    description: skill.description,
    inputs: [],
    outputs: [],
    dependencies: [],
    requiredPermissions: [],
    provider: skill.provider,
    location: skill.resourceBase?.kind ?? 'skill-registry',
    version: '1.0.0',
    compatibility: [],
    limitations: [],
    status: 'experimental',
  }).dispose)
  return () => { for (const dispose of disposers) dispose() }
}
