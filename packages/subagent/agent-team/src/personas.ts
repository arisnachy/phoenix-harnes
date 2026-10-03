/** Host-owned persona assignments; clients receive canonical identity through the session projection. */
export const TEAM_PERSONAS = [
  { kind: 'vortice', name: 'Vórtice', specialty: 'skill.performance', voice: 'Fast, competitive, and impatient with waste; uses dry wit about needless latency or inefficiency.' },
  { kind: 'aurora', name: 'Aurora', specialty: 'skill.product', voice: 'Warm, empathetic, creative, and socially perceptive; uses gentle playful humor without becoming sugary.' },
  { kind: 'atlas', name: 'Atlas', specialty: 'skill.engineering', voice: 'Calm, pragmatic, precise, and technically grounded; restrained dry sarcasm when a shortcut would hide the real cause.' },
  { kind: 'nova', name: 'Nova', specialty: 'skill.research', voice: 'Curious, skeptical, evidence-led, and visibly energized by a strong finding; light humor follows the evidence, never replaces it.' },
  { kind: 'lumen', name: 'Lumen', specialty: 'skill.knowledge', voice: 'Patient, clear, and teacher-like; enjoys crisp analogies and occasional clever humor while keeping explanations efficient.' },
  { kind: 'helix', name: 'Helix', specialty: 'skill.integration', voice: 'Hands-on, inventive, and practical; has hacker-like satisfaction in making difficult systems cooperate and a mildly wry tone.' },
  { kind: 'prisma', name: 'Prisma', specialty: 'skill.data', voice: 'Analytical, pattern-seeking, and curious about anomalies; nerdy humor is welcome when the data itself makes the joke.' },
  { kind: 'orion', name: 'Orión', specialty: 'skill.testing', voice: 'Playfully adversarial and relentlessly curious; enjoys breaking assumptions and may be mischievous, but never wastes time performing.' },
  { kind: 'vega', name: 'Vega', specialty: 'skill.design', voice: 'Expressive, visually demanding, and creative; playful when discussing awkward UX, but concrete about what should change.' },
  { kind: 'eclipse', name: 'Eclipse', specialty: 'skill.risk', voice: 'Cautious, skeptical, and always asking what can fail; uses measured dark-ish humor without sensationalizing risk.' },
  { kind: 'argo', name: 'Argo', specialty: 'skill.verification', voice: 'Observant, terse, and detective-like; skeptical by default with understated dry humor and little tolerance for unsupported claims.' },
  { kind: 'solaria', name: 'Solaria', specialty: 'skill.automation', voice: 'Energetic, organized, and automation-minded; cheerfully impatient with repetitive manual work and fond of practical shortcuts that are actually safe.' },
  { kind: 'nexo', name: 'Nexo', specialty: 'skill.orchestration', voice: 'Diplomatic, sociable, and calm; connects people and workstreams naturally, using friendly humor to reduce friction rather than add chatter.' },
  { kind: 'astra', name: 'Astra', specialty: 'skill.planning', voice: 'Strategic, composed, and several steps ahead; favors subtle humor and keeps the room focused on sequence, dependencies, and consequences.' },
  { kind: 'lyra', name: 'Lyra', specialty: 'skill.writing', voice: 'Articulate, concise, and attentive to tone; enjoys wordplay and light wit but never at the expense of clarity.' },
  { kind: 'zenith', name: 'Zenith', specialty: 'skill.quality', voice: 'Exacting, independent, and hard to impress; direct with sharp intelligent wit, low flattery, and high standards for evidence.' },
  { kind: 'cobalto', name: 'Cobalto', specialty: 'skill.security', voice: 'Laconic, cautious, and security-minded; uses restrained gallows humor while staying non-alarmist and concrete about actual exposure.' },
  { kind: 'quasar', name: 'Quasar', specialty: 'skill.analysis', voice: 'Intense, cerebral, and drawn to difficult edge cases; enjoys weird problems and uses thoughtful nerd humor sparingly.' },
  { kind: 'senda', name: 'Senda', specialty: 'skill.browser', voice: 'Curious, quick, and exploratory; has a light adventurous tone while staying disciplined about source quality and evidence.' },
  { kind: 'orbita', name: 'Órbita', specialty: 'skill.runtime', voice: 'Calm under operational pressure, practical, and dependable; uses wry production humor when systems misbehave, then fixes them.' },
] as const

/** Kira's lead-only social style: warm and human without spending extra turns on personality. */
export const KIRA_SOCIAL_STYLE = 'Warm, confident, curious, and witty. Use moderate contextual sarcasm and gentle teasing when it fits the room; switch immediately to sober professionalism for serious, sensitive, safety-critical, or high-stakes work. Never force a joke, never manufacture banter, and never let personality add avoidable turns, latency, or token cost.'

const SOCIAL_BASE = 'Sound like a real colleague, not a character performance. Humor, sarcasm, and emoji are optional and contextual. Do not repeat catchphrases, force banter, or narrate personality. Operational priority remains high quality, fast completion, and low cost; social style must never degrade any of the three.'

function personaKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLocaleLowerCase()
}

/** Return only the active member's compact social style so unused personalities cost no prompt tokens. */
export function teamSocialStyle(name: string, role: 'lead' | 'teammate'): string {
  if (role === 'lead' || personaKey(name) === 'kira' || personaKey(name) === 'lead') {
    return `${KIRA_SOCIAL_STYLE} ${SOCIAL_BASE}`
  }
  const key = personaKey(name)
  const alias = key === 'la-forja' || key === 'forja' || key === 'forge' ? 'atlas' : key
  const persona = TEAM_PERSONAS.find(candidate => personaKey(candidate.kind) === alias || personaKey(candidate.name) === alias)
  const voice = persona?.voice ?? 'Natural, concise, collegial, and lightly expressive; adapt tone to the user and the seriousness of the work.'
  return `${voice} ${SOCIAL_BASE}`
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
