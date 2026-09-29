// Hero chrome for the blank-draft phase of ConversationRoot: intelligent
// greeting, Phoenix brand mark, glow backdrop, and the workspace row. Pure
// presentation — the resident composer is NOT rendered here (it keeps its own
// stable tree position in ConversationRoot so the textarea survives the hero
// → composer flip); CSS positions it over this shell's glow area during the
// hero phase.

import { useId } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16, IconSparkle16, IconWarningOutline16, PhoenixLogo,
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
  if (item.kind === 'failure') return 'Necesita revisión.'
  if (item.kind === 'upcoming') return 'Phoenix lo está preparando.'
  return 'Hay un resultado nuevo.'
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, retained for the workspace chip contract. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /** Durable preferred name from the current user's Profile settings. */
  preferredName?: string | undefined
  /** Highest-value proactive signals; the Hero renders only the first two. */
  attention?: readonly ProactivityAttentionItem[] | undefined
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
export function HeroShell({ renderSlot, preferredName, attention = [], children }: HeroShellProps) {
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
        {attention.length === 0 ? null : (
          <div className={css.attention} aria-label="Atención proactiva de Phoenix">
            {attention.slice(0, 2).map(item => (
              <div className={css.attentionRow} key={item.id}>
                {item.kind === 'failure'
                  ? <IconWarningOutline16 className={css.attentionIcon} size={15} />
                  : <IconSparkle16 className={css.attentionIcon} size={15} />}
                <span className={css.attentionTitle}>{item.title}</span>
                <span className={css.attentionSeparator} aria-hidden="true">·</span>
                <span className={css.attentionDetail}>{heroAttentionDetail(item)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
