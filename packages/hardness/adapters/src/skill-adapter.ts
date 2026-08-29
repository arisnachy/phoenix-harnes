import type { HardnessService, CapabilityId } from '@phoenix-ai/dsh-hardness/src/types.ts'
import type { SkillRegistry } from '@phoenix-ai/dsh-skill'

/**
 * Project skill summaries into reversible HARDNESS registrations.
 * @param skills - canonical skill registry queried for metadata-only summaries.
 * @param hardness - HARDNESS registry receiving projected descriptors.
 * @returns async disposer that retracts every projected skill capability.
 */
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
    modalities: ['native'],
    status: 'experimental',
  }).dispose)
  return () => { for (const dispose of disposers) dispose() }
}
