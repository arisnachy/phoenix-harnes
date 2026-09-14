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
  'tasks.trigger': '任务',
  'tasks.panel.aria': 'Phoenix 任务中心',
  'tasks.title': 'Phoenix 任务',
  'tasks.subtitle': '持久计划、主动跟进和重复工作',
  'tasks.empty': '还没有可见的计划任务。你可以直接在聊天中让 Phoenix 创建一个。',
  'tasks.pause': '暂停',
  'tasks.resume': '恢复',
  'tasks.cancel': '取消',
  'tasks.privacy': '未公开的惊喜任务在揭晓前不会显示在这里。',
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
  'tasks.trigger': 'Tasks',
  'tasks.panel.aria': 'Phoenix Task Center',
  'tasks.title': 'Phoenix Tasks',
  'tasks.subtitle': 'Durable schedules, proactive follow-ups, and recurring work',
  'tasks.empty': 'No visible scheduled tasks yet. Ask Phoenix in chat to create one.',
  'tasks.pause': 'Pause',
  'tasks.resume': 'Resume',
  'tasks.cancel': 'Cancel',
  'tasks.privacy': 'Unrevealed surprise tasks stay hidden here until their reveal time.',
}

/** Key domain of the `job` namespace (zh is the source of truth). */
export type JobKey = keyof typeof zh
