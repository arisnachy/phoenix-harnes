/**
 * Codex-first product onboarding with a safe provider-key fallback.
 *
 * First run prefers the native ChatGPT / Codex authorization plane because it
 * reuses the user's Codex-managed session, live model catalog, refresh
 * lifecycle, quota telemetry, and connectors without asking PHOENIX to store
 * OAuth secrets. After sign-in the flow materializes the openai-codex route
 * and persists the first provider-preferred live Codex model as PHOENIX's
 * default. The existing DeepSeek key editor remains a fallback.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { messageOf, providerUsable } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import {
  AuthorizationAttemptProgress,
  useAuthorizationAttempt,
} from './authorization-attempt.tsx'
import {
  NATIVE_CODEX_AUTH_KEY,
  NATIVE_CODEX_PROVIDER,
  authorizationConnected,
} from './authorization-provider.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import modelStyles from './ModelsSection.module.css'
import styles from './DeepSeekOnboardingDialog.module.css'

const AGENT_DEFAULT_MODEL_NS = 'agent-default-model'
const USER_PROFILE_NS = 'user-profile'
const LOOPBACK_CHATGPT_WEB_PROVIDER = 'chatgpt-web'

interface AuthorizationEntry {
  key: string
  label: string
  methods: Array<{ id: string; label: string }>
  inFlight: boolean
  stored?: { kind: 'api-key' | 'grant' }
  telemetry?: { kind?: string; provider?: string }
}

type AuthorizationCatalogState =
  | { status: 'loading'; entries: AuthorizationEntry[] }
  | { status: 'ready'; entries: AuthorizationEntry[] }
  | { status: 'unavailable'; entries: AuthorizationEntry[] }

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire faces reused by provider setup and native account login. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
    & Partial<Pick<IApiClient, 'authorization'>>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

function isCodexEntry(entry: AuthorizationEntry): boolean {
  if (!entry.methods.some(method => method.id === 'oauth')) return false
  if (entry.key === NATIVE_CODEX_AUTH_KEY) return true
  const identity = `${entry.label} ${entry.telemetry?.provider ?? ''}`.toLowerCase()
  return identity.includes('codex') || identity.includes('chatgpt')
}

function stringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' ? fieldValue : undefined
}

/**
 * Prefer native ChatGPT / Codex authorization on first run. A user who already
 * has another confirmed provider skips onboarding; installations without the
 * Codex account flow fall back to the existing official DeepSeek key editor.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, api, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const authorization = api.authorization
  const [showApiKey, setShowApiKey] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionFailure, setProvisionFailure] = useState<string | undefined>(undefined)
  const [authorizationCatalog, setAuthorizationCatalog] = useState<AuthorizationCatalogState>(
    authorization === undefined
      ? { status: 'unavailable', entries: [] }
      : { status: 'loading', entries: [] },
  )

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (authorization === undefined) {
      setAuthorizationCatalog({ status: 'unavailable', entries: [] })
      return
    }
    let stale = false
    setAuthorizationCatalog({ status: 'loading', entries: [] })
    void authorization.list({}).then((response) => {
      if (stale) return
      if (!response.result.ok) {
        setAuthorizationCatalog({ status: 'unavailable', entries: [] })
        return
      }
      setAuthorizationCatalog({
        status: 'ready',
        entries: response.result.value.entries as unknown as AuthorizationEntry[],
      })
    }, () => {
      if (!stale) setAuthorizationCatalog({ status: 'unavailable', entries: [] })
    })
    return () => { stale = true }
  }, [authorization])

  const codexEntry = useMemo(
    () => authorizationCatalog.entries.find(isCodexEntry),
    [authorizationCatalog.entries],
  )
  const codexConnected = codexEntry === undefined ? false : authorizationConnected(codexEntry)
  const codexRow = state.rows.find(row => row.entry.provider === NATIVE_CODEX_PROVIDER)
  const defaultNamespace = state.namespaces.get(AGENT_DEFAULT_MODEL_NS)
  const defaultProvider = stringField(defaultNamespace?.value, 'provider')
  const codexReady = codexConnected
    && codexRow?.entry.active === true
    && defaultProvider === NATIVE_CODEX_PROVIDER

  // chatgpt-web is a loopback bridge whose keyless route may be mounted before
  // its external command is configured; it must not suppress first-run auth.
  const anotherProviderReady = state.rows.some(row =>
    row.entry.provider !== NATIVE_CODEX_PROVIDER
    && row.entry.provider !== LOOPBACK_CHATGPT_WEB_PROVIDER
    && providerUsable(row))

  const deepSeekRow = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  const deepSeekNamespace = state.namespaces.get('llm-deepseek')
  const apiFallbackAvailable = state.status === 'ready'
    && state.credentialError === null
    && state.writable
    && deepSeekRow !== undefined
    && deepSeekNamespace !== undefined
    && deepSeekRow.entry.active
    && deepSeekRow.apiKeyEnv !== undefined
    && deepSeekRow.credential !== undefined
    && !deepSeekRow.credential.configured
    && deepSeekRow.credential.writable

  /**
   * Turn a successful native account login into a complete PHOENIX model path:
   * materialize openai-codex, ask its live catalog, then persist the provider's
   * preferred first model as the default for new sessions.
   */
  const finishCodexSetup = useCallback(async (): Promise<void> => {
    setProvisioning(true)
    setProvisionFailure(undefined)
    try {
      let snapshot = controller.store.getSnapshot()
      let row = snapshot.rows.find(candidate => candidate.entry.provider === NATIVE_CODEX_PROVIDER)
      if (row === undefined) {
        throw new Error('PHOENIX did not expose the openai-codex provider route')
      }
      if (!snapshot.writable) throw new Error('PHOENIX model settings are read-only')

      if (!row.configured) {
        const namespace = snapshot.namespaces.get(row.entry.settingsNs)
        if (namespace === undefined) throw new Error('PHOENIX could not resolve Codex model settings')
        const activated = await api.settings.mutate({
          ns: row.entry.settingsNs,
          ops: [{ op: 'set', path: [...row.entry.settingsPath], value: {} }],
          expectedRevision: namespace.revision,
        })
        if (!activated.result.ok) throw new Error(activated.result.error.message)
        await controller.load()
        snapshot = controller.store.getSnapshot()
        row = snapshot.rows.find(candidate => candidate.entry.provider === NATIVE_CODEX_PROVIDER)
      }

      if (row?.entry.active !== true) {
        throw new Error('The openai-codex route did not become active after sign-in')
      }

      const catalog = await api.llm.models({})
      if (!catalog.result.ok) throw new Error(catalog.result.error.message)
      const group = catalog.result.value.groups.find(candidate => candidate.id === NATIVE_CODEX_PROVIDER)
      const preferred = group?.models[0]
      if (preferred === undefined) {
        const diagnostic = catalog.result.value.failures
          .find(candidate => candidate.id === NATIVE_CODEX_PROVIDER)?.message
        throw new Error(diagnostic ?? 'Codex returned no selectable models for this account')
      }

      snapshot = controller.store.getSnapshot()
      const defaults = snapshot.namespaces.get(AGENT_DEFAULT_MODEL_NS)
      if (defaults === undefined) {
        throw new Error('PHOENIX could not resolve its default-model settings')
      }
      const savedDefault = await api.settings.replace({
        ns: AGENT_DEFAULT_MODEL_NS,
        section: { provider: NATIVE_CODEX_PROVIDER, model: preferred.id },
        expectedRevision: defaults.revision,
      })
      if (!savedDefault.result.ok) throw new Error(savedDefault.result.error.message)

      // Presentation-only ordering: best effort. A stale profile revision must
      // never turn a working Codex login into a failed onboarding.
      const profile = snapshot.namespaces.get(USER_PROFILE_NS)
      const currentOrder = typeof profile?.value === 'object'
        && profile.value !== null
        && !Array.isArray(profile.value)
        && Array.isArray((profile.value as Record<string, unknown>).modelProviderOrder)
        ? (profile.value as { modelProviderOrder: unknown[] }).modelProviderOrder
          .filter((value): value is string => typeof value === 'string')
        : snapshot.rows.map(candidate => candidate.entry.provider)
      if (profile !== undefined) {
        const order = [
          NATIVE_CODEX_PROVIDER,
          ...currentOrder.filter(provider => provider !== NATIVE_CODEX_PROVIDER),
        ]
        await api.settings.mutate({
          ns: USER_PROFILE_NS,
          ops: [{ op: 'set', path: ['modelProviderOrder'], value: order }],
          expectedRevision: profile.revision,
        }).catch(() => undefined)
      }

      setProvisioning(false)
      complete()
    } catch (error) {
      setProvisionFailure(messageOf(error))
      setProvisioning(false)
    }
  }, [api.llm, api.settings, complete, controller])

  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } =
    useAuthorizationAttempt(authorization, () => {
      void finishCodexSetup()
    })

  const modelFactsSettled = state.status === 'ready' || state.status === 'error'

  useEffect(() => {
    if (!modelFactsSettled) return
    if (anotherProviderReady || codexReady) {
      complete()
      return
    }
    if (
      authorizationCatalog.status !== 'loading'
      && codexEntry === undefined
      && !apiFallbackAvailable
    ) {
      complete()
    }
  }, [
    anotherProviderReady,
    apiFallbackAvailable,
    authorizationCatalog.status,
    codexEntry,
    codexReady,
    complete,
    modelFactsSettled,
  ])

  if (!modelFactsSettled || authorizationCatalog.status === 'loading') return null
  if (anotherProviderReady || codexReady) return null

  const useApiFallback = showApiKey || codexEntry === undefined
  if (useApiFallback) {
    if (!apiFallbackAvailable || deepSeekRow === undefined || deepSeekNamespace === undefined) return null

    const finishCredential = (changed: boolean): void => {
      if (changed) {
        void controller.load()
        return
      }
      if (codexEntry !== undefined) {
        setShowApiKey(false)
        return
      }
      complete()
    }

    return (
      <OnboardingModal title={t('onboardingTitle')}>
        <p className={styles.description}>{t('onboardingDescription')}</p>
        <div className={styles.editor}>
          <ProviderEditor
            provider={deepSeekRow.entry.provider}
            displayName={deepSeekRow.entry.displayName}
            namespace={deepSeekNamespace}
            schema={schema}
            settingsPath={deepSeekRow.entry.settingsPath}
            api={api}
            t={t}
            readOnly={false}
            hideTitle
            credentialOnly
            credentialRequired
            autoFocusCredential
            cancelLabel={codexEntry === undefined ? 'onboardingLater' : 'onboardingBackToCodex'}
            submitLabel="onboardingSave"
            submitBusyLabel="onboardingSaving"
            onClose={finishCredential}
          />
        </div>
      </OnboardingModal>
    )
  }

  const pending = attempt?.status === 'pending'
  const busy = pending || provisioning || codexEntry.inFlight
  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.authorization}>
        <AuthorizationAttemptProgress
          attempt={attempt}
          answer={answer}
          setAnswer={setAnswer}
          submitAnswer={submitAnswer}
          cancel={cancel}
          t={t}
        />
        {failure === undefined ? null : <p className={modelStyles.error}>{failure}</p>}
        {provisionFailure === undefined ? null : <p className={modelStyles.error}>{provisionFailure}</p>}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={modelStyles.primaryButton}
          disabled={busy}
          onClick={() => { begin(codexEntry.key, 'oauth') }}
        >
          {provisioning ? t('onboardingFinishing') : pending ? t('signingIn') : t('onboardingCodex')}
        </button>
        {apiFallbackAvailable ? (
          <button
            type="button"
            className={modelStyles.secondaryButton}
            disabled={busy}
            onClick={() => { setShowApiKey(true) }}
          >
            {t('onboardingUseApiKey')}
          </button>
        ) : null}
        <button
          type="button"
          className={modelStyles.secondaryButton}
          disabled={busy}
          onClick={complete}
        >
          {t('onboardingLater')}
        </button>
      </div>
    </OnboardingModal>
  )
}
