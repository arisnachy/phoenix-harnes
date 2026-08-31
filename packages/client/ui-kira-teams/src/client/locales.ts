/** `kira-teams` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'kira-teams'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'dock.title': 'KIRA · 团队',
  'dock.expand': '展开团队面板',
  'dock.collapse': '收起团队面板',
  'dock.refresh': '刷新子代理列表',
  'count.members.one': '{count} 个成员',
  'count.members.other': '{count} 个成员',
  'count.running.one': '{count} 个运行中',
  'count.running.other': '{count} 个运行中',
  'status.running': '运行中',
  'status.idle': '已结束',
  'empty.label': '当前会话没有运行中的子代理',
  'team.aria': '当前会话的 KIRA 团队',
} as const

/** Keys shared by every KIRA teams locale dictionary. */
export type KiraTeamsKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<KiraTeamsKey, string> = {
  'dock.title': 'KIRA · Teams',
  'dock.expand': 'Expand the teams dock',
  'dock.collapse': 'Collapse the teams dock',
  'dock.refresh': 'Refresh subagent list',
  'count.members.one': '{count} member',
  'count.members.other': '{count} members',
  'count.running.one': '{count} running',
  'count.running.other': '{count} running',
  'status.running': 'running',
  'status.idle': 'done',
  'empty.label': 'No active subagents for this session',
  'team.aria': 'KIRA team for the current session',
}

/** Spanish dictionary, key-identical to the Chinese source of truth. */
export const es: Record<KiraTeamsKey, string> = {
  'dock.title': 'KIRA · Equipos',
  'dock.expand': 'Desplegar el panel de equipos',
  'dock.collapse': 'Plegar el panel de equipos',
  'dock.refresh': 'Actualizar lista de subagentes',
  'count.members.one': '{count} miembro',
  'count.members.other': '{count} miembros',
  'count.running.one': '{count} en marcha',
  'count.running.other': '{count} en marcha',
  'status.running': 'en marcha',
  'status.idle': 'terminó',
  'empty.label': 'Sin subagentes activos en esta sesión',
  'team.aria': 'Equipo KIRA de la sesión actual',
}
