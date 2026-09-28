import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface BaselineFile {
  readonly version: 1
  readonly total: number
  readonly files: Readonly<Record<string, Readonly<Record<string, number>>>>
}

const baseline = JSON.parse(
  readFileSync(new URL('./oxlint-contracts-baseline.json', import.meta.url), 'utf8'),
) as BaselineFile

const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))
const rawThreads = process.env.DSH_OXLINT_THREADS
const args = ['.', '--format=unix']
const env = { ...process.env }
if (rawThreads !== undefined && rawThreads !== '') {
  const parsed = Number.parseInt(rawThreads, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== rawThreads) {
    throw new Error(`verify-oxlint-contracts: DSH_OXLINT_THREADS must be a positive integer, got ${JSON.stringify(rawThreads)}.`)
  }
  args.push(`--threads=${rawThreads}`)
  env.GOMAXPROCS = rawThreads
}

const result = spawnSync(process.execPath, [oxlintCli, ...args], {
  encoding: 'utf8',
  env,
  maxBuffer: 64 * 1024 * 1024,
})
if (result.error !== undefined) throw result.error
if (result.signal !== null) {
  process.kill(process.pid, result.signal)
}

const output = `${result.stdout}${result.stderr}`
const actual = new Map<string, Map<string, number>>()
const matchingLines = new Map<string, string[]>()
let parsedErrors = 0

for (const rawLine of output.split('\n')) {
  const line = rawLine.trimEnd()
  const match = /^(.+?):(\d+):(\d+): .* \[Error(?:\/([^\]]+))?\]$/.exec(line)
  if (match === null) continue
  const file = (match[1] ?? '').replaceAll('\\', '/')
  const rule = match[4] ?? '__parser__'
  const rules = actual.get(file) ?? new Map<string, number>()
  rules.set(rule, (rules.get(rule) ?? 0) + 1)
  actual.set(file, rules)
  const key = `${file}\u0000${rule}`
  const lines = matchingLines.get(key) ?? []
  lines.push(line)
  matchingLines.set(key, lines)
  parsedErrors += 1
}

const regressions: string[] = []
for (const [file, rules] of actual) {
  for (const [rule, count] of rules) {
    const allowed = baseline.files[file]?.[rule] ?? 0
    if (count <= allowed) continue
    regressions.push(`${file}: ${rule}: ${count} > baseline ${allowed}`)
    const key = `${file}\u0000${rule}`
    for (const line of matchingLines.get(key) ?? []) regressions.push(`  ${line}`)
  }
}

if ((result.status ?? 1) > 1) {
  process.stderr.write(output)
  throw new Error(`verify-oxlint-contracts: oxlint exited with ${String(result.status)}`)
}
if ((result.status ?? 0) !== 0 && parsedErrors === 0) {
  process.stderr.write(output)
  throw new Error('verify-oxlint-contracts: oxlint failed without parseable diagnostics')
}

if (regressions.length > 0) {
  console.error('verify-oxlint-contracts: contracts-ready lint regression(s):')
  for (const line of regressions) console.error(line)
  process.exit(1)
}

const remaining = [...actual.values()].reduce(
  (sum, rules) => sum + [...rules.values()].reduce((inner, count) => inner + count, 0),
  0,
)
const reduced = Math.max(0, baseline.total - remaining)
console.log(
  `verify-oxlint-contracts: no new lint debt; ${remaining} baselined error(s) remain`
  + (reduced > 0 ? ` (${reduced} removed since baseline)` : '')
  + '.',
)
