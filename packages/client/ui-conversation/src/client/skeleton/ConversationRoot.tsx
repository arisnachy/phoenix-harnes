// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar (session-maybe slot) stay mounted across
// no-session/session transitions — the bar renders inert via owner props.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconSearchOutline16 } from '@phoenix-ai/dsh-client-ui-primitives'
import type { SessionId, WorkspaceId } from '@phoenix-ai/dsh-client-runtime/client'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import {
  HeroAttentionList, HeroGlow, HeroShell, WorkspaceChip, heroAttentionPrompt, workspaceLabel,
} from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
export type ConversationRootProps = ConversationSlotProps

interface ScopedConversationOutletProps {
  readonly sessionId: SessionId | undefined
  readonly renderSlot: ConversationRootProps['renderSlot']
}

/**
 * Keep the heavy session surface outside the composer's render lane. The root
 * intentionally follows every input-machine update so input-region owner props
 * stay current; without this memo boundary, every keystroke also rebuilt the
 * whole transcript and header even though those seats already own their own
 * reactive session subscriptions.
 */
const SessionHeaderOutlet = memo(function SessionHeaderOutlet({
  sessionId, renderSlot,
}: ScopedConversationOutletProps) {
  void sessionId
  return renderSlot('conversation.session.header', {})
})

const SessionBodyOutlet = memo(function SessionBodyOutlet({
  sessionId, renderSlot,
}: ScopedConversationOutletProps) {
  void sessionId
  return renderSlot('conversation.session', {})
})

export function ConversationRoot({
  sessionId, useSession, useSessions, useWorkspaces, useInput, inputActions, useComposerBlock, useUserProfile,
  useProactivityAttention, recordAttention, setSidebarFocus, renderSlot, renderSlotChain, selectWorkspace, t,
}: ConversationRootProps) {
  const openState = useSession(s => s.openState)
  const composerPhase = useSession(s => s.composerPhase)
  const pending = useSession(s => s.pending) ?? []
  const session = useSession(s => s)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)
  const preferredName = useUserProfile(profile => profile.preferredName)
  const profileInitials = preferredName?.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || 'PX'
  const proactiveAttention = useProactivityAttention(items => items)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [visualActive, setVisualActive] = useState(false)
  // Collapsing on the FIRST keystroke blocks the input's first paint.
  // Only a first locally admitted submission in a blank session can arm focus.
  const [awaitingFirstBubbleFor, setAwaitingFirstBubbleFor] = useState<SessionId | undefined>()
  const [firstBubbleSettledFor, setFirstBubbleSettledFor] = useState<SessionId | undefined>()
  const firstSendGuard = useRef({
    sessionId,
    wasBlank: composerPhase === 'blank',
    armed: false,
  })
  if (firstSendGuard.current.sessionId !== sessionId) {
    firstSendGuard.current = { sessionId, wasBlank: composerPhase === 'blank', armed: false }
  } else if (composerPhase === 'blank') {
    firstSendGuard.current.wasBlank = true
  }
  // null follows automatic focus; explicit expand/collapse overrides it for this session.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null)

  useEffect(() => {
    setVisualActive(false)
    setHeaderOverride(null)
  }, [sessionId])

  const pendingSubmitAt = inputState?.pendingSubmit?.startedAt
  useEffect(() => {
    const guard = firstSendGuard.current
    if (sessionId === undefined || pendingSubmitAt === undefined || guard.sessionId !== sessionId
      || !guard.wasBlank || guard.armed) return
    guard.armed = true
    setAwaitingFirstBubbleFor(sessionId)
  }, [sessionId, pendingSubmitAt])

  // ChatView paints an optimistic user bubble as soon as the input machine
  // admits Enter OR a Send click. Never collapse until that bubble is in the
  // DOM; one animation frame + 72ms gives the bubble its own paint first.
  // A pending Host admission must not hold typing or trigger on rejected sends.
  useEffect(() => {
    if (sessionId === undefined || awaitingFirstBubbleFor !== sessionId
      || typeof MutationObserver === 'undefined') return
    const scroller = rootRef.current?.querySelector('[data-conversation-scroll]')
    if (scroller === null || scroller === undefined) return
    let raf: number | undefined
    let timeout: number | undefined
    let found = false
    const onBubble = (): void => {
      if (found || scroller.querySelector(
        '[data-chat-flow] [data-pending-steering="true"], [data-chat-flow] [data-chat-flow-kind="user"]',
      ) === null) return
      found = true
      observer.disconnect()
      raf = window.requestAnimationFrame(() => {
        timeout = window.setTimeout(() => {
          setFirstBubbleSettledFor(sessionId)
        }, 72)
      })
    }
    const observer = new MutationObserver(onBubble)
    observer.observe(scroller, { subtree: true, childList: true })
    onBubble()
    return () => {
      observer.disconnect()
      if (raf !== undefined) window.cancelAnimationFrame(raf)
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [awaitingFirstBubbleFor, sessionId])

  // Rendered browser/visual blocks arrive asynchronously as transcript nodes.
  // DOM observation here avoids coupling the chat shell to individual plugins.
  useEffect(() => {
    const scroller = rootRef.current?.querySelector('[data-conversation-scroll]')
    if (scroller == null || typeof MutationObserver === 'undefined') return
    const refresh = (): void => {
      setVisualActive(scroller.querySelector(
        '[data-mini-browser-focus="true"], [data-phoenix-visual-qa]:not([data-phoenix-visual-qa="fail"])',
      ) !== null)
    }
    const observer = new MutationObserver(refresh)
    observer.observe(scroller, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-mini-browser-focus', 'data-phoenix-visual-qa'],
    })
    refresh()
    return () => { observer.disconnect() }
  }, [sessionId])

  useEffect(() => {
    setSidebarFocus((sessionId !== undefined && firstBubbleSettledFor === sessionId) || visualActive)
  }, [setSidebarFocus, sessionId, firstBubbleSettledFor, visualActive])
  useEffect(() => () => { setSidebarFocus(false) }, [setSidebarFocus])

  const openSettingsSection = useCallback((id: string): void => {
    window.dispatchEvent(new CustomEvent('phoenix:open-settings-section', { detail: id }))
  }, [])
  const openWorkspaceSearch = useCallback((): void => {
    window.dispatchEvent(new Event('phoenix:open-workspace-search'))
  }, [])

  const selectAttention = useCallback((item: (typeof proactiveAttention)[number]): void => {
    if (inputActions === undefined) return
    inputActions.setDraft(heroAttentionPrompt(item))
    void recordAttention(item, 'handled')
    requestAnimationFrame(() => {
      rootRef.current?.querySelector('textarea')?.focus()
    })
  }, [inputActions, recordAttention])

  // Publishes the seat's live height as --dsh-composer-height on the scroll
  // body so floating controls (ChatView back-to-bottom) clear the composer as
  // it grows. Callback ref, not an effect; stable identity prevents observer
  // churn while the first blank session fills the resident body outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
    })
    seatObserver.current.observe(seat)
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable — render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (`cold`) and
  // after one fails (`error`) for the same reason — there is no history.
  const settling = sessionId !== undefined && composerPhase === 'blank' && openState === 'loading'
    && summaryBlank !== true
  const hero = sessionId === undefined
    || (composerPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  const chipTitle = pendingWorkspace?.title
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))

  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
    overlay: renderSlot('conversation.input.overlay', {}),
    leftItems: zone === undefined ? null : renderSlot('conversation.input.left', zone),
    rightItems: zone === undefined ? null : renderSlot('conversation.input.right', zone),
    // Stats band under the card, inside the bar's width column so both
    // share one constraint (composer.dock = stats-line family).
    footer: !hero && zone !== undefined ? renderSlot('conversation.composer.dock', zone) : null,
  })

  const composerBar = (
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroGlow className={css.heroGlow} />}
      {hero && <HeroShell t={t} renderSlot={renderSlot} preferredName={preferredName} />}
      {hero && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
      {hero && <HeroAttentionList attention={proactiveAttention} onSelect={selectAttention} onDismiss={(item) => { void recordAttention(item, 'dismissed') }} />}
    </div>
  )

  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  const headerCompact = hero || (headerOverride ?? visualActive)
  const composer = renderSlotChain(
    'conversation.composer',
    { interactions: pending, session },
    { fallback: composerBar, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave Question/Approval panels at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
      {composer}
    </div>
  )

  return (
    <div ref={rootRef} className={css.root} data-phase={phase} data-header-compact={headerCompact ? 'true' : undefined}>
      <div className={css.unifiedHeader} aria-label="Barra superior de Phoenix">
        <div className={css.sessionChrome}>
          <SessionHeaderOutlet sessionId={sessionId} renderSlot={renderSlot} />
        </div>
        <div className={css.headerGlobal} aria-label="Herramientas globales">
          {!hero && <button type="button" className={css.headerToggle}
            aria-label={headerCompact ? 'Expandir barra superior' : 'Compactar barra superior'}
            title={headerCompact ? 'Expandir barra superior' : 'Compactar barra superior'}
            aria-expanded={!headerCompact}
            onClick={() => { setHeaderOverride(!headerCompact) }}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {headerCompact ? <path d="m7 10 5 5 5-5" /> : <path d="m7 14 5-5 5 5" />}
            </svg>
          </button>}
          <button type="button" className={css.heroTopIcon} aria-label="Buscar sesiones" onClick={openWorkspaceSearch}>
            <IconSearchOutline16 size={19} />
          </button>
          <button type="button" className={css.heroTopIcon} aria-label="Descubrir herramientas" onClick={() => { openSettingsSection('plugins') }}>
            <svg viewBox="0 0 20 20" width="19" height="19" fill="currentColor" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => (
                <circle key={index} cx={4 + (index % 3) * 6} cy={4 + Math.floor(index / 3) * 6} r="1.45" />
              ))}
            </svg>
          </button>
          <button type="button" className={css.heroTopProfile} aria-label="Abrir perfil" onClick={() => { openSettingsSection('profile') }}>
            {profileInitials}
          </button>
        </div>
      </div>
      <div className={css.scrollBody} data-conversation-scroll="">
        <SessionBodyOutlet sessionId={sessionId} renderSlot={renderSlot} />
        {composerSeat}
      </div>
    </div>
  )
}
