import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@phoenix-ai/dsh-home-paths'
import SkillRegistry, {
  adaptSkillDefinition,
  buildOperationalProfile,
  renderOperationalPrelude,
} from '@phoenix-ai/dsh-skill'
import * as SkillFileSystem from '@phoenix-ai/dsh-skill-filesystem'

interface VerificationRow {
  name: string
  description: string
  provider: string
  source: string
  loaded: boolean
  purpose: string
  requiredInputs: string[]
  executionMode: string
  toolMappings: { documented: string; runtimeTool?: string; available: boolean }[]
  externalRequirements: string[]
  preflightLength: number
  languageSafe: boolean
  error?: string
}

const root = process.cwd()
const home = resolveDshHome()
const evidencePath = join(root, 'docs', 'superpowers', 'evidence', 'skill-operational-adapters-verification.json')
const reportPath = join(root, 'docs', 'subsystems', 'skill-operational-adapters-report.md')
const categoryReportPath = join(root, 'docs', 'subsystems', 'skill-operational-adapters-by-category.md')
const ctx = new Context()
await ctx.plugin(SkillRegistry)
await ctx.plugin(SkillFileSystem, {
  dshHome: home,
  agentsHome: join(home, '..', '.agents'),
  watch: false,
})

const summaries = await ctx.skills.list({ cwd: root })
const runtimeCapabilities = new Set((process.env.DSH_SKILL_CAPABILITIES ?? 'skill').split(',').map(value => value.trim()).filter(Boolean))
const rows: VerificationRow[] = []

for (const summary of summaries.filter(skill => skill.invocation.modelInvocable)) {
  try {
    const definition = await ctx.skills.get(summary.name, { cwd: root })
    if (definition === undefined) throw new Error('ctx.skills.get() returned undefined')
    const adapted = adaptSkillDefinition(definition, runtimeCapabilities)
    const profile = adapted.operational ?? buildOperationalProfile(definition, runtimeCapabilities)
    const preflight = renderOperationalPrelude(profile)
    const languageSafe = !/[\u4e00-\u9fff]/u.test(preflight) && !preflight.includes('用途')
    if (preflight.length === 0) throw new Error('operational preflight is empty')
    if (!languageSafe) throw new Error('generated preflight contains forbidden language markers')
    rows.push({
      name: summary.name,
      description: summary.description,
      provider: summary.provider,
      source: summary.source,
      loaded: true,
      purpose: summary.description,
      requiredInputs: [...profile.requiredInputs],
      executionMode: profile.executionMode,
      toolMappings: profile.toolMappings.map(mapping => ({ ...mapping })),
      externalRequirements: [...profile.externalRequirements],
      preflightLength: preflight.length,
      languageSafe,
    })
    process.stdout.write(`PASS ${summary.name} — ${summary.description}\n`)
  } catch (error) {
    rows.push({
      name: summary.name,
      description: summary.description,
      provider: summary.provider,
      source: summary.source,
      loaded: false,
      purpose: summary.description,
      requiredInputs: [],
      executionMode: 'unknown',
      toolMappings: [],
      externalRequirements: [],
      preflightLength: 0,
      languageSafe: false,
      error: error instanceof Error ? error.message : String(error),
    })
    process.stdout.write(`FAIL ${summary.name}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

const passed = rows.filter(row => row.loaded).length
const failed = rows.length - passed
await mkdir(join(root, 'docs', 'superpowers', 'evidence'), { recursive: true })
await writeFile(evidencePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  runtimeCapabilities: [...runtimeCapabilities].sort(),
  visibleModelInvocableSkills: rows.length,
  passed,
  failed,
  skills: rows,
}, null, 2)}\n`, 'utf8')

const report = [
  '# Informe individual de skills operativas',
  '',
  `Catálogo visible en este runtime: **${rows.length}** skills model-invocable. Resultado de carga: **${passed}/${rows.length}**.`,
  '',
  'Cada fila fue cargada con `ctx.skills.get()`, adaptada con el perfil operativo y revisada por higiene de idioma. `executionMode` no significa que un servicio externo esté configurado.',
  '',
  '| Skill | Para qué sirve | Cómo cargarla | Entradas | Modo | Requisitos externos | Prueba |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(row => `| \`${row.name}\` | ${escapeCell(row.purpose)} | \`skill({ name: "${row.name}" })\` | ${row.requiredInputs.length > 0 ? row.requiredInputs.join(', ') : 'según la guía'} | ${row.executionMode} | ${row.externalRequirements.length > 0 ? escapeCell(row.externalRequirements.join('; ')) : 'ninguno detectado'} | ${row.loaded ? 'PASS' : `FAIL: ${escapeCell(row.error ?? 'error')}`} |`),
  '',
  '## Regla de uso',
  '',
  'El modelo debe cargar la skill exacta antes de actuar, leer su preflight, pedir datos ambiguos y usar únicamente herramientas presentes en el runtime. Las skills `conditional` requieren sus dependencias; las `instruction-only` se pueden explicar, pero no se deben presentar como ejecutadas.',
  '',
].join('\n')
await mkdir(join(root, 'docs', 'subsystems'), { recursive: true })
await writeFile(reportPath, `${report}\n`, 'utf8')
const byCategory = new Map<string, VerificationRow[]>()
for (const row of rows) {
  const category = categoryFor(row.name)
  const entries = byCategory.get(category) ?? []
  entries.push(row)
  byCategory.set(category, entries)
}
const categoryReport = [
  '# Skills por categoría',
  '',
  `Catálogo visible: **${rows.length}** skills. Cada categoría conserva el nombre exacto y el propósito de cada skill.`,
  '',
  ...[...byCategory.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([category, entries]) => [
    `## ${category} (${entries.length})`,
    '',
    '| Skill | Qué hace | Modo | Prueba |',
    '|---|---|---|---|',
    ...entries.sort((left, right) => left.name.localeCompare(right.name)).map(row => `| \`${row.name}\` | ${escapeCell(row.purpose)} | ${row.executionMode} | ${row.loaded ? 'PASS' : 'FAIL'} |`),
    '',
  ]),
].join('\n')
await writeFile(categoryReportPath, `${categoryReport}\n`, 'utf8')
process.stdout.write(`Skill operational adapters: ${passed}/${rows.length} passed\n`)
if (failed > 0) process.exitCode = 1

function categoryFor(name: string): string {
  const parts = name.split('-')
  if (parts.length === 1) return name
  if (parts[0] === 'codex' && parts.length > 1) return `codex-${parts[1]}`
  return parts[0] ?? name
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}
