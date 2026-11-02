/**
 * Dynamically route explicitly approved OpenClaw plugin tools through PHOENIX.
 *
 * A Gateway bearer is an operator credential. Neither the model nor this
 * bridge may select arbitrary tool names, local/remote endpoints or policies.
 * The owning human grants exact pluginId/toolName pairs in Connectors.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const policyPath = join(home, 'toolchains', 'openclaw-routing.json')
const auditPath = join(home, 'toolchains', 'openclaw-routing-audit.jsonl')
const localGatewayPath = join(home, 'toolchains', 'openclaw-gateway-local.json')
const IDENT = /^[a-zA-Z0-9@][a-zA-Z0-9._@/:-]{0,100}$/
const DENIED = new Set([
  'exec', 'spawn', 'shell', 'fs_write', 'fs_delete', 'fs_move', 'apply_patch',
  'sessions_spawn', 'sessions_send', 'cron', 'gateway', 'nodes',
])
export interface ApprovedPluginTool { readonly pluginId: string; readonly toolName: string }
interface RequestOptions {
  readonly token: string
  readonly port: number
  readonly fetcher?: typeof fetch
  readonly verifyOwner?: (entry: ApprovedPluginTool) => boolean
  readonly signal?: AbortSignal
}
function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
function valid(entry: ApprovedPluginTool): boolean {
  return IDENT.test(entry.pluginId) && IDENT.test(entry.toolName)
    && !DENIED.has(entry.toolName.toLowerCase())
}
export function readApprovedOpenClawPluginTools(): ApprovedPluginTool[] {
  try {
    const payload = obj(JSON.parse(readFileSync(policyPath, 'utf8')) as unknown)
    if (payload.version !== 1 || !Array.isArray(payload.allowed)) return []
    const unique = new Set<string>()
    const tools: ApprovedPluginTool[] = []
    for (const entry of payload.allowed) {
      const record = obj(entry)
      const pair = { pluginId: String(record.pluginId ?? ''), toolName: String(record.toolName ?? '') }
      const key = pair.pluginId + ':' + pair.toolName
      if (valid(pair) && !unique.has(key)) { unique.add(key); tools.push(pair) }
    }
    return tools.slice(0, 80)
  } catch { return [] }
}
function openClawCli(): { binary: string; prefix: string[] } {
  const pkg = join(home, 'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  if (existsSync(pkg)) {
    try {
      const data = obj(JSON.parse(readFileSync(pkg, 'utf8')) as unknown)
      const b = typeof data.bin === 'string' ? data.bin : obj(data.bin).openclaw
      if (typeof b === 'string') {
        const root = dirname(pkg)
        const target = resolve(root, b)
        const rel = relative(root, target)
        if (rel && !rel.startsWith('..') && existsSync(target)) return { binary: process.execPath, prefix: [target] }
      }
    } catch { /* use PATH fallback */ }
  }
  return process.platform === 'win32'
    ? { binary: 'cmd.exe', prefix: ['/d', '/s', '/c', 'openclaw.cmd'] }
    : { binary: 'openclaw', prefix: [] }
}
function ownerInRuntime({ pluginId, toolName }: ApprovedPluginTool): boolean {
  const command = openClawCli()
  const result = spawnSync(command.binary,
    [...command.prefix, 'plugins', 'inspect', pluginId, '--runtime', '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 256_000,
      stdio: ['ignore', 'pipe', 'ignore'] })
  if (result.status !== 0) return false
  try {
    const payload = obj(JSON.parse(result.stdout) as unknown)
    const runtime = obj(payload.runtime)
    const registrations = obj(payload.registrations)
    const runtimeRegistrations = obj(runtime.registrations)
    const imported = payload.imported === true || runtime.imported === true
      || payload.status === 'loaded' || runtime.status === 'loaded'
    if (!imported) return false
    const all = [runtime.tools, registrations.tools, runtimeRegistrations.tools, payload.registeredTools]
    return all.some(group => Array.isArray(group) && group.some(item =>
      (typeof item === 'string' ? item : obj(item).name) === toolName))
  } catch { return false }
}
function audit(tool: string, passed: boolean): void {
  try {
    appendFileSync(auditPath, JSON.stringify({ at: new Date().toISOString(),
      tool, ok: passed }) + '\n', { mode: 0o600 })
  } catch { /* audit logging cannot reveal secrets or block a valid tool call */ }
}
/** The owner-approved tool must still be owned by the same loaded plugin. */
export async function invokeApprovedOpenClawPlugin(
  entry: ApprovedPluginTool,
  argumentsJson: string,
  options: RequestOptions,
): Promise<{ plugin: string; tool: string; result_json: string }> {
  if (!valid(entry)) throw new Error('OpenClaw plugin tool identity is invalid')
  const allowed = readApprovedOpenClawPluginTools().some(item =>
    item.pluginId === entry.pluginId && item.toolName === entry.toolName)
  if (!allowed) throw new Error('OpenClaw plugin tool needs approval in Settings → Connectors')
  if (options.token.trim().length < 16) throw new Error('OpenClaw Gateway credential is missing')
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error('OpenClaw Gateway port is invalid')
  }
  if (argumentsJson.length > 12000) throw new Error('OpenClaw plugin request is too large')
  let parsed: unknown
  try { parsed = JSON.parse(argumentsJson) as unknown }
  catch { throw new Error('OpenClaw plugin arguments must be a JSON object') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenClaw plugin arguments must be a JSON object')
  }
  if (!(options.verifyOwner ?? ownerInRuntime)(entry)) {
    throw new Error('This OpenClaw plugin tool is no longer registered by the approved plugin')
  }
  const signal = options.signal === undefined
    ? AbortSignal.timeout(20000) : AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(`http://127.0.0.1:${options.port}/tools/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
      body: JSON.stringify({ tool: entry.toolName, args: parsed }),
      signal,
    })
  } catch {
    audit(entry.toolName, false)
    throw new Error('OpenClaw Gateway is offline or the plugin tool timed out')
  }
  if (!response.ok) {
    audit(entry.toolName, false)
    throw new Error(`OpenClaw Gateway rejected this plugin tool (HTTP ${response.status})`)
  }
  const raw: unknown = await response.json().catch(() => undefined)
  if (raw === null || typeof raw !== 'object' || (raw as { ok?: unknown }).ok !== true) {
    audit(entry.toolName, false)
    throw new Error('OpenClaw plugin returned an invalid result')
  }
  audit(entry.toolName, true)
  return {
    plugin: entry.pluginId, tool: entry.toolName,
    result_json: JSON.stringify((raw as { result?: unknown }).result ?? null).slice(0, 24_000),
  }
}
/** Resolve the authenticated local Gateway port at invocation time, not at Host startup. */
function openClawGatewayPort(): number {
  const override = process.env.PHOENIX_OPENCLAW_GATEWAY_PORT
  if (override !== undefined) return Number(override)
  try {
    const value = obj(JSON.parse(readFileSync(localGatewayPath, 'utf8')) as unknown).port
    if (typeof value === 'number' && Number.isInteger(value)
      && value >= 1024 && value <= 65535) return value
  } catch { /* Use the conventional localhost port. */ }
  return 18789
}
export function registerOpenClawPluginTools(ctx: Context): void {
  if (process.env.PHOENIX_OPENCLAW_PLUGIN_ROUTING === '0') return
  // Keep the tool registered so a freshly authorized Gateway is usable
  // immediately. Resolve secrets from PHOENIX's vault on every invocation.
  const resolveToken = async (): Promise<string | undefined> => {
    try {
      const service = (ctx.get as (name: string) => unknown)('credentials') as {
        resolve: (ref: string) => Promise<{ value: string } | undefined>
      } | undefined
      const stored = await service?.resolve('PHOENIX_OPENCLAW_GATEWAY_TOKEN')
      if (stored?.value) return stored.value
    } catch { /* use the explicitly configured environment credential */ }
    return process.env.PHOENIX_OPENCLAW_GATEWAY_TOKEN ?? process.env.OPENCLAW_GATEWAY_TOKEN
  }
  ctx.tools.register(defineTool({
    name: 'openclaw_plugin_catalog',
    description: 'List the exact external OpenClaw plugin tools approved by the owner in PHOENIX Settings. The tools are provided by a separate OpenClaw Gateway; this does not grant access to other plugins.',
    parameters: {},
    output: {
      schema: { type: 'object', properties: {
        approved_tools_json: { type: 'string', required: true },
      }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text' as const, text: value.approved_tools_json }],
    },
    async execute() { return { approved_tools_json: JSON.stringify(readApprovedOpenClawPluginTools()) } },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Available OpenClaw plugin tools' }),
  }))
  ctx.tools.register(defineTool({
    name: 'openclaw_plugin_invoke',
    description: 'Invoke a specific OpenClaw plugin tool already authorized in PHOENIX Connectors. First consult openclaw_plugin_catalog; use only for an explicit user request. Tool permissions, runtime ownership, and Gateway policy are checked again on each call.',
    parameters: {
      plugin_id: { type: 'string', required: true, description: 'Exact approved plugin ID' },
      tool_name: { type: 'string', required: true, description: 'Exact approved tool name' },
      arguments_json: { type: 'string', required: true, description: 'JSON object of arguments for the selected plugin tool.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        plugin: { type: 'string', required: true },
        tool: { type: 'string', required: true },
        result_json: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text' as const, text: value.result_json }],
    },
    async execute(args, execution) {
      const token = await resolveToken()
      if (token === undefined) throw new Error('Configure the private OpenClaw Gateway credential in PHOENIX Connectors')
      return invokeApprovedOpenClawPlugin(
        { pluginId: args.plugin_id, toolName: args.tool_name }, args.arguments_json,
        { token, port: openClawGatewayPort(), signal: execution.signal },
      )
    },
    presentCall: args => ({ card: 'generic', kind: 'execute',
      title: `OpenClaw plugin: ${args.tool_name}` }),
  }))
}
