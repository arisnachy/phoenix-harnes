import { useEffect, useRef, useState } from 'react'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import { Modal } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './MessageItem.module.css'

const CODEX_ACCOUNT_KEY = 'subagent-codex/account'
type AuthorizationApi = NonNullable<IApiClient['authorization']>
type Phase = 'idle' | 'preparing' | 'pending' | 'authorized' | 'failed'

/** Never open untrusted or local-file links returned by a provider. */
function consentUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '') return undefined
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href
  } catch {
    // Malformed provider URL: keep the user inside PHOENIX.
  }
  return undefined
}

/** Scope this recovery only to native Codex credential failures. */
export function isCodexAuthFailure(code: string | number | undefined, message: string): boolean {
  return (String(code ?? '') === 'MISSING_CREDENTIAL' && /codex|chatgpt session token/iu.test(message))
    || /Codex did not expose a usable ChatGPT session token/iu.test(message)
}

export function CodexAuthRecovery({ api, open, onClose }: {
  readonly api?: AuthorizationApi | undefined
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [attemptId, setAttemptId] = useState<string | undefined>()
  const [nextSeq, setNextSeq] = useState(0)
  const [url, setUrl] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [failure, setFailure] = useState<string | undefined>()
  const polling = useRef(false)

  useEffect(() => {
    if (!open || phase !== 'pending' || attemptId === undefined || api === undefined) return
    let active = true
    const timer = window.setInterval(() => {
      if (polling.current) return
      polling.current = true
      void api.status({ attemptId, after: nextSeq }).then(response => {
        if (!active) return
        if (!response.result.ok) {
          setFailure(response.result.error.message)
          setPhase('failed')
          return
        }
        const view = response.result.value
        setNextSeq(view.nextSeq)
        const latest = view.notices.at(-1)?.notice
        if (latest?.message !== undefined) setNotice(latest.message)
        const offered = view.notices.findLast(item => item.notice.url !== undefined)?.notice.url
        if (offered !== undefined) {
          const safe = consentUrl(offered)
          if (safe !== undefined) setUrl(safe)
          else {
            setFailure('Codex devolvió una dirección de autenticación no válida.')
            setPhase('failed')
            return
          }
        }
        if (view.status === 'authorized') setPhase('authorized')
        else if (view.status === 'failed' || view.status === 'cancelled') {
          setFailure(view.error ?? 'No se completó la autenticación de Codex.')
          setPhase('failed')
        }
      }, (error: unknown) => {
        if (!active) return
        setFailure(String(error))
        setPhase('failed')
      }).finally(() => { polling.current = false })
    }, 850)
    return () => { active = false; window.clearInterval(timer) }
  }, [api, attemptId, nextSeq, open, phase])

  const start = (): void => {
    if (api === undefined || phase === 'preparing' || phase === 'pending') return
    setPhase('preparing')
    setFailure(undefined)
    setUrl(undefined)
    setNotice(undefined)
    setAttemptId(undefined)
    setNextSeq(0)
    void api.begin({ key: CODEX_ACCOUNT_KEY, method: 'oauth' }).then(response => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        setPhase('failed')
        return
      }
      setAttemptId(response.result.value.attemptId)
      setPhase('pending')
    }, (error: unknown) => {
      setFailure(String(error))
      setPhase('failed')
    })
  }

  const cancel = (): void => {
    if (phase === 'pending' && api !== undefined && attemptId !== undefined) {
      void api.cancel({ attemptId }).catch(() => undefined)
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={cancel}
      title="Conectar ChatGPT con Codex"
      closeLabel="Cerrar"
      description="La sesión de Codex no permite completar este turno. Vuelve a autenticar tu cuenta con el inicio de sesión oficial."
    >
      <div className={css['codexAuthRecovery']}>
        <p>PHOENIX conservará la conversación. La contraseña y los tokens se gestionan directamente en Codex, nunca en el chat.</p>
        {api === undefined
          ? <p role="alert">El servicio de autenticación no está disponible. Abre Modelos → OpenAI Codex para conectarte.</p>
          : null}
        {notice === undefined ? null : <p role="status">{notice}</p>}
        {failure === undefined ? null : <p role="alert">{failure}</p>}
        {phase === 'authorized'
          ? <p role="status">Autenticación completada. Cierra esta ventana y reintenta el turno original.</p>
          : null}
        {url === undefined ? null : (
          <a href={url} target="_blank" rel="noopener noreferrer">Abrir la página oficial para iniciar sesión</a>
        )}
        {phase === 'pending' && url === undefined ? <p role="status">Preparando el enlace seguro de ChatGPT…</p> : null}
        <div className={css['codexAuthActions']}>
          {phase === 'authorized' ? null : (
            <button
              type="button"
              className={css['codexAuthButton']}
              disabled={api === undefined || phase === 'preparing' || phase === 'pending'}
              onClick={start}
            >
              {phase === 'preparing' || phase === 'pending' ? 'Conectando…' : 'Iniciar sesión con ChatGPT'}
            </button>
          )}
          <button type="button" className={css['codexAuthButton']} onClick={cancel}>
            {phase === 'authorized' ? 'Volver al chat' : 'Cerrar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
