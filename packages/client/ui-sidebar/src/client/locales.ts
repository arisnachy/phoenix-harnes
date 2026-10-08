/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'nav.home': '首页',
  'nav.discover': '探索',
  'nav.connectors': '连接器',
  'nav.team': '团队',
  'nav.library': '资料库',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'nav.home': 'Home',
  'nav.discover': 'Discover',
  'nav.connectors': 'Connectors',
  'nav.team': 'Team',
  'nav.library': 'Library',
} satisfies Record<SidebarKey, string>

/** Spanish dictionary. */
export const es = {
  'session.new': 'Nueva sesión',
  'session.new.label': 'Crear sesión',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Contraer barra lateral',
  'nav.home': 'Inicio',
  'nav.discover': 'Descubrir',
  'nav.connectors': 'Conectores',
  'nav.team': 'Equipo',
  'nav.library': 'Biblioteca',
} satisfies Record<SidebarKey, string>
