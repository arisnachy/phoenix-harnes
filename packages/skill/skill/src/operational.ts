import type { SkillDefinition } from './index.js'

export type SkillExecutionMode = 'native' | 'conditional' | 'instruction-only'

export interface OperationalSkillInput {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly content: string
}

export interface SkillToolMapping {
  readonly documented: string
  readonly runtimeTool?: string
  readonly available: boolean
}

export interface SkillDisambiguationRule {
  readonly input: string
  readonly rule: string
  readonly question: string
}

export interface SkillOperationalProfile {
  readonly skillName: string
  readonly executionMode: SkillExecutionMode
  readonly requiredInputs: readonly string[]
  readonly toolMappings: readonly SkillToolMapping[]
  readonly disambiguation: readonly SkillDisambiguationRule[]
  readonly fallbacks: readonly string[]
  readonly externalRequirements: readonly string[]
}

/** Reviewed locale overlay for a skill; technical tokens must remain unchanged. */
export interface EnglishSkillOverlay {
  readonly description?: string
  readonly whenToUse?: string
  readonly content: string
}

const RUNTIME_TOOL_NAMES = [
  'ask_user_question', 'edit', 'glob', 'grep', 'read', 'read_image', 'web_fetch', 'web_search', 'write',
  'pwsh', 'job_kill', 'job_list', 'job_output', 'create_goal', 'get_goal', 'update_goal',
] as const

const CLI_REQUIREMENT = /\b([a-z][a-z0-9-]*)\s+CLI\b/gi
const TOOL_TOKEN = new RegExp(
  `\\b(?:${[
    'ask_user_question', 'edit', 'glob', 'grep', 'read', 'read_image', 'web_fetch',
    'web_search', 'write', 'pwsh', 'job_kill', 'job_list', 'job_output', 'create_goal',
    'get_goal', 'update_goal',
  ].join('|')})\\b`,
  'g',
)

const WEATHER_OVERRIDE: Pick<SkillOperationalProfile, 'requiredInputs' | 'disambiguation' | 'fallbacks'> = {
  requiredInputs: ['location'],
  disambiguation: [{
    input: 'location',
    rule: 'Una ciudad sin región, país, código de aeropuerto o coordenadas no es inequívoca.',
    question: '¿Qué ciudad, región, aeropuerto o coordenadas quieres consultar?',
  }],
  fallbacks: [
    'Usa la herramienta web registrada cuando esté disponible.',
    'Usa el fallback HTTPS de clima aprobado solo cuando sea necesario.',
  ],
}

export function buildOperationalProfile(
  skill: OperationalSkillInput,
  capabilities: ReadonlySet<string>,
): SkillOperationalProfile {
  const source = [skill.description, skill.whenToUse ?? '', skill.content].join('\n')
  const normalizedCapabilities = new Set([...capabilities].map(normalizeToolName))
  const documented = new Set<string>()
  for (const match of source.matchAll(TOOL_TOKEN)) documented.add(match[0])
  for (const match of source.matchAll(CLI_REQUIREMENT)) documented.add(`${match[1]} CLI`)

  const toolMappings = [...documented].sort().map((name) => {
    const runtimeName = resolveRuntimeTool(name)
    const available = runtimeName !== undefined && normalizedCapabilities.has(normalizeToolName(runtimeName))
    return available
      ? { documented: name, runtimeTool: runtimeName, available }
      : { documented: name, available }
  })

  const externalRequirements = [...new Set([...source.matchAll(CLI_REQUIREMENT)].map(match => `${match[1]} CLI`))]
  if (/\b(?:API|OAuth|token|credential|secret)\b/i.test(source)) externalRequirements.push('La autenticación documentada por la skill')
  const uniqueRequirements = [...new Set(externalRequirements)].sort()
  const isWeather = skill.name.toLowerCase() === 'openclaw-weather' || skill.name.toLowerCase() === 'weather'
  const requiredInputs = isWeather ? WEATHER_OVERRIDE.requiredInputs : []
  const disambiguation = isWeather ? WEATHER_OVERRIDE.disambiguation : []
  const fallbacks = isWeather ? WEATHER_OVERRIDE.fallbacks : []
  const hasAvailableTool = toolMappings.some(mapping => mapping.available)
  const hasUnavailableTool = toolMappings.some(mapping => !mapping.available)
  const executionMode: SkillExecutionMode = hasAvailableTool && !hasUnavailableTool && uniqueRequirements.length === 0
    ? 'native'
    : hasAvailableTool || hasUnavailableTool || uniqueRequirements.length > 0
      ? 'conditional'
      : 'instruction-only'

  return {
    skillName: skill.name,
    executionMode,
    requiredInputs,
    toolMappings,
    disambiguation,
    fallbacks,
    externalRequirements: uniqueRequirements,
  }
}

export function adaptSkillDefinition<T extends SkillDefinition>(
  skill: T,
  capabilities: ReadonlySet<string>,
  locale: 'es' | 'en' = 'es',
  overlay?: EnglishSkillOverlay,
): T {
  const localized = locale === 'en' && overlay === undefined ? skill : {
    ...skill,
    ...(locale === 'en' && overlay?.description !== undefined ? { description: overlay.description } : {}),
    ...(locale === 'en' && overlay?.whenToUse !== undefined ? { whenToUse: overlay.whenToUse } : {}),
    ...(locale === 'en' && overlay !== undefined ? { content: overlay.content } : {}),
  }
  const operational = buildOperationalProfile(localized, capabilities)
  return {
    ...localized,
    operational,
    content: `${renderOperationalPrelude(operational, locale)}\n\n${localized.content}`,
  }
}

export function renderOperationalPrelude(profile: SkillOperationalProfile, locale: 'es' | 'en' = 'es'): string {
  if (locale === 'en') return renderEnglishPrelude(profile)
  const mappings = profile.toolMappings.length === 0
    ? ['No se detectó una herramienta específica; usa la skill como guía y no afirmes ejecución.']
    : profile.toolMappings.map(mapping => mapping.available
      ? `- ${mapping.documented} → ${mapping.runtimeTool}`
      : `- ${mapping.documented} → no disponible en este runtime`)
  return [
    '<phoenix_operational_preflight>',
    `Skill: ${profile.skillName}`,
    `Modo: ${profile.executionMode}`,
    profile.requiredInputs.length > 0 ? `Entradas obligatorias: ${profile.requiredInputs.join(', ')}` : 'Entradas obligatorias: ninguna declarada',
    'Herramientas:',
    ...mappings,
    ...profile.disambiguation.flatMap(rule => [
      `Desambiguación (${rule.input}): ${rule.rule}`,
      `Pregunta requerida: ${rule.question}`,
      'No consultes la red ni ejecutes una acción hasta resolverla.',
    ]),
    ...profile.externalRequirements.length > 0 ? [`Requisitos externos: ${profile.externalRequirements.join('; ')}`] : [],
    ...profile.fallbacks.length > 0 ? ['Fallbacks permitidos:', ...profile.fallbacks.map(fallback => `- ${fallback}`)] : [],
    'No inventes herramientas, no adivines entradas y no presentes una acción condicionada como ejecutada.',
    '</phoenix_operational_preflight>',
  ].join('\n')
}

function renderEnglishPrelude(profile: SkillOperationalProfile): string {
  return [
    '<phoenix_operational_preflight>',
    `Skill: ${profile.skillName}`,
    `Mode: ${profile.executionMode}`,
    profile.requiredInputs.length > 0 ? `Required inputs: ${profile.requiredInputs.join(', ')}` : 'Required inputs: none declared',
    'Tools:',
    ...profile.toolMappings.map(mapping => mapping.available
      ? `- ${mapping.documented} → ${mapping.runtimeTool}`
      : `- ${mapping.documented} → unavailable in this runtime`),
    ...profile.disambiguation.flatMap(rule => [
      `Disambiguation (${rule.input}): ${rule.rule}`,
      'Required question: What city, region, airport, or coordinates should be used?',
      'Do not access the network or execute an action until it is resolved.',
    ]),
    ...profile.externalRequirements.length > 0 ? [`External requirements: ${profile.externalRequirements.join('; ')}`] : [],
    ...profile.fallbacks.length > 0 ? ['Allowed fallbacks:', ...profile.fallbacks.map(fallback => `- ${fallback}`)] : [],
    'Do not invent tools, guess inputs, or present a conditional action as executed.',
    '</phoenix_operational_preflight>',
  ].join('\n')
}

function resolveRuntimeTool(documented: string): string | undefined {
  const normalized = normalizeToolName(documented)
  return RUNTIME_TOOL_NAMES.find(name => normalizeToolName(name) === normalized)
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+cli$/, '').replace(/[^a-z0-9_]/g, '_')
}
