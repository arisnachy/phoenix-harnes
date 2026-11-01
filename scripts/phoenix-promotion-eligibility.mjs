#!/usr/bin/env node
/**
 * Fail-closed PHOENIX stable-release evidence gate.
 * The caller has already verified the exact SHA passed the main push guard.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Required pull-request workflows for the exact source PR head. */
export const REQUIRED_WORKFLOWS = Object.freeze([
  'CI', 'PHOENIX CI diagnostics', 'PHOENIX main guard',
  'PHOENIX Guardian Recovery Gate', 'Phoenix Windows Desktop',
  'E2E (real DeepSeek API)',
])
const NON_APPLICABLE_ON_PR = new Set(['PHOENIX Evolution Gate'])
const SHA = /^[a-f0-9]{40}$/

/**
 * Require one merged source PR, all applicable workflows green, and real E2E green.
 * @param {{targetSha:string,pulls:unknown[],workflowRuns:unknown[],deepseekJobs:unknown[]}} evidence - Exact GitHub evidence.
 * @returns {{prNumber:number,prHeadSha:string,checkedWorkflows:number}} Verified source.
 */
export function verifyPromotionEvidence({ targetSha, pulls, workflowRuns, deepseekJobs }) {
  if (!SHA.test(targetSha)) throw new Error('Invalid target SHA')
  if (!Array.isArray(pulls) || !Array.isArray(workflowRuns) || !Array.isArray(deepseekJobs)) {
    throw new Error('Missing source PR or workflow evidence')
  }
  const sources = pulls.filter(pr => pr && pr.merged_at && pr.merge_commit_sha === targetSha
    && pr.base?.ref === 'main' && Number.isSafeInteger(pr.number) && SHA.test(pr.head?.sha ?? ''))
  if (sources.length !== 1) throw new Error('Exact main commit must belong to one merged PR targeting main')
  const pr = sources[0], head = pr.head.sha
  const valid = workflowRuns.filter(run => run && run.head_sha === head && run.event === 'pull_request')
  if (!valid.length) throw new Error('No PR workflows found on exact source HEAD')
  const newest = new Map()
  for (const run of valid) {
    if (typeof run.name !== 'string' || !run.name) throw new Error('Workflow missing name')
    const current = newest.get(run.name)
    if (!current || Number(run.id) > Number(current.id)) newest.set(run.name, run)
  }
  for (const name of REQUIRED_WORKFLOWS) {
    if (!newest.has(name)) throw new Error('Required workflow missing at PR HEAD: ' + name)
  }
  for (const [name, run] of newest) {
    if (NON_APPLICABLE_ON_PR.has(name) && run.status === 'completed' && run.conclusion === 'skipped') continue
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      throw new Error('PR HEAD ' + head + ': ' + name + ' has ' + run.status + '/' + (run.conclusion ?? 'pending'))
    }
  }
  const real = deepseekJobs.filter(job => job && job.name === 'e2e')
  if (real.length !== 1 || real[0].status !== 'completed' || real[0].conclusion !== 'success') {
    throw new Error('Real DeepSeek API E2E must pass; configuration-only green or skipped is insufficient')
  }
  return { prNumber: pr.number, prHeadSha: head, checkedWorkflows: newest.size }
}

/**
 * GET one authenticated REST endpoint; network/permission errors fail closed.
 * @param {string} path - GitHub REST path.
 * @param {string} token - Workflow token.
 * @returns {Promise<unknown>} Parsed response.
 */
async function getGithub(path, token) {
  const response = await fetch('https://api.github.com/' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'PHOENIX-stable-exact-SHA-guard',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('GitHub API failed with HTTP ' + response.status)
  return await response.json()
}

/**
 * Exhaust paginated PR runs, so an incomplete response cannot be treated as green.
 * @param {string} repo - Repository owner/name.
 * @param {string} head - Exact source PR HEAD.
 * @param {string} token - Workflow token.
 * @returns {Promise<unknown[]>} Every matching run.
 */
async function allRuns(repo, head, token) {
  const runs = []
  for (let page = 1; page <= 10; page++) {
    const data = await getGithub('repos/' + repo + '/actions/runs?head_sha=' + head
      + '&event=pull_request&per_page=100&page=' + page, token)
    if (!Array.isArray(data.workflow_runs) || !Number.isSafeInteger(data.total_count)) {
      throw new Error('Invalid workflow-runs response')
    }
    runs.push(...data.workflow_runs)
    if (runs.length >= data.total_count) return runs
    if (data.workflow_runs.length === 0) throw new Error('Incomplete workflow pagination')
  }
  throw new Error('More than 1000 workflow runs; exhaustive evidence unavailable')
}

/**
 * Prove stable eligibility against live, exact-SHA GitHub evidence.
 * @param {string} targetSha - Current main SHA.
 * @param {string} repo - Repository owner/name.
 * @param {string} token - Workflow token.
 * @returns {Promise<object>} Verified PR reference.
 */
export async function verifyLivePromotion(targetSha, repo, token) {
  if (!SHA.test(targetSha) || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
    throw new Error('TARGET_SHA, GITHUB_REPOSITORY and GH_TOKEN are required')
  }
  const pulls = await getGithub('repos/' + repo + '/commits/' + targetSha + '/pulls?per_page=100', token)
  if (!Array.isArray(pulls) || pulls.length >= 100) throw new Error('Source PR listing missing or truncated')
  const sources = pulls.filter(pr => pr?.merged_at && pr.merge_commit_sha === targetSha && pr.base?.ref === 'main')
  if (sources.length !== 1 || !SHA.test(sources[0]?.head?.sha ?? '')) {
    throw new Error('Cannot prove exact main commit came from a single merged PR')
  }
  const runs = await allRuns(repo, sources[0].head.sha, token)
  const deepseek = runs.filter(run => run.name === 'E2E (real DeepSeek API)'
    && run.event === 'pull_request' && run.head_sha === sources[0].head.sha)
    .sort((a, b) => Number(b.id) - Number(a.id))[0]
  if (!deepseek || !Number.isSafeInteger(deepseek.id)) throw new Error('No real DeepSeek run on exact PR head')
  const jobs = await getGithub('repos/' + repo + '/actions/runs/' + deepseek.id + '/jobs?per_page=100', token)
  if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) || jobs.total_count > jobs.jobs.length) {
    throw new Error('DeepSeek job results missing or truncated')
  }
  return verifyPromotionEvidence({
    targetSha, pulls, workflowRuns: runs, deepseekJobs: jobs.jobs,
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await verifyLivePromotion(
      process.env.TARGET_SHA, process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN,
    )
    console.log('PHOENIX promotion proved by PR #' + result.prNumber
      + ' HEAD ' + result.prHeadSha + ', ' + result.checkedWorkflows + ' workflow outcomes')
  } catch (error) {
    console.error('PHOENIX stable promotion blocked:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
