import { useEffect, useState, type ReactNode } from 'react'
import type { ClawHubCatalogItem, ClawHubFamily, ClawHubState, OpenClawRoutingSnapshot, OpenClawRoutedTool, OpenClawGatewayCredentialState } from '@phoenix-ai/dsh-api-remotes/client'
import type { ConnectorKey } from './connectors-locales.ts'
import type { McpRegistryClient } from './AuthorizationPanel.tsx'
import { CONNECTOR_CATALOG } from './connector-catalog.ts'
import css from './ConnectorsSection.module.css'

export interface ClawHubConnectorStoreProps {
  registry?: McpRegistryClient | undefined
  t: (key: ConnectorKey) => string
  connectedIds: readonly string[]
}
const families: readonly ClawHubFamily[] = ['code-plugin', 'bundle-plugin', 'skill']
function duplicate(item: ClawHubCatalogItem, connectedIds: readonly string[]): boolean {
  if (item.installed) return true
  const slug = item.name.split('/').at(-1)?.toLowerCase() ?? ''
  return CONNECTOR_CATALOG.some(def => connectedIds.includes(def.id)
    && [def.id, def.providerFamily, def.name, ...(def.aliases ?? [])]
      .some(alias => alias?.toLowerCase() === slug))
}

/** Live ClawHub store in the existing Connectors page, not a second settings area. */
export function ClawHubConnectorStore({ registry, t, connectedIds }: ClawHubConnectorStoreProps): ReactNode {
  const [family, setFamily] = useState<ClawHubFamily>('code-plugin')
  const [official, setOfficial] = useState(true)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [items, setItems] = useState<readonly ClawHubCatalogItem[] | null>(null)
  const [runtime, setRuntime] = useState<ClawHubState | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [installedPlugins, setInstalledPlugins] = useState<readonly string[]>([])
  const [routing, setRouting] = useState<OpenClawRoutingSnapshot | null>(null)
  const [routingBusy, setRoutingBusy] = useState<string | null>(null)
  const [routingError, setRoutingError] = useState(false)
  const [routingRefresh, setRoutingRefresh] = useState(0)
  const [gatewayToken, setGatewayToken] = useState('')
  const [gatewayCredential, setGatewayCredential] = useState<OpenClawGatewayCredentialState | null>(null)
  const [gatewaySaving, setGatewaySaving] = useState(false)
  const browse = registry?.clawHubCatalog
  const readState = registry?.clawHubState
  const installSkill = registry?.clawHubInstallSkill
  const installPackage = registry?.clawHubInstallPackage
  const prepareCli = registry?.prepareClawHubCli
  const inspectTools = registry?.openClawPluginTools
  const setRoutingPermission = registry?.setOpenClawPluginTool
  const readGatewayCredential = registry?.openClawGatewayCredential
  const saveGatewayCredential = registry?.configureOpenClawGatewayCredential

  useEffect(() => {
    if (readState === undefined) return
    let active = true
    void readState().then(value => { if (active) setRuntime(value) }, () => { if (active) setRuntime(null) })
    return () => { active = false }
  }, [readState, reload])
  useEffect(() => {
    if (browse === undefined) return
    let active = true
    setItems(null)
    setError(false)
    void browse({ family, query, officialOnly: official, limit: 16 }).then(
      value => { if (active) setItems(value.items) },
      () => { if (active) setError(true) },
    )
    return () => { active = false }
  }, [browse, family, query, official, reload])

  useEffect(() => {
    if (inspectTools === undefined) return
    let active = true
    setRoutingError(false)
    void inspectTools().then(
      snapshot => { if (active) setRouting(snapshot) },
      () => { if (active) setRoutingError(true) },
    )
    return () => { active = false }
  }, [inspectTools, routingRefresh, reload])

  const approveTool = (tool: OpenClawRoutedTool): void => {
    if (setRoutingPermission === undefined || routingBusy !== null) return
    const key = tool.pluginId + ':' + tool.name
    setRoutingBusy(key)
    setRoutingError(false)
    void setRoutingPermission({ pluginId: tool.pluginId, toolName: tool.name,
      approved: !tool.approved }).then(
      value => { setRouting(value) },
      () => { setRoutingError(true) },
    ).finally(() => { setRoutingBusy(null) })
  }

  useEffect(() => {
    if (readGatewayCredential === undefined) return
    let active = true
    void readGatewayCredential().then(value => {
      if (active) setGatewayCredential(value)
    }, () => { if (active) setGatewayCredential(null) })
    return () => { active = false }
  }, [readGatewayCredential, routingRefresh])

  const saveToken = (): void => {
    if (gatewaySaving || gatewayToken.length < 16 || saveGatewayCredential === undefined) return
    setGatewaySaving(true)
    setNotice('')
    void saveGatewayCredential({ token: gatewayToken }).then(
      value => {
        setGatewayToken('')
        setGatewayCredential(value)
        setNotice(t('storeGatewayTokenSaved'))
        setRoutingRefresh(n => n + 1)
      },
      () => { setNotice(t('storeGatewayTokenError')) },
    ).finally(() => { setGatewaySaving(false) })
  }

  const fresh = (items ?? []).filter(item => !duplicate(item, connectedIds))
  const hidden = (items?.length ?? 0) - fresh.length
  const familyLabel = (value: ClawHubFamily): string => value === 'skill'
    ? t('storeSkills') : value === 'code-plugin' ? t('storePlugins') : t('storeBundles')
  const install = (item: ClawHubCatalogItem): void => {
    if (item.family !== 'skill' || installSkill === undefined || busy !== null || runtime?.cliStatus !== 'ready') return
    setBusy(item.name)
    setNotice('')
    void installSkill({ name: item.name, family: 'skill' }).then(
      () => { setNotice(t('storeInstalled')); setReload(n => n + 1) },
      () => { setNotice(t('storeInstallFailed')) },
    ).finally(() => { setBusy(null) })
  }

  const installNative = (item: ClawHubCatalogItem): void => {
    if (item.family === 'skill' || busy !== null || installPackage === undefined
      || runtime?.openclaw !== 'available') return
    setBusy(item.name)
    setNotice('')
    void installPackage({ name: item.name, family: item.family }).then(
      () => {
        setInstalledPlugins(current => current.includes(item.name) ? current : [...current, item.name])
        setNotice(t('storeNativeInstalled'))
      },
      () => { setNotice(t('storeNativeInstallError')) },
    ).finally(() => { setBusy(null) })
  }

  const prepare = (): void => {
    if (preparing || prepareCli === undefined) return
    setPreparing(true)
    setNotice('')
    void prepareCli().then(
      value => { setRuntime(value); setNotice(t('storeCliRepairSuccess')); setReload(n => n + 1) },
      () => { setNotice(t('storeCliRepairError')); setReload(n => n + 1) },
    ).finally(() => { setPreparing(false) })
  }
  const cliStatus = runtime?.cliStatus
  const cliLabel = cliStatus === 'ready' ? t('storeCliReady')
    : cliStatus === 'installing' ? t('storeCliInstalling')
      : cliStatus === 'install-failed' ? t('storeCliFailed')
        : cliStatus === 'incompatible-node' ? t('storeCliIncompatible')
          : cliStatus === 'missing' ? t('storeCliMissing') : t('storeCliStatusUnknown')
  return (
    <section className={css.block} data-clawhub-store="true" aria-label={t('storeTitle')}>
      <div className={css.heading}>
        <div><h3>{t('storeTitle')}</h3><p>{t('storeDescription')}</p></div>
        <a href="https://clawhub.ai" target="_blank" rel="noreferrer">{t('storeWebsite')}</a>
      </div>
      <div className={css.toolbar}>
        <strong>{cliLabel}</strong>
        {runtime?.cliVersion ? <span className={css.safetyNote}>{t('storeCliVersion')}: {runtime.cliVersion}</span> : null}
        {runtime?.latestCliVersion ? <span className={css.safetyNote}>{t('storeCliLatest')}: {runtime.latestCliVersion}</span> : null}
        {runtime?.failureReason ? <span className={css.safetyNote}>{t('storeCliReason')}: {runtime.failureReason}</span> : null}
        <button className={css.compactButton} type="button"
          disabled={preparing || prepareCli === undefined}
          onClick={prepare}>{preparing ? t('storeCliRepairing') : t('storeCliRepair')}</button>
      </div>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {families.map(value => (
            <button type="button" key={value} aria-pressed={family === value}
              className={family === value ? css.filterActive : undefined}
              onClick={() => { setFamily(value); setQuery(''); setDraft('') }}>{familyLabel(value)}</button>
          ))}
        </div>
        <label className={css.safetyNote}>
          <input type="checkbox" checked={official} onChange={e => { setOfficial(e.currentTarget.checked) }}/>
          {' '}{t('storeOfficial')}
        </label>
      </div>
      <form className={css.toolbar} onSubmit={event => { event.preventDefault(); setQuery(draft.trim()) }}>
        <input className={css.search} type="search" maxLength={80} aria-label={t('storeSearch')}
          placeholder={t('storeSearch')} value={draft} onChange={e => { setDraft(e.currentTarget.value) }} />
        <button className={css.compactButton} type="submit">{t('storeSearchAction')}</button>
        <button className={css.compactButton} type="button" onClick={() => { setReload(n => n + 1) }}>
          {t('storeReload')}
        </button>
      </form>
      {error || browse === undefined ? <p role="alert">{t('storeUnavailable')}</p> : null}
      {!error && browse !== undefined && items === null ? <p>{t('storeLoading')}</p> : null}
      {hidden > 0 ? <p className={css.safetyNote}>{hidden} {t('storeHidden')}</p> : null}
      {items !== null && fresh.length === 0 ? <p>{t('storeEmpty')}</p> : null}
      {items !== null && fresh.length > 0 ? (
        <div className={css.presetGrid}>
          {fresh.map(item => (
            <article key={item.family + item.name} className={css.presetCard}>
              <strong className={css.presetName}>{item.displayName}</strong>
              <small>{item.name} · {item.version}</small>
              <p>{item.description}</p>
              <div className={css.chips}><span>{item.official ? t('storeOfficial') : t('storeCommunity')}</span></div>
              {item.family === 'skill' ? (
                <button className={css.compactButton} type="button"
                  disabled={busy !== null || installSkill === undefined || runtime?.cli === 'missing'}
                  onClick={() => { install(item) }}>
                  {busy === item.name ? t('storeInstalling') : t('storeInstall')}
                </button>
              ) : (
                <div className={css.toolbar}>
                  <button className={css.compactButton} type="button"
                    disabled={busy !== null || installPackage === undefined
                      || runtime?.openclaw !== 'available' || installedPlugins.includes(item.name)}
                    onClick={() => { installNative(item) }}>
                    {installedPlugins.includes(item.name) ? t('storeNativeInstalledStatus')
                      : busy === item.name ? t('storeInstalling') : t('storeNativeInstall')}
                  </button>
                  {runtime?.openclaw !== 'available' ? (
                    <small>{t('storeRuntimeNotReady')}</small>
                  ) : null}
                  <details>
                    <summary>{t('storeAuthGuide')}</summary>
                    <p className={css.safetyNote}>{t('storeAuthExplanation')}</p>
                    <code>{'openclaw plugins list --json'}</code>
                    <p className={css.safetyNote}>{t('storeAuthConfigStep')}</p>
                    <code>{'openclaw configure --section plugins'}</code>
                    <p className={css.safetyNote}>{t('storeAuthEnableStep')}</p>
                    <code>{'openclaw plugins enable <id>'}</code>
                    <p className={css.safetyNote}>{t('storeAuthVerifyStep')}</p>
                    <code>{'openclaw plugins inspect <id> --runtime --json'}</code>
                    <p><a href="https://docs.openclaw.ai/plugins" target="_blank" rel="noreferrer">
                      {t('storeAuthDocs')}
                    </a></p>
                  </details>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className={css.block} aria-label={t('storeGatewayTokenTitle')}>
        <div className={css.heading}>
          <div>
            <h3>{t('storeGatewayTokenTitle')}</h3>
            <p>{t('storeGatewayTokenHint')}</p>
          </div>
          <a href="http://127.0.0.1:18789/" target="_blank" rel="noreferrer">
            {t('storeGatewayOpenUi')}
          </a>
        </div>
        <p className={css.safetyNote}>{gatewayCredential?.configured
          ? t('storeGatewayTokenReady') : t('storeGatewayTokenMissing')}</p>
        <form className={css.toolbar} onSubmit={event => { event.preventDefault(); saveToken() }}>
          <input className={css.search} type="password" autoComplete="new-password"
            aria-label={t('storeGatewayTokenPlaceholder')}
            placeholder={t('storeGatewayTokenPlaceholder')}
            value={gatewayToken} onChange={event => { setGatewayToken(event.currentTarget.value) }}/>
          <button type="submit" className={css.compactButton}
            disabled={gatewaySaving || gatewayToken.length < 16 || saveGatewayCredential === undefined}>
            {gatewaySaving ? t('storeGatewayTokenSaving') : t('storeGatewayTokenSave')}
          </button>
        </form>
        <p className={css.safetyNote}>{t('storeGatewaySecurity')}</p>
      </div>
      <div className={css.block} aria-label={t('storeRoutingTitle')}>
        <div className={css.heading}>
          <div>
            <h3>{t('storeRoutingTitle')}</h3>
            <p>{t('storeRoutingIntro')}</p>
          </div>
          <button className={css.compactButton} type="button"
            disabled={inspectTools === undefined}
            onClick={() => { setRouting(null); setRoutingRefresh(n => n + 1) }}>
            {t('storeRoutingRefresh')}
          </button>
        </div>
        {routingError ? <p role="alert">{t('storeRoutingUnavailable')}</p> : null}
        {routing === null && !routingError ? <p>{t('storeRoutingLoading')}</p> : null}
        {routing !== null && !routing.inspectionAvailable ? <p>{t('storeRoutingUnavailable')}</p> : null}
        {routing !== null && !routing.gatewayCredentialConfigured
          ? <p className={css.safetyNote}>{t('storeRoutingMissingToken')}</p> : null}
        {routing !== null && routing.tools.length === 0 ? <p>{t('storeRoutingEmpty')}</p> : null}
        {routing !== null && routing.tools.length > 0 ? (
          <div className={css.presetGrid}>
            {routing.tools.map(tool => (
              <article className={css.presetCard} key={tool.pluginId + ':' + tool.name}>
                <strong className={css.presetName}>{tool.name}</strong>
                <small>{tool.pluginId}</small>
                <p className={css.safetyNote}>{tool.approved
                  ? t('storeRoutingApproved') : t('storeRoutingDenied')}</p>
                <button className={css.compactButton} type="button"
                  disabled={!tool.imported || routingBusy !== null
                    || setRoutingPermission === undefined}
                  onClick={() => { approveTool(tool) }}>
                  {tool.approved ? t('storeRoutingRevoke') : t('storeRoutingAllow')}
                </button>
              </article>
            ))}
          </div>
        ) : null}
        <p className={css.safetyNote}>{t('storeRoutingPolicy')}</p>
        <p className={css.safetyNote}>{t('storeRoutingOAuth')} {' '}
          <a href="https://docs.openclaw.ai/concepts/oauth" target="_blank" rel="noreferrer">
            {t('storeRoutingDocs')}
          </a>
        </p>
      </div>
      <p className={css.safetyNote}>{t('storeSafety')}</p>
    </section>
  )
}
