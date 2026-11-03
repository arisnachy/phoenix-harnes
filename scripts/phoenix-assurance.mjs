#!/usr/bin/env node
/**
 * On-demand operational assurance for PHOENIX. Every lane invokes an existing
 * workspace test or analyzer; no dependency is "enabled" by merely listing it.
 * No automatic merge gate and no model/network claims without actual execution.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_ROOT = '.cache/phoenix/assurance'
const minutes = value => value * 60_000
const step = (id, args, timeLimitMinutes = 10) => ({ id, args, timeoutMs: minutes(timeLimitMinutes) })

/** Profiles use the repository's EXISTING installed packages and real tests. */
export const PROFILES = Object.freeze({
  quick: [
    step('agent-first-pass', ['exec', 'vitest', 'run', 'packages/core/agent-loop/tests/first-pass-quality.spec.ts'], 4),
    step('skill-intent', ['exec', 'vitest', 'run', 'packages/skill/tool-skill/tests/natural-intent.spec.ts'], 4),
    step('markdown-regression', ['exec', 'vitest', 'run', 'packages/client/ui-primitives/tests/markdown.client.spec.tsx'], 4),
  ],
  agents: [
    step('agent-first-pass', ['exec', 'vitest', 'run', 'packages/core/agent-loop/tests/first-pass-quality.spec.ts'], 4),
    step('skill-intent', ['exec', 'vitest', 'run', 'packages/skill/tool-skill/tests/natural-intent.spec.ts'], 4),
    step('deliverables-regression', ['exec', 'vitest', 'run', 'packages/client/ui-deliverables/tests/produced-files.client.spec.tsx'], 6),
  ],
  architecture: [
    step('workspace-invariants', ['run', 'verify-package-invariants'], 5),
    step('module-boundaries', ['run', 'constraints'], 5),
    step('dead-exports', ['run', 'knip'], 12),
  ],
  security: [
    step('licenses', ['run', 'verify-dsh-package-licenses'], 8),
    step('dependencies', ['audit', '--prod', '--audit-level=high'], 7),
  ],
  types: [
    step('build-libraries', ['run', 'build:lib'], 30),
  ],
  browser: [
    step('build-libraries', ['run', 'build:lib'], 30),
    step('build-browser', ['run', 'build:web'], 15),
    step('browser-artifact-e2e', ['exec', 'vitest', 'run', '--config', 'vitest.web.config.ts', 'apps/web/tests/produced-files.e2e.ts'], 12),
  ],
  performance: [
    step('build-libraries', ['run', 'build:lib'], 30),
    step('build-browser', ['run', 'build:web'], 15),
    step('browser-performance', ['run', 'test:web:perf:built'], 25),
  ],
})

const FULL_ORDER = ['agents', 'types', 'architecture', 'security', 'browser', 'performance']

/** Deduplicate build steps so a full run doesn't rebuild the same tree. */
export function selectSteps(profile) {
  if (profile !== 'full' && !Object.hasOwn(PROFILES, profile)) {
    throw new Error(`Unknown assurance profile ${JSON.stringify(profile)}.`)
  }
  const profiles = profile === 'full' ? FULL_ORDER : [profile]
  const seen = new Set()
  const result = []
  for (const mode of profiles) {
    for (const candidate of PROFILES[mode]) {
      if (seen.has(candidate.id)) continue
      seen.add(candidate.id)
      result.push(candidate)
    }
  }
  return result
}

/** Resolve the actual package manager from the pnpm invocation (never shell interpolation). */
export function packageManagerInvocation(args, environment = process.env) {
  const executable = environment.npm_execpath
  if (!executable || !/^pnpm@\d+\.\d+\.\d+$/u.test(
    JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).packageManager,
  )) {
    throw new Error('Run via the repository-pinned pnpm: pnpm run quality:<profile>.')
  }
  return /\.[cm]?js$/iu.test(executable)
    ? { command: process.execPath, args: [executable, ...args] }
    : { command: executable, args: [...args] }
}

/** One real child process with a hard time limit and explicit failure semantics. */
export function executeStep(command, args, options = {}) {
  const start = performance.now()
  return new Promise(resolveStep => {
    let resolved = false
    let timedOut = false
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
      shell: false,
    })
    const finish = (status, exitCode = null, error = null) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolveStep({ status, exitCode, durationMs: Math.round(performance.now() - start), ...(error ? { error } : {}) })
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs ?? minutes(10))
    timer.unref()
    child.once('error', error => finish('failed', null, `Unable to start process: ${error.message}`))
    child.once('close', (code, signal) => {
      if (timedOut) finish('failed', code, 'Timed out; process terminated')
      else if (code === 0 && signal === null) finish('passed', 0)
      else finish('failed', code, signal ? `Terminated by ${signal}` : `Exit code ${String(code)}`)
    })
  })
}

/** Persist structured evidence atomically, never copying child output or credentials. */
export function writeReport(report, path) {
  if (!isAbsolute(path)) path = resolve(ROOT, path)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
  return path
}

export function validateInstall() {
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'node_modules/.bin/vitest',
    'apps/web/node_modules/.bin/playwright',
  ]
  // Windows pnpm creates .cmd wrappers; Unix pnpm uses executable shims.
  return paths.map(path => {
    const actual = process.platform === 'win32' && path.includes('/.bin/') ? `${path}.cmd` : path
    return { resource: path, available: existsSync(resolve(ROOT, actual)) }
  })
}

/** Execute all steps in a profile; a failed step never masquerades as skipped/passed. */
export async function runProfile(profile, options = {}) {
  const steps = selectSteps(profile)
  const startedAt = new Date().toISOString()
  const results = []
  for (const item of steps) {
    const invocation = options.invocation?.(item.args) ?? packageManagerInvocation(item.args)
    const log = options.log ?? console.log
    log(`assurance [${profile}] ${item.id}: ${item.args.join(' ')}`)
    const result = await (options.execute ?? executeStep)(invocation.command, invocation.args, {
      timeoutMs: item.timeoutMs,
      cwd: ROOT,
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    })
    results.push({ id: item.id, status: result.status, exitCode: result.exitCode,
      durationMs: result.durationMs, ...(result.error ? { error: result.error } : {}) })
    if (result.status !== 'passed') break // Do not claim downstream stages ran.
  }
  const report = {
    schemaVersion: 1,
    profile,
    startedAt,
    finishedAt: new Date().toISOString(),
    result: results.length === steps.length && results.every(result => result.status === 'passed')
      ? 'passed' : 'failed',
    requestedSteps: steps.length,
    executedSteps: results.length,
    steps: results,
  }
  if (options.persist !== false) {
    const target = options.reportPath ?? `${REPORT_ROOT}/${profile}-latest.json`
    writeReport(report, target)
  }
  return report
}

async function main(argv) {
  const [profile = 'quick', ...extra] = argv
  if (extra.length > 0) throw new Error('Use a single profile name (quick, agents, architecture, security, types, browser, performance, full, doctor, plan).')
  if (profile === 'doctor') {
    const resources = validateInstall()
    for (const resource of resources) console.log(`${resource.available ? 'OK' : 'MISSING'} ${resource.resource}`)
    return resources.every(resource => resource.available) ? 0 : 1
  }
  if (profile === 'plan') {
    for (const name of [...Object.keys(PROFILES), 'full']) {
      console.log(`${name}: ${selectSteps(name).map(step => step.id).join(', ')}`)
    }
    return 0
  }
  const report = await runProfile(profile)
  console.log(`assurance ${profile}: ${report.result} (${String(report.executedSteps)}/${String(report.requestedSteps)} executed)`)
  return report.result === 'passed' ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(`assurance: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
