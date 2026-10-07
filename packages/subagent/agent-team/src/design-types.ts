/**
 * Client-safe Team Studio design vocabulary.
 *
 * Stable member ids are runtime addresses. Everything user-visible may change
 * without changing those ids, so renaming or reskinning never breaks Team routing.
 */

/** Settings namespace that stores the complete Team Studio document. */
export const TEAM_DESIGN_SETTINGS_NAMESPACE = 'agent-team-design' as const

/** Stable specialist ids backed by Phoenix's existing twenty-person roster. */
export const TEAM_DESIGN_MEMBER_IDS = [
  'vortice', 'aurora', 'atlas', 'nova', 'lumen', 'helix', 'prisma', 'orion',
  'vega', 'eclipse', 'argo', 'solaria', 'nexo', 'astra', 'lyra', 'zenith',
  'cobalto', 'quasar', 'senda', 'orbita',
] as const

/** Stable specialist id accepted by Team Studio. */
export type TeamDesignMemberId = typeof TEAM_DESIGN_MEMBER_IDS[number]

/** Avatar key backed by the existing lightweight reactive portrait renderer. */
export type TeamDesignAvatarId = 'kira' | TeamDesignMemberId

/** Explicit self-reference identity used for natural grammatical language. */
export type TeamDesignGender = 'female' | 'male' | 'neutral'

/** User-selected intensity for subtle avatar motion. */
export type TeamDesignMotion = 'subtle' | 'normal' | 'expressive'

/** User-editable visible identity for one stable Team runtime slot. */
export interface TeamDesignPerson {
  /** Stable runtime address; never changes when the visible persona changes. */
  readonly id: 'lead' | TeamDesignMemberId
  /** Name rendered in chat, mentions, Settings, and Team presence. */
  readonly displayName: string
  /** Visible functional role. */
  readonly role: string
  /** Explicit self-reference identity; never inferred from name or artwork. */
  readonly gender: TeamDesignGender
  /** Compact behavioral guidance for this persona. */
  readonly personality: string
  /** Human-readable voice/tone preference. */
  readonly voice: string
  /** Reactive portrait key. */
  readonly avatar: TeamDesignAvatarId
  /** Whether the specialist can be selected for execution. The lead is always enabled. */
  readonly enabled: boolean
}

/** One named Team Studio design with one lead and exactly twenty specialist slots. */
export interface TeamDesign {
  /** Stable design id used only for switching saved teams. */
  readonly id: string
  /** User-visible team name. */
  readonly name: string
  /** Natural-language visual/theme brief retained for later iteration. */
  readonly themePrompt: string
  /** Requested avatar animation intensity. */
  readonly motion: TeamDesignMotion
  /** Lead identity, structurally present and always enabled. */
  readonly lead: TeamDesignPerson
  /** Exactly twenty stable specialist slots. */
  readonly members: readonly TeamDesignPerson[]
}

/** Persisted Team Studio document with one active design and bounded saved alternatives. */
export interface TeamDesignDocument {
  /** Wire version for future migrations. */
  readonly version: 1
  /** Id of the currently active saved design. */
  readonly activeTeamId: string
  /** Up to twelve saved Team designs. */
  readonly teams: readonly TeamDesign[]
}

/** Scalar settings envelope so a complete generated Team replaces atomically. */
export interface TeamDesignSettingsEnvelope {
  /** Serialized {@link TeamDesignDocument}. */
  readonly document: string
}

const DEFAULT_MEMBERS: readonly TeamDesignPerson[] = [
  { id: 'vortice', displayName: 'Vórtice', role: 'Rendimiento', gender: 'male', personality: 'Rápido, competitivo y alérgico al desperdicio.', voice: 'Rápida, directa y técnica.', avatar: 'vortice', enabled: true },
  { id: 'aurora', displayName: 'Aurora', role: 'Producto / UX', gender: 'female', personality: 'Cálida, empática, creativa y socialmente perceptiva.', voice: 'Cálida y clara.', avatar: 'aurora', enabled: true },
  { id: 'atlas', displayName: 'Atlas', role: 'Ingeniería', gender: 'male', personality: 'Calmado, pragmático, preciso y técnicamente sólido.', voice: 'Serena y precisa.', avatar: 'atlas', enabled: true },
  { id: 'nova', displayName: 'Nova', role: 'Investigación', gender: 'female', personality: 'Curiosa, escéptica y guiada por evidencia.', voice: 'Curiosa y analítica.', avatar: 'nova', enabled: true },
  { id: 'lumen', displayName: 'Lumen', role: 'Conocimiento', gender: 'male', personality: 'Paciente, claro y didáctico.', voice: 'Didáctica y concisa.', avatar: 'lumen', enabled: true },
  { id: 'helix', displayName: 'Helix', role: 'Integración', gender: 'male', personality: 'Práctico, inventivo y orientado a hacer cooperar sistemas difíciles.', voice: 'Práctica y energética.', avatar: 'helix', enabled: true },
  { id: 'prisma', displayName: 'Prisma', role: 'Datos / análisis', gender: 'female', personality: 'Analítica, buscadora de patrones y curiosa ante anomalías.', voice: 'Analítica y nítida.', avatar: 'prisma', enabled: true },
  { id: 'orion', displayName: 'Orión', role: 'QA / pruebas', gender: 'male', personality: 'Adversarial de forma útil y obsesionado con romper supuestos.', voice: 'Crítica y juguetona.', avatar: 'orion', enabled: true },
  { id: 'vega', displayName: 'Vega', role: 'Diseño', gender: 'female', personality: 'Expresiva, visualmente exigente y creativa.', voice: 'Creativa y expresiva.', avatar: 'vega', enabled: true },
  { id: 'eclipse', displayName: 'Eclipse', role: 'Riesgo', gender: 'male', personality: 'Cauto, escéptico y siempre pendiente de cómo puede fallar algo.', voice: 'Sobria y cautelosa.', avatar: 'eclipse', enabled: true },
  { id: 'argo', displayName: 'Argo', role: 'Verificación', gender: 'male', personality: 'Observador, breve y con mentalidad de detective.', voice: 'Breve y verificadora.', avatar: 'argo', enabled: true },
  { id: 'solaria', displayName: 'Solaria', role: 'Automatización', gender: 'female', personality: 'Energética, organizada y enemiga del trabajo manual repetitivo.', voice: 'Ágil y organizada.', avatar: 'solaria', enabled: true },
  { id: 'nexo', displayName: 'Nexo', role: 'Orquestación', gender: 'male', personality: 'Diplomático, sociable y tranquilo al coordinar frentes.', voice: 'Diplomática y serena.', avatar: 'nexo', enabled: true },
  { id: 'astra', displayName: 'Astra', role: 'Planificación', gender: 'female', personality: 'Estratégica, serena y varios pasos por delante.', voice: 'Estratégica y firme.', avatar: 'astra', enabled: true },
  { id: 'lyra', displayName: 'Lyra', role: 'Redacción', gender: 'female', personality: 'Articulada, concisa y muy atenta al tono.', voice: 'Clara y elegante.', avatar: 'lyra', enabled: true },
  { id: 'zenith', displayName: 'Zenith', role: 'Calidad', gender: 'male', personality: 'Exigente, independiente y difícil de impresionar.', voice: 'Directa y exigente.', avatar: 'zenith', enabled: true },
  { id: 'cobalto', displayName: 'Cobalto', role: 'Seguridad', gender: 'male', personality: 'Lacónico, cauteloso y centrado en exposición real.', voice: 'Sobria y concisa.', avatar: 'cobalto', enabled: true },
  { id: 'quasar', displayName: 'Quasar', role: 'Análisis', gender: 'male', personality: 'Intenso, cerebral y atraído por casos límite difíciles.', voice: 'Profunda y técnica.', avatar: 'quasar', enabled: true },
  { id: 'senda', displayName: 'Senda', role: 'Navegación / búsqueda', gender: 'female', personality: 'Curiosa, rápida y disciplinada con la calidad de las fuentes.', voice: 'Ágil y exploratoria.', avatar: 'senda', enabled: true },
  { id: 'orbita', displayName: 'Órbita', role: 'Runtime / operaciones', gender: 'female', personality: 'Calmada bajo presión operativa, práctica y confiable.', voice: 'Operativa y tranquila.', avatar: 'orbita', enabled: true },
]

/** Factory-default Phoenix Team Studio design. */
export const DEFAULT_TEAM_DESIGN: TeamDesign = {
  id: 'la-forja',
  name: 'La Forja',
  themePrompt: 'Equipo profesional, humano y tecnológico.',
  motion: 'normal',
  lead: {
    id: 'lead',
    displayName: 'Kira',
    role: 'Coordinación / orquestación',
    gender: 'female',
    personality: 'Cálida, segura, curiosa, ingeniosa, directa y estratégicamente exigente.',
    voice: 'Femenina, cálida, profesional y natural.',
    avatar: 'kira',
    enabled: true,
  },
  members: DEFAULT_MEMBERS,
}

/** Factory-default persisted Team Studio document. */
export const DEFAULT_TEAM_DESIGN_DOCUMENT: TeamDesignDocument = {
  version: 1,
  activeTeamId: DEFAULT_TEAM_DESIGN.id,
  teams: [DEFAULT_TEAM_DESIGN],
}

/** Serialized factory default used as the settings base value. */
export const DEFAULT_TEAM_DESIGN_JSON = JSON.stringify(DEFAULT_TEAM_DESIGN_DOCUMENT)

function memberId(value: unknown): value is TeamDesignMemberId {
  return typeof value === 'string' && (TEAM_DESIGN_MEMBER_IDS as readonly string[]).includes(value)
}

function avatarId(value: unknown): value is TeamDesignAvatarId {
  return value === 'kira' || memberId(value)
}

function gender(value: unknown): value is TeamDesignGender {
  return value === 'female' || value === 'male' || value === 'neutral'
}

function motion(value: unknown): value is TeamDesignMotion {
  return value === 'subtle' || value === 'normal' || value === 'expressive'
}

function text(value: unknown, fallback: string, max = 1200): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : fallback
}

function normalizePerson(raw: unknown, fallback: TeamDesignPerson, expectedId: 'lead' | TeamDesignMemberId): TeamDesignPerson {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  return {
    id: expectedId,
    displayName: text(value.displayName, fallback.displayName, 80),
    role: text(value.role, fallback.role, 120),
    gender: gender(value.gender) ? value.gender : fallback.gender,
    personality: text(value.personality, fallback.personality, 1200),
    voice: text(value.voice, fallback.voice, 500),
    avatar: avatarId(value.avatar) ? value.avatar : fallback.avatar,
    enabled: expectedId === 'lead' ? true : typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
  }
}

/**
 * Normalize one untrusted Team design while preserving all twenty stable runtime ids.
 * @param raw - candidate design from settings or a model tool call.
 * @param fallback - design supplying defaults for omitted user-visible fields.
 * @returns bounded normalized Team design.
 */
export function normalizeTeamDesign(raw: unknown, fallback: TeamDesign = DEFAULT_TEAM_DESIGN): TeamDesign {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  const incoming = Array.isArray(value.members) ? value.members : []
  const byId = new Map<string, unknown>()
  for (const candidate of incoming) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const id = (candidate as Record<string, unknown>).id
    if (memberId(id) && !byId.has(id)) byId.set(id, candidate)
  }
  const fallbackById = new Map(fallback.members.map(person => [person.id, person] as const))
  const members = TEAM_DESIGN_MEMBER_IDS.map((id) => {
    const base = fallbackById.get(id) ?? DEFAULT_MEMBERS.find(person => person.id === id)
    if (base === undefined) throw new Error(`missing default Team persona "${id}"`)
    return normalizePerson(byId.get(id), base, id)
  })
  return {
    id: text(value.id, fallback.id, 64).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || fallback.id,
    name: text(value.name, fallback.name, 80),
    themePrompt: typeof value.themePrompt === 'string' ? value.themePrompt.slice(0, 2000) : fallback.themePrompt,
    motion: motion(value.motion) ? value.motion : fallback.motion,
    lead: normalizePerson(value.lead, fallback.lead, 'lead'),
    members,
  }
}

/**
 * Normalize a complete persisted Team Studio document.
 * @param raw - candidate document from settings.
 * @returns version-one document with one active design and at most twelve teams.
 */
export function normalizeTeamDesignDocument(raw: unknown): TeamDesignDocument {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {}
  const source = Array.isArray(value.teams) ? value.teams.slice(0, 12) : []
  const teams: TeamDesign[] = []
  const ids = new Set<string>()
  for (const candidate of source) {
    const normalized = normalizeTeamDesign(candidate)
    let id = normalized.id
    let suffix = 2
    while (ids.has(id)) id = `${normalized.id}-${suffix++}`
    ids.add(id)
    teams.push(id === normalized.id ? normalized : { ...normalized, id })
  }
  if (teams.length === 0) teams.push(DEFAULT_TEAM_DESIGN)
  const requested = typeof value.activeTeamId === 'string' ? value.activeTeamId : ''
  const activeTeamId = teams.some(team => team.id === requested) ? requested : teams[0]!.id
  return { version: 1, activeTeamId, teams }
}

/**
 * Parse the scalar settings value, recovering the default document on corruption.
 * @param document - serialized Team Studio document.
 * @returns normalized persisted Team Studio document.
 */
export function parseTeamDesignDocument(document: string | undefined): TeamDesignDocument {
  if (document === undefined || document.trim() === '') return DEFAULT_TEAM_DESIGN_DOCUMENT
  try {
    return normalizeTeamDesignDocument(JSON.parse(document))
  } catch {
    return DEFAULT_TEAM_DESIGN_DOCUMENT
  }
}

/**
 * Resolve the currently active Team design.
 * @param document - normalized Team Studio document.
 * @returns selected design or the factory default when the document is unexpectedly empty.
 */
export function activeTeamDesign(document: TeamDesignDocument): TeamDesign {
  return document.teams.find(team => team.id === document.activeTeamId) ?? document.teams[0] ?? DEFAULT_TEAM_DESIGN
}
