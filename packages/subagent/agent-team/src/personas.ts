/** Host-owned persona assignments; clients receive canonical identity through the session projection. */
export const TEAM_PERSONAS = [
  { kind: 'vortice', name: 'Vórtice', specialty: 'skill.performance' },
  { kind: 'aurora', name: 'Aurora', specialty: 'skill.product' },
  { kind: 'atlas', name: 'Atlas', specialty: 'skill.engineering' },
  { kind: 'nova', name: 'Nova', specialty: 'skill.research' },
  { kind: 'lumen', name: 'Lumen', specialty: 'skill.knowledge' },
  { kind: 'helix', name: 'Helix', specialty: 'skill.integration' },
  { kind: 'prisma', name: 'Prisma', specialty: 'skill.data' },
  { kind: 'orion', name: 'Orión', specialty: 'skill.testing' },
  { kind: 'vega', name: 'Vega', specialty: 'skill.design' },
  { kind: 'eclipse', name: 'Eclipse', specialty: 'skill.risk' },
  { kind: 'argo', name: 'Argo', specialty: 'skill.verification' },
  { kind: 'solaria', name: 'Solaria', specialty: 'skill.automation' },
  { kind: 'nexo', name: 'Nexo', specialty: 'skill.orchestration' },
  { kind: 'astra', name: 'Astra', specialty: 'skill.planning' },
  { kind: 'lyra', name: 'Lyra', specialty: 'skill.writing' },
  { kind: 'zenith', name: 'Zenith', specialty: 'skill.quality' },
  { kind: 'cobalto', name: 'Cobalto', specialty: 'skill.security' },
  { kind: 'quasar', name: 'Quasar', specialty: 'skill.analysis' },
  { kind: 'senda', name: 'Senda', specialty: 'skill.browser' },
  { kind: 'orbita', name: 'Órbita', specialty: 'skill.runtime' },
] as const

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
