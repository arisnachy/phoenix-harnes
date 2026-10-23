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

/** Kira's planning and execution seats plus her delegated teammates. */
export interface EclipseProfile {
  mode?: 'automatic' | 'hybrid' | 'manual'
  executionEngine?: 'automatic' | 'internal' | 'codex' | 'openclaw'
  planner?: Route
  coordinator?: Route
  subagent?: Route
  escalationSensitivity?: 'adaptive' | 'quality' | 'economy'
  maxTeammates?: number
}

/** Former per-specialist overrides are read for cleanup only. */
interface LegacyProfile extends EclipseProfile {
  specialists?: Record<string, Route>
}

type Role = 'planner' | 'coordinator' | 'subagent'
type Translator = (key: keyof typeof en) => string
/** Secret-free status returned by the execution-engine registry. */
export interface EclipseEngineStatus {
  engine: 'internal' | 'codex' | 'openclaw'
  connected: boolean
  version: string
  diagnostic?: string
}

/** Secret-free Host inspection of the installed execution runtimes. */
export interface EclipseEngineRuntimeEntry {
  status: 'active' | 'prepared' | 'stopped' | 'unavailable'
  version?: string
  diagnostic?: string
}

/** Unified Phoenix/Codex/OpenClaw update state rendered by Eclipse. */
export interface EclipseEngineRuntimeSnapshot {
  checkedAt: string
  codex: EclipseEngineRuntimeEntry
  openclaw: EclipseEngineRuntimeEntry
  phoenix: { status: string; current?: string; target?: string; diagnostic?: string }
}

/** Safe preparation receipt; activation and rollback are intentionally absent. */
export interface EclipseEnginePrepareReceipt {
  status: 'prepared' | 'already-active' | 'blocked' | 'unavailable' | 'error'
  version?: string
  diagnostic?: string
}
const ROLES: readonly Role[] = ['coordinator', 'subagent']
const DEFAULT_PROFILE: EclipseProfile = { mode: 'automatic', maxTeammates: 3, escalationSensitivity: 'adaptive' }

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

function routeFromValue(value: unknown): Route | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string') return undefined
  return {
    provider: candidate.provider,
    model: candidate.model,
    ...(typeof candidate.reasoningEffort === 'string'
      ? { reasoningEffort: candidate.reasoningEffort } : {}),
  }
}

function profileFromValue(value: unknown): EclipseProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFAULT_PROFILE }
  const candidate = value as LegacyProfile
  const mode: NonNullable<EclipseProfile['mode']> = candidate.mode === 'automatic'
    || candidate.mode === 'hybrid' || candidate.mode === 'manual' ? candidate.mode : 'automatic'
  // Older two-seat documents reused planner as coordinator. New three-seat
  // documents persist escalationSensitivity to distinguish independent seats.
  const sensitivity = candidate.escalationSensitivity === 'quality' || candidate.escalationSensitivity === 'economy'
    ? candidate.escalationSensitivity : 'adaptive'
  const legacyPlanner = candidate.escalationSensitivity === undefined && candidate.coordinator === undefined
  const coordinator = routeFromValue(candidate.coordinator)
    ?? (legacyPlanner ? routeFromValue(candidate.planner) : undefined)
  const planner = legacyPlanner ? undefined : routeFromValue(candidate.planner)
  const subagent = routeFromValue(candidate.subagent)
  const maxTeammates = typeof candidate.maxTeammates === 'number'
    && Number.isInteger(candidate.maxTeammates) && candidate.maxTeammates >= 0 && candidate.maxTeammates <= 3
    ? candidate.maxTeammates : 3
  return {
    mode,
    ...candidate.executionEngine === 'automatic' || candidate.executionEngine === 'internal'
      || candidate.executionEngine === 'codex' || candidate.executionEngine === 'openclaw'
      ? { executionEngine: candidate.executionEngine } : {},
    ...(planner === undefined ? {} : { planner }),
    ...(coordinator === undefined ? {} : { coordinator }),
    ...(subagent === undefined ? {} : { subagent }),
    escalationSensitivity: sensitivity,
    maxTeammates,
  }
}

/** Use the independent Eclipse section, with legacy values for migration only.
 * @param dedicated - Independently persisted Eclipse settings.
 * @param legacy - Settings from the former Agent default-model namespace.
 * @returns The independent planning, execution and teammate routes shown in Settings.
 */
export function existingProfile(dedicated: unknown, legacy?: unknown): EclipseProfile {
  if (typeof dedicated === 'object' && dedicated !== null && !Array.isArray(dedicated)
    && Object.keys(dedicated).length > 0) return profileFromValue(dedicated)
  if (typeof legacy === 'object' && legacy !== null && !Array.isArray(legacy)) {
    const previous = (legacy as { eclipse?: unknown }).eclipse
    if (previous !== undefined) return profileFromValue(previous)
  }
  return { ...DEFAULT_PROFILE }
}

/** Settings live mirror plus the current OpenAI Codex catalog. */
export function EclipseRoutingPanel(props: {
  controller: ModelsSettingsStore
  api: Pick<IApiClient, 'settings'>
  loadCatalog: () => Promise<readonly EclipseCatalogChoice[]>
  loadEngines?: () => Promise<readonly EclipseEngineStatus[]>
  loadRuntime?: () => Promise<EclipseEngineRuntimeSnapshot>
  prepareOpenClaw?: (version: string) => Promise<EclipseEnginePrepareReceipt>
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
  const [draft, setDraft] = useState<EclipseProfile>(() => existingProfile(source?.value, legacy?.value))
  const [catalog, setCatalog] = useState<readonly EclipseCatalogChoice[]>([])
  const [catalogError, setCatalogError] = useState<string>()
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string>()
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [engines, setEngines] = useState<readonly EclipseEngineStatus[]>([])
  const [engineError, setEngineError] = useState(false)
  const [checkingEngines, setCheckingEngines] = useState(false)
  const [runtime, setRuntime] = useState<EclipseEngineRuntimeSnapshot>()
  const [runtimeError, setRuntimeError] = useState(false)
  const [checkingRuntime, setCheckingRuntime] = useState(false)
  const [runtimeVersion, setRuntimeVersion] = useState('')
  const [preparingRuntime, setPreparingRuntime] = useState(false)
  const [runtimeMessage, setRuntimeMessage] = useState<string>()
  const checkEngines = async (): Promise<void> => {
    if (props.loadEngines === undefined) return
    setCheckingEngines(true)
    try { setEngines(await props.loadEngines()); setEngineError(false) }
    catch { setEngineError(true) }
    finally { setCheckingEngines(false) }
  }
  useEffect(() => { void checkEngines() }, [props.loadEngines])

  const checkRuntime = async (): Promise<void> => {
    if (props.loadRuntime === undefined) return
    setCheckingRuntime(true)
    try { setRuntime(await props.loadRuntime()); setRuntimeError(false) }
    catch { setRuntimeError(true) }
    finally { setCheckingRuntime(false) }
  }
  useEffect(() => { void checkRuntime() }, [props.loadRuntime])

  useEffect(() => {
    if (state.status === 'idle') void props.controller.load()
  }, [props.controller, state.status])
  useEffect(() => { setDraft(existingProfile(source?.value, legacy?.value)) },
    [source?.value, legacy?.value])

  const refresh = (): void => {
    setCatalogLoading(true)
    void props.loadCatalog().then((rows) => {
      setCatalog(rows)
      setCatalogError(undefined)
    }, (error: unknown) => {
      setCatalogError(error instanceof Error ? error.message : String(error))
    }).finally(() => { setCatalogLoading(false) })
  }
  useEffect(() => {
    let alive = true
    setCatalogLoading(true)
    void props.loadCatalog().then((rows) => {
      if (alive) { setCatalog(rows); setCatalogError(undefined) }
    }, (error: unknown) => {
      if (alive) setCatalogError(error instanceof Error ? error.message : String(error))
    }).finally(() => { if (alive) setCatalogLoading(false) })
    return () => { alive = false }
  }, [props.loadCatalog])

  const update = (patch: Partial<EclipseProfile>): void => {
    setDraft(previous => ({ ...previous, ...patch }))
    setMessage(undefined)
  }
  // Keep the catalog defense here even when a caller supplies an unfiltered loader.
  const models = catalog.filter(choice => choice.provider === 'openai-codex' && choice.model !== 'phoenix-auto')
  const unique = [...new Map(models.map(choice => [encoded(choice), choice])).values()]
  const selection = (route: Route | undefined): string => route === undefined ? '' : encoded(route)
  const pick = (role: Role, key: string): void => {
    const next = routeFromKey(key)
    update({
      [role]: next,
      ...next !== undefined && (draft.mode ?? 'automatic') === 'automatic' ? { mode: 'hybrid' as const } : {},
    })
  }
  const updateEffort = (role: Role, effort: string): void => {
    const route = draft[role]
    if (route === undefined) return
    const { reasoningEffort: _removed, ...bare } = route
    update({
      [role]: effort === '' ? bare : { ...bare, reasoningEffort: effort },
      ...effort !== '' && (draft.mode ?? 'automatic') === 'automatic' ? { mode: 'hybrid' as const } : {},
    })
  }
  const selectedModel = (route: Route | undefined): EclipseCatalogChoice | undefined =>
    route === undefined ? undefined : models.find(choice => choice.provider === route.provider && choice.model === route.model)
  const field = (role: Role): React.JSX.Element => {
    const route = draft[role]
    const found = selectedModel(route)
    // The app-server's reasoning list is authoritative; do not drop newer ids.
    const supported = found?.reasoningEfforts ?? []
    return <div className={css.role} key={role}>
      <label className={css.label} htmlFor={`eclipse-${role}`}>{props.t(`eclipseRole_${role}` as keyof typeof en)}</label>
      <select id={`eclipse-${role}`} className={css.input} value={selection(route)}
        disabled={!state.writable || working || catalogLoading || models.length === 0}
        onChange={(event) => { pick(role, event.target.value) }}>
        <option value="">{props.t('eclipseAutomatic')}</option>
        {route !== undefined && found === undefined ? <option value={selection(route)}>{route.provider} / {route.model}</option> : null}
        {unique.map(choice => <option key={encoded(choice)} value={encoded(choice)}>{choice.name}</option>)}
      </select>
      {route !== undefined && models.length === 0 ? <p className={css.hint}>{route.provider} / {route.model}</p> : null}
      <label className={css.label} htmlFor={`eclipse-effort-${role}`}>{props.t('eclipseReasoning')}</label>
      <select id={`eclipse-effort-${role}`} className={css.input} value={route?.reasoningEffort ?? ''}
        disabled={!state.writable || working || route === undefined}
        onChange={(event) => { updateEffort(role, event.target.value) }}>
        <option value="">{props.t(draft.mode === 'hybrid' ? 'eclipseAdaptiveEffort' : 'eclipseDefaultEffort')}</option>
        {route?.reasoningEffort !== undefined && !supported.includes(route.reasoningEffort)
          ? <option value={route.reasoningEffort}>{route.reasoningEffort}</option> : null}
        {supported.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </select>
    </div>
  }
  const valid = ROLES.every((role) => {
    const route = draft[role]
    if (route === undefined) return true
    const available = selectedModel(route)
    return available !== undefined
      && (route.reasoningEffort === undefined || available.reasoningEfforts.includes(route.reasoningEffort))
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
      const namespace = dedicatedRegistered ? source : legacy
      if (namespace === undefined) throw new Error(props.t('eclipseHostUnavailable'))
      let response = await props.api.settings.mutate({
        ns: dedicatedRegistered ? 'eclipse-routing' : 'agent-default-model',
        expectedRevision: namespace.revision,
        // Keep the plan and execution routes independent while cleaning up
        // obsolete per-specialist overrides.
        ops: dedicatedRegistered
          ? (['mode', 'planner', 'coordinator', 'subagent', 'specialists', 'maxTeammates', 'escalationSensitivity', 'executionEngine'] as const)
            .map((field) => {
              const value = reset
                ? field === 'mode' ? 'automatic' : undefined
                : field === 'mode' || field === 'planner' || field === 'coordinator' || field === 'subagent'
                  || field === 'maxTeammates' || field === 'escalationSensitivity' || field === 'executionEngine'
                  ? draft[field] : undefined
              return value === undefined
                ? { op: 'unset' as const, path: [field] }
                : { op: 'set' as const, path: [field], value }
            })
          : [{ op: 'set' as const, path: ['eclipse'],
            value: reset ? { mode: 'automatic' } : draft }],
      })
      // A stale mirror can advertise the new namespace while an older Host
      // still handles writes. Recover only for this exact registration error.
      let usedCompatibility = legacyCompatible
      if (!response.result.ok && dedicatedRegistered && legacy !== undefined
        && /settings namespace ["']?eclipse-routing["']? is not registered/i.test(response.result.error.message)) {
        response = await props.api.settings.mutate({
          ns: 'agent-default-model',
          expectedRevision: legacy.revision,
          ops: [{ op: 'set', path: ['eclipse'],
            value: reset ? { mode: 'automatic' } : draft }],
        })
        usedCompatibility = true
      }
      if (!response.result.ok) throw new Error(response.result.error.message)
      await props.controller.load()
      setMessage(props.t(usedCompatibility ? 'eclipseLegacySaved' : 'eclipseSaved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setWorking(false) }
  }
  return <section className={css.section} aria-label={props.t('eclipseTitle')}>
    <h2 className={css.title}>{props.t('eclipseTitle')}</h2>
    <p className={css.hint}>{props.t('eclipseDescription')}</p>
    <div className={css.actions}>
      <span className={css.hint} role="status">{catalogLoading
        ? props.t('eclipseCatalogLoading')
        : props.t('eclipseCatalogCount').replace('{count}', String(models.length))}</span>
      <button type="button" disabled={catalogLoading} onClick={refresh}>
        {props.t('eclipseRefresh')}
      </button>
    </div>
    <label className={css.label} htmlFor="eclipse-mode">{props.t('eclipseMode')}</label>
    <select id="eclipse-mode" className={css.input} disabled={!state.writable || working}
      value={draft.mode ?? 'automatic'} onChange={(event) => { update({ mode: event.target.value as NonNullable<EclipseProfile['mode']> }) }}>
      <option value="automatic">{props.t('eclipseAutomatic')}</option>
      <option value="hybrid">{props.t('eclipseHybrid')}</option>
      <option value="manual">{props.t('eclipseManual')}</option>
    </select>
    <div className={css.roles}>{ROLES.map(field)}</div>
    <label className={css.label} htmlFor="eclipse-strategy">{props.t('eclipseStrategy')}</label>
    <select id="eclipse-strategy" className={css.input} value={draft.escalationSensitivity ?? 'adaptive'}
      disabled={!state.writable || working}
      onChange={(event) => { update({ escalationSensitivity: event.target.value as NonNullable<EclipseProfile['escalationSensitivity']> }) }}>
      <option value="adaptive">{props.t('eclipseStrategyAdaptive')}</option>
      <option value="quality">{props.t('eclipseStrategyQuality')}</option>
      <option value="economy">{props.t('eclipseStrategyEconomy')}</option>
    </select>
    <p className={css.hint}>{props.t('eclipseStrategyUnlimited')}</p>
    <label className={css.label} htmlFor="eclipse-workers">{props.t('eclipseWorkers')}</label>
    <select id="eclipse-workers" className={css.input} value={draft.maxTeammates ?? 3}
      disabled={!state.writable || working} onChange={(event) => { update({ maxTeammates: Number(event.target.value) }) }}>
      {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
    </select>
    <h3>{props.t('eclipseEnginesTitle')}</h3>
    <p className={css.hint}>{props.t('eclipseEnginesDescription')}</p>
    <label className={css.label} htmlFor="eclipse-engine">{props.t('eclipseEnginePreference')}</label>
    <select id="eclipse-engine" className={css.input} value={draft.executionEngine ?? 'automatic'}
      disabled={!state.writable || working} onChange={(event) => { update({ executionEngine: event.target.value as NonNullable<EclipseProfile['executionEngine']> }) }}>
      <option value="automatic">{props.t('eclipseAutomatic')}</option>
      <option value="codex">Codex</option><option value="openclaw">OpenClaw</option>
      <option value="internal">{props.t('eclipseEngineInternal')}</option>
    </select>
    <ul>
      {(['codex', 'openclaw', 'internal'] as const).map((engine) => {
        const entry = engines.find(item => item.engine === engine)
        return <li key={engine}>{engine === 'internal' ? props.t('eclipseEngineInternal') : engine === 'codex' ? 'Codex' : 'OpenClaw'}
          {' · '}{entry?.connected === true ? props.t('eclipseEngineConnected') : props.t('eclipseEngineUnavailable')}
          {entry === undefined ? '' : ` · ${entry.version}`}
          {entry?.diagnostic === undefined ? '' : ` · ${entry.diagnostic}`}</li>
      })}
    </ul>
    {engineError ? <p role="status" className={css.hint}>{props.t('eclipseEngineDiagnosticFailed')}</p> : null}
    <button type="button" disabled={checkingEngines || props.loadEngines === undefined}
      onClick={() => { void checkEngines() }}>{props.t('eclipseEngineCheck')}</button>
    {props.loadRuntime !== undefined ? <div className={css.runtime}>
      <h4>{props.t('eclipseRuntimeTitle')}</h4>
      <p className={css.hint}>{props.t('eclipseRuntimeDescription')}</p>
      {runtimeError ? <p role="status" className={css.error}>{props.t('eclipseRuntimeUnavailable')}</p> : null}
      {runtime !== undefined ? <ul>
        {(['codex', 'openclaw'] as const).map((engine) => {
          const entry = runtime[engine]
          const label = engine === 'codex' ? 'Codex' : 'OpenClaw'
          return <li key={engine}>{label} · {entry.status}
            {entry.version === undefined ? '' : ` · ${entry.version}`}
            {entry.diagnostic === undefined ? '' : ` · ${entry.diagnostic}`}</li>
        })}
        <li>PHOENIX · {runtime.phoenix.status}
          {runtime.phoenix.current === undefined ? '' : ` · ${runtime.phoenix.current.slice(0, 8)}`}</li>
      </ul> : null}
      <div className={css.actions}>
        <button type="button" disabled={checkingRuntime} onClick={() => { void checkRuntime() }}>
          {props.t('eclipseRuntimeRefresh')}
        </button>
      </div>
      {props.prepareOpenClaw !== undefined ? <>
        <label className={css.label} htmlFor="eclipse-openclaw-version">{props.t('eclipseRuntimeVersion')}</label>
        <input id="eclipse-openclaw-version" className={css.input} value={runtimeVersion}
          placeholder="2026.10.6" disabled={preparingRuntime || checkingRuntime}
          onChange={(event) => { setRuntimeVersion(event.target.value); setRuntimeMessage(undefined) }} />
        <button type="button" disabled={preparingRuntime || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(runtimeVersion.trim())}
          onClick={() => {
            setPreparingRuntime(true); setRuntimeMessage(undefined)
            void props.prepareOpenClaw?.(runtimeVersion.trim()).then((result) => {
              setRuntimeMessage(result.status === 'prepared' || result.status === 'already-active'
                ? `${props.t('eclipseRuntimePrepared')}${result.version === undefined ? '' : ` · ${result.version}`}`
                : `${props.t('eclipseRuntimePrepareBlocked')} ${result.diagnostic ?? ''}`.trim())
            }, () => { setRuntimeMessage(props.t('eclipseRuntimePrepareFailed')) })
              .finally(() => { setPreparingRuntime(false); void checkRuntime() })
          }}>{preparingRuntime ? props.t('eclipseRuntimePreparing') : props.t('eclipseRuntimePrepare')}</button>
        {runtimeMessage !== undefined ? <p role="status" className={css.hint}>{runtimeMessage}</p> : null}
      </> : <p role="status" className={css.hint}>{props.t('eclipseRuntimePreparationDisabled')}</p>}
      <p role="status" className={css.hint}>{props.t('eclipseRuntimeActivationDisabled')}</p>
    </div> : null}
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
