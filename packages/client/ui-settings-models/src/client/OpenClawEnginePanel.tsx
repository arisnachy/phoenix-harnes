import { useEffect, useState, type ReactNode } from 'react'
import type { OpenClawEngineConfig, OpenClawConversationSnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import type { McpRegistryClient } from './AuthorizationPanel.tsx'
import css from './ConnectorsSection.module.css'
import styles from './OpenClawEnginePanel.module.css'

/** Direct conversation surface: no Kira prompt, no fake connected state. */
export function OpenClawEnginePanel({ registry }: { registry?: McpRegistryClient | undefined }): ReactNode {
  const [state, setState] = useState<OpenClawConversationSnapshot | null>(null)
  const [draft, setDraft] = useState<OpenClawEngineConfig | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const load = registry?.openClawConversation
  useEffect(() => {
    if (!load) return
    let active = true
    const poll = () => { void load().then(value => {
      if (active) { setState(value); setDraft(old => old ?? value.config) }
    }, () => { if (active) setNotice('OpenClaw connection state unavailable') }) }
    poll()
    const timer = window.setInterval(poll, 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [load])
  if (!registry || !load || !state || !draft) return null
  const run = (action: (() => Promise<OpenClawConversationSnapshot>) | undefined, saved = false): void => {
    if (!action || busy) return
    setBusy(true); setNotice('')
    void action().then(value => { setState(value); if (saved) setDraft(value.config) },
      () => { setNotice('OpenClaw request rejected or not confirmed. Check Gateway and permissions.') })
      .finally(() => setBusy(false))
  }
  const running = state.phase === 'running'
  const disabled = busy || running
  const changed = draft.mode !== state.config.mode || draft.agent !== state.config.agent || draft.port !== state.config.port
  return (
    <section className={css.block} aria-label="PHOENIX Universal Bridge">
      <h3>PHOENIX Universal Bridge</h3>
      <label className={styles.field}>Engine
        <select value={draft.mode} disabled={disabled} onChange={event => {
          const mode = event.target.value as OpenClawEngineConfig['mode']
          setDraft({ ...draft, mode }); setNotice('')
        }}>
          <option value="native">PHOENIX Native — Kira</option>
          <option value="direct">OpenClaw — direct</option>
          <option value="hybrid">PHOENIX Hybrid — Kira + OpenClaw</option>
        </select>
      </label>
      {draft.mode !== 'native' && <>
        <label className={styles.field}>Dedicated OpenClaw agent ID
          <input value={draft.agent} disabled={disabled} onChange={event => setDraft({ ...draft, agent: event.target.value })} />
        </label>
        <label className={styles.field}>Local Gateway / SSH tunnel port
          <input type="number" min={1024} max={65535} value={draft.port} disabled={disabled}
            onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} />
        </label>
        <p className={css.safetyNote}>Use an agent with minimal permissions. Only explicit tasks are sent. Remote Gateways require an owner-managed SSH tunnel.</p>
      </>}
      <div className={css.toolbar}>
        <button type="button" className={css.compactButton} disabled={disabled || !changed || !registry.configureOpenClawEngine}
          onClick={() => run(() => registry.configureOpenClawEngine!(draft), true)}>Save engine</button>
        <button type="button" className={css.compactButton} disabled={disabled || changed || state.config.mode === 'native' || !registry.checkOpenClawEngine}
          onClick={() => {
            setBusy(true); setNotice('')
            void registry.checkOpenClawEngine!().then(result => setNotice(result.available ? 'Agent verified by Gateway' : 'Agent unavailable'),
              () => setNotice('Gateway verification failed')).finally(() => setBusy(false))
          }}>Verify connection</button>
      </div>
      {state.config.mode === 'hybrid' && <p className={css.safetyNote}>Restart PHOENIX to register hybrid tools; Kira can then delegate explicit tasks. Native PHOENIX stays active.</p>}
      {state.config.mode === 'direct' && <>
        <div className={styles.transcript} aria-live="polite">
          {state.messages.map((message, i) => <article key={i}>
            <strong>{message.role === 'user' ? 'You' : 'OpenClaw'}</strong>
            <p>{message.text}</p>
          </article>)}
          {running && <article><strong>OpenClaw</strong><p>{state.partial || 'Running…'}</p></article>}
        </div>
        {state.phase === 'failed' && <p role="alert">Connection or agent verification failed before submission. You can retry.</p>}
        {state.phase === 'unconfirmed' && <p role="alert">Previous run not confirmed. Inspect OpenClaw before retrying, or start a new thread.</p>}
        <textarea className={styles.input} aria-label="Message to OpenClaw" value={text} disabled={disabled || state.phase === 'unconfirmed'}
          onChange={event => setText(event.target.value)} />
        <div className={css.toolbar}>
          <button type="button" className={css.compactButton} disabled={disabled || changed || state.phase === 'unconfirmed' || !text.trim() || !registry.sendOpenClawConversation}
            onClick={() => { const message = text; run(async () => {
              const result = await registry.sendOpenClawConversation!({ thread: state.thread, text: message })
              setText(''); return result
            }) }}>Send to OpenClaw</button>
          <button type="button" className={css.compactButton} disabled={!running || busy || !registry.cancelOpenClawConversation}
            onClick={() => run(() => registry.cancelOpenClawConversation!())}>Cancel</button>
          <button type="button" className={css.compactButton} disabled={disabled || !registry.newOpenClawConversation}
            onClick={() => run(() => registry.newOpenClawConversation!())}>New thread</button>
        </div>
      </>}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
