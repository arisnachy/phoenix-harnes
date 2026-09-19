/**
 * Codex-first product onboarding with a safe provider-key fallback.
 *
 * First run prefers the native ChatGPT / Codex authorization plane because it
 * reuses the user's Codex-managed session, model catalog, refresh lifecycle,
 * quota telemetry, and connectors without asking PHOENIX to store OAuth
 * secrets. The existing DeepSeek key editor remains available as a fallback so
 * installations without the native Codex bridge never become blocked.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { providerUsable } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import {
  AuthorizationAttemptProgress,
  useAuthorizationAttempt,
} from './authorization-attempt.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import modelStyles from './ModelsSection.module.css'
import styles from './DeepSeekOnboardingDialog.module.css'

const CODEX_ACCOUNT_AUTH_KEY = 'subagent-codex/account'

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
  /** Existing wire faces reused by the credential editor and native account login. */
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
  if (entry.key === CODEX_ACCOUNT_AUTH_KEY) return true
  const identity = `${entry.label} ${entry.telemetry?.provider ?? ''}`.toLowerCase()
  return identity.includes('codex') || identity.includes('chatgpt')
}

function isCodexConnected(entry: AuthorizationEntry | undefined): boolean {
  if (entry === undefined) return false
  return entry.stored !== undefined
    || entry.telemetry?.provider?.toLowerCase() === 'codex'
}

/**
 * Prefer native ChatGPT / Codex authorization on first run. A user who already
 * has any other usable model provider skips onboarding; installations without
 * the Codex account flow fall back to the existing official DeepSeek key editor.
 *
 * @param props - settings-shell owner state plus Models/authorization dependencies.
 * @returns the onboarding modal or null when no intervention is needed.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, api, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const authorization = api.authorization
  const [showApiKey, setShowApiKey] = useState(false)
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
  const codexConnected = isCodexConnected(codexEntry)
  const anotherProviderReady = state.rows.some(row =>
    row.entry.provider !== 'openai-codex' && providerUsable(row))

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

  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } =
    useAuthorizationAttempt(authorization, () => {
      complete()
      void controller.load()
    })

  const modelFactsSettled = state.status === 'ready' || state.status === 'error'

  useEffect(() => {
    if (!modelFactsSettled) return
    if (anotherProviderReady || codexConnected) {
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
    codexConnected,
    codexEntry,
    complete,
    modelFactsSettled,
  ])

  if (!modelFactsSettled || authorizationCatalog.status === 'loading') return null
  if (anotherProviderReady || codexConnected) return null

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
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={modelStyles.primaryButton}
          disabled={pending || codexEntry.inFlight}
          onClick={() => { begin(codexEntry.key, 'oauth') }}
        >
          {pending ? t('signingIn') : t('onboardingCodex')}
        </button>
        {apiFallbackAvailable ? (
          <button
            type="button"
            className={modelStyles.secondaryButton}
            disabled={pending}
            onClick={() => { setShowApiKey(true) }}
          >
            {t('onboardingUseApiKey')}
          </button>
        ) : null}
        <button
          type="button"
          className={modelStyles.secondaryButton}
          disabled={pending}
          onClick={complete}
        >
          {t('onboardingLater')}
        </button>
      </div>
    </OnboardingModal>
  )
}
