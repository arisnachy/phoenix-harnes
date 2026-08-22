/**
 * Durable storage-domain declaration for PHOENIX Continuity.
 * @module @arisnachy/phoenix-continuity/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  PhoenixMemoryId,
  PhoenixMemoryRecord,
  PhoenixMissionId,
  PhoenixMissionRecord,
  PhoenixMissionTaskId,
  PhoenixMissionTaskRecord,
  PhoenixMissionTaskState,
} from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const nonBlank = z.string().refine(value => value.trim().length > 0, { message: 'value must not be blank' })

/** Runtime schema for a Memory Genome id. */
export const phoenixMemoryIdSchema = z.uuid().transform(value => value as PhoenixMemoryId)
/** Runtime schema for a Mission Graph id. */
export const phoenixMissionIdSchema = z.uuid().transform(value => value as PhoenixMissionId)
/** Runtime schema for a Mission Graph task id. */
export const phoenixMissionTaskIdSchema = z.string().min(1).transform(value => value as PhoenixMissionTaskId)

/** Runtime schema for the closed task-state vocabulary. */
export const phoenixMissionTaskStateSchema = z.union([
  z.literal('pending'),
  z.literal('ready'),
  z.literal('running'),
  z.literal('succeeded'),
  z.literal('pivot-required'),
  z.literal('blocked'),
]) satisfies z.ZodType<PhoenixMissionTaskState>

/** Runtime schema for one durable Memory Genome record. */
export const phoenixMemoryRecordSchema = z.object({
  id: phoenixMemoryIdSchema,
  topic: nonBlank,
  content: nonBlank,
  tags: z.array(nonBlank),
  source: z.union([
    z.literal('operator'),
    z.literal('mission'),
    z.literal('tool'),
    z.literal('benchmark'),
  ]),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(value => value.updatedAt >= value.createdAt, {
  path: ['updatedAt'],
  message: 'updatedAt must not precede createdAt',
}) as unknown as z.ZodType<PhoenixMemoryRecord>

/** Runtime schema for one durable Mission Graph task. */
export const phoenixMissionTaskRecordSchema = z.object({
  id: phoenixMissionTaskIdSchema,
  objective: nonBlank,
  dependencies: z.array(phoenixMissionTaskIdSchema),
  state: phoenixMissionTaskStateSchema,
  attempts: nonNegativeSafeInteger,
  maxAttempts: positiveSafeInteger,
  lastError: nonBlank.optional(),
  outputFingerprint: nonBlank.optional(),
  replacedBy: phoenixMissionTaskIdSchema.optional(),
}) as unknown as z.ZodType<PhoenixMissionTaskRecord>

/** Runtime schema for one durable Mission Graph. */
export const phoenixMissionRecordSchema = z.object({
  id: phoenixMissionIdSchema,
  objective: nonBlank,
  tasks: z.array(phoenixMissionTaskRecordSchema),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).superRefine((mission, ctx) => {
  if (mission.updatedAt < mission.createdAt) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt must not precede createdAt' })
  }
  const ids = new Set<string>()
  mission.tasks.forEach((task, index) => {
    if (ids.has(task.id)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: `duplicate task id '${task.id}'` })
    }
    ids.add(task.id)
  })
  mission.tasks.forEach((task, index) => {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        ctx.addIssue({ code: 'custom', path: ['tasks', index, 'dependencies'], message: `unknown dependency '${dependency}'` })
      }
    }
  })
}) as unknown as z.ZodType<PhoenixMissionRecord>

/** Durable PHOENIX Continuity domain. */
export const phoenixContinuityDomainSpec = defineDomain({
  name: 'phoenix_continuity',
  version: 0,
  tables: {
    memories: domainTable<PhoenixMemoryId, PhoenixMemoryRecord>(phoenixMemoryRecordSchema),
    missions: domainTable<PhoenixMissionId, PhoenixMissionRecord>(phoenixMissionRecordSchema),
  },
})
