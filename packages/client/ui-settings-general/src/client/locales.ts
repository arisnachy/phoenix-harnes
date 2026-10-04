/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'diagnostics.title': '诊断',
  'diagnostics.description': '查看隐藏启动器和 Phoenix 运行时的最近错误。',
  'diagnostics.refresh': '刷新',
  'diagnostics.clean': '最近没有检测到错误。',
  'diagnostics.noLog': '从桌面快捷方式启动 Phoenix 后，诊断日志会显示在这里。',
  'diagnostics.loadError': '无法读取诊断状态。',
  'diagnostics.openError': '无法打开诊断位置。',
  'diagnostics.openLog': '打开完整日志',
  'diagnostics.openFolder': '打开日志文件夹',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'diagnostics.title': 'Diagnostics',
  'diagnostics.description': 'Recent errors from the hidden launcher and Phoenix runtime.',
  'diagnostics.refresh': 'Refresh',
  'diagnostics.clean': 'No recent errors detected.',
  'diagnostics.noLog': 'The diagnostic log will appear here after Phoenix is started from its desktop shortcut.',
  'diagnostics.loadError': 'Could not read diagnostic status.',
  'diagnostics.openError': 'Could not open the diagnostic location.',
  'diagnostics.openLog': 'Open full log',
  'diagnostics.openFolder': 'Open log folder',
} satisfies Record<SettingsKey, string>


/** Spanish dictionary. */
export const es = {
  'trigger': 'Configuración',
  'title': 'Configuración',
  'close': 'Cerrar',
  'openDocument': 'Abrir archivo de configuración',
  'openDocument.error': 'No se pudo abrir el archivo de configuración',
  'general.nav': 'General',
  'diagnostics.title': 'Diagnóstico',
  'diagnostics.description': 'Errores recientes del lanzador oculto y del runtime de Phoenix.',
  'diagnostics.refresh': 'Actualizar',
  'diagnostics.clean': 'No se detectaron errores recientes.',
  'diagnostics.noLog': 'El registro aparecerá aquí después de iniciar Phoenix desde el acceso directo.',
  'diagnostics.loadError': 'No se pudo leer el estado de diagnóstico.',
  'diagnostics.openError': 'No se pudo abrir la ubicación de diagnóstico.',
  'diagnostics.openLog': 'Abrir registro completo',
  'diagnostics.openFolder': 'Abrir carpeta del registro',
} satisfies Record<SettingsKey, string>
