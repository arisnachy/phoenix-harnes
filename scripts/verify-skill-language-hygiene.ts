import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const files = [
  join(root, 'docs', 'subsystems', 'skill-operational-adapters.md'),
  join(root, 'docs', 'subsystems', 'skill-operational-adapters-report.md'),
  join(root, 'docs', 'subsystems', 'skill-operational-adapters-by-category.md'),
  join(root, 'docs', 'subsystems', 'skill-english-overlays.md'),
  join(root, 'docs', 'superpowers', 'evidence', 'skill-operational-adapters-verification.json'),
  join(root, 'docs', 'superpowers', 'evidence', 'skill-english-translation-review.json'),
  join(root, 'docs', 'superpowers', 'plans', '2026-08-28-phoenix-skill-english-translation-plan.md'),
]
const failures: string[] = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  if (/[\u4e00-\u9fff]/u.test(text)) failures.push(`${file}: contiene ideogramas chinos generados`)
  if (text.includes('用途')) failures.push(`${file}: contiene el marcador chino 用途`)
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Skill language hygiene: ${files.length}/${files.length} files passed\n`)
}
