/**
 * One click in App Studio starts a real conversation with the active PHOENIX
 * harness. It never creates an installed app or bypasses the model/tool pipeline.
 */
export const ADAPTIVE_MISSION_EVENT = 'phoenix:adaptive-app-mission' as const

export function isAdaptiveMissionEvent(value: unknown): value is { readonly intent: 'new-app' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 1 && request.intent === 'new-app'
}

/**
 * Human-led app creation. Source code, data, external APIs, and credentials
 * are NEVER modified directly by this browser event.
 */
export function newAdaptiveAppMission(): string {
  return [
    'Quiero crear una nueva aplicación dentro de PHOENIX Adaptive Workspace.',
    'Actúa mediante el flujo habitual de PHOENIX: Kira coordina; Sol planifica y Luna ejecuta con las herramientas reales disponibles, sin asumir modelos o capacidades que no estén instalados.',
    'Primero conversa conmigo para identificar objetivo, usuarios, pantallas, datos, entradas y salidas. Si faltan datos esenciales, haz preguntas concretas; no inventes mis requisitos.',
    'Si el repositorio está disponible, usa `pnpm adaptive:inspect` como inventario no privilegiado de componentes declarados. No confundas ese inventario con disponibilidad activa, permisos ni salud del sistema.',
    'Haz una auditoría limitada y verificable de las capacidades activas de este PHOENIX: herramientas, modelos, extensiones, almacenamiento, renderizadores, permisos, pruebas y rutas de restauración. Distingue disponible, conectado, pendiente y deshabilitado. Nunca muestres secretos ni registres datos clínicos en el chat general.',
    'Con los requisitos acordados, diseña 1-3 propuestas visuales fieles a la apariencia actual de PHOENIX (Pearl Light, menú contextual, panel adaptativo y chat siempre disponible). Usa la herramienta real de imágenes o previsualización HTML si está disponible y presenta una alternativa descriptiva si no lo está. No presentes una imagen como una app funcional.',
    'Propón arquitectura, formularios editables, controles configurables, destino de cada input (local/API/chat/IA), permisos, almacenamiento, flujos, salidas profesionales, pruebas y riesgos. Reutiliza los componentes y servicios del harness en vez de duplicarlos.',
    'Antes de instalar o publicar cambios, enséñame una vista previa, un diff de capacidades/estructura y los efectos previstos; pide aprobación para escrituras sensibles o cambios persistentes. Nunca transformes automáticamente el núcleo ni eludas autenticación, controles clínicos o autorizaciones.',
    'Una vez aprobado, implementa en una extensión aislada de la aplicación, verifica compilación y pruebas con datos sintéticos, activa por etapas y registra un punto de recuperación. Si falla, restaura el último estado correcto y conserva PHOENIX General.',
    'Comienza preguntándome qué aplicación quiero construir y qué problema debe resolver; luego planifica conmigo paso a paso.',
  ].join('\n\n')
}

/**
 * Reuse the real session/input service with a narrow testable choreography.
 * This is an explicit user gesture, not a model permission grant.
 */
export interface AdaptiveMissionTransport<Session extends string, Workspace extends string> {
  readonly current: () => Session | undefined
  readonly workspaces: () => {
    readonly items: readonly { readonly workspaceId: Workspace; readonly sessionIds: readonly Session[] }[]
    readonly recentWorkspaceId?: Workspace | undefined
  }
  readonly create: (options: { workspaceId?: Workspace }) => Promise<Session>
  readonly open: (id: Session) => void
  readonly input: (id: Session) => {
    readonly setDraft: (text: string) => void
    readonly submit: () => void
  }
}
export async function startAdaptiveAppConversation<Session extends string, Workspace extends string>(
  transport: AdaptiveMissionTransport<Session, Workspace>,
): Promise<Session> {
  const active = transport.current()
  const workspace = transport.workspaces()
  const target = (active === undefined ? undefined : workspace.items.find(
    item => item.sessionIds.includes(active),
  )?.workspaceId) ?? workspace.recentWorkspaceId
  const sessionId = await transport.create(target === undefined ? {} : { workspaceId: target })
  transport.open(sessionId)
  const input = transport.input(sessionId)
  input.setDraft(newAdaptiveAppMission())
  input.submit()
  return sessionId
}
