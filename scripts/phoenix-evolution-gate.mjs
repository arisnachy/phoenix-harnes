#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.PHOENIX_GATE_BASE || 'origin/main'
const head = process.env.PHOENIX_GATE_HEAD || 'HEAD'
const manifestPath = '.phoenix/evolution/sources.json'
const reportPath = process.env.PHOENIX_GATE_REPORT || '.phoenix/evolution/gate-report.json'

function fail(message) {
  console.error(`PHOENIX_EVOLUTION_GATE: ${message}`)
  process.exitCode = 1
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}`)
  process.exit()
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const [key, expected] of Object.entries({
  directMainWrites: false,
  automaticMainMerge: false,
  requireHumanPromotion: true,
  requireIdentityGate: true,
  requireSecurityGate: true,
  requireRegressionGate: true,
  requireRollbackPlan: true,
})) {
  if (manifest.policy?.[key] !== expected) fail(`policy.${key} must remain ${expected}`)
}
if (manifest.stableBranch !== 'main') fail('stableBranch must remain main')
if (manifest.inboxBranch !== 'phoenix/evolution-inbox') fail('inboxBranch identity changed')

let changed = []
let patch = ''
try {
  changed = git(['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean)
  patch = git(['diff', '--unified=0', `${base}...${head}`])
} catch (error) {
  fail(`cannot inspect candidate diff: ${error instanceof Error ? error.message : String(error)}`)
}

const protectedIdentity = new Set([
  'README.md',
  'package.json',
  'packages/bundle/phoenix/package.json',
  'packages/bundle/phoenix/README.md',
  'packages/phoenix/README.md',
])
const identityTouched = changed.some(path => protectedIdentity.has(path))
if (identityTouched) {
  const root = readFileSync('README.md', 'utf8')
  if (!/\bPHOENIX\b/.test(root)) fail('root product identity no longer contains PHOENIX')
  if (/^#\s+(DeepSeek Harness|Claude Code|Codex)\s*$/mi.test(root)) {
    fail('candidate appears to replace PHOENIX product identity with an upstream product')
  }
}

const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n')
const highRiskPatterns = [
  /danger-full-access/i,
  /dangerously-bypass-approvals-and-sandbox/i,
  /\bgit\s+push\b[^\n]*(--force|-f\b)/i,
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i,
  /\b(?:exec|execSync|spawn|spawnSync)\s*\(/,
  /\bsecrets?\b[^\n]*(?:log|print|console)/i,
]
const highRiskSignals = highRiskPatterns.filter(pattern => pattern.test(added)).map(pattern => pattern.source)
const rollbackPlan = 'docs/evolution/ROLLBACK.md'
if (highRiskSignals.length > 0 && !existsSync(rollbackPlan)) {
  fail(`high-risk candidate requires ${rollbackPlan}`)
}

const sovereignPrefixes = [
  '.github/workflows/',
  '.github/CODEOWNERS',
  'SECURITY.md',
  'packages/credentials/',
  'packages/authorization/',
  'packages/sandbox/',
]
const sovereignTouched = changed.filter(path => sovereignPrefixes.some(prefix => path.startsWith(prefix)))

const report = {
  schemaVersion: 1,
  base,
  head,
  stableBranch: manifest.stableBranch,
  inboxBranch: manifest.inboxBranch,
  changedFiles: changed.length,
  identityTouched,
  sovereignTouched,
  highRiskSignals,
  requiresHumanPromotion: true,
  automaticMainMerge: false,
  result: process.exitCode ? 'FAIL' : 'PASS',
}
mkdirSync('.phoenix/evolution', { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
