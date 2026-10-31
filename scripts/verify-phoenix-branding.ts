/** Fail when legacy product copy returns to PHOENIX user-facing surfaces. */

import { globSync, readFileSync } from 'node:fs'

const patterns = [
  { label: 'legacy product name', value: /DeepSeek Harness/gu },
  { label: 'legacy local-build name', value: /DSH Local Build/gu },
  { label: 'legacy thinking label', value: /Deep diving/gu },
  { label: 'legacy welcome title', value: /Into the Unknown/gu },
]

const files = globSync([
  'apps/web/src/**/*.{ts,tsx,json}',
  'apps/web/index.html',
  'apps/web/public/*.json',
  'packages/client/*/src/**/*.{ts,tsx,json}',
  'packages/core/system-prompt/src/**/*.{ts,md}',
  'packages/sandbox/sandbox-policy/src/**/*.{ts,md}',
  '!**/lib/**',
  '!**/snapshots/**',
])

const failures: string[] = []
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    pattern.value.lastIndex = 0
    if (pattern.value.test(content)) failures.push(`${file}: ${pattern.label}`)
  }
}

const requiredCopy = [
  ['apps/web/index.html', '<title>PHOENIX HARDNESS</title>'],
  ['apps/web/public/manifest.webmanifest', '"name": "PHOENIX HARDNESS"'],
  ['packages/client/web/src/boot-page.ts', 'PHOENIX HARDNESS'],
] as const
for (const [file, value] of requiredCopy) {
  if (!readFileSync(file, 'utf8').includes(value)) failures.push(`${file}: missing ${JSON.stringify(value)}`)
}

const rootBrandDocuments = [
  'README.md', 'README.es.md', 'README.zh.md',
  'BRAND_GUIDELINES.md', 'BRAND_GUIDELINES.es.md', 'BRAND_GUIDELINES.zh.md',
]
for (const file of rootBrandDocuments) {
  const content = readFileSync(file, 'utf8')
  if (!content.includes('PHOENIX')) failures.push(`${file}: missing PHOENIX identity`)
  if (/DeepSeek Harness|downstream evolution|built on DeepSeek|下游演进/u.test(content)) {
    failures.push(`${file}: outdated external-product branding`)
  }
}
for (const [file, links] of [
  ['README.md', ['README.es.md', 'README.zh.md']],
  ['README.es.md', ['README.md', 'README.zh.md']],
  ['README.zh.md', ['README.md', 'README.es.md']],
  ['BRAND_GUIDELINES.md', ['BRAND_GUIDELINES.es.md', 'BRAND_GUIDELINES.zh.md']],
  ['BRAND_GUIDELINES.es.md', ['BRAND_GUIDELINES.md', 'BRAND_GUIDELINES.zh.md']],
  ['BRAND_GUIDELINES.zh.md', ['BRAND_GUIDELINES.md', 'BRAND_GUIDELINES.es.md']],
] as const) {
  const content = readFileSync(file, 'utf8')
  for (const link of links) {
    if (!content.includes(`](${link})`)) failures.push(`${file}: missing language link to ${link}`)
  }
}
if (!readFileSync('THIRD_PARTY_NOTICES.md', 'utf8').includes('PHOENIX is distributed under the [MIT license]')) {
  failures.push('THIRD_PARTY_NOTICES.md: missing PHOENIX identity in generated notices')
}

if (failures.length > 0) {
  console.error(`verify-phoenix-branding: ${failures.length} violation(s):\n${failures.map(row => `  - ${row}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`verify-phoenix-branding: PASS (${files.length} user-facing files)`)
}
