/** Durable task contracts shared by the proactivity engine and its tools. */

export type TaskState = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
export type TaskOrigin = 'user' | 'phoenix'
export type TaskVisibility = 'normal' | 'hidden_until_reveal' | 'internal'
export type CatchUpPolicy = 'latest' | 'all' | 'skip'
export type SenderIdentity = 'user' | 'phoenix' | 'auto'
export type TaskDelivery = 'chat' | 'email' | 'chat_and_email'

export type TaskSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; anchorAt: string; everySeconds: number }
  | { kind: 'annual'; month: number; day: number; hour: number; minute: number; timeZone: string }

export interface TaskRecord {
  id: string
  title: string
  prompt: string
  state: TaskState
  origin: TaskOrigin
  visibility: TaskVisibility
  revealAt?: string
  catchUp: CatchUpPolicy
  delivery: TaskDelivery
  senderIdentity: SenderIdentity
  emailTo?: string
  emailSubject?: string
  schedule: TaskSchedule
  nextRunAt: string
  createdAt: string
  updatedAt: string
  parentTaskId?: string
  tags?: string[]
  consecutiveFailures: number
}

export type TaskRunStatus = 'running' | 'completed' | 'failed' | 'skipped'

export interface TaskRunRecord {
  occurrenceId: string
  taskId: string
  dueAt: string
  status: TaskRunStatus
  startedAt: string
  finishedAt?: string
  retryAt?: string
  error?: string
}

export interface TaskStoreDocument {
  version: 1
  sequence: number
  tasks: TaskRecord[]
  runs: TaskRunRecord[]
}

export interface DueOccurrence {
  task: TaskRecord
  dueAt: string
  occurrenceId: string
}

export interface UserTaskView {
  id: string
  title: string
  state: TaskState
  origin: TaskOrigin
  nextRunAt: string
  schedule: TaskSchedule
  delivery: TaskDelivery
  hidden: boolean
  prompt?: string
  revealAt?: string
  senderIdentity?: SenderIdentity
  emailTo?: string
  tags?: string[]
}