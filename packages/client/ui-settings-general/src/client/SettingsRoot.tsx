/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — every piece of text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,
  IconPlugOutline16, IconProfileOutline16, IconSettingsOutline16,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'profile') return <IconProfileOutline16 className={css.navIcon} size={16} />
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'connectors' || id === 'plugins') return <IconPlugOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type FeatureDestination = 'discover' | 'connectors' | 'team'
type FeatureFocus = { destination: FeatureDestination; label: string }

type PanelProps = {
  focus: FeatureFocus | undefined
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * The modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose, focus }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  // A direct destination must never silently fall back to unrelated Settings content.
  const active = rows.find(r => r.id === activeId)?.id ?? (focus === undefined ? rows[0]?.id : undefined)
  const deferredActive = useDeferredValue(active)
  const renderedActive = rows.some(row => row.id === deferredActive) ? deferredActive : active
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Baseline focus management: entering the dialog lands on the close button.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={clsx(css.panel, focus !== undefined && css.focusedPanel)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {focus === undefined && <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>}
        <div className={css.content}>
          <div className={css.header}>
            {focus === undefined
              ? <div className={css.actions}>{renderSlot('settings.action', {})}</div>
              : <h2 id={titleId} className={css.focusTitle}>{focus.label}</h2>}
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {renderedActive !== undefined
              ? renderSlot('settings.section', {
                close: onClose,
                ...(focus === undefined ? {} : { launchContext: focus.destination }),
              }, { only: renderedActive })
              : focus !== undefined ? <p role="status">Esta función todavía no está disponible en esta instalación de Phoenix.</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [focus, setFocus] = useState<FeatureFocus | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
    setFocus(undefined)
  }, [])
  const openSection = useCallback((id: string) => {
    setFocus(undefined)
    setActiveId(id)
    setOpen(true)
  }, [])
  useEffect(() => {
    const onNavigate = (event: Event): void => {
      const requested = (event as CustomEvent<unknown>).detail
      if (typeof requested === 'string') openSection(requested)
    }
    window.addEventListener('phoenix:open-settings-section', onNavigate)
    return () => { window.removeEventListener('phoenix:open-settings-section', onNavigate) }
  }, [openSection])

  useEffect(() => {
    const onFeature = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (typeof detail !== 'object' || detail === null) return
      const { destination, label } = detail as { destination?: unknown; label?: unknown }
      if ((destination !== 'discover' && destination !== 'connectors' && destination !== 'team')
        || typeof label !== 'string' || label.trim().length === 0) return
      setActiveId(destination === 'team' ? 'agent-presets' : 'connectors')
      setFocus({ destination, label })
      setOpen(true)
    }
    window.addEventListener('phoenix:open-feature', onFeature)
    return () => { window.removeEventListener('phoenix:open-feature', onFeature) }
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <div className={clsx(css.triggerStack, !wide && css.triggerStackRail)}>
        {!wide && (
          <div className={css.railStatus}>
            {renderSlot('settings.trigger.trailing', { wide })}
          </div>
        )}
        <button
          type="button"
          className={clsx(css.trigger, !wide && css.rail)}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setFocus(undefined); setActiveId(undefined); setOpen(true) }}
        >
          {renderSlot('settings.trigger', { wide })}
          {wide && renderSlot('settings.trigger.trailing', { wide })}
        </button>
      </div>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          focus={focus}
          onSelect={setActiveId}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
