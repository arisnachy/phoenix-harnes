/** Eclipse's durable provider/model/effort editor; it never writes a fake model selection. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { ModelsSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import css from './EclipseRoutingPanel.module.css'

export interface EclipseCatalogChoice {
  provider: string
  model: string
  name: string
  reasoningEfforts: readonly string[]
}
interface Route { provider: string; model: string; reasoningEffort?: string }
interface Profile {
  mode?: 'automatic' | 'hybrid' | 'manual'
  planner?: Route
  coordinator?: Route
  subagent?: Route
  specialists?: Record<string, Route>
  maxTeammates?: number
}
type Role = 'planner' | 'coordinator' | 'subagent'
type Translator = (key: keyof typeof en) => string
const ROLES: readonly Role[] = ['planner', 'coordinator', 'subagent']
const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const DEFAULT_PROFILE: Profile = { mode: 'automatic', maxTeammates: 3 }

function encoded(route: Route): string { return JSON.stringify([route.provider, route.model]) }
function routeFromKey(key: string): Route | undefined {
  if (key === '') return undefined
  try {
    const value: unknown = JSON.parse(key)
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string'
      || typeof value[1] !== 'string' || value[1] === 'phoenix-auto') return undefined
    return { provider: value[0], model: value[1] }
  } catch { return undefined }
}
/** Use the independent synthetic-model section, with legacy values for migration only.
 * @param dedicated - Independently persisted Eclipse settings.
 * @param legacy - Settings from the former Agent default-model namespace.
 * @returns Profile shown in Settings, preserving any earlier preferences.
 */
export function existingProfile(dedicated: unknown, legacy?: unknown): Profile {
  if (typeof dedicated === 'object' && dedicated !== null && !Array.isArray(dedicated)
    && Object.keys(dedicated).length > 0) return structuredClone(dedicated as Profile)
  if (typeof legacy === 'object' && legacy !== null && !Array.isArray(legacy)) {
    const previous = (legacy as { eclipse?: Profile }).eclipse
    if (previous !== undefined) return structuredClone(previous)
  }
  return { ...DEFAULT_PROFILE }
}

/** Settings live mirror + real Host session catalog, never hardcoded model names. */
export function EclipseRoutingPanel(props: {
  controller: ModelsSettingsStore
  api: Pick<IApiClient, 'settings'>
  loadCatalog: () => Promise<readonly EclipseCatalogChoice[]>
  t: Translator
}) {
  const state = useSyncExternalStore(
    listener => props.controller.store.subscribe(listener),
    () => props.controller.store.getSnapshot(),
  )
  const source = state.namespaces.get('eclipse-routing')
  const legacy = state.namespaces.get('agent-default-model')
  const dedicatedRegistered = source !== undefined
  const legacyCompatible = !dedicatedRegistered && legacy !== undefined
  const canPersist = dedicatedRegistered || legacyCompatible
  const [draft, setDraft] = useState<Profile>(() => existingProfile(source?.value, legacy?.value))
  const [catalog, setCatalog] = useState<readonly EclipseCatalogChoice[]>([])
  const [catalogError, setCatalogError] = useState<string>()
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string>()
  const [specialist, setSpecialist] = useState('')
  useEffect(() => {
    if (state.status === 'idle') void props.controller.load()
  }, [props.controller, state.status])
  useEffect(() => { setDraft(existingProfile(source?.value, legacy?.value)) },
    [source?.value, legacy?.value])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const refresh = (): void => {
    setCatalogLoading(true)
    void props.loadCatalog().then(rows => {
      setCatalog(rows)
      setCatalogError(undefined)
    }, (error: unknown) => {
      setCatalogError(error instanceof Error ? error.message : String(error))
    }).finally(() => { setCatalogLoading(false) })
  }
  useEffect(() => {
    let alive = true
    setCatalogLoading(true)
    void props.loadCatalog().then(rows => {
      if (alive) { setCatalog(rows); setCatalogError(undefined) }
    }, (error: unknown) => {
      if (alive) setCatalogError(error instanceof Error ? error.message : String(error))
    }).finally(() => { if (alive) setCatalogLoading(false) })
    return () => { alive = false }
  }, [props.loadCatalog])
  const update = (patch: Partial<Profile>): void => { setDraft(previous => ({ ...previous, ...patch })); setMessage(undefined) }
  const models = catalog.filter(choice => choice.model !== 'phoenix-auto')
  const unique = [...new Map(models.map(choice => [encoded(choice), choice])).values()]
  const selection = (route: Route | undefined): string => route === undefined ? '' : encoded(route)
  const pick = (role: Role, key: string): void => {
    const next = routeFromKey(key)
    update({ [role]: next, ...next !== undefined && (draft.mode ?? 'automatic') === 'automatic'
      ? { mode: 'hybrid' as const } : {} } as Partial<Profile>)
  }
  const updateEffort = (role: Role, effort: string): void => {
    const route = draft[role]
    if (route === undefined) return
    const { reasoningEffort: _removed, ...bare } = route
    update({
      [role]: effort === '' ? bare : { ...bare, reasoningEffort: effort },
      ...effort !== '' && (draft.mode ?? 'automatic') === 'automatic'
        ? { mode: 'hybrid' as const } : {},
    } as Partial<Profile>)
  }
  const selectedModel = (route: Route | undefined): EclipseCatalogChoice | undefined =>
    route === undefined ? undefined : models.find(choice => choice.provider === route.provider && choice.model === route.model)
  const field = (role: Role): React.JSX.Element => {
    const route = draft[role]
    const found = selectedModel(route)
    const supported = found?.reasoningEfforts.filter(item => EFFORTS.includes(item as typeof EFFORTS[number])) ?? []
    return <div className={css.role} key={role}>
      <label className={css.label} htmlFor={`eclipse-${role}`}>{props.t(`eclipseRole_${role}` as keyof typeof en)}</label>
      <select id={`eclipse-${role}`} className={css.input} value={selection(route)}
        disabled={!state.writable || working || catalogLoading || models.length === 0}
        onChange={event => { pick(role, event.target.value) }}>
        <option value="">{props.t('eclipseAutomatic')}</option>
        {route !== undefined && found === undefined ? <option value={selection(route)}>{route.provider} / {route.model}</option> : null}
        {unique.map(choice => <option key={encoded(choice)} value={encoded(choice)}>{choice.name} ({choice.provider})</option>)}
      </select>
      {route !== undefined && models.length === 0 ? <p className={css.hint}>{route.provider} / {route.model}</p> : null}
      <label className={css.label} htmlFor={`eclipse-effort-${role}`}>{props.t('eclipseReasoning')}</label>
      <select id={`eclipse-effort-${role}`} className={css.input} value={route?.reasoningEffort ?? ''}
        disabled={!state.writable || working || route === undefined}
        onChange={event => { updateEffort(role, event.target.value) }}>
        <option value="">{props.t('eclipseDefaultEffort')}</option>
        {route?.reasoningEffort !== undefined && !supported.includes(route.reasoningEffort)
          ? <option value={route.reasoningEffort}>{route.reasoningEffort}</option> : null}
        {supported.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </select>
    </div>
  }
  const valid = ROLES.every(role => {
    const route = draft[role]
    if (route === undefined) return true
    const available = selectedModel(route)
    return available !== undefined
      && (route.reasoningEffort === undefined || available.reasoningEfforts.includes(route.reasoningEffort))
  }) && Object.values(draft.specialists ?? {}).every(route => {
    const available = selectedModel(route)
    return available !== undefined && (route.reasoningEffort === undefined
      || available.reasoningEfforts.includes(route.reasoningEffort))
  })
  const save = async (reset = false): Promise<void> => {
    if (!state.writable || working) return
    if (!canPersist) {
      setMessage(props.t('eclipseHostUnavailable'))
      return
    }
    setWorking(true)
    setMessage(undefined)
    try {
      const response = await props.api.settings.mutate({
        ns: dedicatedRegistered ? 'eclipse-routing' : 'agent-default-model',
        // A mixed-version Host may have only the legacy settings section.
        // Use its Eclipse subtree until the current Host restarts; do not
        // silently claim that the new dedicated namespace was written.
        ops: dedicatedRegistered
          ? (['mode', 'planner', 'coordinator', 'subagent', 'specialists', 'maxTeammates'] as const)
            .map(field => {
              const value = reset ? (field === 'mode' ? 'automatic' : undefined) : draft[field]
              return value === undefined
                ? { op: 'unset' as const, path: [field] }
                : { op: 'set' as const, path: [field], value }
            })
          : [{ op: 'set' as const, path: ['eclipse'],
            value: reset ? { mode: 'automatic' } : draft }],
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await props.controller.load()
      setMessage(props.t(legacyCompatible ? 'eclipseLegacySaved' : 'eclipseSaved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setWorking(false) }
  }
  const specialistNames = Object.keys(draft.specialists ?? {}).sort()
  return <section className={css.section} aria-label={props.t('eclipseTitle')}>
    <h2 className={css.title}>{props.t('eclipseTitle')}</h2>
    <p className={css.hint}>{props.t('eclipseDescription')}</p>
    <div className={css.actions}>
      <span className={css.hint} role="status">{catalogLoading
        ? props.t('eclipseCatalogLoading')
        : props.t('eclipseCatalogCount').replace('{count}', String(models.filter(x => x.provider === 'openai-codex').length))}</span>
      <button type="button" disabled={catalogLoading} onClick={refresh}>
        {props.t('eclipseRefresh')}
      </button>
    </div>
    <label className={css.label} htmlFor="eclipse-mode">{props.t('eclipseMode')}</label>
    <select id="eclipse-mode" className={css.input} disabled={!state.writable || working}
      value={draft.mode ?? 'automatic'} onChange={event => { update({ mode: event.target.value as NonNullable<Profile['mode']> }) }}>
      <option value="automatic">{props.t('eclipseAutomatic')}</option>
      <option value="hybrid">{props.t('eclipseHybrid')}</option>
      <option value="manual">{props.t('eclipseManual')}</option>
    </select>
    <div className={css.roles}>{ROLES.map(field)}</div>
    <label className={css.label} htmlFor="eclipse-workers">{props.t('eclipseWorkers')}</label>
    <select id="eclipse-workers" className={css.input} value={draft.maxTeammates ?? 3}
      disabled={!state.writable || working} onChange={event => { update({ maxTeammates: Number(event.target.value) }) }}>
      {[0,1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
    </select>
    <div className={css.role}>
      <label className={css.label} htmlFor="eclipse-specialist">{props.t('eclipseSpecialist')}</label>
      <div className={css.actions}>
        <input id="eclipse-specialist" className={css.input} placeholder="orion, atlas, lumen…"
          value={specialist} disabled={!state.writable || working}
          onChange={event => { setSpecialist(event.target.value.toLowerCase()) }} />
        <button type="button" disabled={!state.writable || working || !/^[a-z][a-z0-9-]{0,62}$/.test(specialist)
          || draft.subagent === undefined || selectedModel(draft.subagent) === undefined}
          onClick={() => {
            if (draft.subagent === undefined) return
            update({ specialists: { ...draft.specialists, [specialist]: { ...draft.subagent } } })
            setSpecialist('')
          }}>{props.t('eclipseAdd')}</button>
      </div>
      <p className={css.hint}>{props.t('eclipseSpecialistHint')}</p>
      {specialistNames.map(name => <div className={css.saved} key={name}>
        <span>{name}: {draft.specialists?.[name]?.model}</span>
        <button type="button" disabled={!state.writable || working} onClick={() => {
          const next = { ...draft.specialists }
          delete next[name]
          update({ specialists: next })
        }}>{props.t('remove')}</button>
      </div>)}
    </div>
    {legacyCompatible ? <p role="status" className={css.hint}>{props.t('eclipseLegacyHost')}</p> : null}
    {!canPersist && state.status === 'ready'
      ? <p role="alert" className={css.error}>{props.t('eclipseHostUnavailable')}</p> : null}
    {catalogError !== undefined ? <p role="status" className={css.error}>{catalogError}</p> : null}
    {models.length === 0 && !catalogLoading
      ? <p className={css.hint}>{props.t('eclipseCatalogHint')}</p> : null}
    {!valid && draft.mode !== 'automatic' ? <p className={css.error}>{props.t('eclipseInvalid')}</p> : null}
    {message !== undefined ? <p role="status" className={css.hint}>{message}</p> : null}
    <div className={css.actions}>
      <button type="button" className={css.primary} disabled={!state.writable || working || !canPersist || (!valid && draft.mode !== 'automatic')}
        onClick={() => { void save() }}>{props.t('eclipseSave')}</button>
      <button type="button" disabled={!state.writable || working || !canPersist}
        onClick={() => { void save(true) }}>{props.t('eclipseReset')}</button>
    </div>
  </section>
}
