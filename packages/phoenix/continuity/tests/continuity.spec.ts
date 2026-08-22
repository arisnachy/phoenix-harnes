import { describe, expect, it } from 'vitest'
import { recallMemories } from '../src/memory.ts'
import {
  createMissionRecord,
  failMissionTask,
  PhoenixMissionError,
  pivotMissionTask,
  readyMissionTasks,
  startMissionTask,
  succeedMissionTask,
} from '../src/mission.ts'
import type {
  PhoenixMemoryId,
  PhoenixMemoryRecord,
  PhoenixMissionId,
  PhoenixMissionTaskId,
} from '../src/types.ts'

const missionId = (value: string): PhoenixMissionId => value as PhoenixMissionId
const taskId = (value: string): PhoenixMissionTaskId => value as PhoenixMissionTaskId
const memoryId = (value: string): PhoenixMemoryId => value as PhoenixMemoryId

describe('PHOENIX Mission Graph', () => {
  it('rejects dependency cycles before a mission becomes durable', () => {
    expect(() => createMissionRecord(missionId('00000000-0000-4000-8000-000000000001'), {
      objective: 'cycle should fail',
      tasks: [
        { id: taskId('a'), objective: 'A', dependencies: [taskId('b')] },
        { id: taskId('b'), objective: 'B', dependencies: [taskId('a')] },
      ],
    }, 1, 10, 2)).toThrow(PhoenixMissionError)
  })

  it('unblocks dependents only after their dependencies succeed', () => {
    let mission = createMissionRecord(missionId('00000000-0000-4000-8000-000000000002'), {
      objective: 'ordered work',
      tasks: [
        { id: taskId('prepare'), objective: 'Prepare' },
        { id: taskId('ship'), objective: 'Ship', dependencies: [taskId('prepare')] },
      ],
    }, 10, 10, 2)

    expect(readyMissionTasks(mission).map(task => task.id)).toEqual([taskId('prepare')])
    mission = startMissionTask(mission, taskId('prepare'), 11)
    expect(() => startMissionTask(mission, taskId('ship'), 12)).toThrow(/not ready/)
    mission = succeedMissionTask(mission, taskId('prepare'), 'sha256:abc', 13)
    expect(readyMissionTasks(mission).map(task => task.id)).toEqual([taskId('ship')])
  })

  it('requires a pivot after the configured attempt ceiling and preserves failure history', () => {
    let mission = createMissionRecord(missionId('00000000-0000-4000-8000-000000000003'), {
      objective: 'never stop safely',
      tasks: [
        { id: taskId('route-a'), objective: 'Try route A', maxAttempts: 2 },
        { id: taskId('finish'), objective: 'Finish', dependencies: [taskId('route-a')] },
      ],
    }, 20, 10, 3)

    mission = startMissionTask(mission, taskId('route-a'), 21)
    mission = failMissionTask(mission, taskId('route-a'), 'first failure', 22)
    expect(mission.tasks[0]?.state).toBe('ready')
    mission = startMissionTask(mission, taskId('route-a'), 23)
    mission = failMissionTask(mission, taskId('route-a'), 'second failure', 24)
    expect(mission.tasks[0]?.state).toBe('pivot-required')

    mission = pivotMissionTask(mission, {
      taskId: taskId('route-a'),
      replacementId: taskId('route-b'),
      objective: 'Try route B',
    }, 25, 10, 3)

    const old = mission.tasks.find(task => task.id === taskId('route-a'))
    const replacement = mission.tasks.find(task => task.id === taskId('route-b'))
    const finish = mission.tasks.find(task => task.id === taskId('finish'))
    expect(old).toMatchObject({ state: 'blocked', replacedBy: taskId('route-b'), attempts: 2, lastError: 'second failure' })
    expect(replacement?.state).toBe('ready')
    expect(finish?.dependencies).toEqual([taskId('route-b')])
  })
})

describe('PHOENIX Memory Genome recall', () => {
  const memories: PhoenixMemoryRecord[] = [
    {
      id: memoryId('00000000-0000-4000-8000-000000000011'),
      topic: 'OrcaRouter free lane',
      content: 'Use the explicitly free model alias and never silently spend paid balance.',
      tags: ['router', 'free'],
      source: 'operator',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: memoryId('00000000-0000-4000-8000-000000000012'),
      topic: 'Mission continuity',
      content: 'Persist task state and pivot instead of abandoning the mission.',
      tags: ['mission', 'continuity'],
      source: 'mission',
      createdAt: 2,
      updatedAt: 2,
    },
  ]

  it('ranks topic/tag evidence deterministically without a model call', () => {
    const hits = recallMemories(memories, 'free router', 2)
    expect(hits.map(hit => hit.memory.id)).toEqual([memoryId('00000000-0000-4000-8000-000000000011')])
    expect(hits[0]?.score).toBeGreaterThan(0)
  })

  it('returns no guesses for a query with no indexed lexical evidence', () => {
    expect(recallMemories(memories, 'cardiology imaging', 5)).toEqual([])
  })
})
