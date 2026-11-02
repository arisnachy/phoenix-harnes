import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  defineTool,
  ToolArgsError,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_DESCRIPTION = 1_000
const MAX_WHEN = 2_000
const MAX_INSTRUCTIONS = 64_000

/** Stable text-only procedure accepted by the learned-skill store. */
export interface LearnedSkillInput {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly instructions: string
  readonly replace?: boolean
}

/** Receipt returned after writing a persistent user skill. */
export interface LearnedSkillReceipt {
  readonly name: string
  readonly path: string
  readonly replaced: boolean
}

function bounded(value: string, field: string, max: number): string {
  const text = value.trim()
  if (text.length === 0 || text.length > max) {
    throw new Error(`${field} must contain 1-${max} characters`)
  }
  return text
}

/**
 * Safe text-only promotion store for procedures Phoenix has already completed
 * successfully. It writes only SKILL.md instructions; it never writes scripts,
 * executables, credentials, connector configuration, or permission grants.
 */
export class LearnedSkillStore {
  constructor(readonly root = join(homedir(), '.dsh', 'skills')) {}

  /**
   * Persist one validated user skill under the ordinary ~/.dsh/skills layout.
   * @param input - Reusable procedure and explicit replacement intent.
   * @returns Path and identity of the written skill.
   */
  async learn(input: LearnedSkillInput): Promise<LearnedSkillReceipt> {
    const name = input.name.trim()
    if (!NAME.test(name) || name.length > 64) {
      throw new Error('skill name must be kebab-case and at most 64 characters')
    }
    const description = bounded(input.description, 'description', MAX_DESCRIPTION)
    const whenToUse = bounded(input.whenToUse, 'whenToUse', MAX_WHEN)
    const instructions = bounded(input.instructions, 'instructions', MAX_INSTRUCTIONS)
    const directory = join(this.root, name)
    const path = join(directory, 'SKILL.md')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const learnedAt = new Date().toISOString()
    const content = [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      `whenToUse: ${JSON.stringify(whenToUse)}`,
      'metadata:',
      '  source: phoenix-learned',
      `  learnedAt: ${JSON.stringify(learnedAt)}`,
      '---',
      '',
      `# ${name}`,
      '',
      instructions,
      '',
    ].join('\n')

    try {
      await writeFile(path, content, {
        encoding: 'utf8',
        mode: 0o600,
        flag: input.replace === true ? 'w' : 'wx',
      })
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined
      if (code === 'EEXIST') {
        throw new Error(`skill "${name}" already exists; set replace=true only when intentionally revising it`)
      }
      throw error
    }
    return { name, path, replaced: input.replace === true }
  }
}

/**
 * Model-facing "learn this workflow" tool. The model extracts a reusable,
 * parameter-agnostic procedure only after it has evidence the workflow worked.
 * @param store - Persistent text-only user Skill store.
 * @returns Tool definition for promoting a verified workflow into a Skill.
 */
export function createLearnedSkillTool(store = new LearnedSkillStore()): ToolDefinition {
  return defineTool({
    name: 'phoenix_skill_learn',
    description: 'Promote a successfully completed repeatable procedure into a persistent user Skill. Use only after the workflow has enough evidence of success. Store stable steps, decision rules, verification, and approval boundaries—not secrets, transient outputs, exact coordinates, or one-off conversation text.',
    parameters: {
      name: { type: 'string', required: true, description: 'Persistent kebab-case skill name.' },
      description: { type: 'string', required: true, description: 'Short catalog description.' },
      whenToUse: { type: 'string', required: true, description: 'Clear trigger conditions for loading this skill.' },
      instructions: { type: 'string', required: true, description: 'Reusable procedure, validation, fallbacks, and approval boundaries.' },
      replace: { type: 'boolean', description: 'Explicitly replace an existing learned skill of the same name.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      try {
        const receipt = await store.learn({
          name: args.name,
          description: args.description,
          whenToUse: args.whenToUse,
          instructions: args.instructions,
          ...(args.replace === undefined ? {} : { replace: args.replace }),
        })
        return {
          name: receipt.name,
          path: receipt.path,
          replaced: receipt.replaced,
        }
      } catch (error: unknown) {
        throw new ToolArgsError([error instanceof Error ? error.message : String(error)])
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Learn skill: ${args.name}`, kind: 'execute' }
    },
  })
}
