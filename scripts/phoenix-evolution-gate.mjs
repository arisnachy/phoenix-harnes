#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const base = process.env.PHOENIX_GATE_BASE || 'origin/main'
const head = process.env.PHOENIX_GATE_HEAD || 'HEAD'
const manifestPath = '.phoenix/evolution/sources.json'
const reportPath = process.env.PHOENIX_GATE_REPORT || '.phoenix/evolution/gate-report.json'
let failed = false
const fail = message => { failed = true; console.error(`PHOENIX_EVOLUTION_GATE: ${message}`) }
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()

if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`)
else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const expected = { directMainWrites:false, automaticMainMerge:false, requireHumanPromotion:true, requireIdentityGate:true, requireSecurityGate:true, requireRegressionGate:true, requireRollbackPlan:true }
  for (const [key, value] of Object.entries(expected)) if (manifest.policy?.[key] !== value) fail(`policy.${key} must remain ${value}`)
  if (manifest.stableBranch !== 'main') fail('stableBranch must remain main')
  if (manifest.inboxBranch !== 'phoenix/evolution-inbox') fail('inboxBranch identity changed')
}

let changed = []
let patch = ''
try {
  changed = git(['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean)
  patch = git(['diff', '--unified=0', `${base}...${head}`])
} catch (error) { fail(`cannot inspect candidate diff: ${error instanceof Error ? error.message : String(error)}`) }

const identityTouched = changed.some(path => ['README.md','package.json','packages/bundle/phoenix/package.json','packages/bundle/phoenix/README.md','packages/phoenix/README.md'].includes(path))
if (identityTouched && existsSync('README.md')) {
  const root = readFileSync('README.md', 'utf8')
  if (!/\bPHOENIX\b/.test(root)) fail('root product identity no longer contains PHOENIX')
  if (/^#\s+(DeepSeek Harness|Claude Code|Codex)\s*$/mi.test(root)) fail('candidate replaces PHOENIX identity with an upstream product')
}

const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n')
const riskSignals = [/danger-full-access/i,/dangerously-bypass-approvals-and-sandbox/i,/\bgit\s+push\b[^\n]*(--force|-f\b)/i,/\brm\s+-rf\b/i,/\bsecrets?\b[^\n]*(?:log|print|console)/i].filter(pattern => pattern.test(added)).map(pattern => pattern.source)
if (riskSignals.length > 0 && !existsSync('docs/evolution/ROLLBACK.md')) fail('high-risk candidate lacks rollback contract')

const sovereignPrefixes = ['.github/workflows/','.github/CODEOWNERS','SECURITY.md','packages/credentials/','packages/authorization/','packages/sandbox/']
const report = { schemaVersion:1, base, head, changedFiles:changed.length, identityTouched, sovereignTouched:changed.filter(path => sovereignPrefixes.some(prefix => path.startsWith(prefix))), riskSignals, requiresHumanPromotion:true, automaticMainMerge:false, result: failed ? 'FAIL' : 'PASS' }
mkdirSync('.phoenix/evolution', { recursive:true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (failed) process.exitCode = 1
