/** Phoenix Team Studio settings section: AI-assisted, durable, 20-slot persona designer. */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import {
  DEFAULT_TEAM_DESIGN,
  TEAM_DESIGN_MEMBER_IDS,
  activeTeamDesign,
  normalizeTeamDesignDocument,
  parseTeamDesignDocument,
  type TeamDesign,
  type TeamDesignAvatarId,
  type TeamDesignDocument,
  type TeamDesignGender,
  type TeamDesignMotion,
  type TeamDesignPerson,
  type TeamDesignSettingsEnvelope,
} from '@phoenix-ai/dsh-agent-team/design-types'
import { ModelActivityAvatar, type ModelAvatarKind } from './ModelActivityAvatar.tsx'
import css from './TeamDesignerSection.module.css'

export interface TeamDesignerInjected {
  hooks: {
    teamDesign: SettingsScope<TeamDesignSettingsEnvelope>
  }
  save: (document: TeamDesignDocument) => Promise<void>
  generateWithKira: (prompt: string) => Promise<void>
}

export type TeamDesignerSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<TeamDesignerInjected>

type SelectedPerson = 'lead' | typeof TEAM_DESIGN_MEMBER_IDS[number]

const THEME_EXAMPLES = [
  'Superhéroes originales',
  'Aventura submarina',
  'Plataformas retro',
  'Equipo médico',
  'Studio de videojuegos',
  'Cyberpunk elegante',
  'Anime profesional',
  'Oficina futurista',
] as const

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
}

function personOf(team: TeamDesign, selected: SelectedPerson): TeamDesignPerson {
  if (selected === 'lead') return team.lead
  return team.members.find(member => member.id === selected)
    ?? DEFAULT_TEAM_DESIGN.members.find(member => member.id === selected)
    ?? team.lead
}

function replacePerson(team: TeamDesign, selected: SelectedPerson, person: TeamDesignPerson): TeamDesign {
  return selected === 'lead'
    ? { ...team, lead: person }
    : { ...team, members: team.members.map(member => member.id === selected ? person : member) }
}

function updateActive(document: TeamDesignDocument, team: TeamDesign): TeamDesignDocument {
  return normalizeTeamDesignDocument({
    ...document,
    activeTeamId: team.id,
    teams: document.teams.map(candidate => candidate.id === document.activeTeamId ? team : candidate),
  })
}

function uniqueTeamId(document: TeamDesignDocument, name: string): string {
  const base = slug(name) || 'equipo'
  const used = new Set(document.teams.map(team => team.id))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function PersonCard({ person, selected, onClick, isLead = false }: {
  person: TeamDesignPerson
  selected: boolean
  onClick: () => void
  isLead?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      className={selected ? `${css.personCard} ${css.personSelected}` : css.personCard}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className={css.avatarShell}>
        <ModelActivityAvatar
          kind={person.avatar as ModelAvatarKind}
          activity={selected ? { provider: 'phoenix', model: 'team-studio', phase: 'verifying' } : undefined}
          running={selected}
          pending={false}
          ready={!selected}
        />
      </span>
      <span className={css.personText}>
        <strong>{person.displayName}</strong>
        <small>{isLead ? 'Líder · ' : ''}{person.role}</small>
      </span>
      <span className={person.enabled ? css.dotOn : css.dotOff} aria-hidden="true" />
    </button>
  )
}

/** Full user-facing Team Studio. Runtime ids remain invisible and immutable. */
export function TeamDesignerSection(props: TeamDesignerSectionProps): ReactNode {
  const snapshot = props.useTeamDesign(value => value)
  const document = useMemo(
    () => parseTeamDesignDocument(snapshot.value?.document),
    [snapshot.value?.document],
  )
  const team = activeTeamDesign(document)
  const [selected, setSelected] = useState<SelectedPerson>('lead')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const person = personOf(team, selected)

  const saveTeam = (next: TeamDesign): void => {
    setError(undefined)
    void props.save(updateActive(document, next)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  const patchPerson = (patch: Partial<TeamDesignPerson>): void => {
    saveTeam(replacePerson(team, selected, { ...person, ...patch }))
  }

  const chooseTeam = (id: string): void => {
    setSelected('lead')
    void props.save({ ...document, activeTeamId: id }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const createTeam = (): void => {
    const id = uniqueTeamId(document, 'Nuevo equipo')
    const copy: TeamDesign = {
      ...DEFAULT_TEAM_DESIGN,
      id,
      name: 'Nuevo equipo',
      lead: { ...DEFAULT_TEAM_DESIGN.lead },
      members: DEFAULT_TEAM_DESIGN.members.map(member => ({ ...member })),
    }
    setSelected('lead')
    void props.save(normalizeTeamDesignDocument({
      ...document,
      activeTeamId: id,
      teams: [...document.teams, copy],
    })).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }

  const duplicateTeam = (): void => {
    const id = uniqueTeamId(document, `${team.name} copia`)
    const copy: TeamDesign = {
      ...team,
      id,
      name: `${team.name} copia`,
      lead: { ...team.lead },
      members: team.members.map(member => ({ ...member })),
    }
    setSelected('lead')
    void props.save(normalizeTeamDesignDocument({
      ...document,
      activeTeamId: id,
      teams: [...document.teams, copy],
    })).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }

  const removeTeam = (): void => {
    if (document.teams.length <= 1) return
    const teams = document.teams.filter(candidate => candidate.id !== team.id)
    const first = teams[0]
    if (first === undefined) return
    setSelected('lead')
    void props.save({ version: 1, activeTeamId: first.id, teams }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const generate = async (): Promise<void> => {
    const request = prompt.trim()
    if (request === '') {
      setError('Describe primero cómo quieres que sea tu equipo.')
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      await props.generateWithKira(request)
      props.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (snapshot.status === 'unavailable') {
    return <div className={css.section}><p className={css.error}>Team Studio necesita la configuración local de Phoenix.</p></div>
  }

  return (
    <div className={css.section} data-team-studio data-motion={team.motion}>
      <header className={css.header}>
        <div>
          <span className={css.eyebrow}>PHOENIX · TEAM STUDIO</span>
          <h2>Crea tu equipo</h2>
          <p>Diseña a tu líder y a los 20 especialistas. Nombres, personalidad, sexo/identidad, voz y avatar pueden cambiar; la arquitectura interna no.</p>
        </div>
        <div className={css.headerBadge}>20 especialistas + líder</div>
      </header>

      <section className={css.aiPanel}>
        <div className={css.aiTitle}>
          <div><strong>✨ Diseñar con Kira</strong><span>Describe una idea y Kira construirá el equipo completo con IA.</span></div>
          <span className={css.safeLabel}>IDs técnicos protegidos</span>
        </div>
        <textarea
          className={css.prompt}
          value={prompt}
          rows={3}
          placeholder="Ej.: Quiero un equipo inspirado en superhéroes, elegante y profesional; líder femenina fuerte, ingeniería brillante, diseño creativo y QA implacable."
          onChange={event => { setPrompt(event.target.value) }}
        />
        <div className={css.aiActions}>
          <div className={css.examples}>
            {THEME_EXAMPLES.map(example => (
              <button key={example} type="button" onClick={() => { setPrompt(example) }}>{example}</button>
            ))}
          </div>
          <button className={css.primary} type="button" disabled={busy} onClick={() => { void generate() }}>
            {busy ? 'Enviando…' : '✨ Generar con IA'}
          </button>
        </div>
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </section>

      <section className={css.teamSwitcher}>
        <div className={css.sectionTitle}><strong>Mis equipos</strong><span>{document.teams.length}/12</span></div>
        <div className={css.teamTabs}>
          {document.teams.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === team.id ? css.teamTabActive : css.teamTab}
              onClick={() => { chooseTeam(candidate.id) }}
            >
              <strong>{candidate.name}</strong>
              <small>{candidate.members.filter(member => member.enabled).length} activos</small>
            </button>
          ))}
          <button type="button" className={css.addTeam} disabled={document.teams.length >= 12} onClick={createTeam}>＋ Nuevo equipo</button>
        </div>
      </section>

      <div className={css.workspace}>
        <main className={css.rosterPanel}>
          <div className={css.rosterHead}>
            <div>
              <input
                key={`${team.id}:${team.name}`}
                className={css.teamName}
                defaultValue={team.name}
                aria-label="Nombre del equipo"
                onBlur={event => {
                  const name = event.currentTarget.value.trim()
                  if (name !== '' && name !== team.name) saveTeam({ ...team, name })
                }}
              />
              <span>{team.members.filter(member => member.enabled).length} de 20 especialistas disponibles</span>
            </div>
            <div className={css.rosterActions}>
              <button type="button" onClick={duplicateTeam}>Duplicar</button>
              <button type="button" disabled={document.teams.length <= 1} onClick={removeTeam}>Eliminar</button>
            </div>
          </div>

          <div className={css.leadRow}>
            <PersonCard person={team.lead} selected={selected === 'lead'} isLead onClick={() => { setSelected('lead') }} />
            <div className={css.motion}>
              <span>Avatar vivo</span>
              {(['subtle', 'normal', 'expressive'] as TeamDesignMotion[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={team.motion === mode}
                  className={team.motion === mode ? css.motionActive : undefined}
                  onClick={() => { saveTeam({ ...team, motion: mode }) }}
                >{mode === 'subtle' ? 'Suave' : mode === 'normal' ? 'Normal' : 'Expresivo'}</button>
              ))}
            </div>
          </div>

          <div className={css.grid} aria-label="20 especialistas del equipo">
            {team.members.map(member => (
              <PersonCard
                key={member.id}
                person={member}
                selected={selected === member.id}
                onClick={() => { setSelected(member.id as SelectedPerson) }}
              />
            ))}
          </div>
        </main>

        <aside className={css.editor}>
          <div className={css.preview}>
            <ModelActivityAvatar
              kind={person.avatar as ModelAvatarKind}
              activity={{ provider: 'phoenix', model: 'team-studio', phase: 'running-tools' }}
              running
              pending={false}
            />
            <div><strong>{person.displayName}</strong><span>{person.role}</span></div>
          </div>

          <label className={css.field}>
            <span>Nombre visible</span>
            <input
              key={`${team.id}:${selected}:name:${person.displayName}`}
              defaultValue={person.displayName}
              onBlur={event => {
                const displayName = event.currentTarget.value.trim()
                if (displayName !== '' && displayName !== person.displayName) patchPerson({ displayName })
              }}
            />
          </label>

          <label className={css.field}>
            <span>Rol</span>
            <input
              key={`${team.id}:${selected}:role:${person.role}`}
              defaultValue={person.role}
              onBlur={event => {
                const role = event.currentTarget.value.trim()
                if (role !== '' && role !== person.role) patchPerson({ role })
              }}
            />
          </label>

          <label className={css.field}>
            <span>Sexo / identidad</span>
            <select value={person.gender} onChange={event => { patchPerson({ gender: event.target.value as TeamDesignGender }) }}>
              <option value="female">Femenino</option>
              <option value="male">Masculino</option>
              <option value="neutral">Neutral / no especificado</option>
            </select>
          </label>

          <label className={css.field}>
            <span>Personalidad</span>
            <textarea
              key={`${team.id}:${selected}:personality:${person.personality}`}
              defaultValue={person.personality}
              rows={4}
              onBlur={event => {
                const personality = event.currentTarget.value.trim()
                if (personality !== '' && personality !== person.personality) patchPerson({ personality })
              }}
            />
          </label>

          <label className={css.field}>
            <span>Voz / estilo hablado</span>
            <input
              key={`${team.id}:${selected}:voice:${person.voice}`}
              defaultValue={person.voice}
              onBlur={event => {
                const voice = event.currentTarget.value.trim()
                if (voice !== '' && voice !== person.voice) patchPerson({ voice })
              }}
            />
          </label>

          <div className={css.field}>
            <span>Avatar</span>
            <div className={css.avatarPicker}>
              {(['kira', ...TEAM_DESIGN_MEMBER_IDS] as TeamDesignAvatarId[]).map(avatar => (
                <button
                  key={avatar}
                  type="button"
                  className={avatar === person.avatar ? css.avatarChoiceActive : css.avatarChoice}
                  aria-label={avatar}
                  title={avatar}
                  onClick={() => { patchPerson({ avatar }) }}
                >
                  <ModelActivityAvatar kind={avatar as ModelAvatarKind} activity={undefined} running={false} pending={false} ready />
                </button>
              ))}
            </div>
            <p className={css.hint}>Los retratos incluidos son ligeros y reactivos. Kira puede usar el generador de imágenes de Phoenix desde el chat para crear arte nuevo cuando lo pidas.</p>
          </div>

          {selected === 'lead' ? null : (
            <label className={css.enabledRow}>
              <input type="checkbox" checked={person.enabled} onChange={event => { patchPerson({ enabled: event.target.checked }) }} />
              <span>Disponible para este equipo</span>
            </label>
          )}
        </aside>
      </div>
    </div>
  )
}
