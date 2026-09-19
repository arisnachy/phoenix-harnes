/**
 * Codex-first first-run onboarding with a separate API-provider fallback.
 *
 * The first screen prefers the official ChatGPT / Codex app-server account
 * lifecycle. That subscription session is deliberately kept separate from
 * PHOENIX API-provider credentials: connecting Codex must never be treated as
 * if it had produced an OpenAI API key. A user may configure a chat provider
 * next, or defer that choice without blocking the application shell.
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

const NATIVE_CODEX_AUTH_KEY = 'subagent-codex/account'
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

function codexConnected(entry: AuthorizationEntry | undefined): boolean {
  if (entry === undefined) return false
  return entry.stored !== undefined
    || entry.telemetry?.provider?.toLowerCase() === 'codex'
}

/**
 * First-run ordering:
 * 1. Connect the official Codex account when that native bridge is installed.
 * 2. Keep API-provider configuration a clearly separate optional step.
 * 3. Never synthesize an API credential or select openai-codex merely because
 *    the native account is connected.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, api, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const authorization = api.authorization
  const [showApiKey, setShowApiKey] = useState(false)
  const [connectedThisRun, setConnectedThisRun] = useState(false)
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
  const accountReady = connectedThisRun || codexConnected(codexEntry)

  // chatgpt-web is only a loopback declaration until its external bridge is
  // installed and authenticated, so it must not suppress first-run setup.
  const anotherProviderReady = state.rows.some(row =>
    row.entry.provider !== LOOPBACK_CHATGPT_WEB_PROVIDER
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

  const { attempt, answer, setAnswer, failure, begin, submitAnswer, cancel } =
    useAuthorizationAttempt(authorization, () => {
      setConnectedThisRun(true)
    })

  const modelFactsSettled = state.status === 'ready' || state.status === 'error'

  useEffect(() => {
    if (!modelFactsSettled) return
    // A confirmed chat provider means this installation is already usable; do
    // not force account onboarding on an existing configured user.
    if (anotherProviderReady) {
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
    complete,
    modelFactsSettled,
  ])

  if (!modelFactsSettled || authorizationCatalog.status === 'loading') return null
  if (anotherProviderReady) return null

  const useApiFallback = showApiKey || codexEntry === undefined
  if (useApiFallback) {
    if (!apiFallbackAvailable || deepSeekRow === undefined || deepSeekNamespace === undefined) {
      return accountReady
        ? (
          <OnboardingModal title={t('onboardingTitle')}>
            <p className={styles.description}>{t('onboardingCodexConnected')}</p>
            <p className={styles.description}>{t('onboardingChooseChatProvider')}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={modelStyles.primaryButton}
                onClick={complete}
              >
                {t('onboardingLater')}
              </button>
            </div>
          </OnboardingModal>
        )
        : null
    }

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
        <p className={styles.description}>{t('onboardingApiDescription')}</p>
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

  if (accountReady) {
    return (
      <OnboardingModal title={t('onboardingTitle')}>
        <p className={styles.description}>{t('onboardingCodexConnected')}</p>
        <p className={styles.description}>{t('onboardingChooseChatProvider')}</p>
        <div className={styles.actions}>
          {apiFallbackAvailable ? (
            <button
              type="button"
              className={modelStyles.primaryButton}
              onClick={() => { setShowApiKey(true) }}
            >
              {t('onboardingUseApiKey')}
            </button>
          ) : null}
          <button
            type="button"
            className={modelStyles.secondaryButton}
            onClick={complete}
          >
            {t('onboardingLater')}
          </button>
        </div>
      </OnboardingModal>
    )
  }

  if (codexEntry === undefined) return null

  const pending = attempt?.status === 'pending'
  const busy = pending || codexEntry.inFlight
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
          disabled={busy}
          onClick={() => { begin(codexEntry.key, 'oauth') }}
        >
          {pending ? t('signingIn') : t('onboardingCodex')}
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
