import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, {
  adaptSkillDefinition,
  renderOperationalPrelude,
  type EnglishSkillOverlay,
} from '@phoenix-ai/dsh-skill'
import * as SkillFileSystem from '@phoenix-ai/dsh-skill-filesystem'
import { resolveDshHome } from '@phoenix-ai/dsh-home-paths'

interface OverlayRow {
  name: string
  source: string
  sourceLanguage: 'en' | 'es'
  status: 'translated' | 'alreadyEnglish' | 'fallback'
  overlayPresent: boolean
  technicalTokensPreserved: boolean
  operationalEnglish: boolean
  needsHumanReview: boolean
  error?: string
}

const root = process.cwd()
const home = resolveDshHome()
const overlayRoot = process.env.DSH_ENGLISH_OVERLAY_ROOT ?? join(homedir(), '.agents', 'skills-en')
const overlayFile = join(overlayRoot, 'overlays.json')
const ctx = new Context()
await ctx.plugin(SkillRegistry)
await ctx.plugin(SkillFileSystem, { dshHome: home, agentsHome: join(home, '..', '.agents'), watch: false })

const catalog = await loadCatalog(overlayFile)
const summaries = await ctx.skills.list({ cwd: root })
const rows: OverlayRow[] = []

for (const summary of summaries.filter(skill => skill.invocation.modelInvocable)) {
  const definition = await ctx.skills.get(summary.name, { cwd: root })
  if (definition === undefined) {
    rows.push(failure(summary.name, summary.source, 'ctx.skills.get() returned undefined'))
    continue
  }
  const sourceLanguage = looksSpanish([definition.description, definition.whenToUse ?? '', definition.content].join('\n')) ? 'es' : 'en'
  const overlay = catalog[summary.name]
  const needsHumanReview = sourceLanguage === 'es' && /(?:credential|oauth|token|secret|family|health|medical|password)/i.test(definition.content)
  if (sourceLanguage === 'en' && overlay === undefined) {
    rows.push({ name: summary.name, source: summary.source, sourceLanguage, status: 'alreadyEnglish', overlayPresent: false, technicalTokensPreserved: true, operationalEnglish: true, needsHumanReview: false })
    continue
  }
  if (overlay === undefined) {
    rows.push({ name: summary.name, source: summary.source, sourceLanguage, status: 'fallback', overlayPresent: false, technicalTokensPreserved: false, operationalEnglish: false, needsHumanReview, error: 'No reviewed English overlay found' })
    continue
  }
  const sourceTokens = protectedTokens(definition.content)
  const missingTokens = sourceTokens.filter(token => !overlay.content.includes(token))
  const adapted = adaptSkillDefinition(definition, new Set(), 'en', overlay)
  const prelude = adapted.operational === undefined ? '' : renderOperationalPrelude(adapted.operational, 'en')
  const operationalEnglish = adapted.operational !== undefined && prelude.includes('Mode:') && !prelude.includes('Modo:') && !/[\u4e00-\u9fff]/u.test(prelude)
  const technicalTokensPreserved = missingTokens.length === 0
  const error = technicalTokensPreserved && operationalEnglish ? undefined : [
    missingTokens.length > 0 ? `missing technical tokens: ${missingTokens.join(', ')}` : undefined,
    operationalEnglish ? undefined : 'English preflight failed',
  ].filter(Boolean).join('; ')
  rows.push({ name: summary.name, source: summary.source, sourceLanguage, status: 'translated', overlayPresent: true, technicalTokensPreserved, operationalEnglish, needsHumanReview, ...(error !== undefined ? { error } : {}) })
}

const translated = rows.filter(row => row.status === 'translated' && row.technicalTokensPreserved && row.operationalEnglish).length
const alreadyEnglish = rows.filter(row => row.status === 'alreadyEnglish').length
const fallback = rows.filter(row => row.status === 'fallback').length
const failed = rows.filter(row => row.error !== undefined).length
const needsHumanReview = rows.filter(row => row.needsHumanReview).length
const evidence = {
  generatedAt: new Date().toISOString(),
  overlayFile,
  visibleModelInvocableSkills: rows.length,
  translated,
  alreadyEnglish,
  fallback,
  failed,
  needsHumanReview,
  skills: rows,
}
const evidencePath = join(root, 'docs', 'superpowers', 'evidence', 'skill-english-translation-review.json')
await mkdir(join(root, 'docs', 'superpowers', 'evidence'), { recursive: true })
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

const report = [
  '# Overlays ingleses de skills',
  '',
  `Skills visibles invocables por modelo: **${rows.length}**. Ya inglesas: **${alreadyEnglish}**. Overlays traducidos: **${translated}**. Fallbacks: **${fallback}**.`,
  '',
  'Los archivos originales `SKILL.md` permanecen intactos. El overlay se selecciona solo con `locale: "en"`; si falta, se devuelve el contenido original y la evidencia registra el fallback.',
  '',
  '| Skill | Origen | Estado | Tokens técnicos | Preflight inglés | Revisión humana | Resultado |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(row => `| \`${row.name}\` | ${row.sourceLanguage} | ${row.status} | ${row.technicalTokensPreserved ? 'PASS' : 'FAIL'} | ${row.operationalEnglish ? 'PASS' : 'FAIL'} | ${row.needsHumanReview ? 'required' : 'not required'} | ${row.error ?? 'PASS'} |`),
  '',
  '## Límite de revisión',
  '',
  `El adaptador encontró **${needsHumanReview}** skills traducidas que requieren revisión humana porque mencionan credenciales, datos sensibles o acciones delicadas. El dato es explícito y permanece en la evidencia JSON.`,
].join('\n')
const reportPath = join(root, 'docs', 'subsystems', 'skill-english-overlays.md')
await mkdir(join(root, 'docs', 'subsystems'), { recursive: true })
await writeFile(reportPath, `${report}\n`, 'utf8')
process.stdout.write(`English skill overlays: translated=${translated}, alreadyEnglish=${alreadyEnglish}, fallback=${fallback}, failed=${failed}, humanReview=${needsHumanReview}\n`)
if (failed > 0 || fallback > 0) process.exitCode = 1

async function loadCatalog(filePath: string): Promise<Record<string, EnglishSkillOverlay>> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return {}
    throw error
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid overlay catalog: ${filePath}`)
  const catalog: Record<string, EnglishSkillOverlay> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid overlay: ${name}`)
    const candidate = value as { description?: unknown; whenToUse?: unknown; content?: unknown }
    if (typeof candidate.content !== 'string' || candidate.content.length === 0) throw new Error(`Overlay content missing: ${name}`)
    catalog[name] = {
      content: candidate.content,
      ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
      ...(typeof candidate.whenToUse === 'string' ? { whenToUse: candidate.whenToUse } : {}),
    }
  }
  return catalog
}

function looksSpanish(value: string): boolean {
  const accents = value.match(/[áéíóúñ¿¡]/gu)?.length ?? 0
  const strongWords = value.match(
    new RegExp(
      `\\b(?:${[
        'para', 'cuando', 'prepara', 'memoria', 'orquesta', 'asigna', 'autoevaluación',
        'escáner', 'estación', 'vigila', 'monta', 'dominio', 'usuario', 'sistema',
        'herramienta', 'tarea', 'respuesta', 'idioma', 'debe', 'puede', 'nunca',
        'según', 'hijo', 'familia', 'credenciales', 'maneja', 'navega', 'extrae',
        'actúa', 'actua', 'crear', 'montar', 'protocolo', 'permanente',
      ].join('|')})\\b`,
      'giu',
    ),
  )?.length ?? 0
  return accents >= 2 || strongWords >= 2
}

function protectedTokens(value: string): string[] {
  return [...new Set([
    ...[...value.matchAll(/`[^`\n]+`/g)].map(match => match[0]),
    ...[...value.matchAll(/https?:\/\/[^\s)]+/g)].map(match => match[0]),
  ])]
}

function failure(name: string, source: string, error: string): OverlayRow {
  return { name, source, sourceLanguage: 'es', status: 'fallback', overlayPresent: false, technicalTokensPreserved: false, operationalEnglish: false, needsHumanReview: false, error }
}
