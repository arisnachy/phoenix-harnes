// Hero chrome for the blank-draft phase of ConversationRoot: intelligent
// greeting, Phoenix brand mark, glow backdrop, and the workspace row. Pure
// presentation — the resident composer is NOT rendered here (it keeps its own
// stable tree position in ConversationRoot so the textarea survives the hero
// → composer flip); CSS positions it over this shell's glow area during the
// hero phase.

import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconFolderClose16, IconFolderOpen16,
  IconSparkle16, IconWarningOutline16, PhoenixLogo,
} from '@phoenix-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@phoenix-ai/dsh-client-runtime/client'
import type { ConversationSlotProps, ProactivityAttentionItem } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Resolve Phoenix's Spanish time-of-day greeting.
 * @param hour - local hour in 24-hour form.
 * @returns the greeting shown above the new-session composer.
 */
export function greetingForHour(hour: number): 'Buenos días' | 'Buenas tardes' | 'Buenas noches' {
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Normalize the user-owned preferred name for hero presentation. */
export function preferredNameForHero(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === '' ? undefined : normalized
}

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/**
 * The soft warm-neutral backdrop ellipse. Rendered by the hero owner
 * (ConversationRoot), not HeroShell, so it can center on the input card; the
 * owner's className supplies all positioning.
 * @param props.className - positioning class from the owner.
 * @returns the blurred-ellipse svg element.
 */
export function HeroGlow({ className }: { className?: string | undefined }) {
  // Stable filter id so multiple hero mounts do not collide in the DOM.
  const glowFilterId = `empty-glow-${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 1051 468" fill="none" aria-hidden="true">
      <defs>
        <filter
          id={glowFilterId}
          x="0"
          y="0"
          width="1051"
          height="468"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <g filter={`url(#${glowFilterId})`}>
        <ellipse cx="525.5" cy="234" rx="425.5" ry="134" fill="#E46A2A" fillOpacity="0.026" />
      </g>
    </svg>
  )
}

/** Resolve concise fallback copy without exposing internal task mechanics. */
export function heroAttentionDetail(item: ProactivityAttentionItem): string {
  if (item.detail !== undefined && item.detail.trim().length > 0) return item.detail.trim()
  if (item.kind === 'failure') return 'Phoenix no pudo completar esta tarea.'
  if (item.kind === 'upcoming') return 'Se acerca esta tarea.'
  return 'Hay un resultado nuevo.'
}

/** Build the draft that opens one proactive signal into a normal Phoenix conversation. */
export function heroAttentionPrompt(item: ProactivityAttentionItem): string {
  const detail = heroAttentionDetail(item)
  if (item.kind === 'failure') {
    return `Revisa este asunto proactivo de Phoenix: ${item.title}. ${detail} Encuentra la causa y ayúdame a resolverlo.`
  }
  if (item.kind === 'upcoming') {
    return `Ayúdame a preparar este asunto que se aproxima: ${item.title}. ${detail}`
  }
  return `Explícame este resultado proactivo de Phoenix y dime qué requiere mi atención: ${item.title}. ${detail}`
}

/** Quiet, actionable attention feed rendered below the Hero composer. */
export function HeroAttentionList({
  attention,
  onSelect,
  onDismiss,
}: {
  attention: readonly ProactivityAttentionItem[]
  onSelect?: (item: ProactivityAttentionItem) => void
  onDismiss?: (item: ProactivityAttentionItem) => void
}) {
  if (attention.length === 0) return null
  return (
    <div className={css.attention} aria-label="Atención proactiva de Phoenix">
      {attention.slice(0, 3).map(item => (
        <div className={css.attentionEntry} key={item.id}>
          <button
            type="button"
            className={css.attentionRow}
            onClick={() => { onSelect?.(item) }}
          >
            <span className={css.attentionIconWrap} aria-hidden="true">
              {item.kind === 'failure'
                ? <IconWarningOutline16 className={css.attentionIcon} size={16} />
                : <IconSparkle16 className={css.attentionIcon} size={16} />}
            </span>
            <span className={css.attentionCopy}>
              <span className={css.attentionTitle}>{item.title}</span>
              <span className={css.attentionDetail}>{heroAttentionDetail(item)}</span>
            </span>
            <IconChevronRightOutline14 className={css.attentionArrow} size={14} />
          </button>
          {onDismiss === undefined ? null : <button type="button" className={css.attentionDismiss} aria-label={`Descartar ${item.title}`} onClick={() => { onDismiss(item) }}>×</button>}
        </div>
      ))}
    </div>
  )
}


/** Visual glyphs follow the reference without importing a new icon system. */
const iconFrame = { width: 24, height: 24, viewBox: '0 0 24 24', stroke: 'currentColor', fill: 'none',
  strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** Preset prompts fill the existing composer; they never send a turn by themselves. */
const HERO_STARTERS = [
  { title: 'Crear', description: 'Documentos, gráficos, apps', kind: 'create',
    prompt: 'Ayúdame a crear un proyecto. Primero pregúntame qué necesito y propón un plan claro.',
    icon: <svg {...iconFrame}><path d="m4 20 4.7-.9L20 7.8a2.4 2.4 0 0 0-3.4-3.4L5.4 15.6 4 20Z" /><path d="m14 7 3 3" /></svg> },
  { title: 'Analizar', description: 'Datos, informes, tendencias', kind: 'analyze',
    prompt: 'Quiero analizar datos. Ayúdame a preparar un análisis riguroso y visual.',
    icon: <svg {...iconFrame}><path d="M4 20V12m5 8V6m5 14v-9m5 9V3" /><path d="M2 20h20" /></svg> },
  { title: 'Automatizar', description: 'Tareas y flujos de trabajo', kind: 'automate',
    prompt: 'Quiero automatizar una tarea en Phoenix. Diseña un flujo verificable y eficiente.',
    icon: <svg {...iconFrame}><path d="m13 2-9 11h7l-1 9 10-12h-7l0-8Z" /></svg> },
  { title: 'Investigar', description: 'Información en la web', kind: 'research',
    prompt: 'Quiero investigar un tema. Ayúdame a definir las preguntas, fuentes y método.',
    icon: <svg {...iconFrame}><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg> },
  { title: 'Programar', description: 'Código, apps, integraciones', kind: 'code',
    prompt: 'Quiero desarrollar software. Ayúdame a definir los requisitos y a implementarlo.',
    icon: <svg {...iconFrame}><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" /></svg> },
  { title: 'Usar herramientas', description: 'Conectores, archivos, MCP', kind: 'tools',
    prompt: 'Ayúdame a realizar una tarea usando las herramientas y conectores disponibles en Phoenix.',
    icon: <svg {...iconFrame}><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" /><path d="m3 7 9 5 9-5m-9 5v10" /></svg> },
] as const

const HERO_SUGGESTIONS = [
  { label: 'Dame una gráfica de datos ficticios', icon: '⌁',
    prompt: 'Crea una gráfica de líneas con datos ficticios y explícame lo que muestra.' },
  { label: 'Resume este PDF', icon: '▤', prompt: 'Quiero resumir un PDF. Pídeme el archivo y extrae los puntos clave.' },
  { label: 'Crea una imagen', icon: '▧', prompt: 'Ayúdame a crear una imagen con una descripción que vamos a definir.' },
  { label: 'Escribe un script de Python', icon: '</>',
    prompt: 'Ayúdame a crear un script de Python. Primero definamos qué debe resolver.' },
] as const

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, retained for the workspace chip contract. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /** Durable preferred name from the current user's Profile settings. */
  preferredName?: string | undefined
  /** Add the chosen starting prompt to the resident composer. */
  onStarter?: (prompt: string) => void
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render Phoenix's new-session welcome without moving the workspace row or
 * composer. Only the brand/greeting block changes; the folders and input keep
 * their existing tree positions.
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ renderSlot, preferredName, onStarter, children }: HeroShellProps) {
  const greeting = greetingForHour(new Date().getHours())
  const displayName = preferredNameForHero(preferredName)

  return (
    <div className={css.root}>
      <div className={css.stack}>
        <span className={css.fishHitbox} aria-hidden="true">
          {renderSlot('conversation.hero.brand.mark', { size: 64, className: css.fish }, {
            fallback: <PhoenixLogo size={64} {...(css.fish === undefined ? {} : { className: css.fish })} />,
          })}
        </span>
        <h1 className={css.headline}>
          <span>{greeting}</span>
          {displayName === undefined ? null : (
            <>
              <span>{',\u00A0'}</span>
              <span className={css.preferredName}>{displayName}</span>
            </>
          )}
        </h1>
        <p className={css.subtitle}>¿Qué quieres construir hoy en Phoenix?</p>
        <div className={css.starterGrid} aria-label="Acciones rápidas de Phoenix">
          {HERO_STARTERS.map(starter => (
            <button
              key={starter.kind}
              type="button"
              className={css.starterCard}
              aria-label={starter.title}
              onClick={() => { onStarter?.(starter.prompt) }}
            >
              <span className={css.starterIcon} data-tone={starter.kind} aria-hidden="true">{starter.icon}</span>
              <span className={css.starterCopy}>
                <strong className={css.starterTitle}>{starter.title}</strong>
                <span className={css.starterDescription}>{starter.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={css.suggestions}>
          <span className={css.suggestionHeading}>Sugerencias</span>
          <div className={css.suggestionList}>
            {HERO_SUGGESTIONS.map(suggestion => (
              <button
                key={suggestion.label}
                type="button"
                className={css.suggestion}
                onClick={() => { onStarter?.(suggestion.prompt) }}
              >
                <span className={css.suggestionIcon} aria-hidden="true">{suggestion.icon}</span>
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
