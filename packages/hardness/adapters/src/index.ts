import type { Context } from '@deepseek-ai/cordis'
import type { HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { indexSkills } from './skill-adapter.ts'
import { indexTools } from './tool-adapter.ts'

export { indexTools } from './tool-adapter.ts'
export { indexSkills } from './skill-adapter.ts'

/** Base-composition consumer that projects existing registries into HARDNESS. */
export const name = 'hardness-adapters'
export const inject = ['hardness', 'tools', 'skills']

export async function apply(ctx: Context): Promise<() => void> {
  const hardness = ctx.get('hardness') as HardnessService | undefined
  const tools = ctx.get('tools')
  const skills = ctx.get('skills')
  if (hardness === undefined || tools === undefined || skills === undefined) {
    throw new Error('hardness-adapters requires hardness, tools, and skills services')
  }
  const disposeTools = indexTools(tools, hardness)
  try {
    const disposeSkills = await indexSkills(skills, hardness)
    return () => { disposeSkills(); disposeTools() }
  } catch (error) {
    disposeTools()
    throw error
  }
}
