/** `job` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'job'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'count.live.one': '{count} 个后台任务运行中',
  'count.live.other': '{count} 个后台任务运行中',
  'count.idle.one': '{count} 个后台任务',
  'count.idle.other': '{count} 个后台任务',
  'list.aria': '后台任务',
  'status.running': '运行中',
  'status.stopping': '正在停止',
  'status.completed': '已完成',
  'status.killed': '已取消',
  'status.failed': '已失败',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
  'duration.hours': '{hours}小时{minutes}分',
  'duration.title.live': '已运行 {duration}',
  'duration.title.done': '耗时 {duration}',
  'task.title': '任务',
  'task.count': '任务 {count}',
  'task.list.aria': 'Phoenix 持久任务',
  'task.empty': '暂无计划任务',
  'task.status.scheduled': '已计划',
  'task.status.running': '运行中',
  'task.status.completed': '已完成',
  'task.status.failed': '失败',
  'task.status.paused': '已暂停',
  'task.status.cancelled': '已取消',
  'task.recurrence.once': '一次',
  'task.recurrence.yearly': '每年',
  'task.recurrence.years': '每 {count} 年',
  'task.recurrence.days': '每 {count} 天',
  'task.recurrence.hours': '每 {count} 小时',
  'task.recurrence.minutes': '每 {count} 分钟',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<JobKey, string> = {
  'count.live.one': '{count} background job running',
  'count.live.other': '{count} background jobs running',
  'count.idle.one': '{count} background job',
  'count.idle.other': '{count} background jobs',
  'list.aria': 'Background jobs',
  'status.running': 'running',
  'status.stopping': 'stopping',
  'status.completed': 'completed',
  'status.killed': 'cancelled',
  'status.failed': 'failed',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'duration.title.live': 'Running for {duration}',
  'duration.title.done': 'Took {duration}',
  'task.title': 'Tasks',
  'task.count': 'Tasks {count}',
  'task.list.aria': 'Phoenix durable tasks',
  'task.empty': 'No scheduled tasks',
  'task.status.scheduled': 'scheduled',
  'task.status.running': 'running',
  'task.status.completed': 'completed',
  'task.status.failed': 'failed',
  'task.status.paused': 'paused',
  'task.status.cancelled': 'cancelled',
  'task.recurrence.once': 'once',
  'task.recurrence.yearly': 'yearly',
  'task.recurrence.years': 'every {count}y',
  'task.recurrence.days': 'every {count}d',
  'task.recurrence.hours': 'every {count}h',
  'task.recurrence.minutes': 'every {count}m',
}

/** Key domain of the `job` namespace (zh is the source of truth). */
export type JobKey = keyof typeof zh
