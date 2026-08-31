// PHOENIX bridge for the official Codex plugin marketplace.
//
// The bridge deliberately keeps the upstream repository outside this public
// source tree. `sync` clones/updates openai/plugins under $DSH_HOME, mirrors
// Codex skills into PHOENIX's native skill root, and translates compatible MCP
// declarations into PHOENIX Cordis patch files. Secrets are never copied: MCP
// bearer tokens remain environment-variable references.

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
import { basename, join, resolve } from 'node:path'
import { dshHomePath, dshHomeDisplay, resolveDshHome } from '@phoenix-ai/dsh-home-paths'

const NAME = 'dsh codex-plugin'
const SOURCE_REPOSITORY = 'https://github.com/openai/plugins.git'
const SOURCE_BRANCH = 'main'
const MARKETPLACE_PATH = join('.agents', 'plugins', 'marketplace.json')
const MANIFEST_PATH = join('.codex-plugin', 'plugin.json')

interface MarketplaceEntry {
  name?: unknown
  source?: { source?: unknown; path?: unknown }
  category?: unknown
  policy?: unknown
}

interface Marketplace {
  plugins?: MarketplaceEntry[]
}

interface CodexManifest {
  name?: unknown
  version?: unknown
  description?: unknown
  license?: unknown
  skills?: unknown
  agents?: unknown
  commands?: unknown
  hooks?: unknown
  mcpServers?: unknown
  apps?: unknown
}

interface PluginRecord {
  name: string
  version: string
  description: string
  license: string
  category: string
  relativePath: string
  surfaces: string[]
  skillAliases: string[]
  mcpServers: string[]
  requiredEnv: string[]
}

interface ArsenalState {
  schema: 1
  sourceRepository: string
  sourceCommit: string
  syncedAt: string
  plugins: PluginRecord[]
  managedSkills: string[]
  enabledMcpPlugins: string[]
}

interface McpServer {
  type?: unknown
  url?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  headers?: unknown
  bearer_token_env_var?: unknown
}

function paths() {
  const home = resolveDshHome()
  const codex = dshHomePath('codex')
  return {
    home,
    homeDisplay: dshHomeDisplay(home),
    codex,
    repository: join(codex, 'openai-plugins'),
    state: join(codex, 'arsenal.json'),
    patches: join(codex, 'patches'),
    enabledPatch: join(codex, 'enabled.patch.yml'),
    skills: dshHomePath('skills'),
  }
}

function jsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
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

function syncSource(repository: string): string {
  mkdirSync(resolve(repository, '..'), { recursive: true })
  if (!existsSync(join(repository, '.git'))) {
    run('git', ['clone', '--filter=blob:none', '--depth', '1', '--branch', SOURCE_BRANCH, SOURCE_REPOSITORY, repository])
  } else {
    const origin = run('git', ['remote', 'get-url', 'origin'], repository)
    if (!/github\.com[/:]openai\/plugins(?:\.git)?$/i.test(origin.replace(/\\/g, '/'))) {
      throw new Error(`refusing to update unexpected Codex plugin remote ${JSON.stringify(origin)}`)
    }
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', SOURCE_BRANCH], repository)
    run('git', ['reset', '--hard', `origin/${SOURCE_BRANCH}`], repository)
    run('git', ['clean', '-fd'], repository)
  }
  return run('git', ['rev-parse', 'HEAD'], repository)
}

function readState(path: string): ArsenalState | undefined {
  if (!existsSync(path)) return undefined
  const value = jsonFile(path) as { schema?: number }
  return value.schema === 1 ? value as ArsenalState : undefined
}

function writeState(path: string, state: ArsenalState): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function kebab(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function rewriteSkillName(text: string, alias: string): string {
  if (!text.startsWith('---')) throw new Error('skill has no YAML frontmatter')
  const end = text.indexOf('\n---', 3)
  if (end < 0) throw new Error('skill frontmatter is unterminated')
  const head = text.slice(0, end)
  if (!/^name\s*:/m.test(head)) throw new Error('skill frontmatter has no name')
  const rewritten = head.replace(/^name\s*:.*$/m, `name: ${alias}`)
  return `${rewritten}${text.slice(end)}`
}

function discoverSkillEntries(root: string): Array<{ source: string; entryName: string; flat: boolean }> {
  if (!existsSync(root)) return []
  const entries: Array<{ source: string; entryName: string; flat: boolean }> = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md'))) {
      entries.push({ source: join(root, entry.name), entryName: entry.name, flat: false })
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      entries.push({ source: join(root, entry.name), entryName: basename(entry.name, '.md'), flat: true })
    }
  }
  return entries
}

function clearManagedSkills(skillRoot: string, previous?: ArsenalState): void {
  if (previous === undefined) return
  for (const managed of previous.managedSkills) {
    if (!/^codex-[a-z0-9-]+(?:\.md)?$/.test(managed)) continue
    rmSync(join(skillRoot, managed), { recursive: true, force: true })
  }
}

function mirrorSkills(pluginName: string, skillRoot: string, sourceRoot: string): { aliases: string[]; managed: string[] } {
  const aliases: string[] = []
  const managed: string[] = []
  for (const entry of discoverSkillEntries(sourceRoot)) {
    const alias = kebab(`codex-${pluginName}-${entry.entryName}`)
    if (alias.length === 0) continue
    if (entry.flat) {
      const targetName = `${alias}.md`
      const text = rewriteSkillName(readFileSync(entry.source, 'utf8'), alias)
      writeFileSync(join(skillRoot, targetName), text, 'utf8')
      managed.push(targetName)
    } else {
      const targetName = alias
      const target = join(skillRoot, targetName)
      cpSync(entry.source, target, { recursive: true, force: true })
      const skillPath = join(target, 'SKILL.md')
      writeFileSync(skillPath, rewriteSkillName(readFileSync(skillPath, 'utf8'), alias), 'utf8')
      managed.push(targetName)
    }
    aliases.push(alias)
  }
  return { aliases, managed }
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

function envRefs(server: McpServer): string[] {
  const refs = new Set<string>()
  if (typeof server.bearer_token_env_var === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(server.bearer_token_env_var)) {
    refs.add(server.bearer_token_env_var)
  }
  if (server.env !== null && typeof server.env === 'object' && !Array.isArray(server.env)) {
    for (const value of Object.values(server.env as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value)
      if (match?.[1] !== undefined) refs.add(match[1])
    }
  }
  return [...refs]
}

function renderMcpPatch(pluginName: string, mcpPath: string): { text: string; servers: string[]; requiredEnv: string[] } {
  if (!existsSync(mcpPath)) return { text: '', servers: [], requiredEnv: [] }
  const doc = jsonFile(mcpPath) as { mcpServers?: Record<string, McpServer> }
  const servers = doc.mcpServers ?? {}
  const rows: string[] = []
  const names: string[] = []
  const requiredEnv = new Set<string>()

  for (const [rawName, server] of Object.entries(servers)) {
    const serverName = kebab(`${pluginName}-${rawName}`).slice(0, 32)
    if (serverName.length === 0) continue
    const type = typeof server.type === 'string' ? server.type.toLowerCase() : undefined
    const isHttp = type === 'http' || type === 'streamable-http' || typeof server.url === 'string'
    const isStdio = type === 'stdio' || typeof server.command === 'string'
    if (!isHttp && !isStdio) continue

    rows.push(`    - id: codex-mcp-${kebab(pluginName)}-${kebab(rawName)}`)
    rows.push("      name: '@phoenix-ai/dsh-mcp-client'")
    rows.push('      config:')
    rows.push(`        serverName: ${yamlScalar(serverName)}`)

    if (isHttp) {
      if (typeof server.url !== 'string' || server.url.length === 0) continue
      rows.push('        transport: streamable-http')
      rows.push(`        url: ${yamlScalar(server.url)}`)
      const tokenEnv = typeof server.bearer_token_env_var === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(server.bearer_token_env_var)
        ? server.bearer_token_env_var
        : undefined
      if (tokenEnv !== undefined) {
        requiredEnv.add(tokenEnv)
        rows.push('        headers:')
        rows.push(`          Authorization: !!js '\`Bearer \${process.env.${tokenEnv}}\`'`)
      }
    } else {
      if (typeof server.command !== 'string' || server.command.length === 0) continue
      rows.push('        transport: stdio')
      rows.push(`        command: ${yamlScalar(server.command)}`)
      if (Array.isArray(server.args) && server.args.every(argument => typeof argument === 'string')) {
        rows.push(`        args: [${server.args.map(argument => yamlScalar(argument)).join(', ')}]`)
      }
      if (server.env !== null && typeof server.env === 'object' && !Array.isArray(server.env)) {
        const env = server.env as Record<string, unknown>
        const safe = Object.entries(env).filter(([, value]) => typeof value === 'string') as Array<[string, string]>
        if (safe.length > 0) {
          rows.push('        env:')
          for (const [key, value] of safe) {
            const ref = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value)?.[1]
            if (ref !== undefined) {
              requiredEnv.add(ref)
              rows.push(`          ${key}: !!js process.env.${ref}`)
            } else {
              rows.push(`          ${key}: ${yamlScalar(value)}`)
            }
          }
        }
      }
    }
    for (const ref of envRefs(server)) requiredEnv.add(ref)
    names.push(rawName)
  }

  if (rows.length === 0) return { text: '', servers: [], requiredEnv: [] }
  return {
    text: `# Generated by PHOENIX from the official Codex plugin ${pluginName}.\n# Secrets remain environment references; this file contains no credential values.\n- insert:\n${rows.join('\n')}\n`,
    servers: names,
    requiredEnv: [...requiredEnv].sort(),
  }
}

function surfaceList(pluginDir: string, manifest: CodexManifest): string[] {
  const surfaces = new Set<string>()
  const fields: Array<[keyof CodexManifest, string]> = [
    ['skills', 'skills'], ['agents', 'agents'], ['commands', 'commands'], ['hooks', 'hooks'],
    ['mcpServers', 'mcp'], ['apps', 'apps'],
  ]
  for (const [field, label] of fields) {
    if (typeof manifest[field] === 'string') surfaces.add(label)
  }
  if (existsSync(join(pluginDir, 'skills'))) surfaces.add('skills')
  if (existsSync(join(pluginDir, 'agents'))) surfaces.add('agents')
  if (existsSync(join(pluginDir, 'commands'))) surfaces.add('commands')
  if (existsSync(join(pluginDir, 'hooks.json'))) surfaces.add('hooks')
  if (existsSync(join(pluginDir, '.mcp.json'))) surfaces.add('mcp')
  if (existsSync(join(pluginDir, '.app.json'))) surfaces.add('apps')
  if (existsSync(join(pluginDir, 'scripts'))) surfaces.add('scripts')
  if (existsSync(join(pluginDir, 'assets'))) surfaces.add('assets')
  return [...surfaces].sort()
}

function rebuildEnabledPatch(state: ArsenalState): void {
  const p = paths()
  const pieces: string[] = []
  for (const name of state.enabledMcpPlugins) {
    const patch = join(p.patches, `${kebab(name)}.patch.yml`)
    if (existsSync(patch)) pieces.push(readFileSync(patch, 'utf8').trim())
  }
  if (pieces.length === 0) {
    rmSync(p.enabledPatch, { force: true })
    return
  }
  writeFileSync(p.enabledPatch, `${pieces.join('\n\n')}\n`, 'utf8')
}

function sync(): number {
  const p = paths()
  mkdirSync(p.codex, { recursive: true })
  mkdirSync(p.skills, { recursive: true })
  mkdirSync(p.patches, { recursive: true })
  const previous = readState(p.state)
  const sourceCommit = syncSource(p.repository)
  const marketplace = jsonFile(join(p.repository, MARKETPLACE_PATH)) as Marketplace
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
  clearManagedSkills(p.skills, previous)
  rmSync(p.patches, { recursive: true, force: true })
  mkdirSync(p.patches, { recursive: true })

  const plugins: PluginRecord[] = []
  const managedSkills: string[] = []
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.source?.source !== 'local' || typeof entry.source.path !== 'string') continue
    const relativePath = entry.source.path.replace(/^\.\//, '')
    const pluginDir = resolve(p.repository, relativePath)
    const manifestPath = join(pluginDir, MANIFEST_PATH)
    if (!existsSync(manifestPath)) continue
    const manifest = jsonFile(manifestPath) as CodexManifest
    const pluginName = typeof manifest.name === 'string' ? manifest.name : entry.name
    const declaredSkills = typeof manifest.skills === 'string' ? manifest.skills : './skills/'
    const skillSource = resolve(pluginDir, declaredSkills)
    let mirrored = { aliases: [] as string[], managed: [] as string[] }
    if (existsSync(skillSource)) {
      try {
        mirrored = mirrorSkills(pluginName, p.skills, skillSource)
      } catch (error) {
        process.stderr.write(`${NAME}: warning: ${pluginName} skills were not mirrored: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
    managedSkills.push(...mirrored.managed)

    const mcpSource = typeof manifest.mcpServers === 'string' ? resolve(pluginDir, manifest.mcpServers) : join(pluginDir, '.mcp.json')
    const mcp = renderMcpPatch(pluginName, mcpSource)
    if (mcp.text.length > 0) writeFileSync(join(p.patches, `${kebab(pluginName)}.patch.yml`), mcp.text, 'utf8')

    plugins.push({
      name: pluginName,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      license: typeof manifest.license === 'string' ? manifest.license : 'unspecified',
      category: typeof entry.category === 'string' ? entry.category : '',
      relativePath,
      surfaces: surfaceList(pluginDir, manifest),
      skillAliases: mirrored.aliases,
      mcpServers: mcp.servers,
      requiredEnv: mcp.requiredEnv,
    })
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name))
  const available = new Set(plugins.filter(plugin => plugin.mcpServers.length > 0).map(plugin => plugin.name))
  const enabledMcpPlugins = (previous?.enabledMcpPlugins ?? []).filter(name => available.has(name))
  const state: ArsenalState = {
    schema: 1,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit,
    syncedAt: new Date().toISOString(),
    plugins,
    managedSkills,
    enabledMcpPlugins,
  }
  writeState(p.state, state)
  rebuildEnabledPatch(state)
  process.stdout.write(`${NAME}: synced ${plugins.length} plugins at ${sourceCommit.slice(0, 12)}; mirrored ${managedSkills.length} Codex skills into ${p.homeDisplay}/skills.\n`)
  process.stdout.write(`${NAME}: ${plugins.filter(plugin => plugin.mcpServers.length > 0).length} plugins expose MCP servers; enable only the ones you need with: dsh codex-plugin enable <name>\n`)
  return 0
}

function requireState(): ArsenalState {
  const state = readState(paths().state)
  if (state === undefined) throw new Error('arsenal is not synchronized; run `dsh codex-plugin sync` first')
  return state
}

function list(): number {
  const state = requireState()
  const enabled = new Set(state.enabledMcpPlugins)
  process.stdout.write(`Codex plugin arsenal — ${state.plugins.length} plugins — source ${state.sourceCommit.slice(0, 12)}\n`)
  for (const plugin of state.plugins) {
    const mcp = plugin.mcpServers.length > 0 ? (enabled.has(plugin.name) ? 'mcp:on' : 'mcp:off') : 'mcp:-'
    const surfaces = plugin.surfaces.length > 0 ? plugin.surfaces.join(',') : '-'
    process.stdout.write(`${plugin.name.padEnd(28)} ${plugin.version.padEnd(10)} ${mcp.padEnd(8)} ${surfaces}\n`)
  }
  return 0
}

function inspect(name: string): number {
  const state = requireState()
  const plugin = state.plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error(`unknown Codex plugin ${JSON.stringify(name)}`)
  process.stdout.write(`${JSON.stringify({ ...plugin, mcpEnabled: state.enabledMcpPlugins.includes(name) }, null, 2)}\n`)
  return 0
}

function setEnabled(name: string, enabled: boolean): number {
  const p = paths()
  const state = requireState()
  const plugin = state.plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error(`unknown Codex plugin ${JSON.stringify(name)}`)
  if (plugin.mcpServers.length === 0) {
    process.stdout.write(`${NAME}: ${name} has no MCP server. Its synchronized skills are already available to PHOENIX.\n`)
    return 0
  }
  const set = new Set(state.enabledMcpPlugins)
  if (enabled) set.add(name)
  else set.delete(name)
  state.enabledMcpPlugins = [...set].sort()
  writeState(p.state, state)
  rebuildEnabledPatch(state)
  process.stdout.write(`${NAME}: ${name} MCP ${enabled ? 'enabled' : 'disabled'}. ${enabled ? 'It will load automatically on the next PHOENIX boot.' : ''}\n`)
  if (enabled && plugin.requiredEnv.length > 0) {
    process.stdout.write(`${NAME}: required credential environment variable(s): ${plugin.requiredEnv.join(', ')} (values are never stored in the arsenal).\n`)
  }
  return 0
}

function verify(): number {
  const p = paths()
  const state = readState(p.state)
  if (state === undefined) throw new Error('arsenal state is missing or has an unsupported schema')
  let failures = 0
  const pluginNames = new Set<string>()
  for (const plugin of state.plugins) {
    if (pluginNames.has(plugin.name)) {
      process.stdout.write(`FAIL duplicate plugin ${plugin.name}\n`)
      failures += 1
    }
    pluginNames.add(plugin.name)
    for (const alias of plugin.skillAliases) {
      if (!/^codex-[a-z0-9-]+$/.test(alias)) {
        process.stdout.write(`FAIL ${plugin.name}: invalid skill alias ${alias}\n`)
        failures += 1
        continue
      }
      if (!existsSync(join(p.skills, alias)) && !existsSync(join(p.skills, `${alias}.md`))) {
        process.stdout.write(`FAIL ${plugin.name}: mirrored skill is missing: ${alias}\n`)
        failures += 1
      }
    }
  }

  const managed = new Set<string>()
  for (const entry of state.managedSkills) {
    if (!/^codex-[a-z0-9-]+(?:\.md)?$/.test(entry) || managed.has(entry)) {
      process.stdout.write(`FAIL invalid or duplicate managed skill ${entry}\n`)
      failures += 1
      continue
    }
    managed.add(entry)
    if (!existsSync(join(p.skills, entry))) {
      process.stdout.write(`FAIL managed skill is missing: ${entry}\n`)
      failures += 1
    }
  }

  const mcpPlugins = new Set(state.plugins.filter(plugin => plugin.mcpServers.length > 0).map(plugin => plugin.name))
  for (const enabled of state.enabledMcpPlugins) {
    if (!mcpPlugins.has(enabled)) {
      process.stdout.write(`FAIL enabled MCP plugin is unavailable: ${enabled}\n`)
      failures += 1
    }
  }
  if (!/^[0-9a-f]{40}$/i.test(state.sourceCommit) || state.sourceRepository !== SOURCE_REPOSITORY) {
    process.stdout.write('FAIL source identity is invalid\n')
    failures += 1
  }
  if (existsSync(p.enabledPatch)) {
    const patch = readFileSync(p.enabledPatch, 'utf8')
    if (/@deepseek-ai\//i.test(patch) || /(?:api[_-]?key|bearer|secret|token)\s*:\s*[^$!\s][^\n]*/i.test(patch)) {
      process.stdout.write('FAIL generated MCP patch contains a legacy namespace or literal credential\n')
      failures += 1
    }
  }
  process.stdout.write(`${NAME}: ${failures === 0 ? 'PASS' : 'FAIL'} structural bridge verification (${state.plugins.length} plugins, ${state.managedSkills.length} skills)\n`)
  return failures === 0 ? 0 : 1
}

function doctor(): number {
  const p = paths()
  const state = readState(p.state)
  let failures = 0
  try {
    run('git', ['--version'])
    process.stdout.write('PASS git available\n')
  } catch (error) {
    process.stdout.write(`FAIL git unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
    failures += 1
  }
  if (state === undefined) {
    process.stdout.write('FAIL arsenal not synchronized\n')
    return 1
  }
  process.stdout.write(`PASS arsenal ${state.plugins.length} plugins @ ${state.sourceCommit.slice(0, 12)}\n`)
  process.stdout.write(`PASS native skill bridge ${state.managedSkills.length} mirrored skills\n`)
  const enabled = state.plugins.filter(plugin => state.enabledMcpPlugins.includes(plugin.name))
  process.stdout.write(`PASS MCP bridge ${enabled.length} enabled plugin(s)\n`)
  for (const plugin of enabled) {
    for (const envName of plugin.requiredEnv) {
      if ((process.env[envName] ?? '').length > 0) process.stdout.write(`PASS ${plugin.name}: ${envName} present\n`)
      else {
        process.stdout.write(`WARN ${plugin.name}: ${envName} is not set\n`)
        failures += 1
      }
    }
  }
  if (existsSync(p.enabledPatch)) process.stdout.write(`PASS automatic MCP patch ${p.enabledPatch}\n`)
  return failures === 0 ? 0 : 1
}

function printHelp(): number {
  process.stdout.write('PHOENIX Codex plugin arsenal\n\nCommands:\n  dsh codex-plugin sync\n  dsh codex-plugin list\n  dsh codex-plugin inspect <name>\n  dsh codex-plugin enable <name>\n  dsh codex-plugin disable <name>\n  dsh codex-plugin verify\n  dsh codex-plugin doctor\n  dsh codex-plugin path\n\n')
  process.stdout.write('sync installs the official openai/plugins catalog under $DSH_HOME, exposes skills natively, and prepares MCP patches without copying secrets.\n')
  return 0
}

/** Execute a PHOENIX Codex-plugin arsenal command. */
export function runCodexPlugin(args: readonly string[]): number {
  try {
    const [command = 'list', name] = args
    switch (command) {
      case 'sync': return sync()
      case 'list': return list()
      case 'inspect':
        if (name === undefined) throw new Error('inspect requires a plugin name')
        return inspect(name)
      case 'enable':
        if (name === undefined) throw new Error('enable requires a plugin name')
        return setEnabled(name, true)
      case 'disable':
        if (name === undefined) throw new Error('disable requires a plugin name')
        return setEnabled(name, false)
      case 'verify': return verify()
      case 'doctor': return doctor()
      case 'path':
        process.stdout.write(`${paths().codex}\n`)
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
