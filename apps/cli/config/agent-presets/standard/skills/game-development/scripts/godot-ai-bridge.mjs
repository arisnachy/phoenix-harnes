/**
 * Integrate the upstream Godot AI v4 "DeepSeek Harness" dock configuration
 * with the Phoenix MCP package name. Never invent/print rotating capabilities.
 *
 * node .../godot-ai-bridge.mjs doctor [--home PATH] [--project DIR]
 * node .../godot-ai-bridge.mjs sync --allow-config-edit [--home PATH]
 * node .../godot-ai-bridge.mjs plan [--home PATH]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const VENDOR = '@deepseek-ai/' + 'dsh-mcp-client'
const NATIVE = '@phoenix-ai/dsh-mcp-client'
const GODOT_MIN = [4, 7]
const options = process.argv.slice(2)
const operation = options.shift() ?? 'doctor'
const flags = new Map()
for (let i = 0; i < options.length; i++) {
  const option = options[i]
  if (option === '--allow-config-edit') {
    if (flags.has(option)) throw new Error('Duplicate config-edit grant.')
    flags.set(option, true)
  } else if (['--home', '--project'].includes(option)) {
    if (flags.has(option) || !options[i + 1]) throw new Error('Malformed Godot AI option.')
    flags.set(option, options[++i])
  } else throw new Error('Unknown Godot AI option.')
}
if (!['doctor', 'plan', 'sync'].includes(operation)) throw new Error('Unknown Godot AI action.')
if (operation !== 'sync' && flags.has('--allow-config-edit')) throw new Error('Only sync accepts --allow-config-edit.')
if (operation === 'sync' && !flags.has('--allow-config-edit')) throw new Error('sync needs explicit --allow-config-edit.')
if (operation === 'sync' && flags.has('--project')) throw new Error('sync only changes the DSH home config.')

const home = resolve(flags.get('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const path = join(home, 'cordis.patch.yml')
function probe(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: 'utf8', timeout: 7000, maxBuffer: 4096 })
  return { ready: result.status === 0, output: String(result.stdout || result.stderr || '').trim().slice(0, 200) }
}
function godotReadiness() {
  const explicit = process.env.PHOENIX_GODOT_BIN
  const candidates = explicit ? [explicit] : ['godot', 'godot4',
    ...(process.platform === 'win32' && process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'godot.exe')] : [])]
  for (const binary of candidates) {
    const result = probe(binary, ['--version'])
    const match = result.output.match(/^(\d+)\.(\d+)/)
    if (result.ready && match) {
      return { ready: Number(match[1]) > GODOT_MIN[0]
        || Number(match[1]) === GODOT_MIN[0] && Number(match[2]) >= GODOT_MIN[1],
        version: result.output, binary }
    }
  }
  return { ready: false, reason: 'Godot AI v4 requires Godot 4.7+; install a compatible editor and configure PHOENIX_GODOT_BIN.' }
}
function analyze(text) {
  const lines = text.split(/\r?\n/u)
  const matches = []
  let inInsert = false
  let block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/u.test(line) && !/^\s*#/u.test(line)) inInsert = /^- insert:\s*$/u.test(line)
    const h = /^(\s+)- id: ['"]?mcp-godot-ai['"]?\s*$/u.exec(line)
    if (!h) continue
    if (!inInsert) return { state: 'malformed', reason: 'Godot AI is not nested under an insert entry.' }
    const indent = h[1].length
    let end = i + 1
    while (end < lines.length && (!lines[end].trim() || /^\s*#/u.test(lines[end])
      || (lines[end].match(/^\s*/u)?.[0].length ?? 0) > indent)) end++
    matches.push({ start: i, end, lines: lines.slice(i, end) })
    block = matches[0]
  }
  if (matches.length > 1) return { state: 'malformed', reason: 'More than one Godot AI entry.' }
  if (!block) return { state: 'absent' }
  const body = block.lines.join('\n')
  const pkg = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/mu.exec(body)?.[1]
  const valid = /^\s+serverName:\s*['"]?godot-ai['"]?\s*$/mu.test(body)
    && /^\s+transport:\s*['"]?stdio['"]?\s*$/mu.test(body)
    && /^\s+command:\s*\S+/mu.test(body)
    && /^\s+args:\s*\[.+\]\s*$/mu.test(body)
    && /godot-ai/u.test(body) && /attach/u.test(body)
    && !/^\s+url:\s*\S+/mu.test(body)
  if (!valid || (pkg !== VENDOR && pkg !== NATIVE)) {
    return { state: 'malformed', reason: 'Expected official stdio attach from Godot AI dock (not raw HTTP).' }
  }
  return { state: pkg === NATIVE ? 'ready-config' : 'vendor-config', block, pkg }
}
function report(status, extra = {}) {
  // Never serialize command arguments, capability files, or environment tokens.
  process.stdout.write(JSON.stringify({ ...status, ...extra }) + '\n')
}
const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
const state = analyze(text)
const project = flags.get('--project') ? resolve(flags.get('--project')) : undefined
const addon = project ? join(project, 'addons', 'godot_ai', 'plugin.cfg') : undefined
const engine = operation === 'sync' ? undefined : godotReadiness()
const uvx = operation === 'sync' ? undefined : probe(process.env.PHOENIX_UVX_BIN ?? 'uvx', ['--version'])
if (operation === 'plan') {
  report({ action: 'plan', state: state.state, godot: engine, uvxReady: uvx.ready,
    addonPresent: addon ? existsSync(addon) : null,
    next: 'Install Godot 4.7+, uv and a verified Godot AI v4 release in the project. Enable the editor plugin, choose DeepSeek Harness > Configure, then sync the package alias for Phoenix and restart Phoenix.' })
} else if (operation === 'doctor') {
  const connected = state.state === 'ready-config' && engine.ready && uvx.ready
    && (addon === undefined || existsSync(addon))
  report({ action: 'doctor', state: state.state, configured: state.state === 'ready-config',
    prerequisitesReady: engine.ready && uvx.ready, configReady: state.state === 'ready-config',
    addonPresent: addon ? existsSync(addon) : null, godot: engine, uvxReady: uvx.ready,
    status: connected ? 'configured-not-live-verified' : 'setup-required',
    next: connected
      ? 'Restart Phoenix and use godot-ai editor_state + scene_get_hierarchy to verify the live authenticated MCP session.'
      : state.state === 'vendor-config'
        ? 'Run sync --allow-config-edit after reviewing dock-generated entry.'
        : 'Install/enable Godot AI and choose DeepSeek Harness > Configure in Godot.' })
  process.exitCode = connected ? 0 : 1
} else if (state.state !== 'vendor-config' && state.state !== 'ready-config') {
  report({ action: 'sync', updated: false, state: state.state, reason: state.reason ?? 'Run Configure from Godot AI dock first.' })
  process.exitCode = 1
} else if (state.state === 'ready-config') {
  report({ action: 'sync', updated: false, state: 'ready-config' })
} else {
  const lines = text.split(/\r?\n/u)
  const { start, end } = state.block
  const original = lines.slice(start, end).join('\n')
  const changed = original.replace(/^(\s+name:\s*['"]?)@deepseek-ai\/dsh-mcp-client(['"]?\s*)$/mu,
    '$1@phoenix-ai/dsh-mcp-client$2')
  if (changed === original) throw new Error('Godot AI client package alias could not be updated.')
  const updated = lines.slice(0, start).concat(changed.split('\n'), lines.slice(end)).join('\n')
  const before = createHash('sha256').update(text).digest('hex')
  if (createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex') !== before) {
    throw new Error('DSH patch changed concurrently; retry rather than overwrite.')
  }
  const mode = statSync(path).mode & 0o777
  const tmp = path + '.phoenix-godot-ai-tmp-' + process.pid
  try {
    writeFileSync(tmp, updated, { mode: mode & 0o600, flag: 'wx' })
    renameSync(tmp, path)
  } finally {
    // Clean only our own staging file; unrelated patch rows are untouched.
    if (existsSync(tmp)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(tmp)
    }
  }
  report({ action: 'sync', updated: true, state: 'ready-config',
    note: 'Only the MCP package alias changed. The upstream dock may regenerate its entry on update; rerun sync and restart Phoenix.' })
}
