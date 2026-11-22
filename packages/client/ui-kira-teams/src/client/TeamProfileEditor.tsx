import { useEffect, useState } from 'react'
import { createTeamPortrait, suggestTeamNames, type LivingTeamRpc } from './team-avatar-rpc.ts'
import {
  normalizeTeamPortrait, readTeamPortrait, resetTeamName, resetTeamPortrait,
  saveTeamNames, saveTeamPortrait, type LivingTeamKind,
} from './team-customization.ts'
import css from './TeamProfileEditor.module.css'

/** A user-controlled editor: Codex only proposes; nothing overwrites a portrait without approval. */
export function TeamProfileEditor({ kind, name, specialty, originalName, rpc }: {
  kind: LivingTeamKind; name: string; specialty: string; originalName: string; rpc: LivingTeamRpc
}) {
  const [draft, setDraft] = useState(name)
  const [style, setStyle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [candidate, setCandidate] = useState<Blob>()
  const [preview, setPreview] = useState<string>()
  useEffect(() => { setDraft(name); setCandidate(undefined); setError(''); setMessage('') }, [kind, name])
  useEffect(() => {
    if (candidate === undefined) { setPreview(undefined); return }
    const url = URL.createObjectURL(candidate)
    setPreview(url)
    return () => { URL.revokeObjectURL(url) }
  }, [candidate])
  const action = async (work: () => Promise<void>, success: string) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await work(); setMessage(success) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible modificar el perfil.') }
    finally { setBusy(false) }
  }
  const upload = (file: File | undefined) => {
    if (file === undefined) return
    void action(async () => {
      const normalized = await normalizeTeamPortrait(file)
      await saveTeamPortrait(kind, normalized)
      setCandidate(undefined)
    }, 'Retrato personalizado guardado en este dispositivo.')
  }
  const generate = (improve: boolean) => {
    void action(async () => {
      const original = improve ? await readTeamPortrait(kind) : undefined
      if (improve && original === undefined) throw new Error('Sube primero una imagen para mejorarla.')
      const result = await createTeamPortrait(rpc, {
        kind, name: draft.trim() || name, specialty, style,
        ...(original === undefined ? {} : { original }),
      })
      setCandidate(result)
    }, 'Imagen generada. Revísala y pulsa Guardar retrato.')
  }
  return <div className={css.editor} aria-label={'Personalizar ' + name} data-team-profile-editor>
    <label className={css.field}>Nombre visible
      <input value={draft} maxLength={48} disabled={busy}
        onChange={event => { setDraft(event.currentTarget.value) }} aria-label="Nombre del agente" />
    </label>
    <div className={css.actions}>
      <button disabled={busy || draft === name} type="button"
        onClick={() => { void action(() => saveTeamNames({ [kind]: draft }), 'Nombre actualizado.') }}>
        Guardar nombre
      </button>
      <button type="button" disabled={busy} onClick={() => { void action(async () => {
        await resetTeamName(kind); setDraft(originalName)
      }, 'Nombre original restaurado.') }}>Restaurar nombre</button>
      <button type="button" disabled={busy} onClick={() => { void action(async () => {
        const suggestions = await suggestTeamNames(rpc, [{ kind, name, specialty }], style)
        const suggested = suggestions[kind]
        if (suggested === undefined) throw new Error('No se propuso un nombre.')
        setDraft(suggested)
      }, 'Nombre propuesto por IA. Guárdalo si te gusta.') }}>Sugerir nombre con IA</button>
    </div>
    <label className={css.field}>Estilo o instrucciones para la IA (opcional)
      <input value={style} maxLength={180} disabled={busy}
        onChange={event => { setStyle(event.currentTarget.value) }}
        placeholder="Por ejemplo: futurista, cinematográfico, elegante" />
    </label>
    <label className={css.upload}>Subir avatar propio
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
        onChange={event => { upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
    </label>
    <div className={css.actions}>
      <button type="button" disabled={busy} onClick={() => { generate(false) }}>
        {busy ? 'Procesando…' : 'Generar imagen con IA'}
      </button>
      <button type="button" disabled={busy} onClick={() => { generate(true) }}>Mejorar mi imagen con IA</button>
      <button type="button" disabled={busy} onClick={() => { void action(
        () => resetTeamPortrait(kind), 'Retrato predeterminado restaurado.',
      ) }}>Restaurar avatar</button>
    </div>
    {candidate !== undefined && preview !== undefined && <div className={css.candidate}>
      <img src={preview} alt="Vista previa del retrato generado" />
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={() => { void action(async () => {
          await saveTeamPortrait(kind, await normalizeTeamPortrait(candidate)); setCandidate(undefined)
        }, 'Avatar generado guardado.') }}>Guardar retrato</button>
        <button type="button" disabled={busy} onClick={() => { setCandidate(undefined) }}>Descartar</button>
      </div>
    </div>}
    {error && <p role="alert" className={css.error}>{error}</p>}
    {message && <p role="status" className={css.message}>{message}</p>}
    <p className={css.hint}>Los nombres y retratos se conservan en este navegador. Las imágenes solo se envían a Codex cuando pulsas Generar o Mejorar. La identidad operativa de cada agente permanece intacta.</p>
  </div>
}

/** Bulk names are reviewed before a single atomic save. */
export function TeamBulkNames({ members, rpc }: {
  members: readonly { kind: LivingTeamKind; name: string; specialty: string }[]
  rpc: LivingTeamRpc
}) {
  const [direction, setDirection] = useState('')
  const [proposed, setProposed] = useState<Partial<Record<LivingTeamKind,string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className={css.bulk}>
    <strong>Personalizar nombres de todo el equipo con IA</strong>
    <input aria-label="Estilo de nombres del equipo" maxLength={180} value={direction}
      placeholder="Estilo opcional: científico, espacial, creativo…"
      onChange={event => { setDirection(event.currentTarget.value) }} disabled={busy} />
    <div className={css.actions}>
      <button type="button" disabled={busy} onClick={() => {
        setBusy(true); setError('')
        void suggestTeamNames(rpc, members, direction)
          .then(names => { setProposed(names) })
          .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'La IA no pudo proponer nombres.') })
          .finally(() => { setBusy(false) })
      }}>{busy ? 'Generando…' : 'Proponer 21 nombres'}</button>
      {Object.keys(proposed).length > 0 && <>
        <button type="button" disabled={busy} onClick={() => {
          setBusy(true); setError('')
          void saveTeamNames(proposed).then(() => { setProposed({}) })
            .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se guardaron los nombres.') })
            .finally(() => { setBusy(false) })
        }}>Aplicar los nombres</button>
        <button type="button" onClick={() => { setProposed({}) }}>Descartar</button>
      </>}
    </div>
    {Object.keys(proposed).length > 0 && <div className={css.proposals}>
      {members.map(member => <div key={member.kind}><span>{member.name}</span><strong>{proposed[member.kind] ?? member.name}</strong></div>)}
    </div>}
    {error && <p role="alert" className={css.error}>{error}</p>}
  </div>
}
