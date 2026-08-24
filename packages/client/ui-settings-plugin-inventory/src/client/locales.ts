/** Copy dictionaries for PHOENIX System & Plugins settings. */

export const zh = {
  tab: '系统与插件', loading: '正在读取 PHOENIX 系统状态…', error: '暂时无法读取系统状态。', retry: '重试', search: '搜索插件',
  system: 'PHOENIX HARDNESS', version: '版本', build: '构建', channel: '更新通道', upToDate: '已是最新版本', updateAvailable: '发现新版本', downloading: '正在下载更新…', preparing: '正在验证更新…', readyRestart: '更新已就绪。PHOENIX 将自动重启。', installing: '正在安装更新…', restarting: '正在重启 PHOENIX…', rolledBack: '更新失败，已恢复到上一可用版本。', updateError: '更新失败；当前版本保持不变。',
  codex: 'Codex 插件', codexEmpty: '尚未同步 Codex 插件。', sourceCommit: '上游版本', syncedAt: '同步时间', skills: 'Skills', mcp: 'MCP', credentials: '所需凭据名称', mcpOn: 'MCP 已启用', mcpOff: 'MCP 未启用', surfaces: '能力面',
  catalog: 'PHOENIX 插件', empty: '暂无插件。', emptySearch: '没有匹配的插件。', enabledTag: '已启用', disabledTag: '已停用', configuration: '配置状态', cordis: 'Cordis 状态', unobserved: '未挂载', pending: '等待依赖', loadingPhase: '加载中', active: '已挂载', failed: '挂载失败', unloading: '卸载中',
} satisfies Record<string, string>

export type PluginInventoryLocaleKey = keyof typeof zh

export const en = {
  tab: 'System & plugins', loading: 'Reading PHOENIX system state…', error: 'System state is temporarily unavailable.', retry: 'Retry', search: 'Search plugins',
  system: 'PHOENIX HARDNESS', version: 'Version', build: 'Build', channel: 'Update channel', upToDate: 'Up to date', updateAvailable: 'New version available', downloading: 'Downloading update…', preparing: 'Validating update…', readyRestart: 'Update ready. PHOENIX will restart automatically.', installing: 'Installing update…', restarting: 'Restarting PHOENIX…', rolledBack: 'Update failed and PHOENIX restored the last working version.', updateError: 'Update failed; the current version was preserved.',
  codex: 'Codex plugins', codexEmpty: 'Codex plugins have not been synchronized yet.', sourceCommit: 'Upstream build', syncedAt: 'Last sync', skills: 'Skills', mcp: 'MCP', credentials: 'Credential names required', mcpOn: 'MCP enabled', mcpOff: 'MCP disabled', surfaces: 'Surfaces',
  catalog: 'PHOENIX plugins', empty: 'No plugins are available.', emptySearch: 'No matching plugins.', enabledTag: 'Enabled', disabledTag: 'Disabled', configuration: 'Configuration', cordis: 'Cordis status', unobserved: 'Not mounted', pending: 'Waiting for dependencies', loadingPhase: 'Loading', active: 'Mounted', failed: 'Mount failed', unloading: 'Unloading',
} satisfies Record<PluginInventoryLocaleKey, string>

export const es = {
  tab: 'Sistema y plugins', loading: 'Leyendo el estado de PHOENIX…', error: 'El estado del sistema no está disponible temporalmente.', retry: 'Reintentar', search: 'Buscar plugins',
  system: 'PHOENIX HARDNESS', version: 'Versión', build: 'Build', channel: 'Canal de actualización', upToDate: 'PHOENIX está actualizado', updateAvailable: 'Hay una nueva versión disponible', downloading: 'Descargando actualización…', preparing: 'Validando la actualización…', readyRestart: 'Actualización lista. PHOENIX se reiniciará automáticamente.', installing: 'Instalando actualización…', restarting: 'Reiniciando PHOENIX…', rolledBack: 'La actualización falló y PHOENIX restauró la última versión funcional.', updateError: 'La actualización falló; se conservó la versión actual.',
  codex: 'Plugins de Codex', codexEmpty: 'Todavía no se han sincronizado los plugins de Codex.', sourceCommit: 'Build upstream', syncedAt: 'Última sincronización', skills: 'Skills', mcp: 'MCP', credentials: 'Nombres de credenciales requeridas', mcpOn: 'MCP activado', mcpOff: 'MCP desactivado', surfaces: 'Superficies',
  catalog: 'Plugins de PHOENIX', empty: 'No hay plugins disponibles.', emptySearch: 'No hay plugins que coincidan.', enabledTag: 'Activado', disabledTag: 'Desactivado', configuration: 'Configuración', cordis: 'Estado Cordis', unobserved: 'Sin montar', pending: 'Esperando dependencias', loadingPhase: 'Cargando', active: 'Montado', failed: 'Falló el montaje', unloading: 'Desmontando',
} satisfies Record<PluginInventoryLocaleKey, string>
