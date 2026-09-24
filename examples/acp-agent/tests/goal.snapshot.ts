import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionSnapshot,
  normalizeStdout,
  runScenario,
  type AgentUnderTest,
  type InputScript,
  type NormalizeContext,
} from '@phoenix-ai/dsh-acp-snapshot'
import { foldGoal } from '@phoenix-ai/dsh-goal'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { describe, expect, it } from 'vitest'

// This lifecycle proof has goal-specific timestamp normalization and semantic
// assertions, so it owns a separate snapshot root from the generic suite.
const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots/goal-round-driver')
const fixtureFile = join(scenarioDir, 'session.jsonl')
const overrideFile = join(scenarioDir, 'replay.override.json')
const stdoutExpected = join(scenarioDir, 'stdout.expected.jsonl')
const sessionExpected = join(scenarioDir, 'session.expected.jsonl')
const wrapupDir = join(dirname(fileURLToPath(import.meta.url)), 'goal-snapshots/goal-wrapup')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

const agent: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}

interface JsonObject {
  [key: string]: unknown
}

/** Parse non-empty records from one JSONL artifact. */
function parseJsonl(content: string): JsonObject[] {
  return content.split('\n').filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

/** Zero durable goal timestamps inside metadata records and rendered XML JSON. */
function normalizeGoalTimestamps(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/("(?:createdAt|updatedAt|clearedAt)":)\d+/g, '$10')
  }
  if (Array.isArray(value)) return value.map(normalizeGoalTimestamps)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      ['createdAt', 'updatedAt', 'clearedAt'].includes(key) && typeof item === 'number'
        ? 0
        : normalizeGoalTimestamps(item),
    ]))
  }
  return value
}

/** Normalize one persisted goal log after the shared snapshot scrubbers. */
function normalizeGoalLog(content: string, context: NormalizeContext): string {
  return normalizeGoalTimestamps(normalizeSessionSnapshot(content, context)) as string
}

describe('same-session goal snapshot through the ACP automation driver', () => {
  it('runs exact automatic rounds in the shipped application and persists cancellation', async () => {
    const input = JSON.parse(await readFile(join(scenarioDir, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent,
      mode: 'replay',
      fixtureFile,
      overrideFile,
      configPath: agent.configPath,
      env: {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })

    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(1)
    const log = result.sessionLogs[0]
    if (log === undefined) throw new Error('goal snapshot did not persist its session')
    const records = parseJsonl(log.content)
    const events = records.slice(1) as unknown as SessionEvent[]
    const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['create_goal', 'get_goal'])
    const rounds = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
      && event.data.source.round > 0
      ? [event.data.source.round]
      : [])
    expect(rounds).toEqual([1, 2])
    expect(foldGoal(events)).toMatchObject({
      goal: {
        objective: 'Finish the ACP goal-round-driver snapshot proof',
        phase: 'paused',
        revision: 2,
        maxGoalRounds: 2,
      },
      roundsStarted: 2,
    })

    const context: NormalizeContext = {
      sessionIds: [result.sessionId, log.id].filter((id): id is string => id !== undefined),
      cwd: result.cwd,
    }
    const stdout = normalizeStdout(result.rawStdout, context)
    const session = normalizeGoalLog(log.content, context)
    if (refreshing) {
      await Promise.all([
        writeFile(stdoutExpected, stdout),
        writeFile(sessionExpected, session),
      ])
    }
    expect(stdout).toBe(await readFile(stdoutExpected, 'utf8'))
    expect(session).toBe(await readFile(sessionExpected, 'utf8'))
  })

  it('persists a newly created goal before autonomous continuation', async () => {
    const input = JSON.parse(await readFile(join(wrapupDir, 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      agent,
      mode: 'replay',
      fixtureFile: join(wrapupDir, 'session.jsonl'),
      overrideFile: join(wrapupDir, 'replay.override.json'),
      configPath: agent.configPath,
      env: {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })

    expect(result.stderr).toBe('')
    expect(result.sessionLogs).toHaveLength(1)
    const log = result.sessionLogs[0]
    if (log === undefined) throw new Error('goal activation snapshot did not persist its session')
    const records = parseJsonl(log.content)
    const events = records.slice(1) as unknown as SessionEvent[]
    const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
    expect(calls).toEqual(['create_goal'])
    const folded = foldGoal(events)
    expect(folded).toMatchObject({
      goal: {
        objective: 'Finish the ACP goal wrap-up snapshot proof',
        phase: 'active',
        revision: 1,
      },
      roundsStarted: 0,
    })
    expect(events.some(event => event.type === 'goal/judge')).toBe(false)
    const closing = events.filter(event => event.type === 'assistant/message')
      .flatMap(event => event.data.message.content)
      .filter(block => block.type === 'text' && block.text.startsWith('GOAL WRAP-UP'))
    expect(closing).toHaveLength(0)

    const context: NormalizeContext = {
      sessionIds: [result.sessionId, log.id].filter((id): id is string => id !== undefined),
      cwd: result.cwd,
    }
    const stdout = normalizeStdout(result.rawStdout, context)
    const session = normalizeGoalLog(log.content, context)
    const wrapupStdoutExpected = join(wrapupDir, 'stdout.expected.jsonl')
    const wrapupSessionExpected = join(wrapupDir, 'session.expected.jsonl')
    if (refreshing) {
      await Promise.all([
        writeFile(wrapupStdoutExpected, stdout),
        writeFile(wrapupSessionExpected, session),
      ])
    }
    expect(stdout).toBe(await readFile(wrapupStdoutExpected, 'utf8'))
    const expectedSession = await readFile(wrapupSessionExpected, 'utf8')
    const continuationMarkers = [
      '\n{"type":"goal/strategy"',
      '\n{"type":"turn/start","data":{"turn":2}}',
    ]
    const stablePrefix = (value: string): string => {
      const offsets = continuationMarkers
        .map(marker => value.indexOf(marker))
        .filter(offset => offset >= 0)
      if (offsets.length === 0) return value
      return value.slice(0, Math.min(...offsets) + 1)
    }
    expect(stablePrefix(session)).toBe(stablePrefix(expectedSession))
  })
})
