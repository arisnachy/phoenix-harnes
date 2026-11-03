/**
 * Explicit local real-model research trial. Uses the existing Phoenix headless
 * profile and current provider account; never fabricates a model run in CI.
 * Runs with read-only permissions and no telemetry. Only aggregate metrics,
 * answer text and sanitized public-source URLs leave the temporary session.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

const MAX_STDOUT = 200_000

function boundedSourceUrl(input) {
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    // Do not export auth tokens, search terms or personally identifying data
    // that the remote site may have embedded in a URL query.
    url.search = ''
    url.hash = ''
    return url.href
  } catch { return undefined }
}
function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return {}
  try { return JSON.parse(raw) } catch { return {} }
}
function numericUsage(usage, ...names) {
  for (const name of names) {
    const n = usage?.[name]
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n
  }
  return undefined
}

/** Extract source receipts only from successfully completed web_fetch calls. */
export function researchEvidenceFromEvents(events) {
  const calls = new Map()
  let promptTokens = 0
  let completionTokens = 0
  let tokenSamples = 0
  let searches = 0
  let duplicateSearches = 0
  const queries = new Set()
  let fetches = 0
  const fetched = new Set()
  let assistantText = ''
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (Array.isArray(content)) {
        const current = content.filter(block => block.type === 'text').map(block => block.text).join('')
        if (current.trim()) assistantText = current
      }
      const usage = event.data?.usage ?? event.data?.message?.usage
      const input = numericUsage(usage, 'inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens')
      const output = numericUsage(usage, 'outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens')
      if (input !== undefined && output !== undefined) {
        const cacheRead = numericUsage(usage, 'cacheReadTokens')
        const cacheWrite = numericUsage(usage, 'cacheWriteTokens')
        promptTokens += input + (cacheRead ?? 0) + (cacheWrite ?? 0)
        completionTokens += output
        tokenSamples++
      }
    }
    if (event.type === 'tool/call') {
      const id = event.data?.callId
      const name = event.data?.name
      if (typeof id !== 'string' || typeof name !== 'string') continue
      const args = parseArguments(event.data.arguments)
      calls.set(id, { name, args })
      if (name === 'web_search') {
        searches++
        for (const q of Array.isArray(args.queries) ? args.queries : []) {
          if (typeof q !== 'string') continue
          const key = q.trim().toLocaleLowerCase()
          if (queries.has(key)) duplicateSearches++
          else queries.add(key)
        }
      }
    }
    if (event.type === 'tool/result') {
      const id = event.data?.message?.source?.callId
      const call = calls.get(id)
      if (call?.name !== 'web_fetch') continue
      fetches++
      const blocks = event.data.message.content ?? []
      const successful = event.data.error === undefined
        && blocks.some(block => block.type === 'tool-result' && block.isError !== true)
      if (!successful) continue
      const status = event.data?.meta?.statusCode
      // A tool may complete successfully while the HTTP response is 404.
      // Only a validated 2xx source body is a factual research receipt.
      if (!Number.isInteger(status) || status < 200 || status >= 300) continue
      const url = boundedSourceUrl(event.data.meta.url ?? call.args.url)
      if (url) fetched.add(url)
    }
  }
  return {
    answer: assistantText,
    observedWebFetchUrls: [...fetched],
    promptTokens: tokenSamples === 0 ? null : promptTokens,
    completionTokens: tokenSamples === 0 ? null : completionTokens,
    searches, duplicateSearches, fetches,
    observedToolCalls: calls.size,
    usageSamples: tokenSamples,
  }
}

function readSessionFiles(root) {
  const found = []
  const traverse = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = join(dir, entry.name)
      if (entry.isDirectory()) traverse(name)
      else if (entry.isFile() && name.endsWith('.jsonl')) found.push(name)
    }
  }
  traverse(root)
  return found
}
function readRootEvents(sessionRoot) {
  const files = readSessionFiles(sessionRoot)
  for (const file of files) {
    const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    if (entries.length < 2) continue
    try {
      const header = JSON.parse(entries[0])
      if (header.type !== 'session' || header.origin === 'subagent') continue
      return entries.slice(1).map(line => JSON.parse(line)).filter(row => row && typeof row.type === 'string')
    } catch { /* Corrupted incomplete log is not evidence. */ }
  }
  return []
}
async function runOne(testCase, rootDir, nodeBinary) {
  const id = String(testCase.id)
  const dir = join(rootDir, id.replace(/[^\w.-]/gu, '-'))
  mkdirSync(dir, { recursive: true })
  const sessions = join(dir, 'sessions')
  mkdirSync(sessions, { recursive: true })
  const patch = join(dir, 'research-readonly.patch.yml')
  writeFileSync(patch, [
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(sessions)}`,
    '    compression: none',
    '    packChunks: false',
    '',
  ].join('\n'))
  const args = [
    '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
    '--profile', 'headless', '--patch', patch, testCase.prompt,
  ]
  let output = ''
  let reachedLimit = false
  const start = performance.now()
  const maxTimeMs = Math.min(240_000, Math.max(30_000, testCase.maxTimeMs ?? 180_000))
  const exitCode = await new Promise(resolveExit => {
    const child = spawn(nodeBinary, args, {
      cwd: process.cwd(),
      env: { ...process.env, DSH_PERMISSION_MODE: 'read-only', DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      reachedLimit = true
      child.kill()
    }, maxTimeMs)
    child.stdout.on('data', chunk => {
      if (output.length < MAX_STDOUT) output += String(chunk).slice(0, MAX_STDOUT - output.length)
    })
    // stderr may include provider/system secrets: never retain it in the report.
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); resolveExit(1) })
    child.on('close', code => { clearTimeout(timer); resolveExit(code ?? 1) })
  })
  const elapsedMs = Math.round(performance.now() - start)
  const evidence = researchEvidenceFromEvents(readRootEvents(sessions))
  return {
    id, answer: evidence.answer || output.trim().slice(-MAX_STDOUT),
    observedWebFetchUrls: evidence.observedWebFetchUrls,
    elapsedMs, promptTokens: evidence.promptTokens,
    completionTokens: evidence.completionTokens,
    searches: evidence.searches, duplicateSearches: evidence.duplicateSearches,
    fetches: evidence.fetches, observedToolCalls: evidence.observedToolCalls,
    usageSamples: evidence.usageSamples, exitCode, timedOut: reachedLimit,
    // The report stores no provider keys, web query parameters or private tool outputs.
  }
}

/** Run selected, explicitly authorized live headless research challenges. */
export async function runLiveSuite(config, { only, output, nodeBinary = process.execPath } = {}) {
  if (!output) throw new Error('A local --output file is required')
  const selected = config.cases.filter(item => !only || item.id === only)
  if (!selected.length) throw new Error('Unknown or empty research case selection')
  const scratch = mkdtempSync(join(tmpdir(), 'phoenix-research-'))
  const cases = []
  try {
    for (const testCase of selected) {
      console.log(`Running live Phoenix research: ${testCase.id}`)
      const result = await runOne(testCase, scratch, nodeBinary)
      cases.push(result)
      console.log(`${result.id}: ${result.elapsedMs}ms, fetches=${result.fetches}, tokens=${result.promptTokens === null ? 'unknown' : result.promptTokens + result.completionTokens}`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const report = {
    kind: 'phoenix-live-research-unscored', capturedAt: new Date().toISOString(),
    disclaimer: 'Real model outputs are NOT fact-verified by this runner. Audit with an independently authored source corpus.',
    cases,
  }
  mkdirSync(dirname(resolve(output)), { recursive: true })
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const find = name => args[args.indexOf(name) + 1]
  const casesFile = args.includes('--cases') ? find('--cases') : undefined
  const outputFile = args.includes('--output') ? find('--output') : undefined
  if (!casesFile || !outputFile) {
    console.error('Usage: node scripts/phoenix-research-live.mjs --cases reports/research-quality/live-prompts.json --case mcp-live --output /path/research-run.json')
    process.exitCode = 2
  } else {
    try {
      const suite = JSON.parse(readFileSync(resolve(casesFile), 'utf8'))
      const result = await runLiveSuite(suite, {
        only: args.includes('--case') ? find('--case') : undefined,
        output: outputFile,
      })
      if (result.cases.some(row => row.exitCode !== 0 || row.timedOut)) process.exitCode = 1
    } catch (error) {
      console.error('Live research runner failed:', error instanceof Error ? error.message : String(error))
      process.exitCode = 2
    }
  }
}
