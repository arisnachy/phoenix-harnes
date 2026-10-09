import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scoreResearchCase, scoreResearchRun } from './phoenix-research-benchmark.mjs'

const load = name => JSON.parse(readFileSync(new URL(`../reports/research-quality/${name}`, import.meta.url), 'utf8'))
const cases = load('cases.synthetic.json')
const good = load('fixtures/reference-run.synthetic.json')
const bad = load('fixtures/weak-run.synthetic.json')

test('three independently authored, evidence-backed synthetic runs pass at 100/100', () => {
  const report = scoreResearchRun(cases, good)
  assert.equal(report.score, 100)
  assert.equal(report.passed, true)
  assert.equal(report.results.length, 3)
  for (const result of report.results) {
    assert.equal(result.score, 100)
    assert.equal(result.facts.grounded, result.facts.required)
    assert.equal(result.failures.length, 0)
  }
})

test('unfounded and slow work cannot earn a passing mark', () => {
  const report = scoreResearchRun(cases, bad)
  assert.equal(report.passed, false)
  assert.ok(report.score < 50)
  assert.ok(report.results[0].failures.includes('material-unsupported-claim'))
  assert.equal(report.results[0].sources.fetched, 0)
})

test('a fabricated citation is flagged even with perfect copied prose', () => {
  const target = good.cases[0]
  const malicious = { ...target,
    answer: target.answer + ' [evidencia inventada](https://fake.example.org/report)',
  }
  const result = scoreResearchCase(cases.cases[0], malicious)
  assert.equal(result.passed, false)
  assert.ok(result.score <= 59)
  assert.ok(result.failures.includes('unverified-citation'))
})

test('the search result alone does not prove a source was read', () => {
  const target = good.cases[1]
  const fakeRetrieval = { ...target, observedWebFetchUrls: [] }
  const result = scoreResearchCase(cases.cases[1], fakeRetrieval)
  assert.equal(result.passed, false)
  assert.equal(result.facts.grounded, 0)
  assert.ok(result.failures.includes('required-claim-not-fully-grounded'))
})

test('source quote must exist in independently authored gold corpus', () => {
  const edited = { ...cases.cases[0], requiredFacts: [
    { aliases: ['404'], sourceUrl: 'https://primary.example.com/mcp/endpoint',
      evidenceQuote: 'fictitious invented service confirmation' },
  ] }
  assert.throws(() => scoreResearchCase(edited, good.cases[0]), /independent source quotation/)
})

test('results require real measured elapsed milliseconds and token usage', () => {
  const record = { ...good.cases[0], elapsedMs: undefined, promptTokens: undefined }
  const result = scoreResearchCase(cases.cases[0], record)
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes('missing-measured-runtime-or-tokens'))
})

test('a missing task fails instead of inflating the aggregate average', () => {
  assert.throws(() => scoreResearchRun(cases, { cases: good.cases.slice(1) }), /Missing research case/)
})

test('stale current-information source fails the freshness constraint', () => {
  const testCase = structuredClone(cases.cases[2])
  testCase.sources[0].publishedAt = '2023-01-01'
  const result = scoreResearchCase(testCase, good.cases[2])
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes('stale-research'))
})
