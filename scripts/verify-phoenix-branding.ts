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

if (failures.length > 0) {
  console.error(`verify-phoenix-branding: ${failures.length} violation(s):\n${failures.map(row => `  - ${row}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`verify-phoenix-branding: PASS (${files.length} user-facing files)`)
}
