/**
 * OpenClaw plugin-tool inspection and owner-controlled routing permissions.
 * This is a separate runtime; inspecting metadata never executes a plugin tool.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

export interface OpenClawRoutedTool {
  readonly pluginId: string
  readonly name: string
  readonly enabled: boolean
  readonly imported: boolean
  readonly approved: boolean
}
export interface OpenClawInstalledPlugin {
  readonly id: string
  readonly enabled: boolean
  readonly loaded: boolean
  readonly status: 'loaded' | 'enabled' | 'disabled' | 'error' | 'unknown'
}
export interface OpenClawRoutingSnapshot {
  readonly gatewayCredentialConfigured: boolean
  readonly tools: readonly OpenClawRoutedTool[]
  readonly plugins: readonly OpenClawInstalledPlugin[]
  readonly inspectionAvailable: boolean
}
export interface OpenClawPluginActivationRequest {
  readonly pluginId: string
  readonly enabled: boolean
}
export interface OpenClawRoutingRequest {
  readonly pluginId: string
  readonly toolName: string
  readonly approved: boolean
}

const ID = /^[a-zA-Z0-9@][a-zA-Z0-9._@/:-]{0,100}$/
const FORBIDDEN = new Set([
  'exec', 'spawn', 'shell', 'fs_write', 'fs_delete', 'fs_move', 'apply_patch',
  'sessions_spawn', 'sessions_send', 'cron', 'gateway', 'nodes',
])
const root = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const policyFile = join(root, 'toolchains', 'openclaw-routing.json')

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function entries(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  const r = obj(v)
  for (const key of ['plugins', 'entries', 'items', 'results']) {
    if (Array.isArray(r[key])) return r[key] as unknown[]
  }
  return []
}
function names(v: unknown): string[] {
  const result: string[] = []
  for (const item of Array.isArray(v) ? v : []) {
    const name = typeof item === 'string' ? item : str(obj(item).name)
    if (ID.test(name) && !FORBIDDEN.has(name.toLowerCase()) && !result.includes(name)) result.push(name)
  }
  return result
}
export function normalizedRuntimeTools(report: unknown): { imported: boolean; tools: string[] } {
  const v = obj(report)
  const runtime = obj(v.runtime)
  const registrations = obj(v.registrations)
  const runtimeRegistrations = obj(runtime.registrations)
  // A manifest tool list is not runtime evidence: require actual runtime fields.
  const tools = [
    ...names(runtime.tools), ...names(registrations.tools),
    ...names(runtimeRegistrations.tools), ...names(v.registeredTools),
  ]
  return {
    imported: v.imported === true || runtime.imported === true
      || v.status === 'loaded' || runtime.status === 'loaded',
    tools: [...new Set(tools)].slice(0, 70),
  }
}

function cli(): { bin: string; args: string[] } {
  const pkg = join(root, 'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  if (existsSync(pkg)) {
    try {
      const data = obj(JSON.parse(readFileSync(pkg, 'utf8')) as unknown)
      const bin = typeof data.bin === 'string' ? data.bin : str(obj(data.bin).openclaw)
      const base = dirname(pkg)
      const entry = resolve(base, bin)
      const rel = relative(base, entry)
      if (bin && rel && !rel.startsWith('..') && existsSync(entry)) {
        return { bin: process.execPath, args: [entry] }
      }
    } catch { /* use PATH */ }
  }
  return process.platform === 'win32'
    ? { bin: 'cmd.exe', args: ['/d', '/s', '/c', 'openclaw.cmd'] }
    : { bin: 'openclaw', args: [] }
}
function run(args: readonly string[], timeout = 9000, json = true): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const target = cli()
    const child = spawn(target.bin, [...target.args, ...args], {
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    let ended = false
    const done = (value: unknown, failed: boolean): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      if (failed) reject(new Error('OpenClaw runtime inspection failed'))
      else resolveResult(value)
    }
    const timer = setTimeout(() => { child.kill(); done(undefined, true) }, timeout)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output = (output + chunk).slice(-300_000) })
    child.on('error', () => { done(undefined, true) })
    child.on('close', code => {
      if (code !== 0) { done(undefined, true); return }
      if (!json) { done(output, false); return }
      try { done(JSON.parse(output) as unknown, false) }
      catch { done(undefined, true) }
    })
  })
}
function approvedTools(): Set<string> {
  try {
    const raw = obj(JSON.parse(readFileSync(policyFile, 'utf8')) as unknown)
    if (raw.version !== 1 || !Array.isArray(raw.allowed)) return new Set()
    return new Set(raw.allowed.flatMap(item => {
      const v = obj(item)
      const pluginId = str(v.pluginId)
      const name = str(v.toolName)
      return ID.test(pluginId) && ID.test(name) && !FORBIDDEN.has(name.toLowerCase())
        ? [pluginId + ':' + name] : []
    }))
  } catch { return new Set() }
}
/** Only installed and runtime-imported plugin tools are eligible for PHOENIX routing. */
export async function readOpenClawRouting(): Promise<OpenClawRoutingSnapshot> {
  const allowed = approvedTools()
  const gatewayCredentialConfigured = Boolean(
    process.env.PHOENIX_OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN,
  )
  let list: unknown
  try { list = await run(['plugins', 'list', '--json']) }
  catch { return { gatewayCredentialConfigured, tools: [], plugins: [], inspectionAvailable: false } }
  const inventory = entries(list).map(obj).filter(plugin => ID.test(str(plugin.id))).slice(0, 200)
  const installed: OpenClawInstalledPlugin[] = inventory.map(plugin => {
    const status = str(plugin.status)
    const state: OpenClawInstalledPlugin['status'] =
      status === 'loaded' || status === 'enabled' || status === 'disabled' || status === 'error'
        ? status : 'unknown'
    return {
      id: str(plugin.id),
      status: state,
      enabled: plugin.enabled !== false && (plugin.enabled === true
        || status === 'enabled' || status === 'loaded'),
      loaded: status === 'loaded',
    }
  })
  const plugins = inventory.filter(plugin => plugin.enabled !== false
    && (plugin.enabled === true || plugin.status === 'enabled' || plugin.status === 'loaded')
    && plugin.status !== 'error')
  const tools: OpenClawRoutedTool[] = []
  // Bound simultaneous CLI inspection, avoiding a long sequential Settings stall.
  for (let index = 0; index < plugins.length; index += 5) {
    const group = await Promise.all(plugins.slice(index, index + 5).map(async plugin => {
      const pluginId = str(plugin.id)
      let report: unknown
      try { report = await run(['plugins', 'inspect', pluginId, '--runtime', '--json']) }
      catch { return [] as OpenClawRoutedTool[] }
      const runtime = normalizedRuntimeTools(report)
      return runtime.tools.map(name => ({
        pluginId, name, enabled: true, imported: runtime.imported,
        approved: runtime.imported && allowed.has(pluginId + ':' + name),
      }))
    }))
    for (const batch of group) tools.push(...batch)
  }
  return { gatewayCredentialConfigured, tools, plugins: installed, inspectionAvailable: true }
}
/** Explicit owner action; no arbitrary tool names may be added by the model. */
export async function setOpenClawRoutingPermission(
  request: OpenClawRoutingRequest,
): Promise<OpenClawRoutingSnapshot> {
  if (!ID.test(request.pluginId) || !ID.test(request.toolName)
    || FORBIDDEN.has(request.toolName.toLowerCase())) throw new Error('Invalid OpenClaw tool identity')
  const snapshot = await readOpenClawRouting()
  if (request.approved && !snapshot.tools.some(tool => tool.imported
    && tool.pluginId === request.pluginId && tool.name === request.toolName)) {
    throw new Error('Plugin tool is not loaded; enable and authorize the plugin first')
  }
  const allowed = approvedTools()
  const key = request.pluginId + ':' + request.toolName
  if (request.approved) allowed.add(key)
  else allowed.delete(key)
  const ordered = [...allowed].sort().map(k => {
    const index = k.indexOf(':')
    return { pluginId: k.slice(0, index), toolName: k.slice(index + 1) }
  })
  const folder = dirname(policyFile)
  mkdirSync(folder, { recursive: true })
  const tmp = policyFile + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify({ version: 1, allowed: ordered }, null, 2), { mode: 0o600 })
  renameSync(tmp, policyFile)
  return readOpenClawRouting()
}

/**
 * Explicit owner action to activate an already-installed OpenClaw plugin.
 * A plugin enabled in OpenClaw is NOT automatically approved for Kira.
 */
export async function setOpenClawPluginEnabled(
  request: OpenClawPluginActivationRequest,
): Promise<OpenClawRoutingSnapshot> {
  if (!ID.test(request.pluginId)) throw new Error('Invalid installed plugin identity')
  const current = await readOpenClawRouting()
  if (!current.inspectionAvailable || !current.plugins.some(item => item.id === request.pluginId)) {
    throw new Error('Plugin is not installed in this OpenClaw runtime')
  }
  await run(['plugins', request.enabled ? 'enable' : 'disable', request.pluginId], 15_000, false)
  const updated = await readOpenClawRouting()
  const item = updated.plugins.find(plugin => plugin.id === request.pluginId)
  if (item === undefined || item.enabled !== request.enabled) {
    throw new Error('OpenClaw did not confirm the requested plugin state')
  }
  return updated
}
