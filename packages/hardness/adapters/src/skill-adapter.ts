import type { HardnessService, CapabilityId } from '@deepseek-ai/dsh-hardness/src/types.ts'
import type { SkillRegistry, SkillSummary } from '@deepseek-ai/dsh-skill'

function skillCompatibility(skill: SkillSummary): readonly string[] {
  const compatibility = [`source:${skill.source}`]
  if (skill.invocation.modelInvocable) compatibility.push('invocation:model')
  if (skill.invocation.userInvocable) compatibility.push('invocation:user')
  if (skill.whenToUse?.trim()) compatibility.push('routing:when-to-use')
  return compatibility
}

/**
 * Project skill summaries into reversible HARDNESS registrations.
 * Skills receive their real semantic name as the capability kind so ATLAS can
 * distinguish hundreds of installed skills without making them executable by
 * declaration. They remain experimental until an execution contract/runner is
 * qualified by the one-pass pipeline.
 * @param skills - canonical skill registry queried for metadata-only summaries.
 * @param hardness - HARDNESS registry receiving projected descriptors.
 * @returns async disposer that retracts every projected skill capability.
 */
export async function indexSkills(skills: SkillRegistry, hardness: HardnessService): Promise<() => void> {
  const summaries = await skills.list()
  const disposers = summaries.map(skill => hardness.register({
    id: `skill:${skill.name}` as CapabilityId,
    kind: skill.name,
    name: skill.name,
    description: skill.description,
    inputs: [],
    outputs: [],
    dependencies: [],
    requiredPermissions: [],
    provider: skill.provider,
    location: skill.resourceBase?.kind ?? 'skill-registry',
    version: '1.0.0',
    compatibility: [...skillCompatibility(skill)],
    limitations: ['skill summary exposes no executable input/output schema'],
    modalities: ['native'],
    status: 'experimental',
  }).dispose)
  return () => { for (const dispose of disposers) dispose() }
}