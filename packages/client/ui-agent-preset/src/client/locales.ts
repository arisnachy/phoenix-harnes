/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetKiraMaxName' | 'presetKiraMaxDescription'
  | 'viewerOverview' | 'viewerSource' | 'viewerIntro' | 'viewerSourceIntro' | 'viewerComponents'
  | 'viewerIdentity' | 'viewerShell' | 'viewerFilesystem' | 'viewerJobs' | 'viewerSkills'
  | 'viewerGoals' | 'viewerPlanning' | 'viewerCompaction' | 'viewerTeam'
  | 'viewerImages' | 'viewerTools' | 'viewerPresentation' | 'viewerAuthoring' | 'viewerOther'
  | 'viewerIdentityDetail' | 'viewerShellDetail' | 'viewerFilesystemDetail' | 'viewerJobsDetail' | 'viewerSkillsDetail' | 'viewerGoalsDetail' | 'viewerPlanningDetail' | 'viewerCompactionDetail' | 'viewerTeamDetail' | 'viewerImagesDetail' | 'viewerToolsDetail' | 'viewerPresentationDetail' | 'viewerAuthoringDetail' | 'viewerOtherDetail'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Lean coding agent with persistent shell and str_replace_editor; Phoenix Living connector tools remain available so created artifacts stay connected.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  presetKiraMaxName: 'Kira Max',
  presetKiraMaxDescription: 'Complete Phoenix agent with research, coding, team orchestration, visual creation, game development, automation, runtime inspection and preset authoring; permissions and verification stay in force.',
  viewerOverview: 'In your language',
  viewerSource: 'Original YAML',
  viewerIntro: 'Explanation of the installed components. Technical identifiers remain unchanged to keep the configuration accurate.',
  viewerSourceIntro: 'Original executable composition (read only). Comments and code retain their source language; changing identifiers or expressions would break the preset.',
  viewerComponents: 'Components',
  viewerIdentity: 'Identity and instructions',
  viewerShell: 'Shell and computer',
  viewerFilesystem: 'Files and search',
  viewerJobs: 'Background jobs',
  viewerSkills: 'Skills and learning',
  viewerGoals: 'Objectives',
  viewerPlanning: 'Planning',
  viewerCompaction: 'Context and memory optimization',
  viewerTeam: 'Teams and workflows',
  viewerImages: 'Image generation',
  viewerTools: 'Assistant tools',
  viewerPresentation: 'Code Mode',
  viewerAuthoring: 'Runtime inspection and authoring',
  viewerOther: 'Other components',
  viewerIdentityDetail: 'Identity, mission rules, selected model, working directory and assistant instructions.',
  viewerShellDetail: 'Shell tools to run allowed operating-system commands and interact with the desktop.',
  viewerFilesystemDetail: 'Read, write, edit and search files in the authorized workspace.',
  viewerJobsDetail: 'Track and control tasks that continue while other work proceeds.',
  viewerSkillsDetail: 'Load specialized capabilities such as game development, research and local learning.',
  viewerGoalsDetail: 'Maintain goals and completion criteria across multi-step tasks.',
  viewerPlanningDetail: 'Prepare and review plans without premature edits.',
  viewerCompactionDetail: 'Keep long conversations usable through context management.',
  viewerTeamDetail: 'Coordinate specialists, delegated tasks and reusable workflows.',
  viewerImagesDetail: 'Create image assets through configured, authorized generation backends.',
  viewerToolsDetail: 'Ask questions, track work, search the web and use other available tools.',
  viewerPresentationDetail: 'Expose tools to the model through the Code Mode presentation layer.',
  viewerAuthoringDetail: 'Inspect runtime state and author presets/plugins under the existing approval policy.',
  viewerOtherDetail: 'Additional registered components of this composition.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的 Agent 预设',
  headerHint: '本会话运行的 Agent 预设，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: '标准模式',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  presetCodeName: 'PTC 模式',
  presetCodeDescription: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: '精简编码 Agent，核心提供持久 shell 与 str_replace_editor；Phoenix Living 连接工具仍保持可用，以便创建的产物持续连接。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  presetKiraMaxName: 'Kira 最强模式',
  presetKiraMaxDescription: '完整的 Phoenix 助手：研究、编程、团队协作、视觉创作、游戏开发、自动化、运行时检查及预设创作；保留权限控制和验证流程。',
  viewerOverview: '当前语言说明',
  viewerSource: '原始 YAML',
  viewerIntro: '已安装组件的说明。技术标识符保持原样，以确保配置准确。',
  viewerSourceIntro: '原始可执行配置（只读）。注释和代码保留源语言，修改标识符或表达式可能损坏预设。',
  viewerComponents: '组件',
  viewerIdentity: '身份和指令',
  viewerShell: '终端和计算机',
  viewerFilesystem: '文件与搜索',
  viewerJobs: '后台任务',
  viewerSkills: '技能和学习',
  viewerGoals: '目标',
  viewerPlanning: '规划',
  viewerCompaction: '上下文和记忆优化',
  viewerTeam: '团队和工作流',
  viewerImages: '图像生成',
  viewerTools: '助手工具',
  viewerPresentation: '代码模式',
  viewerAuthoring: '运行时检查与预设创作',
  viewerOther: '其他组件',
  viewerIdentityDetail: '身份、任务规则、所选模型、工作目录及助手指令。',
  viewerShellDetail: '运行获授权的系统命令并与桌面交互。',
  viewerFilesystemDetail: '在授权工作区中读取、写入、编辑和搜索文件。',
  viewerJobsDetail: '管理和监控后台执行的任务。',
  viewerSkillsDetail: '加载游戏开发、研究与本地学习等专业技能。',
  viewerGoalsDetail: '跨步骤维护目标与完成标准。',
  viewerPlanningDetail: '在修改前拟定并审查计划。',
  viewerCompactionDetail: '管理上下文，使长对话保持有效。',
  viewerTeamDetail: '协调专家、委派任务与可复用的工作流。',
  viewerImagesDetail: '通过已配置且获授权的后端生成图像资源。',
  viewerToolsDetail: '提问、追踪进度、搜索网页并使用其他可用工具。',
  viewerPresentationDetail: '通过代码模式向模型提供工具。',
  viewerAuthoringDetail: '在现有审批策略下检查运行时并创建预设/插件。',
  viewerOtherDetail: '此组合注册的其他组件。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  copyOf: '复制自',
  composition: '组装（agent.cordis.yml）',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '用「创造模式」创作自定义预设',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}


/** Spanish copy. */
export const es: Record<AgentPresetSettingsKey, string> = {
  title: 'Preajuste de agente',
  description: 'Se aplica a las sesiones que inicies a partir de ahora. Las sesiones en curso conservan el preajuste con el que comenzaron.',
  loading: 'Cargando preajustes…',
  error: 'No se pudieron cargar los preajustes de agente.',
  userTrust: 'Personalizado',
  seatHint: 'Preajuste de agente para la sesión que estás a punto de iniciar',
  headerHint: 'Preajuste de agente que usa esta sesión, fijado al iniciarse',
  nav: 'Preajustes de agente',
  sectionIntro:
    'Un preajuste define la composición de plugins que ejecuta el agente en una sesión: sus herramientas, instrucciones y capacidades. '
    + 'Duplica uno existente y adáptalo, o deja que el agente cree uno para ti en el modo Creador.',
  builtIn: 'Integrado',
  setDefault: 'Establecer como predeterminado',
  view: 'Ver',
  presetStandardName: 'Modo estándar',
  presetStandardDescription:
    'Agente de programación completo con edición de archivos, shell, búsqueda en archivos y web, skills, planificación, objetivos, subagentes y flujos de trabajo.',
  presetCodeName: 'Modo PTC',
  presetCodeDescription:
    'Incluye todas las capacidades del modo estándar y expone las herramientas mediante Code Mode SDK para que el modelo combine operaciones de varios pasos en un programa TypeScript.',
  presetMinimalName: 'Modo mínimo',
  presetMinimalDescription:
    'Agente de programación ligero con shell persistente y str_replace_editor; las herramientas Living de Phoenix siguen disponibles para mantener conectados los artefactos creados.',
  presetCordisName: 'Modo Creador',
  presetCordisDescription:
    'Diseñado para crear preajustes de agente personalizados, con todas las capacidades del modo estándar más inspección en tiempo de ejecución, experimentos con plugins y guía para crear preajustes.',
  presetKiraMaxName: 'Kira Máximo',
  presetKiraMaxDescription: 'Agente integral de Phoenix para investigar, programar, coordinar equipos, crear recursos visuales y juegos, automatizar, inspeccionar el sistema y crear preajustes; conserva permisos y verificación.',
  viewerOverview: 'En tu idioma',
  viewerSource: 'YAML original',
  viewerIntro: 'Explicación de los componentes instalados. Los identificadores técnicos permanecen intactos para garantizar la exactitud de la configuración.',
  viewerSourceIntro: 'Composición ejecutable original (solo lectura). Los comentarios y el código conservan su idioma de origen; cambiar identificadores o expresiones rompería el preajuste.',
  viewerComponents: 'Componentes',
  viewerIdentity: 'Identidad e instrucciones',
  viewerShell: 'Consola y computadora',
  viewerFilesystem: 'Archivos y búsqueda',
  viewerJobs: 'Trabajos en segundo plano',
  viewerSkills: 'Habilidades y aprendizaje',
  viewerGoals: 'Objetivos',
  viewerPlanning: 'Planificación',
  viewerCompaction: 'Optimización de contexto y memoria',
  viewerTeam: 'Equipos y flujos de trabajo',
  viewerImages: 'Generación de imágenes',
  viewerTools: 'Herramientas del asistente',
  viewerPresentation: 'Modo de código',
  viewerAuthoring: 'Inspección y creación de preajustes',
  viewerOther: 'Otros componentes',
  viewerIdentityDetail: 'Identidad, reglas de trabajo, modelo seleccionado, directorio e instrucciones del asistente.',
  viewerShellDetail: 'Ejecuta comandos autorizados del sistema y permite interactuar con el escritorio.',
  viewerFilesystemDetail: 'Lee, modifica y busca archivos dentro del espacio de trabajo autorizado.',
  viewerJobsDetail: 'Administra y supervisa tareas que continúan en segundo plano.',
  viewerSkillsDetail: 'Carga habilidades especializadas como desarrollo de juegos, investigación y aprendizaje local.',
  viewerGoalsDetail: 'Mantiene objetivos y criterios de finalización a lo largo del trabajo.',
  viewerPlanningDetail: 'Permite preparar y revisar planes antes de modificar recursos.',
  viewerCompactionDetail: 'Optimiza el contexto para mantener útiles las conversaciones extensas.',
  viewerTeamDetail: 'Coordina especialistas, delegaciones y flujos de trabajo reutilizables.',
  viewerImagesDetail: 'Genera recursos gráficos mediante proveedores configurados y autorizados.',
  viewerToolsDetail: 'Permite consultar, registrar tareas, buscar en la web y utilizar otras herramientas.',
  viewerPresentationDetail: 'Presenta las herramientas al modelo mediante la capa Code Mode.',
  viewerAuthoringDetail: 'Inspecciona el sistema y permite crear preajustes o plugins según las aprobaciones existentes.',
  viewerOtherDetail: 'Otros componentes declarados en esta composición.',
  duplicate: 'Duplicar',
  duplicateUnavailable: 'Este despliegue no tiene un directorio de preajustes con permisos de escritura',
  delete: 'Eliminar',
  presetId: 'Identificador',
  presetIdPlaceholder: 'mi-agente',
  displayName: 'Nombre',
  displayNamePlaceholder: 'Se muestra en el selector; por defecto usa el identificador',
  inUse: 'En uso',
  builtInGroup: 'Integrados',
  customGroup: 'Personalizados',
  noDescription: 'Sin descripción.',
  brokenBadge: 'Error al cargar',
  brokenNoCopy: 'No se puede duplicar un preajuste que no pudo cargarse',
  copyOf: 'Copiado de',
  composition: 'Composición (agent.cordis.yml)',
  cancel: 'Cancelar',
  close: 'Cerrar',
  retry: 'Reintentar',
  copyTitle: 'Duplicar preajuste',
  copyIntro:
    'El preajuste completo se copia en este equipo. El identificador se convierte en el nombre de su directorio y no podrá cambiarse después; el resto se edita en los propios archivos del preajuste.',
  create: 'Crear',
  creating: 'Creando…',
  creatorDraft: 'Crear un preajuste personalizado con el modo Creador',
  openLocation: 'Abrir carpeta',
  showLocation: 'Mostrar ubicación',
  revealedPathLabel: 'Archivos del preajuste:',
  idRequired: 'Escribe un identificador para el preajuste.',
  idInvalid: 'Usa letras minúsculas, números y guiones; debe comenzar con una letra o un número.',
  idTaken: 'Ya existe un preajuste con este identificador.',
  deleteTitle: '¿Eliminar este preajuste?',
  deleteDescription:
    'Se eliminará el directorio del preajuste. Las sesiones que ya lo están usando seguirán funcionando; las nuevas sesiones no podrán seleccionarlo.',
  deleteConfirm: 'Eliminar',
  deleting: 'Eliminando…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  'kira-max': { name: 'presetKiraMaxName', description: 'presetKiraMaxDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
