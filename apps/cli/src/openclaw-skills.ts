// PHOENIX bridge for the official OpenClaw skill catalog.
//
// The upstream repository is kept outside this source tree. `sync` clones only
// its skills tree under $DSH_HOME, mirrors bundles into the native PHOENIX
// skill root with an explicit namespace, and records an auditable state file.
// The bridge copies instructions/resources only; it never copies credentials.

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { dshHomeDisplay, dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const NAME = 'dsh openclaw-skills'
const SOURCE_REPOSITORY = 'https://github.com/openclaw/openclaw.git'
const SOURCE_BRANCH = 'main'
const SKILLS_PATH = join('skills')
const STATE_SCHEMA = 1

type Signal = 'network' | 'external-runtime' | 'credentials' | 'platform-specific'

export interface OpenClawSkillRecord {
  sourceName: string
  alias: string
  description: string
  license: 'MIT'
  modelInvocable: boolean
  userInvocable: boolean
  signals: Signal[]
  resources: string[]
  managedPath: string
}

interface OpenClawState {
  schema: 1
  sourceRepository: string
  sourceCommit: string
  syncedAt: string
  skills: OpenClawSkillRecord[]
  managedSkills: string[]
}

function paths() {
  const home = resolveDshHome()
  const root = dshHomePath('openclaw-skills')
  return {
    home,
    homeDisplay: dshHomeDisplay(home),
    root,
    repository: join(root, 'openclaw'),
    state: join(root, 'arsenal.json'),
    skills: dshHomePath('skills'),
  }
}

function run(bin: string, args: string[], cwd?: string): string {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`${bin} was not found on PATH`)
    throw result.error
  }
  if ((result.status ?? 1) !== 0) {
    const diagnostic = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(`${bin} ${args.join(' ')} failed${diagnostic.length > 0 ? `: ${diagnostic}` : ''}`)
  }
  return typeof result.stdout === 'string' ? result.stdout.trim() : ''
}

function kebab(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/** Return the stable PHOENIX alias for one upstream OpenClaw skill folder. */
export function openClawAlias(sourceName: string): string {
  const normalized = kebab(sourceName)
  if (normalized.length === 0) throw new Error(`invalid OpenClaw skill name ${JSON.stringify(sourceName)}`)
  return `openclaw-${normalized}`
}

function frontmatter(source: string): string {
  if (!source.startsWith('---')) throw new Error('skill has no YAML frontmatter')
  const end = source.search(/\r?\n---(?:\r?\n|$)/)
  if (end < 0) throw new Error('skill frontmatter is unterminated')
  return source.slice(0, end)
}

function frontmatterValue(source: string, field: string): string | undefined {
  const head = frontmatter(source)
  const match = new RegExp(`^${field}\\s*:\\s*(.+)$`, 'mi').exec(head)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
}

function booleanField(source: string, field: string, defaultValue: boolean): boolean {
  const value = frontmatterValue(source, field)?.toLowerCase()
  if (value === undefined) return defaultValue
  return !['false', 'off', 'no', '0'].includes(value.replace(/^['"]|['"]$/g, ''))
}

function hasAny(source: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(source))
}

/** Produce non-secret audit metadata for one upstream skill body. */
export function auditBundle(sourceName: string, source: string): Pick<OpenClawSkillRecord, 'sourceName' | 'description' | 'license' | 'modelInvocable' | 'userInvocable' | 'signals'> {
  const description = frontmatterValue(source, 'description') ?? ''
  const signals: Signal[] = []
  if (hasAny(source, [/https?:\/\//i, /\bcurl\b/i, /\bfetch\s*\(/i, /\bweb_fetch\b/i])) signals.push('network')
  if (hasAny(source, [/\bcurl\b/i, /\bbrew\s+install\b/i, /\bapt(?:-get)?\s+install\b/i, /\bnpm\s+(?:install|i)\b/i, /\bpip(?:x)?\s+install\b/i, /\buv\s+/i, /\bffmpeg\b/i, /\bgh\s+/i, /\bnode\b/i, /\bpython\b/i, /\bcli\b/i])) signals.push('external-runtime')
  const credentialText = source.replace(/\b(?:no|without)\s+(?:an?\s+)?api[_ -]?key\b/gi, '')
  if (hasAny(credentialText, [/api[_ -]?key/i, /\btoken\b/i, /\bcredential/i, /\bsecret/i, /\boauth\b/i])) signals.push('credentials')
  if (hasAny(source, [/macOS/i, /Darwin/i, /Linux/i, /Windows/i, /Android/i, /iOS/i])) signals.push('platform-specific')
  return {
    sourceName,
    description,
    license: 'MIT',
    modelInvocable: !booleanField(source, 'disable-model-invocation', false),
    userInvocable: booleanField(source, 'user-invocable', true),
    signals,
  }
}

function rewriteSkillName(source: string, alias: string): string {
  const head = frontmatter(source)
  if (!/^name\s*:/mi.test(head)) throw new Error('skill frontmatter has no name')
  const rewritten = head.replace(/^name\s*:.*$/mi, `name: ${alias}`)
  const end = source.search(/\r?\n---(?:\r?\n|$)/)
  if (end < 0) throw new Error('skill frontmatter is unterminated')
  return `${rewritten}${source.slice(end)}`
}

function discoverSkillEntries(root: string): Array<{ source: string; entryName: string }> {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .map(entry => ({ source: join(root, entry.name), entryName: entry.name }))
    .sort((left, right) => left.entryName.localeCompare(right.entryName))
}

function resourceFiles(root: string, current = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...resourceFiles(root, path))
    else if (entry.name !== 'SKILL.md') files.push(relative(root, path).replace(/\\/g, '/'))
  }
  return files.sort()
}

function readState(path: string): OpenClawState | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { schema?: unknown }
    return value.schema === STATE_SCHEMA ? value as OpenClawState : undefined
  } catch {
    return undefined
  }
}

function writeState(path: string, state: OpenClawState): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function clearManagedSkills(skillRoot: string, previous: OpenClawState | undefined): void {
  for (const managed of previous?.managedSkills ?? []) {
    if (!/^openclaw-[a-z0-9-]+$/.test(managed)) continue
    rmSync(join(skillRoot, managed), { recursive: true, force: true })
  }
}

function syncSource(repository: string): string {
  mkdirSync(resolve(repository, '..'), { recursive: true })
  if (!existsSync(join(repository, '.git'))) {
    run('git', ['clone', '--filter=blob:none', '--sparse', '--depth', '1', '--branch', SOURCE_BRANCH, SOURCE_REPOSITORY, repository])
  } else {
    const origin = run('git', ['remote', 'get-url', 'origin'], repository)
    if (!/github\.com[/:]openclaw\/openclaw(?:\.git)?$/i.test(origin.replace(/\\/g, '/'))) {
      throw new Error(`refusing to update unexpected OpenClaw remote ${JSON.stringify(origin)}`)
    }
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', SOURCE_BRANCH], repository)
    run('git', ['reset', '--hard', `origin/${SOURCE_BRANCH}`], repository)
    run('git', ['clean', '-fd'], repository)
  }
  run('git', ['sparse-checkout', 'set', SKILLS_PATH], repository)
  return run('git', ['rev-parse', 'HEAD'], repository)
}

function mirrorSkills(sourceRoot: string, skillRoot: string): { records: OpenClawSkillRecord[]; managed: string[] } {
  const records: OpenClawSkillRecord[] = []
  const managed: string[] = []
  for (const entry of discoverSkillEntries(sourceRoot)) {
    const alias = openClawAlias(entry.entryName)
    const target = join(skillRoot, alias)
    const sourceFile = join(entry.source, 'SKILL.md')
    const sourceText = readFileSync(sourceFile, 'utf8')
    const audit = auditBundle(entry.entryName, sourceText)
    rmSync(target, { recursive: true, force: true })
    cpSync(entry.source, target, { recursive: true, force: true })
    writeFileSync(join(target, 'SKILL.md'), rewriteSkillName(sourceText, alias), 'utf8')
    const resources = resourceFiles(target)
    records.push({ ...audit, alias, resources, managedPath: alias })
    managed.push(alias)
  }
  return { records, managed }
}

function sync(): number {
  const p = paths()
  mkdirSync(p.root, { recursive: true })
  mkdirSync(p.skills, { recursive: true })
  const previous = readState(p.state)
  const sourceCommit = syncSource(p.repository)
  clearManagedSkills(p.skills, previous)
  const result = mirrorSkills(join(p.repository, SKILLS_PATH), p.skills)
  const state: OpenClawState = {
    schema: STATE_SCHEMA,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit,
    syncedAt: new Date().toISOString(),
    skills: result.records,
    managedSkills: result.managed,
  }
  writeState(p.state, state)
  process.stdout.write(`${NAME}: synced ${result.records.length} skills at ${sourceCommit.slice(0, 12)}; installed under ${p.homeDisplay}/skills.\n`)
  return 0
}

function requireState(): OpenClawState {
  const state = readState(paths().state)
  if (state === undefined) throw new Error('OpenClaw skills are not synchronized; run `dsh openclaw-skills sync` first')
  return state
}

function list(): number {
  const state = requireState()
  process.stdout.write(`OpenClaw skills — ${state.skills.length} bundles — source ${state.sourceCommit.slice(0, 12)}\n`)
  for (const skill of state.skills) {
    const signals = skill.signals.length > 0 ? skill.signals.join(',') : 'local'
    process.stdout.write(`${skill.alias.padEnd(34)} ${signals}\n`)
  }
  return 0
}

function inspect(name: string): number {
  const state = requireState()
  const skill = state.skills.find(candidate => candidate.alias === name || candidate.sourceName === name)
  if (skill === undefined) throw new Error(`unknown OpenClaw skill ${JSON.stringify(name)}`)
  process.stdout.write(`${JSON.stringify(skill, null, 2)}\n`)
  return 0
}

function verify(): number {
  const p = paths()
  const state = requireState()
  let failures = 0
  const aliases = new Set<string>()
  for (const skill of state.skills) {
    aliases.add(skill.alias)
    const target = join(p.skills, skill.managedPath)
    const body = join(target, 'SKILL.md')
    try {
      if (!existsSync(body)) throw new Error('SKILL.md is missing')
      const source = readFileSync(body, 'utf8')
      if (frontmatterValue(source, 'name') !== skill.alias) throw new Error('frontmatter name does not match alias')
      for (const resource of skill.resources) {
        if (!existsSync(join(target, resource))) throw new Error(`resource is missing: ${resource}`)
      }
      process.stdout.write(`PASS ${skill.alias}\n`)
    } catch (error) {
      failures += 1
      process.stdout.write(`FAIL ${skill.alias}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  if (aliases.size !== state.skills.length || state.skills.length === 0) failures += 1
  process.stdout.write(`${NAME}: ${state.skills.length - failures}/${state.skills.length} installed bundles verified.\n`)
  return failures === 0 ? 0 : 1
}

function doctor(): number {
  const p = paths()
  let failures = 0
  try {
    run('git', ['--version'])
    process.stdout.write('PASS git available\n')
  } catch (error) {
    process.stdout.write(`FAIL git unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
    failures += 1
  }
  let state: OpenClawState
  try {
    state = requireState()
  } catch (error) {
    process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  process.stdout.write(`PASS source ${state.sourceRepository} @ ${state.sourceCommit.slice(0, 12)}\n`)
  process.stdout.write(`PASS native skill bridge ${state.skills.length} installed bundle(s)\n`)
  for (const skill of state.skills) {
    if (skill.signals.includes('external-runtime')) process.stdout.write(`WARN ${skill.alias}: optional external runtime documented\n`)
    if (skill.signals.includes('credentials')) process.stdout.write(`WARN ${skill.alias}: optional credentials/API documented; no values stored\n`)
  }
  try {
    if (existsSync(p.repository)) process.stdout.write(`PASS source checkout ${p.repository}\n`)
    else throw new Error('source checkout is missing')
    if (verify() !== 0) failures += 1
  } catch (error) {
    process.stdout.write(`FAIL installation: ${error instanceof Error ? error.message : String(error)}\n`)
    failures += 1
  }
  return failures === 0 ? 0 : 1
}

function printHelp(): number {
  process.stdout.write('PHOENIX OpenClaw skill bridge\n\nCommands:\n  dsh openclaw-skills sync\n  dsh openclaw-skills list\n  dsh openclaw-skills inspect <alias-or-source-name>\n  dsh openclaw-skills verify\n  dsh openclaw-skills doctor\n  dsh openclaw-skills path\n\n')
  process.stdout.write('sync installs the official MIT OpenClaw skill instructions/resources under $DSH_HOME and exposes them through PHOENIX native skill loading.\n')
  return 0
}

/** Execute a PHOENIX OpenClaw skill bridge command. */
export function runOpenClawSkills(args: readonly string[]): number {
  try {
    const [command = 'list', name] = args
    switch (command) {
      case 'sync': return sync()
      case 'list': return list()
      case 'inspect':
        if (name === undefined) throw new Error('inspect requires an alias or source name')
        return inspect(name)
      case 'verify': return verify()
      case 'doctor': return doctor()
      case 'path':
        process.stdout.write(`${paths().root}\n`)
        return 0
      case '-h':
      case '--help':
      case 'help': return printHelp()
      default: throw new Error(`unknown command ${JSON.stringify(command)}`)
    }
  } catch (error) {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
