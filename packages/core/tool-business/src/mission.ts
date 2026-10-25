/** Pure, bounded intent/capability planning for Kira. NEVER invokes external services. */
/** Domain recognized by the business intent heuristic. */
export type BusinessCategory = 'book' | 'course' | 'software' | 'game' | 'design' | 'research' | 'video' | 'audio' | 'service' | 'unspecified'
/** Commercial stage requested by the user; not authority to execute it. */
export type BusinessAction = 'opportunity' | 'create' | 'validate' | 'package' | 'publish' | 'market' | 'analytics'
/** Public lifecycle state from the connected MCP runtime. */
export type ConnectorStatus = 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
/** Secret-free server state and advertised model-facing tool names. */
export interface RuntimeConnector {
  readonly serverName: string
  readonly status: ConnectorStatus
  readonly toolNames: readonly string[]
}
/** Advisory connector candidate with no implied write permission. */
export interface BusinessCandidate {
  readonly server: string
  readonly status: ConnectorStatus
  readonly tools: readonly string[]
  readonly capability: 'read' | 'write'
  readonly eligible: boolean
}
/** Normalized, non-executing commercial plan and permission blockers. */
export interface BusinessMissionPlan {
  readonly category: BusinessCategory
  readonly actions: readonly BusinessAction[]
  readonly channel: string | null
  readonly confidence: 'high' | 'medium' | 'low'
  readonly openEnded: boolean
  readonly publishingProhibited: boolean
  readonly connectors: readonly BusinessCandidate[]
  readonly connectorState: 'available' | 'unavailable'
  readonly needsConnectorAuthorization: boolean
  readonly browserFallback: 'possible-with-user-session' | 'not-required'
  readonly submissionRequiresApproval: boolean
  readonly blockers: readonly string[]
  readonly nextStep: string
}
const CATEGORY_PATTERNS: readonly [BusinessCategory, RegExp][] = [
  ['book', /\b(?:novela|saga|libro|ebook|manuscrito|kindle|book|novel)\b/u],
  ['course', /\b(?:curso|leccion(?:es)?|educacion|formacion|course|training|academy)\b/u],
  ['software', /\b(?:app|aplicacion|saas|software|web|programa|crm|erp|codigo|api)\b/u],
  ['game', /\b(?:videojuego|juego|godot|unity|steam|game|gaming)\b/u],
  ['design', /\b(?:diseno|plantilla|ilustracion|logo|poster|figma|canva|template)\b/u],
  ['research', /\b(?:investigacion|informe|estudio|reporte|research|report|dashboard|analisis)\b/u],
  ['video', /\b(?:video|reels|youtube|shorts|animacion|film)\b/u],
  ['audio', /\b(?:audio|podcast|musica|cancion|voiceover|narracion)\b/u],
  ['service', /\b(?:servicio|consultoria|asesoria|auditoria|freelance|consulting|service)\b/u],
]
const ACTION_PATTERNS: readonly [BusinessAction, RegExp][] = [
  ['opportunity', /\b(?:investiga|investigar|demanda|mercado|nicho|oportunidad|rentable|competencia|what can i sell)\b/u],
  ['create', /\b(?:crea|crear|construye|construir|desarrolla|desarrollar|escribe|escribir|produce|genera|disena|haz|build|create|write|develop|make)\b/u],
  ['validate', /\b(?:valida|validar|verifica|verificar|audita|comprueba|calidad|revisa|review|test)\b/u],
  ['package', /\b(?:empaqueta|empaquetar|exporta|exportar|compila|maqueta|zip|epub|instalador|release|package)\b/u],
  ['publish', /\b(?:publica|publicar|publicalo|publicala|publique|sube|lanzalo|ponlo a la venta|publish|submit|launch|list for sale)\b/u],
  ['market', /\b(?:promociona|promocionar|publicidad|campana|anuncios|marketing|seo|promote|advertise)\b/u],
  ['analytics', /\b(?:ventas|regalias|ingresos|pedidos|beneficio|conversion|metricas|sales|royalties|revenue|orders)\b/u],
]
const CHANNEL_PATTERNS: readonly [string, RegExp][] = [
  ['amazon-kdp', /\b(?:amazon|kdp|kindle)\b/u],
  ['etsy', /\betsy\b/u], ['shopify', /\bshopify\b/u],
  ['woocommerce', /\b(?:woocommerce|wordpress)\b/u],
  ['gumroad', /\bgumroad\b/u], ['itch', /\b(?:itch|itch\.io)\b/u],
  ['steam', /\bsteam\b/u],
]
const SKILL_SERVERS: Readonly<Record<Exclude<BusinessCategory, 'unspecified'>, readonly RegExp[]>> = {
  book: [/google.*(?:drive|docs)/u, /notion/u],
  course: [/google.*(?:drive|slides)/u, /canva/u, /notion/u],
  software: [/github/u, /vercel/u, /supabase/u],
  game: [/github/u, /figma/u, /canva/u],
  design: [/canva/u, /figma/u],
  research: [/brave/u, /fetch/u, /google.*(?:drive|sheets)/u],
  video: [/heygen/u, /canva/u],
  audio: [/heygen/u],
  service: [/notion/u, /google.*(?:drive|docs)/u],
}
const WRITE_ACTION = /(?:^|_)(?:create|add|update|upload|submit|publish|post|deploy|release|start|edit|delete|modify|insert|write)(?:_|$)/u
const READ_ACTION = /(?:^|_)(?:get|search|read|list|fetch|inspect|find|query|status|preview|lookup|describe)(?:_|$)/u
const DANGEROUS_TOOL = /(?:^|_)(?:purchase|pay|charge|checkout|transfer|withdraw|refund|place_bet)(?:_|$)/u
const TOOL_NAME = /^mcp__[a-z0-9_-]{1,64}__[a-z0-9_-]{1,100}$/u
const SAFE_SERVER = /^[a-z0-9_-]{1,64}$/u
const MAX_CONNECTORS = 200

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
}
function matchedServer(server: string, channel: string | null, category: BusinessCategory, publishing: boolean): boolean {
  if (publishing) {
    if (channel === null) return false
    if (channel === 'amazon-kdp') return /(?:amazon|kdp|kindle)/u.test(server)
    if (channel === 'itch') return /(?:itch|gamejolt)/u.test(server)
    return server.includes(channel)
  }
  if (category === 'unspecified') return false
  return SKILL_SERVERS[category].some(regex => regex.test(server))
}

/**
 * Returns advisory execution routes, not authority to perform a commercial action.
 * @param request - Original user request, excluding secrets.
 * @param runtime - Current secret-free MCP inventory, when the runtime is available.
 * @returns Bounded plan whose connectors are suggestions, never proof of authorization.
 */
export function planBusinessMission(
  request: string,
  runtime: readonly RuntimeConnector[] | undefined,
): BusinessMissionPlan {
  if (typeof request !== 'string' || request.trim().length < 3 || request.length > 4000) {
    throw new TypeError('La petición comercial debe contener entre 3 y 4000 caracteres.')
  }
  const text = normalize(request)
  const category = CATEGORY_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? 'unspecified'
  const detectedActions = ACTION_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
  const publishingProhibited = new RegExp(
    String.raw`\b(?:no|nunca|sin|do not|don't|never|without)\s+(?:lo\s+|la\s+)?`
    + String.raw`(?:publicar|publiques|publica(?:r)?|publish|upload|submit|lanzar)\b`,
    'u',
  ).test(text)
  const actions = detectedActions.filter(action => !(action === 'publish' && publishingProhibited))
  if (actions.length === 0) actions.push('opportunity')
  const channel = CHANNEL_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null
  const publishing = actions.includes('publish')
  const connectors: BusinessCandidate[] = []
  const blockers: string[] = []
  if (runtime !== undefined && !Array.isArray(runtime)) throw new TypeError('Inventario MCP inválido.')
  if ((runtime?.length ?? 0) > MAX_CONNECTORS) throw new TypeError('Inventario MCP excesivamente grande.')
  const inventory: readonly RuntimeConnector[] = runtime ?? []
  for (const candidate of inventory as readonly unknown[]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as RuntimeConnector
    if (typeof entry.serverName !== 'string' || !SAFE_SERVER.test(entry.serverName) ||
      !['ready','starting','disconnected','failed','auth-required'].includes(entry.status) ||
      !Array.isArray(entry.toolNames) || entry.toolNames.length > 400) continue
    const server = entry.serverName.toLowerCase()
    if (!matchedServer(server, channel, category, publishing)) continue
    const names: string[] = (entry.toolNames as readonly unknown[]).filter((name): name is string => typeof name === 'string' && TOOL_NAME.test(name) && name.startsWith('mcp__'+server+'__') && !DANGEROUS_TOOL.test(name))
    const usable = names.filter(name => publishing ? WRITE_ACTION.test(name.split('__').at(-1) ?? '') : WRITE_ACTION.test(name.split('__').at(-1) ?? '') || READ_ACTION.test(name.split('__').at(-1) ?? ''))
    if (usable.length === 0) continue
    const writeNames = usable.filter(name => WRITE_ACTION.test(name.split('__').at(-1) ?? ''))
    const capability = writeNames.length ? 'write' : 'read'
    const selected = publishing ? writeNames : usable
    if (selected.length === 0) continue
    connectors.push({ server, status: entry.status, tools: entry.status === 'ready' ? selected.slice(0, 12) : [], capability, eligible: entry.status === 'ready' })
  }
  const hasReady = connectors.some(item => item.eligible)
  const needsConnectorAuthorization = connectors.some(item => item.status === 'auth-required')
  if (publishing && channel === null) blockers.push('No se indicó una plataforma de publicación.')
  if (publishing && !hasReady) blockers.push('No hay una herramienta MCP comercial de escritura lista y verificada.')
  if (needsConnectorAuthorization) blockers.push('Algún conector pertinente requiere autorización.')
  const confidence = category === 'unspecified' ? 'low' : detectedActions.length > 0 ? 'high' : 'medium'
  return {
    category, actions, channel, confidence,
    openEnded: category === 'unspecified', publishingProhibited,
    connectors: connectors.slice(0, 32), connectorState: runtime === undefined ? 'unavailable' : 'available',
    needsConnectorAuthorization,
    browserFallback: publishing && !hasReady && channel !== null ? 'possible-with-user-session' : 'not-required',
    submissionRequiresApproval: publishing || actions.includes('market'),
    blockers,
    nextStep: publishing ? hasReady
      ? 'Inspeccionar esquema, sesión autenticada y condiciones reales del MCP; pedir aprobación antes de enviar.'
      : channel ? 'Comprobar integración autorizada o mininavegador autenticado; pedir aprobación antes de enviar.'
        : 'Determinar el canal con el usuario antes de cualquier publicación.'
      : category === 'unspecified'
        ? 'Investigar oportunidades antes de elegir el producto; no asumir una categoría.'
        : 'Preparar el flujo de producción específico y los artefactos verificables; no declarar ventas.',
  }
}
