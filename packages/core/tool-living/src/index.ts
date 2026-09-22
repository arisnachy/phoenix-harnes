/** Model-facing controls and standing policy for Universal Living Creations. @module @phoenix-ai/dsh-tool-living */

import { randomBytes } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import {
  LivingCreationId, createLivingControlResource, livingControlForManifest,
  livingLevelRank, parseLivingControlResource,
} from '@phoenix-ai/dsh-living'
import type {
  LivingCreationId as LivingCreationIdType, LivingCreationSnapshot, LivingIntegrationLevel, LivingJson,
} from '@phoenix-ai/dsh-living'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

export const name = 'tool-living'
export const inject = ['living', 'tools', 'systemPrompt']

const LEVELS: readonly LivingIntegrationLevel[] = ['static', 'connected', 'reactive', 'controllable', 'inhabited']
const CREATION_TARGET_LEVELS: readonly LivingIntegrationLevel[] = ['connected', 'reactive', 'controllable', 'inhabited']

/** Standing rule applied to every creation domain, including domains unknown to the harness. */
export const LIVING_CREATION_POLICY = `Universal Living Creation policy: the user's requested deliverable is the mission; Phoenix connectivity is an optional enhancement unless the user explicitly requested it, previously opted in for that creation, or the connector is itself required for the requested functionality. Do not register or install a connector merely because an artifact was created. When connectivity is desired and preference is unknown, ask once rather than silently enabling it. Connector setup is fail-soft: spend at most two bounded connect/repair attempts and roughly ten seconds of foreground wall time per creation; on transport, contract, or authorization failure, preserve any offline manifest, mark/report the connection as degraded, and continue every independent task step. Never let connector repair consume the main task, tests, or final delivery. If the user says to skip, forget, ignore, or finish without the connector, stop connector work immediately and continue the task; do not retry it again in the same turn. Do not call living_verify_creation as a universal completion gate: use it only when Phoenix connectivity is an explicit acceptance criterion. Prefer the generated JavaScript/Python connector kit or native Living tools for the control handshake; do not synthesize Invoke-WebRequest or other interactive PowerShell loops for /connect. Never expose or commit the bearer token. Keep agents optional and user-approved; connectivity never implies background workers. When a connector is used, expose only the smallest meaningful state/actions/events, keep telemetry bounded, and retain enough resources in the manifest to reconnect later.`

interface Summary {
  id: string
  title: string
  kind: string
  target_level: LivingIntegrationLevel
  achieved_level: LivingIntegrationLevel
  connected: boolean
}

function summary(snapshot: LivingCreationSnapshot): Summary {
  return {
    id: snapshot.manifest.id,
    title: snapshot.manifest.title,
    kind: snapshot.manifest.kind,
    target_level: snapshot.manifest.targetLevel,
    achieved_level: snapshot.achievedLevel,
    connected: snapshot.connected,
  }
}


async function provisionResources(
  ctx: Context,
  id: LivingCreationIdType,
  target: LivingIntegrationLevel,
  resources: readonly string[],
): Promise<string[]> {
  const ordinary = resources.filter(resource => parseLivingControlResource(resource) === undefined)
  if (target === 'static') return ordinary

  const existing = ctx.living.list().find(item => item.manifest.id === id)
  const control = existing === undefined ? undefined : livingControlForManifest(existing.manifest)
  const endpoint = control?.endpoint ?? await ctx.living.controlEndpoint()
  const token = control?.token ?? randomBytes(32).toString('base64url')
  return [...ordinary, createLivingControlResource(endpoint, token)]
}

function connectorPayload(snapshot: LivingCreationSnapshot): string {
  const control = livingControlForManifest(snapshot.manifest)
  if (control === undefined) return ''
  return JSON.stringify({
    protocol: control.protocol,
    creation_id: snapshot.manifest.id,
    endpoint: control.endpoint,
    token: control.token,
    capabilities: {
      state: snapshot.manifest.state,
      actions: snapshot.manifest.actions,
      events: snapshot.manifest.events,
      actors: snapshot.manifest.actors,
    },
  })
}

function connectorModules(snapshot: LivingCreationSnapshot): { javascript_module: string; python_module: string } {
  const control = livingControlForManifest(snapshot.manifest)
  if (control === undefined) throw new Error(`living creation ${snapshot.manifest.id} has no provisioned control link`)
  const caps = JSON.stringify({
    state: snapshot.manifest.state,
    actions: snapshot.manifest.actions,
    events: snapshot.manifest.events,
    actors: snapshot.manifest.actors,
  })
  const creation = JSON.stringify(String(snapshot.manifest.id))

  const javascript_module = `// Generated by PHOENIX. Keep PHOENIX_CONTROL_TOKEN out of source control/public bundles.
const CREATION_ID = process.env.PHOENIX_CREATION_ID ?? ${creation}
const ENDPOINT = process.env.PHOENIX_CONTROL_ENDPOINT
const TOKEN = process.env.PHOENIX_CONTROL_TOKEN
const CAPABILITIES = ${caps}

export function connectPhoenix(adapter) {
  if (!ENDPOINT || !TOKEN) throw new Error('PHOENIX_CONTROL_ENDPOINT and PHOENIX_CONTROL_TOKEN are required')
  let sessionId = ''
  let stopped = false
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const post = async (path, body) => {
    const response = await fetch(ENDPOINT + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ creationId: CREATION_ID, ...body }),
    })
    const value = await response.json()
    if (!response.ok) throw new Error(value.message ?? 'Phoenix control request failed')
    return value
  }
  const ready = (async () => {
    const hello = await post('/connect', { capabilities: CAPABILITIES, state: await adapter.readState() })
    sessionId = hello.sessionId
    void pump()
    return hello
  })()
  const syncState = async () => { await ready; return post('/state', { sessionId, state: await adapter.readState() }) }
  const emit = async (name, data) => { await ready; return post('/event', { sessionId, name, data }) }
  const pump = async () => {
    while (!stopped) {
      try {
        const { command } = await post('/poll', { sessionId })
        if (!command) { await sleep(500); continue }
        try {
          const result = await adapter.act(command.action, command.input)
          await post('/result', { sessionId, commandId: command.id, ok: true, result })
        } catch (error) {
          await post('/result', { sessionId, commandId: command.id, ok: false, error: String(error) })
        }
      } catch {
        await sleep(750)
      }
    }
  }
  const stop = async () => {
    stopped = true
    if (sessionId) {
      try { await post('/disconnect', { sessionId }) } catch {}
    }
  }
  return { ready, syncState, emit, stop }
}
`

  const python_module = `# Generated by PHOENIX. Keep PHOENIX_CONTROL_TOKEN out of source control/public bundles.
import json, os, threading, time, urllib.request

CREATION_ID = os.getenv("PHOENIX_CREATION_ID", ${creation})
ENDPOINT = os.environ["PHOENIX_CONTROL_ENDPOINT"]
TOKEN = os.environ["PHOENIX_CONTROL_TOKEN"]
CAPABILITIES = ${JSON.stringify(caps)}

def _post(path, body):
    payload = {"creationId": CREATION_ID, **body}
    req = urllib.request.Request(
        ENDPOINT + path,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode())

def connect_phoenix(adapter):
    state = adapter.read_state()
    hello = _post("/connect", {"capabilities": json.loads(CAPABILITIES), "state": state})
    session_id = hello["sessionId"]
    stopped = threading.Event()

    def pump():
        while not stopped.is_set():
            try:
                command = _post("/poll", {"sessionId": session_id}).get("command")
                if command is None:
                    time.sleep(0.5)
                    continue
                try:
                    result = adapter.act(command["action"], command.get("input"))
                    _post("/result", {"sessionId": session_id, "commandId": command["id"], "ok": True, "result": result})
                except Exception as exc:
                    _post("/result", {"sessionId": session_id, "commandId": command["id"], "ok": False, "error": str(exc)})
            except Exception:
                time.sleep(0.75)

    threading.Thread(target=pump, daemon=True).start()
    return {
        "sync_state": lambda: _post("/state", {"sessionId": session_id, "state": adapter.read_state()}),
        "emit": lambda name, data: _post("/event", {"sessionId": session_id, "name": name, "data": data}),
        "stop": lambda: (stopped.set(), _post("/disconnect", {"sessionId": session_id})),
    }
`
  return { javascript_module, python_module }
}

const SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    target_level: { type: 'string', enum: LEVELS, required: true },
    achieved_level: { type: 'string', enum: LEVELS, required: true },
    connected: { type: 'boolean', required: true },
  },
} as const

const SUMMARY_OUTPUT = {
  schema: SUMMARY_SCHEMA,
  render: (_args: unknown, value: Summary) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}


const REGISTER_OUTPUT = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      ...SUMMARY_SCHEMA.properties,
      connector_json: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: Summary & { connector_json: string }) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

function parseInput(raw: string): LivingJson {
  try {
    return JSON.parse(raw) as LivingJson
  } catch {
    throw new TypeError('input_json must contain valid JSON')
  }
}

function assertTargetReached(snapshot: LivingCreationSnapshot): void {
  if (livingLevelRank(snapshot.achievedLevel) < livingLevelRank(snapshot.manifest.targetLevel)) {
    throw new Error(`living creation ${snapshot.manifest.id} is not ready: achieved ${snapshot.achievedLevel}, target ${snapshot.manifest.targetLevel}`)
  }
}

/** Register the universal living-creation policy and model controls. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:living', order: 115, text: LIVING_CREATION_POLICY })

  ctx.tools.register(defineTool({
    name: 'living_register_creation',
    description: 'Remember any user-facing artifact or runnable system Phoenix creates or materially modifies, using a self-described operational contract. This accepts arbitrary future creation kinds; kind is descriptive, never an enum.',
    parameters: {
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      target_level: { type: 'string', required: true, enum: CREATION_TARGET_LEVELS },
      state: { type: 'array', required: true, items: { type: 'string' } },
      actions: { type: 'array', required: true, items: { type: 'string' } },
      events: { type: 'array', required: true, items: { type: 'string' } },
      resources: { type: 'array', required: true, items: { type: 'string' } },
      actors: { type: 'array', required: true, items: { type: 'string' } },
    },
    output: REGISTER_OUTPUT,
    async execute(args) {
      if (args.target_level === 'static') {
        throw new Error('Phoenix-created or Phoenix-modified creations must target connected or above; static is reserved for legacy/import catalog entries outside the model-facing creation flow')
      }
      const id = LivingCreationId(args.id)
      const snapshot = await ctx.living.remember({
        id, title: args.title, kind: args.kind,
        targetLevel: args.target_level,
        state: args.state, actions: args.actions, events: args.events,
        resources: await provisionResources(ctx, id, args.target_level, args.resources),
        actors: args.actors,
      })
      return { ...summary(snapshot), connector_json: connectorPayload(snapshot) }
    },
    presentCall: args => present('Register living creation', args.title),
  }))

  ctx.tools.register(defineTool({
    name: 'living_get_connector_kit',
    description: 'Return the provisioned Phoenix control descriptor plus drop-in JavaScript and Python sidecar modules for one non-static creation. Keep the bearer token in a local/server-side secret; never commit it or ship it in a public browser bundle.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          connector_json: { type: 'string', required: true },
          javascript_module: { type: 'string', required: true },
          python_module: { type: 'string', required: true },
          security_note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args) {
      const snapshot = ctx.living.inspect(LivingCreationId(args.id))
      const connector_json = connectorPayload(snapshot)
      if (connector_json.length === 0) throw new Error(`living creation ${args.id} is static and has no runtime connector`)
      const modules = connectorModules(snapshot)
      return Promise.resolve({
        connector_json,
        ...modules,
        security_note: 'Inject PHOENIX_CONTROL_ENDPOINT, PHOENIX_CONTROL_TOKEN, and optionally PHOENIX_CREATION_ID at runtime. Never expose the bearer token in a public client bundle or public repository.',
      })
    },
    presentCall: args => present('Get living connector kit', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_inspect_creation',
    description: 'Inspect one remembered creation and report its live integration state. Treat connectivity as advisory unless it is an explicit acceptance criterion.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true }, target_level: { type: 'string', enum: LEVELS, required: true },
          achieved_level: { type: 'string', enum: LEVELS, required: true }, connected: { type: 'boolean', required: true },
          ready: { type: 'boolean', required: true }, manifest_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args) {
      const snapshot = ctx.living.inspect(LivingCreationId(args.id))
      return Promise.resolve({
        id: snapshot.manifest.id, target_level: snapshot.manifest.targetLevel, achieved_level: snapshot.achievedLevel,
        connected: snapshot.connected,
        ready: livingLevelRank(snapshot.achievedLevel) >= livingLevelRank(snapshot.manifest.targetLevel),
        manifest_json: JSON.stringify(snapshot.manifest),
      })
    },
    presentCall: args => present('Inspect living creation', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_list_creations',
    description: 'List creations Phoenix remembers, including offline creations that can reconnect later.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { creations_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.creations_json }],
    },
    execute() { return Promise.resolve({ creations_json: JSON.stringify(ctx.living.list().map(summary)) }) },
    presentCall: () => present('List living creations'),
  }))

  ctx.tools.register(defineTool({
    name: 'living_read_state',
    description: 'Read authoritative live state from a connected creation.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { state_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.state_json }],
    },
    async execute(args) { return { state_json: JSON.stringify(await ctx.living.readState(LivingCreationId(args.id))) } },
    presentCall: args => present('Read living state', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_act',
    description: 'Execute one action declared by a connected creation. The call fails when the creation is offline or the action was not declared.',
    parameters: {
      id: { type: 'string', required: true }, action: { type: 'string', required: true },
      input_json: { type: 'string', required: true, description: 'JSON value passed to the creation action.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.result_json }],
    },
    async execute(args) {
      const result = await ctx.living.act(LivingCreationId(args.id), args.action, parseInput(args.input_json))
      return { result_json: JSON.stringify(result) }
    },
    presentCall: args => present(`Living action: ${args.action}`, args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_verify_creation',
    description: 'Fail unless a creation has reached its declared target integration level. Use only when Phoenix connectivity is an explicit acceptance criterion, not as a universal task-completion gate.',
    parameters: { id: { type: 'string', required: true } },
    output: SUMMARY_OUTPUT,
    execute(args) {
      const snapshot = ctx.living.inspect(LivingCreationId(args.id))
      assertTargetReached(snapshot)
      return Promise.resolve(summary(snapshot))
    },
    presentCall: args => present('Verify living creation', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'living_forget_creation',
    description: 'Explicitly delete Phoenix’s durable relationship to one creation and detach its live provider. Use only when the user explicitly wants Phoenix to stop remembering it or the creation was permanently deleted with no reconnection intended; runtime loss alone is never a reason to call this.',
    parameters: { id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', required: true }, forgotten: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args) {
      const id = LivingCreationId(args.id)
      await ctx.living.forget(id)
      return { id: args.id, forgotten: true }
    },
    presentCall: args => present('Forget living creation', args.id),
  }))
}
