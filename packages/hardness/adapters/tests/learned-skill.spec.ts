import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LearnedSkillStore, createLearnedSkillTool } from '../src/learned-skill.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'phoenix-learned-skill-'))
  roots.push(value)
  return value
}

function render(definition: unknown, args: unknown, value: unknown): unknown {
  const output = (definition as { output?: { render?: (args: never, value: never) => unknown } }).output
  if (output?.render === undefined) throw new Error('missing renderer')
  return output.render(args as never, value as never)
}

describe('learned Phoenix skills', () => {
  it('defaults to the canonical user Skill root', () => {
    expect(new LearnedSkillStore().root.replaceAll('\\', '/')).toMatch(/\.dsh\/skills$/)
  })

  it('promotes a reusable procedure into a normal user SKILL.md', async () => {
    const dir = await root()
    const store = new LearnedSkillStore(dir)
    const receipt = await store.learn({
      name: 'review-ci-failure',
      description: 'Diagnose a failed Phoenix CI run.',
      whenToUse: 'Use after a Phoenix CI workflow fails.',
      instructions: '1. Read the failed jobs.\n2. Reproduce the smallest failure.\n3. Fix and verify it.',
    })

    expect(receipt).toMatchObject({ name: 'review-ci-failure', replaced: false })
    const text = await readFile(join(dir, 'review-ci-failure', 'SKILL.md'), 'utf8')
    expect(text).toContain('name: review-ci-failure')
    expect(text).toContain('source: phoenix-learned')
    expect(text).toContain('Reproduce the smallest failure')
  })

  it('does not silently overwrite an existing learned procedure but supports explicit revision', async () => {
    const dir = await root()
    const store = new LearnedSkillStore(dir)
    const input = {
      name: 'stable-workflow',
      description: 'A stable workflow.',
      whenToUse: 'When it applies.',
      instructions: 'Do the verified steps.',
    }
    await store.learn(input)
    await expect(store.learn(input)).rejects.toThrow(/already exists/)
    await expect(store.learn({ ...input, replace: true })).resolves.toMatchObject({ replaced: true })
  })

  it('validates names and bounded reusable text', async () => {
    const store = new LearnedSkillStore(await root())
    const base = {
      description: 'Description',
      whenToUse: 'When useful',
      instructions: 'Do the steps.',
    }

    await expect(store.learn({ name: 'Not-Kebab', ...base })).rejects.toThrow(/kebab-case/)
    await expect(store.learn({ name: 'a'.repeat(65), ...base })).rejects.toThrow(/at most 64/)
    await expect(store.learn({ name: 'empty-description', ...base, description: '   ' })).rejects.toThrow(/description/)
    await expect(store.learn({ name: 'long-trigger', ...base, whenToUse: 'x'.repeat(2_001) })).rejects.toThrow(/whenToUse/)
    await expect(store.learn({ name: 'long-instructions', ...base, instructions: 'x'.repeat(64_001) })).rejects.toThrow(/instructions/)
  })

  it('rethrows non-collision filesystem errors', async () => {
    const dir = await root()
    await mkdir(join(dir, 'broken-write', 'SKILL.md'), { recursive: true })
    const store = new LearnedSkillStore(dir)

    await expect(store.learn({
      name: 'broken-write',
      description: 'Description',
      whenToUse: 'When useful',
      instructions: 'Do it.',
    })).rejects.not.toThrow(/already exists/)
  })

  it('exposes promotion as phoenix_skill_learn with rendering and presentation', async () => {
    const dir = await root()
    const tool = createLearnedSkillTool(new LearnedSkillStore(dir))
    const args = {
      name: 'browser-form-safe',
      description: 'Fill a recurring browser form safely.',
      whenToUse: 'When this exact recurring form is requested.',
      instructions: 'Inspect origin, fill non-secret fields, use the vault for login, and verify before submit.',
    }
    const value = await tool.execute(args, {} as never) as Record<string, unknown>

    expect(value.name).toBe('browser-form-safe')
    expect(await readFile(join(dir, 'browser-form-safe', 'SKILL.md'), 'utf8')).toContain('use the vault')
    expect(tool.presentCall?.(args)).toMatchObject({ title: 'Learn skill: browser-form-safe', kind: 'execute' })
    expect(render(tool, args, value)).toEqual([{ type: 'text', text: JSON.stringify(value) }])
  })

  it('forwards explicit replacement and normalizes Error and non-Error store failures', async () => {
    const seen: unknown[] = []
    const replacing = createLearnedSkillTool({
      async learn(input: unknown) {
        seen.push(input)
        return { name: 'x', path: '/tmp/x', replaced: true }
      },
    } as never)
    await expect(replacing.execute({
      name: 'x',
      description: 'd',
      whenToUse: 'w',
      instructions: 'i',
      replace: true,
    }, {} as never)).resolves.toMatchObject({ replaced: true })
    expect(seen[0]).toMatchObject({ replace: true })

    const errorTool = createLearnedSkillTool({
      learn: async () => { throw new Error('normal failure') },
    } as never)
    await expect(errorTool.execute({
      name: 'x', description: 'd', whenToUse: 'w', instructions: 'i',
    }, {} as never)).rejects.toThrow(/normal failure/)

    const failure: unknown = 'string failure'
    const nonErrorTool = createLearnedSkillTool({
      learn: async () => {
        await Promise.resolve()
        throw failure
      },
    } as never)
    await expect(nonErrorTool.execute({
      name: 'x', description: 'd', whenToUse: 'w', instructions: 'i',
    }, {} as never)).rejects.toThrow(/string failure/)
  })
})
