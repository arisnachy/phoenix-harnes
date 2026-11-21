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
    'Cuando acordemos nombre y secciones, crea una propuesta instalable en un bloque ```generative-ui de JSON estricto con {"component":"adaptive_app","version":1,"props":{"title":"Nombre de la app","description":"Objetivo resumido","sections":["Inicio","Gestión","Reportes"]}}. Sustituye esos valores por lo acordado; usa de 1 a 12 secciones, textos breves y no incluyas credenciales, datos personales ni acciones ejecutables. El usuario pulsa «Añadir a mis aplicaciones» para guardar solo el manifiesto validado y abrir su espacio. Esto no instala conectores ni un backend; continúa el desarrollo de funciones por el chat.',

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
  prompt = newAdaptiveAppMission(),
): Promise<Session> {
  const active = transport.current()
  const workspace = transport.workspaces()
  const target = (active === undefined ? undefined : workspace.items.find(
    item => item.sessionIds.includes(active),
  )?.workspaceId) ?? workspace.recentWorkspaceId
  const sessionId = await transport.create(target === undefined ? {} : { workspaceId: target })
  transport.open(sessionId)
  const input = transport.input(sessionId)
  input.setDraft(prompt)
  input.submit()
  return sessionId
}

/** The form mission carries app/section identifiers, never input values. */
export function isAdaptiveFormMissionEvent(value: unknown): value is {
  readonly appId: string; readonly sectionId: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return Object.keys(request).length === 2
    && typeof request.appId === 'string' && /^app-[a-z0-9-]{1,45}$/u.test(request.appId)
    && typeof request.sectionId === 'string' && /^[a-z][a-z0-9-]{0,47}$/u.test(request.sectionId)
}
export function newAdaptiveFormMission(appId: string, sectionId: string): string {
  if (!isAdaptiveFormMissionEvent({ appId, sectionId })) throw new Error('ADAPTIVE_INVALID_FORM_MISSION')
  return [
    `Quiero configurar por chat el formulario de la aplicación ${appId}, sección ${sectionId} en PHOENIX.`,
    'Pregunta qué campos y comportamientos necesito; planifica primero, no inventes datos, herramientas ni permisos.',
    'Cuando acordemos la estructura, genera un bloque ```generative-ui con un JSON completo de la forma: {"component":"adaptive_form","version":1,"props":{"appId":"'
      + appId + '","sectionId":"' + sectionId
      + '","fields":[{"label":"Cantidad","kind":"number","destination":"local","output":"table"}]}}.',
    'Tipos de entrada permitidos: text, number, date, select, textarea. Destinos: local, api, chat, ai. Salidas: inline, table, document, chat. Máximo 20 campos por propuesta y 40 por formulario. No incluyas valores, rutas, scripts, URLs, secretos o datos personales.',
    'La propuesta se aplicará solo cuando yo pulse «Aplicar campos al formulario». API, chat e IA son configuraciones pendientes: no las ejecutes ni afirmes que están conectadas.',
    'Para integración real con herramientas o servicios, crea adaptadores revisables, solicita permisos, realiza pruebas y utiliza el sistema de recuperación. Healthia clínica usa exclusivamente el backend protegido.',
  ].join('\n\n')
}
