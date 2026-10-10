// PHOENIX bridge for obra/superpowers.
//
// The upstream repository stays outside the PHOENIX source tree. `sync` keeps
// a sparse checkout of only the upstream skills under $DSH_HOME, mirrors those
// bundles into PHOENIX's native skill root, and rewrites cross-skill references
// from Superpowers' `superpowers:<name>` notation to PHOENIX-safe kebab names.
// No credentials or executable authority are granted by installing the skills.

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
import { extname, join, relative, resolve } from 'node:path'
import { dshHomeDisplay, dshHomePath, resolveDshHome } from '@phoenix-ai/dsh-home-paths'

const NAME = 'dsh superpowers'
const SOURCE_REPOSITORY = 'https://github.com/obra/superpowers.git'
const SOURCE_BRANCH = 'main'
const SKILLS_PATH = 'skills'
const STATE_SCHEMA = 1

interface SuperpowersSkillRecord {
  sourceName: string
  alias: string
  description: string
  license: 'MIT'
  resources: string[]
  managedPath: string
}

interface SuperpowersState {
  schema: 1
  sourceRepository: string
  sourceCommit: string
  syncedAt: string
  skills: SuperpowersSkillRecord[]
  managedSkills: string[]
}

function paths() {
  const home = resolveDshHome()
  const root = dshHomePath('superpowers')
  return {
    home,
    homeDisplay: dshHomeDisplay(home),
    root,
    repository: join(root, 'obra-superpowers'),
    state: join(root, 'arsenal.json'),
    skills: dshHomePath('skills'),
  }
}

function run(bin: string, args: string[], cwd?: string): string {
  const commandArgs = bin === 'git' ? ['-c', 'core.longpaths=true', ...args] : args
  const result = spawnSync(bin, commandArgs, {
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
    throw new Error(`${bin} ${commandArgs.join(' ')} failed${diagnostic.length > 0 ? `: ${diagnostic}` : ''}`)
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

/** Return the stable PHOENIX alias for one upstream Superpowers skill. */
export function superpowersAlias(sourceName: string): string {
  const normalized = kebab(sourceName)
  if (normalized.length === 0) throw new Error(`invalid Superpowers skill name ${JSON.stringify(sourceName)}`)
  return `superpowers-${normalized}`
}

/**
 * Translate Superpowers cross-skill references into PHOENIX skill names.
 * Project directories such as `.superpowers/` are intentionally untouched.
 */
export function rewriteSuperpowersReferences(source: string, siblingSkillNames: readonly string[] = []): string {
  const siblings = new Set(siblingSkillNames.map(name => kebab(name)))
  const namespaced = source.replace(/\bsuperpowers:([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi, (_match, name: string) =>
    superpowersAlias(name))
  return namespaced.replace(/((?:\.\.\/)+)([a-z0-9]+(?:-[a-z0-9]+)*)(?=\/|[\s"'\x60)\]}.,;:]|$)/gi,
    (match, parents: string, name: string) =>
      siblings.has(kebab(name)) ? `${parents}${superpowersAlias(name)}` : match)
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

function rewriteSkill(source: string, alias: string, siblingSkillNames: readonly string[]): string {
  const head = frontmatter(source)
  if (!/^name\s*:/mi.test(head)) throw new Error('skill frontmatter has no name')
  const rewritten = head.replace(/^name\s*:.*$/mi, `name: ${alias}`)
  const end = source.search(/\r?\n---(?:\r?\n|$)/)
  if (end < 0) throw new Error('skill frontmatter is unterminated')
  return rewriteSuperpowersReferences(`${rewritten}${source.slice(end)}`, siblingSkillNames)
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

const REWRITABLE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.sh', '.bash', '.ps1', '.py',
  '.html', '.css', '.xml', '.svg', '.dot',
])

function isRewritableTextResource(resource: string): boolean {
  const extension = extname(resource).toLowerCase()
  return extension.length === 0 || REWRITABLE_EXTENSIONS.has(extension)
}

function rewriteTextResources(root: string, resources: readonly string[], siblingSkillNames: readonly string[]): void {
  for (const resource of resources) {
    if (!isRewritableTextResource(resource)) continue
    const path = join(root, resource)
    const source = readFileSync(path, 'utf8')
    const rewritten = rewriteSuperpowersReferences(source, siblingSkillNames)
    if (rewritten !== source) writeFileSync(path, rewritten, 'utf8')
  }
}

function readState(path: string): SuperpowersState | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { schema?: unknown }
    return value.schema === STATE_SCHEMA ? value as SuperpowersState : undefined
  } catch {
    return undefined
  }
}

function writeState(path: string, state: SuperpowersState): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function clearManagedSkills(skillRoot: string, previous: SuperpowersState | undefined): void {
  for (const managed of previous?.managedSkills ?? []) {
    if (!/^superpowers-[a-z0-9-]+$/.test(managed)) continue
    rmSync(join(skillRoot, managed), { recursive: true, force: true })
  }
}

function syncSource(repository: string): string {
  mkdirSync(resolve(repository, '..'), { recursive: true })
  if (!existsSync(join(repository, '.git'))) {
    run('git', ['clone', '--filter=blob:none', '--sparse', '--depth', '1', '--branch', SOURCE_BRANCH, SOURCE_REPOSITORY, repository])
  } else {
    const origin = run('git', ['remote', 'get-url', 'origin'], repository)
    if (!/github\.com[/:]obra\/superpowers(?:\.git)?$/i.test(origin.replace(/\\/g, '/'))) {
      throw new Error(`refusing to update unexpected Superpowers remote ${JSON.stringify(origin)}`)
    }
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', SOURCE_BRANCH], repository)
    run('git', ['reset', '--hard', `origin/${SOURCE_BRANCH}`], repository)
    run('git', ['clean', '-fd'], repository)
  }
  run('git', ['sparse-checkout', 'set', SKILLS_PATH], repository)
  return run('git', ['rev-parse', 'HEAD'], repository)
}

function mirrorSkills(sourceRoot: string, skillRoot: string): { records: SuperpowersSkillRecord[]; managed: string[] } {
  const records: SuperpowersSkillRecord[] = []
  const managed: string[] = []
  const entries = discoverSkillEntries(sourceRoot)
  const siblingSkillNames = entries.map(entry => entry.entryName)
  for (const entry of entries) {
    const alias = superpowersAlias(entry.entryName)
    const target = join(skillRoot, alias)
    const sourceFile = join(entry.source, 'SKILL.md')
    const sourceText = readFileSync(sourceFile, 'utf8')
    const description = frontmatterValue(sourceText, 'description') ?? ''
    rmSync(target, { recursive: true, force: true })
    cpSync(entry.source, target, { recursive: true, force: true })
    writeFileSync(join(target, 'SKILL.md'), rewriteSkill(sourceText, alias, siblingSkillNames), 'utf8')
    const resources = resourceFiles(target)
    rewriteTextResources(target, resources, siblingSkillNames)
    records.push({
      sourceName: entry.entryName,
      alias,
      description,
      license: 'MIT',
      resources,
      managedPath: alias,
    })
    managed.push(alias)
  }
  if (!records.some(record => record.sourceName === 'using-superpowers')) {
    throw new Error('upstream Superpowers catalog is missing using-superpowers')
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
  const state: SuperpowersState = {
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

function requireState(): SuperpowersState {
  const state = readState(paths().state)
  if (state === undefined) throw new Error('Superpowers is not synchronized; run `dsh superpowers sync` first')
  return state
}

function list(): number {
  const state = requireState()
  process.stdout.write(`Superpowers — ${state.skills.length} skills — source ${state.sourceCommit.slice(0, 12)}\n`)
  for (const skill of state.skills) process.stdout.write(`${skill.alias}\n`)
  return 0
}

function verify(): number {
  const p = paths()
  const state = requireState()
  let failures = 0
  const aliases = new Set<string>()
  const siblingSkillNames = state.skills.map(skill => skill.sourceName)
  for (const skill of state.skills) {
    aliases.add(skill.alias)
    const target = join(p.skills, skill.managedPath)
    const body = join(target, 'SKILL.md')
    try {
      if (!existsSync(body)) throw new Error('SKILL.md is missing')
      const source = readFileSync(body, 'utf8')
      if (frontmatterValue(source, 'name') !== skill.alias) throw new Error('frontmatter name does not match alias')
      if (rewriteSuperpowersReferences(source, siblingSkillNames) !== source) {
        throw new Error('untranslated Superpowers cross-skill reference')
      }
      for (const resource of skill.resources) {
        const resourcePath = join(target, resource)
        if (!existsSync(resourcePath)) throw new Error(`resource is missing: ${resource}`)
        if (isRewritableTextResource(resource)) {
          const resourceText = readFileSync(resourcePath, 'utf8')
          if (rewriteSuperpowersReferences(resourceText, siblingSkillNames) !== resourceText) {
            throw new Error(`resource has untranslated Superpowers cross-skill reference: ${resource}`)
          }
        }
      }
      process.stdout.write(`PASS ${skill.alias}\n`)
    } catch (error) {
      failures += 1
      process.stdout.write(`FAIL ${skill.alias}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  if (aliases.size !== state.skills.length || state.skills.length === 0) failures += 1
  process.stdout.write(`${NAME}: ${state.skills.length - failures}/${state.skills.length} installed skills verified.\n`)
  return failures === 0 ? 0 : 1
}

function doctor(): number {
  let failures = 0
  try {
    run('git', ['--version'])
    process.stdout.write('PASS git available\n')
  } catch (error) {
    process.stdout.write(`FAIL git unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
    failures += 1
  }
  let state: SuperpowersState
  try {
    state = requireState()
  } catch (error) {
    process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  process.stdout.write(`PASS source ${state.sourceRepository} @ ${state.sourceCommit.slice(0, 12)}\n`)
  process.stdout.write(`PASS native skill bridge ${state.skills.length} installed skill(s)\n`)
  if (verify() !== 0) failures += 1
  return failures === 0 ? 0 : 1
}

function printHelp(): number {
  process.stdout.write('PHOENIX Superpowers bridge\n\nCommands:\n  dsh superpowers sync\n  dsh superpowers list\n  dsh superpowers verify\n  dsh superpowers doctor\n  dsh superpowers path\n\n')
  process.stdout.write('sync installs the official MIT obra/superpowers skill bundles into PHOENIX native skill loading and rewrites cross-skill references for PHOENIX.\n')
  return 0
}

/** Execute one PHOENIX Superpowers bridge command. */
export function runSuperpowers(args: readonly string[]): number {
  try {
    const [command = 'list'] = args
    switch (command) {
      case 'sync': return sync()
      case 'list': return list()
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
