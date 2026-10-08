// Hero chrome for the blank-draft phase of ConversationRoot: intelligent
// greeting, Phoenix brand mark, glow backdrop, and the workspace row. Pure
// presentation — the resident composer is NOT rendered here (it keeps its own
// stable tree position in ConversationRoot so the textarea survives the hero
// → composer flip); CSS positions it over this shell's glow area during the
// hero phase.

import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconFolderClose16, IconFolderOpen16, IconSparkle16,
  IconWarningOutline16, PhoenixLogo,
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

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, retained for the workspace chip contract. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /** Durable preferred name from the current user's Profile settings. */
  preferredName?: string | undefined
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/** A small, deliberate set of composer prompts. Every card is an actual draft action. */
export const HERO_QUICK_ACTIONS = [
  { id: 'file', title: 'Analizar un archivo', detail: 'Resume, extrae y analiza', tone: 'peach', prompt: 'Analiza el archivo que voy a adjuntar. Extrae sus ideas principales y entrega un resumen estructurado.' },
  { id: 'chart', title: 'Crear una gráfica', detail: 'Visualiza tus datos', tone: 'blue', prompt: 'Crea una gráfica interactiva a partir de mis datos. Ayúdame a elegir la visualización adecuada.' },
  { id: 'code', title: 'Revisar código', detail: 'Obtén sugerencias', tone: 'violet', prompt: 'Revisa el código que voy a compartir. Detecta errores, explica los riesgos y propone mejoras concretas.' },
  { id: 'link', title: 'Conectar un MCP', detail: 'Integra tus herramientas', tone: 'green', prompt: 'Ayúdame a conectar y comprobar un servidor MCP en Phoenix, paso a paso.' },
  { id: 'mail', title: 'Redactar correo', detail: 'Escribe y mejora textos', tone: 'amber', prompt: 'Ayúdame a redactar un correo profesional. Pregúntame por el destinatario y el propósito.' },
] as const

export const HERO_CAPABILITIES = [
  { id: 'chat', title: 'Chat inteligente', detail: 'Investiga, analiza y crea con tu equipo de IA.', tone: 'peach', prompt: 'Ayúdame a investigar y desarrollar una idea con mi equipo de IA.' },
  { id: 'bolt', title: 'Automatización', detail: 'Convierte ideas en flujos de trabajo.', tone: 'amber', prompt: 'Diseña un flujo de automatización para una tarea repetitiva. Primero identifica los pasos necesarios.' },
  { id: 'database', title: 'Conectores', detail: 'Integra herramientas y fuentes de datos.', tone: 'blue', prompt: 'Revisa las integraciones disponibles en Phoenix y ayúdame a configurar la que necesito.' },
  { id: 'check', title: 'Tareas', detail: 'Planifica, ejecuta y da seguimiento.', tone: 'green', prompt: 'Ayúdame a planificar una tarea, ejecutarla y verificar su resultado.' },
] as const

type HeroIconName = (typeof HERO_QUICK_ACTIONS)[number]['id'] | (typeof HERO_CAPABILITIES)[number]['id']

/** Icons are presentation-only; the native buttons and draft owner handle interaction. */
function HeroActionIcon({ name }: { name: HeroIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'file' && <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>}
      {name === 'chart' && <><path d="M4 20h16M6 17v-5h3v5M11 17V6h3v11M16 17V9h3v8" /></>}
      {name === 'code' && <><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" /></>}
      {name === 'link' && <><path d="M10 13a5 5 0 0 0 7 .3l2-2a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.3l-2 2a5 5 0 0 0 7 7l2-2" /></>}
      {name === 'mail' && <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>}
      {name === 'chat' && <><path d="M20 11a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L4 20l1.9-4A8 8 0 1 1 20 11Z" /><path d="M8 11h8" /></>}
      {name === 'bolt' && <path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z" />}
      {name === 'database' && <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>}
      {name === 'check' && <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>}
    </svg>
  )
}

/**
 * Render the empty-session welcome, retaining the existing brand slot and
 * resident composer. Quick actions only prepare editable drafts through the
 * parent-owned input machine; they do not create sessions or execute tools.
 */
export function HeroShell({ renderSlot, preferredName, onShortcut, children }: HeroShellProps & {
  onShortcut?: (prompt: string) => void
}) {
  const greeting = greetingForHour(new Date().getHours())
  const displayName = preferredNameForHero(preferredName)

  return (
    <div className={css.root}>
      <svg className={css.scenery} viewBox="0 0 1280 290" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 195 Q115 159 219 188 T453 155 T675 190 T906 135 T1280 171 V290 H0Z" fill="currentColor" opacity=".13" />
        <path d="M0 231 Q135 186 276 211 T582 199 T898 215 T1280 182 V290 H0Z" fill="currentColor" opacity=".095" />
        <path d="M0 257 Q160 219 322 242 T664 230 T972 242 T1280 220 V290 H0Z" fill="currentColor" opacity=".075" />
      </svg>
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
        <nav className={css.quickActions} aria-label="Accesos rápidos de Phoenix">
          {HERO_QUICK_ACTIONS.map(action => (
            <button type="button" key={action.id} className={css.quickCard} data-tone={action.tone} disabled={onShortcut === undefined} onClick={() => { onShortcut?.(action.prompt) }}>
              <span className={css.quickIcon}><HeroActionIcon name={action.id} /></span>
              <span className={css.actionText}><strong>{action.title}</strong><small>{action.detail}</small></span>
            </button>
          ))}
        </nav>
        <section className={css.featureActions} aria-label="Qué puedes hacer con Phoenix">
          {HERO_CAPABILITIES.map(action => (
            <button type="button" key={action.id} className={css.featureCard} data-tone={action.tone} disabled={onShortcut === undefined} onClick={() => { onShortcut?.(action.prompt) }}>
              <span className={css.featureIcon}><HeroActionIcon name={action.id} /></span>
              <span className={css.actionText}><strong>{action.title}</strong><small>{action.detail}</small></span>
            </button>
          ))}
        </section>
      </div>
      {children}
    </div>
  )
}
