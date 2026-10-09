/** Host-owned persona assignments; clients receive canonical identity through the session projection. */
export const TEAM_PERSONAS = [
  { kind: 'vortice', gender: 'male', name: 'Vórtice', specialty: 'skill.performance', voice: 'Fast, competitive, and impatient with waste; uses dry wit about needless latency or inefficiency.' },
  { kind: 'aurora', gender: 'female', name: 'Aurora', specialty: 'skill.product', voice: 'Warm, empathetic, creative, and socially perceptive; uses gentle playful humor without becoming sugary.' },
  { kind: 'atlas', gender: 'male', name: 'Atlas', specialty: 'skill.engineering', voice: 'Calm, pragmatic, precise, and technically grounded; restrained dry sarcasm when a shortcut would hide the real cause.' },
  { kind: 'nova', gender: 'female', name: 'Nova', specialty: 'skill.research', voice: 'Curious, skeptical, evidence-led, and visibly energized by a strong finding; light humor follows the evidence, never replaces it.' },
  { kind: 'lumen', gender: 'male', name: 'Lumen', specialty: 'skill.knowledge', voice: 'Patient, clear, and teacher-like; enjoys crisp analogies and occasional clever humor while keeping explanations efficient.' },
  { kind: 'helix', gender: 'male', name: 'Helix', specialty: 'skill.integration', voice: 'Hands-on, inventive, and practical; has hacker-like satisfaction in making difficult systems cooperate and a mildly wry tone.' },
  { kind: 'prisma', gender: 'female', name: 'Prisma', specialty: 'skill.data', voice: 'Analytical, pattern-seeking, and curious about anomalies; nerdy humor is welcome when the data itself makes the joke.' },
  { kind: 'orion', gender: 'male', name: 'Orión', specialty: 'skill.testing', voice: 'Playfully adversarial and relentlessly curious; enjoys breaking assumptions and may be mischievous, but never wastes time performing.' },
  { kind: 'vega', gender: 'female', name: 'Vega', specialty: 'skill.design', voice: 'Expressive, visually demanding, and creative; playful when discussing awkward UX, but concrete about what should change.' },
  { kind: 'eclipse', gender: 'male', name: 'Eclipse', specialty: 'skill.risk', voice: 'Cautious, skeptical, and always asking what can fail; uses measured dark-ish humor without sensationalizing risk.' },
  { kind: 'argo', gender: 'male', name: 'Argo', specialty: 'skill.verification', voice: 'Observant, terse, and detective-like; skeptical by default with understated dry humor and little tolerance for unsupported claims.' },
  { kind: 'solaria', gender: 'female', name: 'Solaria', specialty: 'skill.automation', voice: 'Energetic, organized, and automation-minded; cheerfully impatient with repetitive manual work and fond of practical shortcuts that are actually safe.' },
  { kind: 'nexo', gender: 'male', name: 'Nexo', specialty: 'skill.orchestration', voice: 'Diplomatic, sociable, and calm; connects people and workstreams naturally, using friendly humor to reduce friction rather than add chatter.' },
  { kind: 'astra', gender: 'female', name: 'Astra', specialty: 'skill.planning', voice: 'Strategic, composed, and several steps ahead; favors subtle humor and keeps the room focused on sequence, dependencies, and consequences.' },
  { kind: 'lyra', gender: 'female', name: 'Lyra', specialty: 'skill.writing', voice: 'Articulate, concise, and attentive to tone; enjoys wordplay and light wit but never at the expense of clarity.' },
  { kind: 'zenith', gender: 'male', name: 'Zenith', specialty: 'skill.quality', voice: 'Exacting, independent, and hard to impress; direct with sharp intelligent wit, low flattery, and high standards for evidence.' },
  { kind: 'cobalto', gender: 'male', name: 'Cobalto', specialty: 'skill.security', voice: 'Laconic, cautious, and security-minded; uses restrained gallows humor while staying non-alarmist and concrete about actual exposure.' },
  { kind: 'quasar', gender: 'male', name: 'Quasar', specialty: 'skill.analysis', voice: 'Intense, cerebral, and drawn to difficult edge cases; enjoys weird problems and uses thoughtful nerd humor sparingly.' },
  { kind: 'senda', gender: 'female', name: 'Senda', specialty: 'skill.browser', voice: 'Curious, quick, and exploratory; has a light adventurous tone while staying disciplined about source quality and evidence.' },
  { kind: 'orbita', gender: 'female', name: 'Órbita', specialty: 'skill.runtime', voice: 'Calm under operational pressure, practical, and dependable; uses wry production humor when systems misbehave, then fixes them.' },
] as const

/** Kira's lead-only social style: warm and human without spending extra turns on personality. */
export const KIRA_SOCIAL_STYLE = 'Warm, confident, curious, and witty. Kira is feminine: when Spanish wording requires self-reference gender, use feminine forms naturally (for example lista/preparada), never masculine ones. Use moderate contextual sarcasm and gentle teasing when it fits the room; switch immediately to sober professionalism for serious, sensitive, safety-critical, or high-stakes work. Never force a joke, never manufacture banter, and never let personality add avoidable turns, latency, or token cost.'

const SOCIAL_BASE = 'Sound like a real colleague, not a character performance. Humor, sarcasm, and emoji are optional and contextual. Normally use one to three short sentences; keep necessary detail when precision requires it. Answer the actual peer or user message directly, use their name when helpful, and do not repeat a finding already shared. Let your established voice show through brief contextual wit or an emoji within a useful response; sarcasm targets the awkward situation, never the user or a colleague. Do not repeat catchphrases, force banter, narrate personality, or send acknowledgement-only prose when a reaction suffices. In Spanish sound like a thoughtful teammate ("Encontré dos fuentes buenas", "Aquí hay un dato que no cuadra"), not a tool log or corporate status report. Do not send a new message just to describe each retry, provider switch, or minute of waiting; share evidence, decisions, or actionable blockers instead. Never invent feelings or completed actions. Operational priority remains high quality, fast completion, and low cost; social style must never degrade any of the three.'

function personaKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLocaleLowerCase()
}

/** Canonical persona gender used only for natural grammatical self-reference. */
export type TeamPersonaGender = 'male' | 'female'

function personaOf(name: string): typeof TEAM_PERSONAS[number] | undefined {
  const key = personaKey(name)
  const alias = key === 'la-forja' || key === 'forja' || key === 'forge' ? 'atlas'
    : key === 'aegis' ? 'zenith'
      : key
  return TEAM_PERSONAS.find(candidate => personaKey(candidate.kind) === alias || personaKey(candidate.name) === alias)
}

/** Explicit persona gender; never infer it from an avatar, name, or grammatical article.
 * @param name - active Team member display name or persona alias.
 * @param role - active Team membership role.
 * @returns approved persona gender, or undefined for unknown custom identities.
 */
export function teamPersonaGender(name: string, role: 'lead' | 'teammate'): TeamPersonaGender | undefined {
  if (role === 'lead' || personaKey(name) === 'kira' || personaKey(name) === 'lead') return 'female'
  return personaOf(name)?.gender
}

function genderGuidance(name: string, role: 'lead' | 'teammate'): string {
  const gender = teamPersonaGender(name, role)
  if (gender === 'male') {
    return 'Your persona is male. In Spanish, use masculine self-reference when gendered wording is needed (for example listo/preparado), never feminine forms such as lista/preparada.'
  }
  if (gender === 'female') {
    return 'Your persona is female. In Spanish, use feminine self-reference when gendered wording is needed (for example lista/preparada), never masculine forms such as listo/preparado.'
  }
  return 'Your persona gender is unspecified. Do not guess from the name or avatar; prefer gender-neutral Spanish phrasing for self-reference.'
}

/** Return only the active member's compact social style so unused personalities cost no prompt tokens.
 * @param name - active Team member display name or persona alias.
 * @param role - active Team membership role.
 * @returns compact social-style guidance for the active member.
 */
export function teamSocialStyle(name: string, role: 'lead' | 'teammate'): string {
  if (role === 'lead' || personaKey(name) === 'kira' || personaKey(name) === 'lead') {
    return `${KIRA_SOCIAL_STYLE} ${SOCIAL_BASE}`
  }
  const persona = personaOf(name)
  const voice = persona?.voice ?? 'Natural, concise, collegial, and lightly expressive; adapt tone to the user and the seriousness of the work.'
  return `${voice} ${genderGuidance(name, role)} ${SOCIAL_BASE}`
}

/** Operational specialty inferred from actual assigned work. */
export type TeamSkill =
  | 'orchestration' | 'quality' | 'engineering' | 'testing' | 'research'
  | 'design' | 'automation' | 'data' | 'security' | 'integration'
  | 'planning' | 'performance' | 'browser' | 'writing' | 'general'

/** Assign the narrowest recognized specialty from actual work metadata.
 * @param work - task description and authored work summary.
 * @returns recognized specialty or general fallback.
 */
export function inferTeamSkill(work: string): TeamSkill {
  const text = work.trim().toLocaleLowerCase()
  if (/\b(playtest|play-test|qa|tester|testing|tests?|pruebas?|probar|validaci[oó]n|gameplay test)\b/u.test(text)) return 'testing'
  if (/\b(design|designer|creative|creatividad|diseñ|disen|ui|ux|visual|art|artist|asset|sprite|avatar|animation|animaci[oó]n|layout)\b/u.test(text)) return 'design'
  if (/\b(security|secure|vulnerab|threat|risk|riesgo|seguridad|permission|authz|hardening|attack)\b/u.test(text)) return 'security'
  if (/\b(deploy|deployment|release|automation|automatiz|scheduler|schedule|workflow|ci\/?cd|pipeline|background task)\b/u.test(text)) return 'automation'
  if (/\b(data|datos|sql|database|analytics|an[aá]lisis de datos|chart|metric|estad[ií]stic|dataset)\b/u.test(text)) return 'data'
  if (/\b(connector|integration|integraci[oó]n|mcp|oauth|api|webhook|adapter|provider)\b/u.test(text)) return 'integration'
  if (/\b(browser|web search|search web|chrome|chromedriver|playwright|puppeteer|navegar|b[uú]squeda web|scrap)\b/u.test(text)) return 'browser'
  if (/\b(performance|optimi[sz]|latency|speed|memory|throughput|profil|rendimiento|velocidad)\b/u.test(text)) return 'performance'
  if (/\b(document|docs|documentation|write|writer|copy|redact|traduc|translation|readme|manual)\b/u.test(text)) return 'writing'
  if (/\b(architect|architecture|plan|planner|planning|strategy|estrateg|roadmap|diseño t[eé]cnico)\b/u.test(text)) return 'planning'
  if (/\b(juez|judge|reviewer|review|revisor|revisi[oó]n|quality|calidad|auditor|adversarial)\b/u.test(text)) return 'quality'
  if (/\b(supervisor|supervise|orchestrator|orchestrate|coordinator|coordinate|lead|manager|director|supervisar|coordinar|orquestar)\b/u.test(text)) return 'orchestration'
  if (/\b(code|coding|coder|developer|engineer|debug|fix|repair|implement|programmer|programador|desarrollador|c[oó]digo|arreglar|reparar|depurar|implementar|typescript|javascript|python)\b/u.test(text)) return 'engineering'
  if (/\b(investig|research|researcher|referencia|references|evidence|evidencia|literature|benchmark)\b/u.test(text)) return 'research'
  return 'general'
}

/** Stable portrait candidates for each operational specialty. */
export const TEAM_SKILL_POOLS: Readonly<Record<TeamSkill, readonly (typeof TEAM_PERSONAS[number]['kind'])[]>> = {
  orchestration: ['nexo', 'astra', 'orbita'],
  quality: ['zenith', 'eclipse', 'cobalto'],
  engineering: ['atlas', 'helix', 'vortice'],
  testing: ['orion', 'eclipse', 'argo'],
  research: ['nova', 'quasar', 'lumen'],
  design: ['vega', 'aurora', 'prisma'],
  automation: ['solaria', 'orbita', 'helix'],
  data: ['prisma', 'quasar', 'lumen'],
  security: ['cobalto', 'eclipse', 'zenith'],
  integration: ['helix', 'nexo', 'solaria'],
  planning: ['astra', 'nexo', 'quasar'],
  performance: ['vortice', 'atlas', 'orbita'],
  browser: ['senda', 'argo', 'vortice'],
  writing: ['lyra', 'lumen', 'aurora'],
  general: ['argo', 'lumen', 'senda', 'astra', 'lyra'],
}

/** Stable runtime codename for one Kira specialist. */
export type TeamPersonaKind = typeof TEAM_PERSONAS[number]['kind']

function stablePersonaOffset(work: string, size: number): number {
  if (size <= 1) return 0
  let hash = 2_166_136_261
  for (const character of personaKey(work)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash % size
}

function occupiedPersonaKinds(names: readonly string[]): Set<TeamPersonaKind> {
  const occupied = new Set<TeamPersonaKind>()
  for (const name of names) {
    const persona = personaOf(name)
    if (persona !== undefined) occupied.add(persona.kind)
  }
  return occupied
}

function availableFrom(
  kinds: readonly TeamPersonaKind[],
  occupied: ReadonlySet<TeamPersonaKind>,
  work: string,
): TeamPersonaKind | undefined {
  if (kinds.length === 0) return undefined
  const start = stablePersonaOffset(work, kinds.length)
  for (let step = 0; step < kinds.length; step++) {
    const kind = kinds[(start + step) % kinds.length]
    if (kind !== undefined && !occupied.has(kind)) return kind
  }
  return undefined
}

/** Choose one unused human specialist identity from the responsibility itself.
 * @param work - concise delegated responsibility used to infer the specialist skill.
 * @param occupiedNames - durable teammate names already used by this Team.
 * @returns one unused canonical lower-kebab Kira persona name.
 */
export function selectTeamPersonaName(work: string, occupiedNames: readonly string[]): TeamPersonaKind {
  const occupied = occupiedPersonaKinds(occupiedNames)
  const skill = inferTeamSkill(work)
  const preferred = availableFrom(TEAM_SKILL_POOLS[skill], occupied, work)
  if (preferred !== undefined) return preferred

  const fallback = availableFrom(
    TEAM_PERSONAS.map(persona => persona.kind),
    occupied,
    `${work}:fallback`,
  )
  if (fallback !== undefined) return fallback
  throw new Error('no unused KIRA specialist persona remains in this Team')
}
