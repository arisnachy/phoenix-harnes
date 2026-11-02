/**
 * Deterministic evidence audit for Phoenix research runs. No network calls,
 * no model-as-judge self-grading, and no model credentials.
 *
 * Trusted cases are authored/verified independently of a model's reply;
 * observedWebFetchUrls must be derived from the persisted tool trace.
 * This is an operational regression gate, NOT a live model benchmark.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function normalized(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
}
function urlKey(value) {
  try {
    const uri = new URL(value)
    if (!['https:', 'http:'].includes(uri.protocol) || uri.username || uri.password) return undefined
    uri.hash = ''
    return uri.href
  } catch { return undefined }
}
function citedUrls(answer) {
  return [...answer.matchAll(/https?:\/\/[^\s<>\])}]+/gu)]
    .map(([url]) => urlKey(url.replace(/[.,;!?]+$/u, '')))
    .filter(Boolean)
}
function weighted(points, fraction) {
  return Math.round(points * Math.max(0, Math.min(1, fraction)))
}
/**
 * Score one completed model run against a separately authored, immutable
 * evidence case. The content returned by research tools MUST be stored by
 * an external runner; this script cannot authenticate it from JSON alone.
 */
export function scoreResearchCase(testCase, run) {
  if (testCase?.id !== run?.id || typeof run.answer !== 'string') {
    throw new Error('Case/result ID mismatch or absent answer')
  }
  const sourceRows = Array.isArray(testCase.sources) ? testCase.sources : []
  const gold = new Map(sourceRows.map(source => [urlKey(source.url), source]))
  if (gold.has(undefined) || sourceRows.length === 0) throw new Error('Benchmark requires trustworthy source URLs')
  const required = testCase.requiredFacts
  if (!Array.isArray(required) || required.length === 0) throw new Error('Benchmark requires independent ground-truth facts')
  const refs = new Set(citedUrls(run.answer))
  const fetched = new Set((run.observedWebFetchUrls ?? []).map(urlKey).filter(Boolean))
  const answer = normalized(run.answer)
  const facts = required.map(fact => {
    const sourceUrl = urlKey(fact.sourceUrl)
    const document = gold.get(sourceUrl)
    if (!document || !document.text || !document.text.includes(fact.evidenceQuote)) {
      throw new Error(`Reference fact ${JSON.stringify(fact.aliases)} lacks an independent source quotation`)
    }
    const covered = fact.aliases.some(alias => answer.includes(normalized(alias)))
    return {
      covered,
      cited: covered && refs.has(sourceUrl),
      fetched: fetched.has(sourceUrl),
      grounded: covered && refs.has(sourceUrl) && fetched.has(sourceUrl),
    }
  })
  const factCount = required.length
  const coverage = facts.filter(f => f.covered).length
  const grounded = facts.filter(f => f.grounded).length
  const citations = facts.filter(f => f.cited).length
  const relevantFetched = [...fetched].filter(url => gold.has(url))
  const domains = new Set(relevantFetched.map(url => new URL(url).hostname))
  const unknownCitations = [...refs].filter(url => !gold.has(url))
  const banned = (testCase.bannedClaims ?? []).filter(text => answer.includes(normalized(text)))
  const asOf = testCase.asOf ? Date.parse(testCase.asOf + 'T00:00:00Z') : undefined
  const freshnessDays = testCase.maxAgeDays
  const fresh = asOf === undefined || freshnessDays === undefined
    ? true
    : relevantFetched.some(url => {
      const date = Date.parse(gold.get(url).publishedAt ?? '')
      return Number.isFinite(date) && date <= asOf && asOf - date <= freshnessDays * 86_400_000
    })
  const latencyMs = run.elapsedMs
  const tokens = run.promptTokens + run.completionTokens
  const withinTime = typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
  const withinTokens = typeof run.promptTokens === 'number' && Number.isFinite(run.promptTokens)
    && run.promptTokens >= 0 && typeof run.completionTokens === 'number'
    && Number.isFinite(run.completionTokens) && run.completionTokens >= 0
  const points = {
    completeness: weighted(25, coverage / factCount),
    sourcedClaims: weighted(25, grounded / factCount),
    verifiedAccess: weighted(15, facts.filter(f => f.fetched).length / factCount),
    independentSources: weighted(10, domains.size / Math.max(1, testCase.minIndependentSources ?? 1)),
    freshness: fresh ? 10 : 0,
    speed: withinTime ? weighted(10, (testCase.timeBudgetMs ?? 60_000) / Math.max(1, latencyMs)) : 0,
    tokenEfficiency: withinTokens ? weighted(5, (testCase.tokenBudget ?? 10_000) / Math.max(1, tokens)) : 0,
  }
  const failures = []
  if (banned.length > 0) failures.push('material-unsupported-claim')
  if (unknownCitations.length > 0) failures.push('unverified-citation')
  if (grounded < factCount) failures.push('required-claim-not-fully-grounded')
  if (!withinTime || !withinTokens) failures.push('missing-measured-runtime-or-tokens')
  if (fresh === false) failures.push('stale-research')
  if (run.exitCode !== undefined && run.exitCode !== 0) failures.push('failed-live-execution')
  if (run.timedOut === true) failures.push('live-execution-timeout')
  const rawScore = Object.values(points).reduce((sum, value) => sum + value, 0)
  const incomplete = run.timedOut === true || (run.exitCode !== undefined && run.exitCode !== 0)
  const score = banned.length > 0 || incomplete ? Math.min(rawScore, 49)
    : unknownCitations.length > 0 ? Math.min(rawScore, 59) : rawScore
  return {
    id: run.id,
    score,
    passed: score >= 90 && failures.length === 0,
    points,
    facts: { required: factCount, covered: coverage, cited: citations, grounded },
    sources: { cited: refs.size, fetched: relevantFetched.length, independentDomains: domains.size },
    metrics: { elapsedMs: run.elapsedMs, promptTokens: run.promptTokens, completionTokens: run.completionTokens },
    failures,
  }
}

/** Evaluate one complete, independently grounded multi-case run. */
export function scoreResearchRun(cases, run) {
  const byId = new Map(run.cases.map(row => [row.id, row]))
  const results = cases.cases.map(testCase => {
    const record = byId.get(testCase.id)
    if (!record) throw new Error(`Missing research case ${testCase.id}`)
    return scoreResearchCase(testCase, record)
  })
  const score = Math.round(results.reduce((total, row) => total + row.score, 0) / results.length)
  return { version: 1, score, passed: results.every(row => row.passed), results }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const arg = name => {
    const at = args.indexOf(name)
    return at < 0 ? undefined : args[at + 1]
  }
  const casesFile = arg('--cases')
  const runFile = arg('--run')
  if (!casesFile || !runFile) {
    console.error('Usage: node scripts/phoenix-research-benchmark.mjs --cases <audited-cases.json> --run <run.json> [--output report.json]')
    process.exitCode = 2
  } else {
    try {
      const cases = JSON.parse(readFileSync(resolve(casesFile), 'utf8'))
      const run = JSON.parse(readFileSync(resolve(runFile), 'utf8'))
      const report = scoreResearchRun(cases, run)
      for (const result of report.results) {
        console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}: ${result.score}/100 | ${result.facts.grounded}/${result.facts.required} sourced claims | ${result.metrics.elapsedMs} ms | ${Number(result.metrics.promptTokens) + Number(result.metrics.completionTokens)} tokens`)
        for (const failure of result.failures) console.log(`  - ${failure}`)
      }
      console.log(`Phoenix research audit: ${report.score}/100; ${report.passed ? 'PASS' : 'FAIL'}`)
      const output = arg('--output')
      if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'w' })
      if (!report.passed) process.exitCode = 1
    } catch (error) {
      console.error('Research audit could not run:', error instanceof Error ? error.message : String(error))
      process.exitCode = 2
    }
  }
}
