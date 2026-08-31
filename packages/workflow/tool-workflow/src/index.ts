/**
 * The model-facing `workflow` tool: run a JavaScript orchestration script that fans out
 * subagents, and return the script's final value. It owns the model-facing schema and run lifecycle; script
 * parsing, execution, caps, and cancellation live behind `ctx.workflowEngine`
 * (`@phoenix-ai/dsh-workflow`), so a hardened engine swaps in without touching what the model
 * sees. Execution awaits `run.result` and always disposes the run; non-completed reasons become tool
 * errors, and background collection remains deferred. Presentation is an args-only generic card
 * titled from `meta.name`. Explicit-ask usage guidance is registered as the tool's own prompt
 * section rather than deployment persona prose.
 * @module @phoenix-ai/dsh-tool-workflow
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@phoenix-ai/dsh-tools'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { JsonValue, Session, SessionEventMap } from '@phoenix-ai/dsh-session'
import type {
  WorkflowResult, WorkflowRun, WorkflowRunId, WorkflowStopReason,
} from '@phoenix-ai/dsh-workflow'
import type {
  ToolWorkflowAgentEndData, ToolWorkflowAgentStartData,
  ToolWorkflowRunEndData, ToolWorkflowRunStartData,
} from './types.ts'
// Declaration merge only: makes ctx.systemPrompt visible for the section registration.
import type {} from '@phoenix-ai/dsh-system-prompt'

export const name = 'tool-workflow'
export const inject = ['tools', 'workflowEngine', 'systemPrompt']

/** Config: the model-facing tool name plus result rendering caps. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling, in characters: a longer JSON value is truncated with a notice (default 50000). */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('workflow'),
  maxResultChars: z.natural().min(1).default(50_000),
})

type ResolvedConfig = Required<Config>

interface WorkflowRecorder {
  start(session: Session, run: WorkflowRun): void
  finish(runId: WorkflowRunId, stopReason: WorkflowStopReason): void
  abandon(runId: WorkflowRunId): void
}

interface ToolWorkflowRecordEventMap {
  'tool-workflow/run-start': ToolWorkflowRunStartData
  'tool-workflow/agent-start': ToolWorkflowAgentStartData
  'tool-workflow/agent-end': ToolWorkflowAgentEndData
  'tool-workflow/run-end': ToolWorkflowRunEndData
}

/** Render a contained recording failure without trusting the thrown value. */
function renderRecordingError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Project active top-level workflow runs into their parent Sessions without
 * letting recording failure affect tool execution.
 */
function createWorkflowRecorder(ctx: Context): WorkflowRecorder {
  const active = new Map<WorkflowRunId, Session>()
  const append = <Type extends keyof ToolWorkflowRecordEventMap>(
    session: Session,
    type: Type,
    data: SessionEventMap[Type],
  ): boolean => {
    // These four package-owned events are all log-only. Narrowing the generic
    // append face here discharges Session.append's conditional options tuple.
    const appendRecord = session.append.bind(session) as <Event extends keyof ToolWorkflowRecordEventMap>(
      event: Event,
      value: SessionEventMap[Event],
    ) => void
    try {
      appendRecord(type, data)
      return true
    } catch (error: unknown) {
      ctx.logger.warn(`tool-workflow: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`)
      return false
    }
  }

  ctx.on('workflow/agent-start', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    const data: ToolWorkflowAgentStartData = {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      ...agent.phase === undefined ? {} : { phase: agent.phase },
      childId: agent.childId,
    }
    if (!append(session, 'tool-workflow/agent-start', data)) active.delete(info.id)
  })
  ctx.on('workflow/agent-end', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    const data: ToolWorkflowAgentEndData = {
      runId: info.id,
      seq: agent.seq,
      outcome: agent.outcome,
    }
    if (!append(session, 'tool-workflow/agent-end', data)) active.delete(info.id)
  })

  return {
    start(session, run) {
      if (append(session, 'tool-workflow/run-start', { runId: run.id, name: run.meta.name })) {
        active.set(run.id, session)
      }
    },
    finish(runId, stopReason) {
      const session = active.get(runId)
      if (session !== undefined) append(session, 'tool-workflow/run-end', { runId, stopReason })
      active.delete(runId)
    },
    abandon: (runId) => { active.delete(runId) },
  }
}

/**
 * The script-authoring contract, embedded in the tool description. This IS the
 * model-facing spec: the meta block, the hooks and their exact semantics, and
 * the supported schema subset.
 */
const DESCRIPTION = `Ejecuta un script JavaScript para orquestar subagentes de forma controlada. Úsalo cuando existan piezas independientes reales —auditoría por archivos, migración, investigación con varios ángulos o verificación adversarial— y la coordinación como script aporte valor.

La identidad de la orquestación viaja en \`meta\` como JSON: exige \`name\` y \`description\`, y admite \`whenToUse\` y \`phases\`. \`script\` es únicamente JavaScript plano (no TypeScript ni \`export const meta\`); usa \`await\` de nivel superior y termina con \`return <value>\`. El valor debe ser serializable como JSON.

Funciones disponibles en el script:
- \`agent(prompt, opts?): Promise<any>\` — ejecuta un subagente hasta completar. Sin \`opts.schema\` devuelve el texto final del hijo; con \`opts.schema\` (un esquema JSON raíz de objeto que solo usa type/properties/required/additionalProperties/items/enum/const/oneOf, sin pattern/format ni límites numéricos) devuelve el objeto validado. Devuelve \`null\` si falla el hijo (filtra con \`.filter(Boolean)\`). Otras opciones: \`label\` (etiqueta), \`phase\` (grupo de progreso) y sobrescrituras independientes de \`provider\`/\`model\`; cualquier otra opción (\`effort\`/\`isolation\`/\`agentType\`) se rechaza explícitamente.
- \`pipeline(items, ...stages): Promise<any[]>\` — procesa cada elemento en todas las etapas de forma independiente y SIN barrera entre etapas (preferible para trabajos de varias etapas). Cada etapa recibe \`(prev, item, index)\`. si una etapa lanza un error, ese ELEMENTO pasa a \`null\` y se omiten sus etapas restantes.
- \`parallel(thunks): Promise<any[]>\` — ejecuta funciones sin argumentos en paralelo y espera a TODAS (una barrera; úsala solo cuando una etapa necesite realmente todos los resultados previos). Si una función falla, devuelve \`null\`.
- \`phase(title)\` — inicia una fase de progreso; \`log(message)\` — narra el progreso; \`args\` — recibe literalmente los argumentos de la llamada.

Las funciones mal usadas (argumentos inválidos, opciones desconocidas, esquemas no compatibles o límites superados) lanzan errores que SIEMPRE detienen el script; nunca se convierten en \`null\` por elemento.

Límites: se aplican topes de concurrencia y de agentes totales; no hay acceso a sistema de archivos, red, temporizadores ni APIs de Node.js. Los agentes hacen el trabajo y el script solo coordina. La ejecución es en primer plano y esta llamada termina cuando concluye el script.`

type WorkflowCallArgs = {
  script: string
  meta: {
    name: string
    description: string
    whenToUse?: string
    phases?: { title: string; detail?: string; provider?: string; model?: string }[]
  }
  args?: Record<string, unknown>
}

/** The pending-state card: a generic card titled by the workflow's meta name. */
function presentWorkflowCall(args: WorkflowCallArgs): ToolCallView {
  return {
    card: 'generic',
    title: `orquestación: ${args.meta.name}`,
    rawInput: args.script,
  }
}

/** The completed-state card: keep the pending title; render the result content as-is. */
function presentWorkflowResult(args: WorkflowCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

/** A non-`completed` stop reason means the script did not finish cleanly. */
function stopReasonError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `la orquestación fue cancelada${result.error !== undefined ? ` (${result.error})` : ''}`
    case 'error':
      return `la orquestación falló: ${result.error ?? 'error desconocido'}`
    /* v8 ignore start -- defensive: WorkflowStopReason is a closed union, exhaustive by construction; a future variant fails here loudly */
    default:
      return `la orquestación terminó de forma anómala (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

/** Render the run's outcome text: the meta name, agent count, and the JSON value (capped). */
function renderResult(name: string, agentsStarted: number, value: JsonValue, maxChars: number): string {
  // The engine returns JSON data (null for a valueless script), so stringify never yields undefined.
  const rendered = JSON.stringify(value, null, 2)
  const clipped = rendered.length > maxChars
    ? `${rendered.slice(0, maxChars)}\n… [truncated: ${rendered.length - maxChars} more characters]`
    : rendered
  return `ORQUESTACIÓN "${name}" completada (${agentsStarted} ${agentsStarted === 1 ? 'subagente' : 'subagentes'}).\nRESULTADO:\n${clipped}`
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (the exported Config schema) has already filled the defaulted
  // fields; the assertion records that resolution, not a hidden fallback.
  const { toolName, maxResultChars } = config as ResolvedConfig
  const recorder = createWorkflowRecorder(ctx)
  // Usage policy ships with the tool (the master convention: tool guidance
  // lives in tool plugins as prompt sections, not in the deployment persona).
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: 115,
    text: `Usa ${toolName} SOLO cuando la persona pida explícitamente un workflow o una orquestación grande: escribe un script JavaScript con fases y resultados estructurados. Respeta el límite de 2 subagentes concurrentes y 2 totales. Para una o dos delegaciones, usa llamadas directas seriales. Antes de delegar muestra ORQUESTACION; después resume RESULTADO y EVIDENCIA en español.`,
  })
  ctx.tools.register(defineTool({
    name: toolName,
    description: DESCRIPTION,
    parameters: {
      script: {
        type: 'string',
        required: true,
        description: 'The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`).',
      },
      meta: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: 'The workflow identity block (plain JSON — never code).',
        properties: {
          name: { type: 'string', required: true, description: 'Short kebab-case workflow name.' },
          description: { type: 'string', required: true, description: 'One-line description of what the workflow does.' },
          whenToUse: { type: 'string', description: 'Optional guidance on when this workflow applies.' },
          phases: {
            type: 'array',
            description: 'Optional phase declarations matched by phase() calls.',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                title: { type: 'string', required: true, description: 'The phase title phase() calls match by exact string.' },
                detail: { type: 'string', description: 'Optional one-line description of the phase.' },
                provider: { type: 'string', description: 'Optional provider override this phase is expected to use.' },
                model: { type: 'string', description: 'Optional model override this phase is expected to use.' },
              },
            },
          },
        },
      },
      args: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {"files": [...]}).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          agentsStarted: { type: 'integer', required: true },
          result: { type: 'json', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: renderResult(args.meta.name, value.agentsStarted, value.result, maxResultChars),
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // The loop sets `exec.agent` for every model-driven call; its absence
        // means a non-agent caller invoked the tool directly, which has no
        // parent to attribute the children to. Fail loud rather than guess.
        throw new Error('workflow tool requires a calling agent (exec.agent was undefined)')
      }

      // Meta/body validation failures (META_INVALID/SCRIPT_PARSE) throw
      // synchronously here and become isError results via the registry — the
      // model sees the violation list and can correct the call.
      const run = ctx.workflowEngine.start({
        script: args.script,
        meta: args.meta,
        ...args.args !== undefined ? { args: args.args } : {},
        parent,
        signal: exec.signal,
      })
      const recordsRun = exec.parent === undefined
      // The shipped worker-thread engine publishes member events from later
      // worker messages, after start() returns and this run record is active.
      if (recordsRun) recorder.start(parent.session, run)

      // Bridge the tool's abort signal to the run: if the parent step is aborted while the
      // script is in flight, cancel the whole run. The signal also enters the engine directly, but
      // this local bridge preserves the tool contract even if an implementation ignores it.
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })

      let result: WorkflowResult | undefined
      try {
        result = await run.result
        const error = stopReasonError(result)
        if (error !== undefined) {
          // Map a non-clean finish to an isError result (the registry turns a
          // throw into an isError). Report the reason, not partial output.
          throw new Error(error)
        }
        return {
          runId: run.id,
          agentsStarted: result.agentsStarted,
          result: result.value as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        try {
          // Keep member listeners alive through disposal: an engine may
          // synthesize cancelled member endings while reaching quiescence.
          await run.dispose()
          if (recordsRun) {
            /* v8 ignore next -- WorkflowRun.result never rejects by contract, so result is assigned before finally. */
            if (result === undefined) throw new Error('workflow run settled without a result')
            recorder.finish(run.id, result.stopReason)
          }
        } finally {
          if (recordsRun) recorder.abandon(run.id)
        }
      }
    },
    presentCall: args => presentWorkflowCall(args),
    presentResult: (args, result) => presentWorkflowResult(args, result),
  }))
}
