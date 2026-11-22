/**
 * Shared, declarative navigation icon registry for Healthia and Kira-created apps.
 * Only validated, bundled PHOENIX/Lucide icon identifiers are accepted.
 * Preferences contain menu metadata only; never clinical or chat contents.
 */
import { choosePhoenixUiIcon, isPhoenixUiIconName, type PhoenixUiIconName } from './SmartUi.tsx'

type Role = 'doctor' | 'patient'
type IconStore = Pick<Storage, 'getItem' | 'setItem'>
export type PhoenixNavigationIconOverrides = Readonly<Record<string, PhoenixUiIconName>>

const STORAGE_KEY = 'phoenix.navigation-icons.v1'
const SCOPE = /^[a-z][a-z0-9-]{0,47}\.(?:doctor|patient)\.[a-z][a-z0-9-]{0,47}$/u
const ID = /^[a-z][a-z0-9-]{0,47}$/u
const MAX_ENTRIES = 96
const MAX_BYTES = 12000

/** Stable IDs take precedence over translated labels and AI-generated wording. */
const HEALTHIA_DEFAULTS: Record<Role, Readonly<Record<string, PhoenixUiIconName>>> = {
  doctor: {
    overview: 'house', appointments: 'calendar-days', patients: 'users',
    encounters: 'stethoscope', documents: 'files', management: 'briefcase',
    tools: 'wrench',
  },
  patient: {
    overview: 'house', appointments: 'calendar-days', records: 'clipboard-list',
    documents: 'files', consent: 'shield-check',
  },
}

/** Curated icon picker; options are bundled, validated names rather than arbitrary SVG. */
export const PHOENIX_NAVIGATION_ICON_CHOICES: readonly { name: PhoenixUiIconName; label: string }[] = [
  { name: 'house', label: 'Inicio' },
  { name: 'layout-dashboard', label: 'Panel' },
  { name: 'calendar-days', label: 'Calendario' },
  { name: 'users', label: 'Personas' },
  { name: 'stethoscope', label: 'Consulta' },
  { name: 'clipboard-list', label: 'Expediente' },
  { name: 'file-text', label: 'Documentos' },
  { name: 'files', label: 'Archivos' },
  { name: 'shield-check', label: 'Autorización' },
  { name: 'blocks', label: 'Capacidades' },
  { name: 'share-2', label: 'Compartir' },
  { name: 'database', label: 'Datos' },
  { name: 'graduation-cap', label: 'Educación' },
  { name: 'trophy', label: 'Deportes' },
  { name: 'briefcase', label: 'Trabajo' },
  { name: 'settings', label: 'Configuración' },
]

function browserStore(): IconStore | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}

export function phoenixNavigationIconScope(app: string, role: Role, section: string): string {
  if (!ID.test(app) || !ID.test(section) || (role !== 'doctor' && role !== 'patient')) {
    throw new Error('NAVIGATION_ICON_INVALID_SCOPE')
  }
  return `${app}.${role}.${section}`
}

export function readPhoenixNavigationIcons(store: IconStore | undefined = browserStore()): PhoenixNavigationIconOverrides {
  if (!store) return {}
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw || raw.length > MAX_BYTES) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const payload = parsed as Record<string, unknown>
    if (payload.version !== 1 || Object.keys(payload).some(k => k !== 'version' && k !== 'icons')) return {}
    const icons = payload.icons
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) return {}
    const pairs = Object.entries(icons)
    if (pairs.length > MAX_ENTRIES || pairs.some(([key, name]) => !SCOPE.test(key) || !isPhoenixUiIconName(name))) return {}
    return Object.fromEntries(pairs) as Record<string, PhoenixUiIconName>
  } catch { return {} }
}

/** User action: save/restore a validated icon for one exact app/role/section. */
export function writePhoenixNavigationIcon(
  app: string, role: Role, section: string, icon: unknown,
  store: IconStore | undefined = browserStore(),
): PhoenixNavigationIconOverrides {
  const key = phoenixNavigationIconScope(app, role, section)
  if (icon !== undefined && !isPhoenixUiIconName(icon)) throw new Error('NAVIGATION_ICON_INVALID_NAME')
  if (!store) throw new Error('NAVIGATION_ICON_STORAGE_UNAVAILABLE')
  const next: Record<string, PhoenixUiIconName> = { ...readPhoenixNavigationIcons(store) }
  if (icon === undefined) delete next[key]
  else next[key] = icon as PhoenixUiIconName
  if (Object.keys(next).length > MAX_ENTRIES) throw new Error('NAVIGATION_ICON_LIMIT')
  const serialized = JSON.stringify({ version: 1, icons: next })
  if (serialized.length > MAX_BYTES) throw new Error('NAVIGATION_ICON_LIMIT')
  store.setItem(STORAGE_KEY, serialized)
  return next
}

/** Resolves user override > stable Healthia ID > shared semantic classification > safe fallback. */
export function choosePhoenixNavigationIcon(
  app: string, role: Role, section: string, label: string,
  overrides: PhoenixNavigationIconOverrides = {},
): PhoenixUiIconName {
  const key = phoenixNavigationIconScope(app, role, section)
  const override = overrides[key]
  if (isPhoenixUiIconName(override)) return override
  const fixed = app === 'healthia' ? HEALTHIA_DEFAULTS[role][section] : undefined
  if (fixed && isPhoenixUiIconName(fixed)) return fixed
  const inferred = choosePhoenixUiIcon(label)
  return inferred !== 'info' && isPhoenixUiIconName(inferred) ? inferred : 'layout-grid'
}
