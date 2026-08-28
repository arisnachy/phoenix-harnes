import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'

type StateSkill = {
  sourceName: string
  alias: string
  description: string
  license: string
  modelInvocable: boolean
  userInvocable: boolean
  signals: string[]
  resources: string[]
}

type State = {
  schema: number
  sourceRepository: string
  sourceCommit: string
  skills: StateSkill[]
}

type Verification = {
  alias: string
  sourceName: string
  status: 'passed' | 'failed'
  description: string
  license: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  signals: string[]
  resources: string[]
  loadedContentLength: number
  resourceBase: string | null
  error?: string
}

const home = resolveDshHome()
const statePath = dshHomePath('openclaw-skills', 'arsenal.json')
const evidencePath = join(process.cwd(), 'docs', 'superpowers', 'evidence', 'openclaw-skills-verification.json')

const state = JSON.parse(await readFile(statePath, 'utf8')) as State
const ctx = new Context()
await ctx.plugin(SkillRegistry)
await ctx.plugin(SkillFileSystem, {
  dshHome: join(home),
  agentsHome: join(home, '..', '.agents'),
  watch: false,
})

const summaries = await ctx.skills.list({ cwd: process.cwd() })
const available = new Set(summaries.map(skill => skill.name))
const verification: Verification[] = []

for (const skill of state.skills) {
  try {
    if (!available.has(skill.alias)) throw new Error('alias absent from ctx.skills.list()')
    const definition = await ctx.skills.get(skill.alias)
    if (definition === undefined) throw new Error('ctx.skills.get() returned undefined')
    if (definition.name !== skill.alias) throw new Error(`loaded name mismatch: ${definition.name}`)
    if (definition.content.trim().length === 0) throw new Error('loaded content is empty')
    verification.push({
      alias: skill.alias,
      sourceName: skill.sourceName,
      status: 'passed',
      description: skill.description,
      license: skill.license,
      invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
      signals: skill.signals,
      resources: skill.resources,
      loadedContentLength: definition.content.length,
      resourceBase: definition.resourceBase?.kind === 'directory' ? definition.resourceBase.path : null,
    })
    process.stdout.write(`PASS ${skill.alias}\n`)
  } catch (error) {
    verification.push({
      alias: skill.alias,
      sourceName: skill.sourceName,
      status: 'failed',
      description: skill.description,
      license: skill.license,
      invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
      signals: skill.signals,
      resources: skill.resources,
      loadedContentLength: 0,
      resourceBase: null,
      error: error instanceof Error ? error.message : String(error),
    })
    process.stdout.write(`FAIL ${skill.alias}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

const passed = verification.filter(skill => skill.status === 'passed').length
await mkdir(join(process.cwd(), 'docs', 'superpowers', 'evidence'), { recursive: true })
await writeFile(evidencePath, `${JSON.stringify({
  sourceRepository: state.sourceRepository,
  sourceCommit: state.sourceCommit,
  expectedSkills: state.skills.length,
  availableSkills: summaries.filter(skill => skill.name.startsWith('openclaw-')).length,
  passed,
  failed: verification.length - passed,
  skills: verification,
}, null, 2)}\n`, 'utf8')

process.stdout.write(`OpenClaw native invocation: ${passed}/${verification.length} passed\n`)
if (passed !== verification.length || verification.length !== state.skills.length) process.exitCode = 1
