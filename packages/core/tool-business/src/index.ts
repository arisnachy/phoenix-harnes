/** Native model-facing planner that reads the active Phoenix MCP registry, never its secrets. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { planBusinessMission, type RuntimeConnector } from './mission.ts'

export const name = 'tool-business'
export const inject = ['tools', 'systemPrompt']

const GUIDANCE = 'Para solicitudes de negocios, creación o monetización de productos (libros, cursos, apps, juegos, diseños, investigaciones, audio, vídeo y servicios), consulta business_plan_mission antes de elegir conectores. Es una propuesta basada en el inventario MCP actual: ready NO acredita permisos específicos ni éxito. Verifica el esquema real de la herramienta antes de utilizarla. No confundas un inventario vacío con ausencia definitiva de conectores. La publicación, suscripciones, pagos, contratos y anuncios de pago requieren autorización explícita; una prohibición como «no publiques» prevalece. Si el MCP no sirve, comprueba mininavegador autenticado conforme a las condiciones de la plataforma. Nunca inventes ventas, recibos ni entregables.'

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:business', order: 117, text: GUIDANCE })
  ctx.tools.register(defineTool({
    name: 'business_plan_mission',
    description: 'Interpreta la intención comercial de una solicitud y consulta el inventario MCP real de Phoenix para sugerir herramientas listas, autorizaciones pendientes y alternativas seguras. Solo planificación, jamás publica ni gasta.',
    parameters: { request: { type: 'string', required: true, description: 'La petición comercial exacta del usuario, sin credenciales.' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text' as const, text: value }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      let runtime: readonly RuntimeConnector[] | undefined
      try {
        const registry = (ctx.get as (name: string) => unknown)('mcpConnectors') as
          | { list(): readonly RuntimeConnector[] }
          | undefined
        runtime = registry?.list()
      } catch {
        // The optional MCP registry may be temporarily unavailable; NEVER claim it is empty.
        runtime = undefined
      }
      return Promise.resolve(JSON.stringify(planBusinessMission(args.request, runtime)))
    },
    presentCall: () => ({ card: 'generic', title: 'Planificar negocio y conectores', kind: 'read' as const }),
  }))
}
