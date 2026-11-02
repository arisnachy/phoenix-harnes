import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import path from 'node:path'

const root = process.cwd()
const outputDir = path.join(root, 'artifacts', 'phoenix-zero-cost-benchmark')
const logsDir = path.join(outputDir, 'logs')
mkdirSync(logsDir, { recursive: true })

const safeEnv = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  DEEPSEEK_API_KEY: '',
  GOOGLE_API_KEY: '',
  GEMINI_API_KEY: '',
  GROQ_API_KEY: '',
  OPENROUTER_API_KEY: '',
  XAI_API_KEY: '',
}

function run(command, args, timeoutMs) {
  const started = performance.now()
  const result = spawnSync(command, args, {
    cwd: root,
    env: safeEnv,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  const durationMs = Math.round(performance.now() - started)
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return {
    command: [command, ...args].join(' '),
    durationMs,
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    error: result.error ? String(result.error.message ?? result.error) : null,
    stdout,
    stderr,
  }
}

function writeLog(id, result) {
  const body = [
    `$ ${result.command}`,
    `exitCode=${String(result.exitCode)} signal=${String(result.signal)} durationMs=${result.durationMs}`,
    '',
    '--- stdout ---',
    result.stdout,
    '',
    '--- stderr ---',
    result.stderr,
  ].join('\n')
  writeFileSync(path.join(logsDir, `${id}.log`), body)
}

function summarizeResult(id, label, result, skipped = false, skipReason = null) {
  if (skipped) {
    return {
      id,
      label,
      status: 'skipped',
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      skipReason,
      log: null,
    }
  }
  const status = result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed'
  return {
    id,
    label,
    status,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    error: result.error,
    log: `logs/${id}.log`,
  }
}

function targetLane(id, label, target, timeoutMs) {
  if (!existsSync(path.join(root, target))) {
    return summarizeResult(id, label, null, true, `Target not present: ${target}`)
  }
  const result = run('pnpm', [
    'exec',
    'vitest',
    'run',
    target,
    '--maxWorkers=1',
    '--testTimeout=30000',
    '--expect.poll.timeout=30000',
  ], timeoutMs)
  writeLog(id, result)
  return summarizeResult(id, label, result)
}

const lanes = []

{
  const result = run('pnpm', [
    'exec',
    'vitest',
    'run',
    'packages/test-support/llm-mock-server/tests',
    '--maxWorkers=1',
    '--testTimeout=30000',
    '--expect.poll.timeout=30000',
  ], 180_000)
  writeLog('mock-llm-contract', result)
  lanes.push(summarizeResult(
    'mock-llm-contract',
    'Local mock LLM contract and fault injection',
    result,
  ))
}

lanes.push(targetLane(
  'agent-loop-reconstruction',
  'Agent-loop request reconstruction',
  'packages/core/agent-loop/tests/request-reconstruction.spec.ts',
  180_000,
))

lanes.push(targetLane(
  'completion-gate',
  'Judge/completion gate adversarial behavior',
  'packages/goal/tool-goal/tests/adversarial-completion-gate.spec.ts',
  180_000,
))

const deepMode = process.env.PHOENIX_BENCH_DEEP === '1'

if (deepMode) {
  const snapshot = run('pnpm', ['run', 'test:snapshot'], 480_000)
  writeLog('snapshot-replay', snapshot)
  lanes.push(summarizeResult(
    'snapshot-replay',
    'Deterministic snapshot/replay',
    snapshot,
  ))

  const build = run('pnpm', ['run', 'build:lib'], 420_000)
  writeLog('build-lib', build)
  lanes.push(summarizeResult(
    'build-lib',
    'Host + client library build',
    build,
  ))
} else {
  lanes.push(summarizeResult(
    'snapshot-replay',
    'Deterministic snapshot/replay',
    null,
    true,
    'Fast mode: covered by repository CI; set PHOENIX_BENCH_DEEP=1 for an isolated deep run.',
  ))
  lanes.push(summarizeResult(
    'build-lib',
    'Host + client library build',
    null,
    true,
    'Fast mode: covered by repository CI; set PHOENIX_BENCH_DEEP=1 for an isolated deep run.',
  ))
}

const inventoryResult = run('git', ['ls-files'], 30_000)
const tracked = inventoryResult.stdout.split(/\r?\n/).filter(Boolean)
const testFiles = tracked.filter(file => /(?:\.spec|\.test)\.[cm]?[jt]sx?$/.test(file))
const sourceFiles = tracked.filter(file => /\.[cm]?[jt]sx?$/.test(file))

const passed = lanes.filter(lane => lane.status === 'passed').length
const failed = lanes.filter(lane => lane.status === 'failed').length
const skipped = lanes.filter(lane => lane.status === 'skipped').length
const executed = passed + failed
const totalDurationMs = lanes.reduce((sum, lane) => sum + lane.durationMs, 0)

const priorities = []
function priority(level, area, finding, action) {
  priorities.push({ level, area, finding, action })
}

const byId = Object.fromEntries(lanes.map(lane => [lane.id, lane]))

if (byId['build-lib']?.status === 'failed') {
  priority(
    'P0',
    'Build integrity',
    'The host/client library build is failing on the benchmark commit.',
    'Fix the first compiler/build error before performance tuning; downstream timings are less trustworthy while the build is red.',
  )
}
if (byId['mock-llm-contract']?.status === 'failed') {
  priority(
    'P0',
    'Provider boundary',
    'The local model simulator or its failure-mode contracts are failing.',
    'Repair mock-provider contracts first so retry, timeout, disconnect and recovery measurements remain deterministic.',
  )
}
if (byId['agent-loop-reconstruction']?.status === 'failed') {
  priority(
    'P0',
    'Agent loop',
    'Request reconstruction is failing.',
    'Inspect tool reconstruction/context assembly before changing routing heuristics; malformed reconstructed requests can cause retries and token amplification.',
  )
}
if (byId['completion-gate']?.status === 'failed') {
  priority(
    'P0',
    'Judge/completion gate',
    'Adversarial completion-gate tests are failing.',
    'Repair the completion gate and keep judge activation evidence-driven; repeated or unnecessary judge passes can add latency and token cost.',
  )
}
if (byId['snapshot-replay']?.status === 'failed') {
  priority(
    'P1',
    'Determinism / replay',
    'Snapshot replay is failing.',
    'Stabilize replay before using historical traces as a performance baseline.',
  )
}

for (const lane of lanes) {
  if (lane.status !== 'passed') continue
  if (lane.id === 'build-lib' && lane.durationMs > 120_000) {
    priority(
      'P1',
      'Build speed',
      `Library build took ${(lane.durationMs / 1000).toFixed(1)} s.`,
      'Profile TypeScript project references and tsdown stages; cache generated artifacts and avoid rebuilding unchanged package graphs.',
    )
  } else if (lane.id === 'snapshot-replay' && lane.durationMs > 60_000) {
    priority(
      'P1',
      'Replay speed',
      `Snapshot replay took ${(lane.durationMs / 1000).toFixed(1)} s.`,
      'Partition replay fixtures and reuse prepared runtime state so deterministic regression checks stay cheap.',
    )
  } else if (lane.durationMs > 30_000) {
    priority(
      'P2',
      lane.label,
      `Lane took ${(lane.durationMs / 1000).toFixed(1)} s.`,
      'Profile setup/teardown and repeated initialization in this lane.',
    )
  }
}

priority(
  'P1',
  'Interactive latency',
  'This headless benchmark does not yet measure browser input-to-dispatch latency.',
  'Add a Playwright probe for Enter -> local message bubble -> request dispatch -> thinking cleared. Target immediate optimistic bubble rendering and sub-100 ms dispatch overhead.',
)
priority(
  'P1',
  'Token efficiency',
  'Provider tokens are intentionally zero here, so model-side token amplification is not directly measured.',
  'Record serialized request byte/token estimates from replay traces and compare context growth, duplicate tool results, judge prompts and retries between commits.',
)

const report = {
  schemaVersion: 1,
  benchmark: 'phoenix-zero-cost-harness',
  mode: deepMode ? 'deep' : 'fast',
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  ref: process.env.GITHUB_REF ?? null,
  runner: {
    os: process.platform,
    node: process.version,
    ci: Boolean(process.env.CI),
  },
  zeroCostGuarantees: {
    providerApiKeysBlanked: true,
    externalProviderCallsRequired: false,
    expectedProviderTokens: 0,
    expectedProviderApiCostUsd: 0,
  },
  inventory: {
    trackedFiles: tracked.length,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
  },
  summary: {
    passed,
    failed,
    skipped,
    executed,
    passRate: executed === 0 ? null : passed / executed,
    totalLaneDurationMs: totalDurationMs,
  },
  lanes,
  priorities,
}

writeFileSync(
  path.join(outputDir, 'benchmark-report.json'),
  JSON.stringify(report, null, 2) + '\n',
)

const statusEmoji = status => status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⏭️'
const laneRows = lanes.map(lane =>
  `| ${statusEmoji(lane.status)} | ${lane.label} | ${lane.status} | ${(lane.durationMs / 1000).toFixed(2)} s | ${lane.exitCode ?? '—'} |`
)
const priorityRows = priorities.map(item =>
  `| ${item.level} | ${item.area} | ${item.finding.replace(/\|/g, '\\|')} | ${item.action.replace(/\|/g, '\\|')} |`
)

const markdown = `# PHOENIX zero-cost harness benchmark

Generated: ${report.generatedAt}

## Executive summary

- Mode: **${deepMode ? 'deep' : 'fast'}**
- Provider API tokens consumed by this benchmark: **0**
- Expected provider API cost: **$0**
- Passed lanes: **${passed}**
- Failed lanes: **${failed}**
- Skipped lanes: **${skipped}**
- Executed pass rate: **${executed === 0 ? 'n/a' : (100 * passed / executed).toFixed(1) + '%'}**
- Sum of measured lane times: **${(totalDurationMs / 1000).toFixed(2)} s**
- Repository test inventory: **${testFiles.length} test files**

## Lanes

| | Lane | Status | Time | Exit |
|---|---|---:|---:|---:|
${laneRows.join('\n')}

## Improvement priorities

| Priority | Area | Finding | Recommended action |
|---|---|---|---|
${priorityRows.join('\n')}

## What this benchmark isolates

This suite measures Phoenix infrastructure without paying for model inference. It uses the repository's local mock-LLM contracts, deterministic tests/replay, and build gates. Provider API keys are blanked in the benchmark process.

It is intended to expose harness regressions in request reconstruction, provider recovery, completion/judge gating, deterministic replay, and build integrity. A browser-side input-to-dispatch probe and serialized-context token estimator are listed as next measurements because they require dedicated instrumentation rather than inference calls.

## Raw evidence

Per-lane logs are stored under **logs/** beside this report. The machine-readable result is **benchmark-report.json**.
`

writeFileSync(path.join(outputDir, 'benchmark-report.md'), markdown)
console.log(markdown)
