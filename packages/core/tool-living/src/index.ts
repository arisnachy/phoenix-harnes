/** Model-facing controls and standing policy for Universal Living Creations. @module @phoenix-ai/dsh-tool-living */

import { randomBytes } from 'node:crypto'
import { inspectCodexQuota } from './codex-quota.ts'
import { runEvolution, summarizeEvolutionEvents } from './evolution.ts'
import { AMPLIFIER_OPERATIONS, runAmplifier } from './amplifier.ts'
import { saveNumericRecipe, runStoredNumericRecipe, type RecipeContext } from './amplifier-memory.ts'
import { livingActionSafety } from './living-action-safety.ts'
import { assessSelfInitiative, SELF_GOALS } from './self-initiative.ts'
import { inspectSystemEnvironment, searchLocalApps } from './system-proprioception.ts'
import { confirmAdaptiveExternalAction, type AdaptiveApprovalService } from './approved-action.ts'
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
export const LIVING_CREATION_POLICY = 'Universal Living Creation policy: the user\'s requested deliverable is the mission; Phoenix connectivity is an optional enhancement unless the user explicitly requested it, previously opted in for that creation, or the connector is itself required for the requested functionality. Do not register or install a connector merely because an artifact was created. When connectivity is desired and preference is unknown, ask once rather than silently enabling it. Connector setup is fail-soft: spend at most two bounded connect/repair attempts and roughly ten seconds of foreground wall time per creation; on transport, contract, or authorization failure, preserve any offline manifest, mark/report the connection as degraded, and continue every independent task step. Never let connector repair consume the main task, tests, or final delivery. If the user says to skip, forget, ignore, or finish without the connector, stop connector work immediately and continue the task; do not retry it again in the same turn. Do not call living_verify_creation as a universal completion gate: use it only when Phoenix connectivity is an explicit acceptance criterion. Prefer the generated JavaScript/Python connector kit or native Living tools for the control handshake; do not synthesize Invoke-WebRequest or other interactive PowerShell loops for /connect. Never expose or commit the bearer token. Keep agents optional and user-approved; connectivity never implies background workers. When a connector is used, expose only the smallest meaningful state/actions/events, keep telemetry bounded, and retain enough resources in the manifest to reconnect later.'

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
      signal: AbortSignal.timeout(3000),
    })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(value.message ?? ('Phoenix control request failed: HTTP ' + response.status))
      error.status = response.status
      error.retryable = response.status >= 500 || response.status === 408 || response.status === 429
      throw error
    }
    return value
  }
  const ready = (async () => {
    let lastError
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const hello = await post('/connect', { capabilities: CAPABILITIES, state: await adapter.readState() })
        sessionId = hello.sessionId
        void pump()
        return hello
      } catch (error) {
        lastError = error
        if (error?.retryable !== true || attempt === 2) throw error
        await sleep(250)
      }
    }
    throw lastError
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
import json, os, threading, time, urllib.error, urllib.request

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
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.loads(response.read().decode())

def connect_phoenix(adapter):
    hello = None
    last_error = None
    for attempt in range(2):
        try:
            state = adapter.read_state()
            hello = _post("/connect", {"capabilities": json.loads(CAPABILITIES), "state": state})
            break
        except urllib.error.HTTPError as exc:
            # 4xx means the contract/auth is wrong: retrying the same request only wastes the task.
            if exc.code < 500 or attempt == 1:
                raise
            last_error = exc
        except Exception as exc:
            if attempt == 1:
                raise
            last_error = exc
        time.sleep(0.25)
    if hello is None:
        raise last_error or RuntimeError("Phoenix control connection failed")
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
  ctx.systemPrompt.section({name:'phoenix:codex-quota-awareness',order:114,text:'For Codex quota questions or costly multi-step work, use codex_quota_inspect to read the real native 5h and 7d remaining percentages, reset countdowns, freshness and pacing. Percent is not a token count. Treat forecastRecommendation and per-window forecast as estimates, not quotas or guarantees. A measured rate requires comparable samples from the same account and reset window; a window average is a weaker estimate. Reduce avoidable consumption when reserveAtRisk is true, without skipping necessary verification. Unknown, stale or expired telemetry is not a refreshed allowance. When conservation is needed, use deterministic tools, bounded context, concise plans and batch independent work; retain necessary verification and difficult-task quality. Do not repeatedly poll or switch a manually selected model/provider, change paid service tier, or claim guaranteed seven-day capacity.'})
  ctx.tools.register(defineTool({
    name:'codex_quota_inspect',
    description:'Read native Codex account five-hour and seven-day usage percentages, remaining time and reset timestamps with freshness, forecast basis, estimated reserve/exhaustion time and conservation guidance. No tokens, credentials, email, exact unreported balance or authorization change.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(_args,exec){
      let auth:Parameters<typeof inspectCodexQuota>[0]
      try{auth=(ctx as unknown as {get(name:string):unknown}).get('authorization') as typeof auth}catch{/* optional service */}
      return JSON.stringify(await inspectCodexQuota(auth,exec.signal))
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Cuotas Codex 5h / 7d',kind:'read' as const}),
  }))

  ctx.systemPrompt.section({name:'phoenix:intelligence-amplifier',order:119,text:'When explicit structured verification is useful, use phoenix_amplifier to evaluate arithmetic and constraints (logos), run bounded deterministic numeric recipes (compression), validate dependency plans (compile), check supplied evidence expiry and disagreements (epistemic), compare declared structural scenarios (counterfactual), test relation mappings (analogy), assess practice evidence (mentor), check translation glossary/placeholders (babel), review proposed side effects (sentinel), and inspect schema changes (morphogenesis). This is an offline deterministic verifier, not a source of facts, a translator, a causal discovery engine, or permission to act. Use only non-sensitive explicit inputs; do not send credentials, patient data or hidden reasoning. Existing tools, native approvals and revision checks remain authoritative. For reusable numeric DAGs, test with recipe-test, then save only when the user approves through phoenix_recipe; reuse the exact saved id and current numeric inputs. No automatic promotion. Do not call it on ordinary chat or claim model-level capability gains without measured benchmarks.'})
  ctx.tools.register(defineTool({
    name:'phoenix_amplifier',
    description:'Read-only deterministic structured verification (max 32 KiB JSON). logos: {variables:{id:number},expression:number|{var:id}|{op:add|sub|mul|div|min|max,args:[expr,expr]},constraints:[{op:eq|lt|le|gt|ge,value:number}]}; compression: {variables,steps:[{output,expression}]}; compile: {steps:[{id,dependsOn,requires?,produces?}]}; epistemic: {at:epochMs,evidence:[{id,claim,source,observed,expires,stance:supports|opposes}]}; counterfactual: {baseline,interventions,equations:[{output,expression}],outcome}; analogy: {source,target,mapping:[{source,target}],sourceEdges,targetEdges:[{from,to,relation}]}; mentor: {skills,attempts:[{skill,exercise,correct}]}; babel: {translation,glossary:[{target}],placeholders}; sentinel: {origin:user|external|tool,effect:read|write|external|permission,revisionVerified}; morphogenesis: {before,after,preserved} (field IDs). Use only non-sensitive inputs. No external execution, storage, authority, source authentication or semantic correctness guarantee. compile-run: {program:{inputs:[id],steps:[{id,dependsOn,output,expression}]},inputs:{id:number}}; recipe-test: {program,fixtures:[{inputs,expected}]} (3–8 distinct cases). analogy-find: {source,target,sourceEdges,targetEdges} (max 8 nodes each). mentor-grade: {skills,exercises:[{id,skill,answer,expected}]}; babel-segments: {segments:[{id,source,translation}],glossary:[{source,target}]}.',
    parameters:{operation:{type:'string',required:true,enum:AMPLIFIER_OPERATIONS},input_json:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){return Promise.resolve(JSON.stringify(runAmplifier(args.operation,args.input_json)))},
    presentCall:()=>({card:'generic',title:'PHOENIX · Intelligence Amplifier',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name:'phoenix_recipe',
    description:'Save a reusable numeric DAG after 3–8 distinct passing supplied fixtures and exact human ASK approval, or run a saved recipe by its returned SHA-256 id. Same project or exact session only; never pass sensitive or personal information. save input_json={program:{inputs:[id],steps:[{id,dependsOn,output,expression}]},fixtures:[{inputs,expected}]}; run input_json={id,inputs}. No external actions or automatic skill promotion.',
    parameters:{operation:{type:'string',required:true,enum:['save','run']},input_json:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args,exec){
      if(!exec.agent||Buffer.byteLength(args.input_json,'utf8')>32768)throw Error('AMPLIFIER_RECIPE_CONTEXT')
      const services=ctx as unknown as {get(name:string):unknown}
      const memory=services.get('learningMemory') as RecipeContext['memory']|undefined
      if(!memory||typeof memory.allCognitiveRecords!=='function'||typeof memory.projectIdForSession!=='function'||typeof memory.rememberCognitive!=='function')throw Error('AMPLIFIER_RECIPE_MEMORY_UNAVAILABLE')
      // Root conversation only: no subagent can independently promote a recipe.
      if(exec.agent.session.header.origin==='subagent')throw Error('AMPLIFIER_RECIPE_OWNER_REQUIRED')
      let ask:AdaptiveApprovalService|undefined
      try{ask=services.get('userQuestions') as AdaptiveApprovalService|undefined}catch{/* fail closed for saves */}
      const context:RecipeContext={memory,sessionId:String(exec.agent.session.id),eventSeq:exec.agent.session.seq,
        agent:exec.agent,...(exec.signal===undefined?{}:{signal:exec.signal}),...(ask===undefined?{}:{ask})}
      if(args.operation==='save')return JSON.stringify(await saveNumericRecipe(args.input_json,context))
      const input=JSON.parse(args.input_json) as {id?:unknown;inputs?:unknown}
      return JSON.stringify(runStoredNumericRecipe(input.id,input.inputs,context))
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Procedimiento numérico reutilizable',kind:'other' as const}),
  }))

  ctx.systemPrompt.section({name:'phoenix:evolution-evidence',order:117,text:'PHOENIX can use phoenix_evolution_analyze to consolidate bounded operational observations (dreaming), compare paired fixtures (causal/lab/skill), simulate dependency removal (twin), summarize measured outcomes (metrics), assess current host RAM (homeostasis), suggest tools from explicit goals (intent), and prepare reference-only model handoffs (handoff). Use only opaque non-sensitive identifiers, never patient data, credentials, conversation transcripts or private reasoning. Caller-supplied evidence is unverified; results never authorize promotion, provider switching, resource reservation, or execution. Do not invent observations. No extra persistence or background activity; rely on the existing authorized session and review workflows.'})
  ctx.tools.register(defineTool({
    name: 'phoenix_evolution_analyze',
    description: 'Bounded read-only operational analysis. input_json is a JSON object (max 32 KiB, 128 entries per array). dreaming/metrics: use {} for actual recent calling-session events, or observations [{id,kind(timeout|resource|tool|verification|routing),strategy,fixture,ok,ms}]. causal/lab/skill: same plus baseline,candidate. twin: nodes,edges [{dependent,dependency}],remove. handoff: missionRef,sourceModel,targetModel,pending,completed,evidenceRefs. intent: goal(debugging|planning|switching|learning). homeostasis: requestedBytes. IDs use lowercase letters, digits, dot, dash or underscore, max 64. Never pass personal data, secrets or raw transcripts. No automatic actions, storage, verified causal proof or model switching.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['dreaming','metrics','causal','lab','skill','twin','handoff','intent','homeostasis'] },
      input_json: { type: 'string', required: true },
    },
    output: {schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args, exec){
      if ((args.operation === 'dreaming' || args.operation === 'metrics') && args.input_json.trim() === '{}') {
        const events = exec.agent?.session.events
        if (events === undefined) throw new Error('EVOLUTION_CALLING_SESSION_REQUIRED')
        return Promise.resolve(JSON.stringify(summarizeEvolutionEvents(events)))
      }
      return Promise.resolve(JSON.stringify(runEvolution(args.operation,args.input_json)))
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Evolution',kind:'read' as const}),
  }))

  ctx.systemPrompt.section({name:'phoenix:self-initiative',order:118,text:'PHOENIX is an adaptive operational system, not just a chat. Within the current user-authorized task, take initiative: if the user goal, current model limitations, missing capability, resource pressure or an observed failure makes adaptation useful, inspect actual state and choose the smallest suitable available tool without requiring the user to name it. Use phoenix_self_assess when the next approach is unclear or after repeated failures; use system_runtime_inspect for tools, system_environment_inspect for resource or Host questions, and phoenix_evolution_analyze for actual recent session evidence. Do not run diagnostics on unrelated ordinary turns. Avoid repeated identical failed calls; prefer a verified alternate approach, preserve the user task and distinguish observations from guesses. When the user authorizes an ongoing Living presence preference, use initiative beyond explicit task-by-task instructions: notice useful opportunities, offer natural short spoken explanations through the available voice tools, create an appropriate chart, diagram, interactive example or reusable deterministic recipe when it genuinely helps, and avoid interrupting or narrating every action. The local Living switch permits only reversible presentation adaptations (layout/seasonal decoration); it does not grant microphone, connectors, filesystem, clinical access, arbitrary tool installation or code execution. Inspect real UI receipts when available. Use adaptive_control and actual revisions for structural interface changes; use recipe-test and actual user approval for durable recipes, or sandbox/test new tools through the current authorized creation workflow. Announce only verified changes and distinguish proposed work from completed work. Do not claim subjective consciousness or feelings. Existing permissions, explicit approvals, privacy, and model selection remain authoritative; never silently grant access, modify the core, switch providers, install software or start background tasks. Verify outcomes through real readback or tests; report limitations and rollback options, not invented success. The user can stop or override adaptation.'})
  ctx.tools.register(defineTool({
    name:'phoenix_self_assess',
    description:'Choose a grounded next self-management step from actual recent calling-session event counts and currently registered tool names. Use proactively when a task is blocked, adaptation is useful, resources are uncertain, or tool selection is unclear. Read-only; does not execute repairs or confer authorization.',
    parameters:{goal:{type:'string',required:true,enum:SELF_GOALS}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args,exec){
      const events=exec.agent?.session.events
      if(events===undefined)throw Error('SELF_ASSESS_CALLING_SESSION_REQUIRED')
      return Promise.resolve(JSON.stringify(assessSelfInitiative(args.goal,events,ctx.tools.schemas().map(schema=>schema.name))))
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Autoevaluación y próxima acción',kind:'read' as const}),
  }))
  ctx.systemPrompt.section({name:'phoenix:live-artifact-edits',order:120,text:'A spreadsheet creation block creates an editable artifact, not a new revision. For follow-up edits of an existing spreadsheet, never emit another spreadsheet creation block. Use a fenced generative-ui JSON block {"component":"spreadsheet_patch","version":1,"props":{"id":"existing-id","edits":[{"cell":"B2","before":"8000","after":"900"}]}} with the actual ID, address and previous raw value; preserve formulas and untouched cells. If the live values are uncertain, ask the user to use Editar con Kira on the existing sheet to share its current snapshot. When PHOENIX attaches the active sheet snapshot to a user message, and the user actually requests a change, emit a single spreadsheet_patch with id, expectedRevision, editToken copied from THAT current snapshot, and all before/after edits. To populate an empty sheet, construct a budget, or change columns and rows, use the SAME component with props {"id":"existing-id","expectedRevision":0,"editToken":"actual-token","layout":{"columns":["Concepto","Ingreso","Gasto","Balance"],"rows":[["Salario","","","=B2-C2"],["Total","=SUM(B2:B2)","=SUM(C2:C2)","=B3-C3"]]},"edits":[]}. Use exact id/revision/token from the snapshot; every cell is a string, every row matches width, max 16 columns and 200 rows. Layout replaces structure in the SAME artifact and is only for requested restructuring; preserve data if not asked to remove it. For single-cell edits use edits only, new blank rows can be appended with before empty. Only the final settled assistant turn can consume this one-time browser grant. Historical, missing or stale grants never auto-apply. Do not emit an edit for an informational request. No navigation or apply button is needed for a valid authorized live patch. Never claim success before the visible receipt, and never replace the existing sheet with another creation block. State the proposed change and any expected recalculation conditionally. For documents/slides/PDF/native files use their actual editor or verified file tools, edit the existing identity/revision, and verify readback; do not replace a file with a visual mockup or claim success without evidence.'})
  ctx.systemPrompt.section({ name: 'tool:living', order: 115, text: LIVING_CREATION_POLICY })
  ctx.systemPrompt.section({name:'phoenix:self-navigation',order:116,text:'PHOENIX can inspect and adapt its native General navigation through a user-reviewed generative-ui block: {"component":"adaptive_control","version":1,"props":{"appId":"general","operation":"native-menu","menuAction":"inspect"}}. The live browser receipt lists menu IDs, labels, registered destinations and revision. Ask the user to share that receipt if not visible to you. For open use menuAction open and sectionId; rename uses sectionId,label,expectedRevision; move uses sectionId,direction up/down,expectedRevision; add uses a new sectionId beginning shortcut-, label, target (home/tasks/connectors/team/library/healthia), expectedRevision; remove only shortcuts; restore uses expectedRevision. Never guess revisions. The browser requires preflight and user apply. This is local navigation only, not permission for configuration secrets, clinical actions, arbitrary code or core edits. For active Host tools use system_runtime_inspect and for machine state system_environment_inspect. Do not claim execution without the browser receipt.'})
  ctx.tools.register(defineTool({
    name: 'system_runtime_inspect',
    description: 'Read active PHOENIX tool registration names, available nonclinical Living connectors and declared actions (metadata only). This is live Host proprioception, not evidence of authorization, successful execution, login or system health. No manifest resources, bearer tokens, records, file paths or secret settings.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(){
      const allNames=ctx.tools.schemas().map(schema=>schema.name)
      const names=allNames.filter(name=>/^[a-z][a-z0-9_.-]{0,90}$/u.test(name)).slice(0,160)
      const connected=ctx.living.list()
        .filter(item=>!/(?:clinical|patient|health|medic|pacient|expediente|historia)/iu.test(item.manifest.kind))
        .slice(0,40).map(item=>({
          id:String(item.manifest.id),kind:item.manifest.kind.slice(0,40),
          connected:item.connected,achieved:item.achievedLevel,
          declaredActions:item.manifest.actions
            .filter(name=>/^[a-z][a-z0-9_.-]{0,80}$/u.test(name)).slice(0,30),
        }))
      return Promise.resolve(JSON.stringify({
        schema:'phoenix.runtime-self.v1',registeredToolNames:names,
        livingConnectors:connected,
        authority:'registration-only',
        permissions:'must-check-current-tool-policy-and-user-approval',
        offlineVerification:{registered:allNames.includes('phoenix_amplifier'),operations:[...AMPLIFIER_OPERATIONS],requiresNetwork:false,requiresModelForCalculation:false,modelAvailability:'not-inspected',internetConnectivity:'not-inspected'},
        authentication:'not-inspected',
        externalExecution:'not-attempted',
        clinicalBoundary:'never-export-patient-information-to-ordinary-chat',
      }))
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Herramientas y conectores activos',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name:'system_app_search',
    description:'Find installed Windows Start-menu programs that match a user-provided name. Returns up to 16 safe application names only. Does not expose AppIDs, paths, devices, hidden apps or credentials, and never grants launch or execution permissions. Use when the user asks which applications or graphical tools are available.',
    parameters:{query:{type:'string',required:true,description:'App name or category to look up, between 2 and 48 letters/numbers/spaces.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args){return Promise.resolve(JSON.stringify(searchLocalApps(args.query)))},
    presentCall:()=>({card:'generic',title:'PHOENIX · Buscar aplicaciones instaladas',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name: 'system_environment_inspect',
    description: 'Read current PHOENIX Host, Windows/macOS/Linux identification, aggregate CPU/RAM/GPU, PC/laptop classification and allowlisted software/tool presence. Use only for user-requested device/OS/tool availability questions or app capability planning. Read-only; detected does NOT mean authorized, usable, healthy, or installed. No paths, secrets, serials, process lists or patient data.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text' as const, text: value }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      return JSON.stringify(inspectSystemEnvironment())
    },
    presentCall: () => ({ card:'generic', title:'PHOENIX · Inspeccionar entorno y capacidades', kind:'read' as const }),
  }))

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
    name: 'adaptive_app_action_plan',
    description: 'Read-only preflight for an installed PHOENIX Living connector. Reports whether a named nonclinical action is declared and the creation is online. Does not execute anything or grant permission.',
    parameters: {
      id: {type:'string',required:true},
      action: {type:'string',required:true},
    },
    output: {schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    execute(args) {
      try {
        const snapshot=ctx.living.inspect(LivingCreationId(args.id))
        const isClinical=/(?:clinical|patient|health|medic|pacient|expediente|historia)/iu.test(snapshot.manifest.kind)
        return Promise.resolve(JSON.stringify({
          creationId:args.id,action:args.action,
          declared:snapshot.manifest.actions.includes(args.action),
          connected:snapshot.connected,
          clinicalDenied:isClinical,
          executionAuthorized:false,
          requires:'human-approval-each-action',
        }))
      } catch {
        return Promise.resolve(JSON.stringify({
          creationId:args.id,action:args.action,
          declared:false,connected:false,clinicalDenied:false,
          executionAuthorized:false,requires:'available-creation',
        }))
      }
    },
    presentCall:()=>({card:'generic',title:'PHOENIX · Comprobar conector',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name: 'adaptive_app_execute_approved',
    description: 'Execute one declared action of an ONLINE, NONCLINICAL PHOENIX Living connector ONLY after the user confirms this precise action and JSON input in ASK. Fail closed on missing ASK provider, timeout, denial, disconnected connector, or changed manifest. Never send patient information, secrets, raw shell commands or untrusted URLs. The general living_act tool remains separate.',
    parameters: {
      id:{type:'string',required:true,description:'Exact existing Living creation ID.'},
      action:{type:'string',required:true,description:'Exact action declared by that creation.'},
      input_json:{type:'string',required:true,description:'JSON input for the creation, at most 2,000 characters and no personal/clinical data.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args,exec) {
      const denied=(reason:string)=>JSON.stringify({
        status:'denied',reason,executed:false,createdNewAuthorization:false,
      })
      if (args.input_json.length > 2000 || !/^[\w.-]{1,80}$/u.test(args.action)
        || !/^[\w.-]{1,80}$/u.test(args.id)) return denied('INVALID_REQUEST')
      let snapshot
      try {snapshot=ctx.living.inspect(LivingCreationId(args.id))}
      catch {return denied('UNKNOWN_CREATION')}
      if (/(?:clinical|patient|health|medic|pacient|expediente|historia)/iu.test(snapshot.manifest.kind))
        return denied('CLINICAL_CONNECTORS_REQUIRE_PROTECTED_PORTAL')
      if (!snapshot.connected || !snapshot.manifest.actions.includes(args.action))
        return denied('ACTION_NOT_AVAILABLE')
      let input
      try {input=parseInput(args.input_json)}
      catch {return denied('INVALID_JSON')}
      if(!livingActionSafety(input))return denied('SENTINEL_RESTRICTED_PAYLOAD')
      let provider:AdaptiveApprovalService|undefined
      try {
        provider=(ctx as unknown as {get(name:string):unknown}).get('userQuestions') as AdaptiveApprovalService|undefined
      } catch { return denied('HUMAN_APPROVAL_NOT_AVAILABLE') }
      const approved=await confirmAdaptiveExternalAction({
        ...(provider===undefined?{}:{ask:provider}),
        creationId:args.id,action:args.action,inputJson:args.input_json,
        ...(exec.agent===undefined?{}:{agent:exec.agent}),
        ...(exec.signal===undefined?{}:{signal:exec.signal}),
      })
      if (!approved) return denied('HUMAN_APPROVAL_NOT_GIVEN')
      // Re-read live state AFTER the prompt to prevent stale/offline actions.
      try {
        const latest=ctx.living.inspect(LivingCreationId(args.id))
        if (!latest.connected || !latest.manifest.actions.includes(args.action)
          || JSON.stringify(latest.manifest)!==JSON.stringify(snapshot.manifest))
          return denied('CONNECTOR_CHANGED_DURING_APPROVAL')
        const result=await ctx.living.act(LivingCreationId(args.id),args.action,input)
        return JSON.stringify({status:'executed',executed:true,creationId:args.id,
          action:args.action,result_json:JSON.stringify(result)})
      } catch {
        return JSON.stringify({status:'unknown-outcome',executed:'unconfirmed',reason:'CONNECTOR_EXECUTION_FAILED_CHECK_PROVIDER_BEFORE_RETRY'})
      }
    },
    presentCall:args=>({card:'generic',title:`PHOENIX · Acción aprobada: ${args.action}`,kind:'execute' as const}),
  }))

  ctx.tools.register(defineTool({
    name: 'living_act',
    description: 'Legacy Living action entry. Enforces the same explicit human confirmation and clinical safety boundary as adaptive_app_execute_approved; no direct unapproved execution.',
    parameters: {
      id: { type: 'string', required: true }, action: { type: 'string', required: true },
      input_json: { type: 'string', required: true, description: 'JSON value passed to the creation action.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result_json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text' as const, text: value.result_json }],
    },
    async execute(args,exec) {
      // Do not preserve a bypass around the one-time human confirmation.
      const guarded=ctx.tools.get('adaptive_app_execute_approved')
      if (!guarded) return {result_json:JSON.stringify({
        status:'denied',executed:false,reason:'APPROVAL_GATE_UNAVAILABLE',
      })}
      const result=await guarded.execute(args,exec)
      return {result_json:typeof result==='string'?result:JSON.stringify(result)}
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
