/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 *
 * Host provider/model ids remain the only routing facts. The model pane adds
 * a presentation-only layer for friendly catalog names, secondary capability
 * copy, Preview badges, and provider identity. Known provider marks are bundled
 * official paths and unknown providers use a local monogram; no provider mark
 * request can change selection state or open an error surface.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@phoenix-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconRefreshOutline16, IconWarningOutline16, PhoenixLogo, Toast,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import {
  isPhoenixAutoRouting, localModelBrandMark, presentModel, providerBrandMark, providerInitial, type ModelPresentation,
} from './presentation.ts'
import css from './ModelSelect.module.css'
import { projectAntigravitySelector } from './antigravity-visibility.ts'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort' | 'speed'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** Render a packaged provider mark or the local fallback for unknown ids. */
function ProviderLogo({ providerId, providerName, modelId, modelName }: {
  providerId: string; providerName: string; modelId?: string; modelName?: string
}) {
  const local = providerId === 'phoenix-local'
  const phoenix = providerId === 'phoenix-nexus'
  const mark = local ? localModelBrandMark(modelId ?? '', modelName ?? '')
    : phoenix ? undefined : providerBrandMark(providerId, providerName)
  return (
    <span className={css.providerLogo} role="img" aria-label={`${local ? modelName ?? 'PHOENIX' : providerName} logo`}>
      {mark === undefined
        ? local || phoenix ? <PhoenixLogo size={20} /> : <span className={css.providerLogoFallback} aria-hidden="true">{providerInitial(providerName)}</span>
        : (
          <svg
            className={css.providerLogoMark}
            data-provider-mark={mark.slug}
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ color: `#${mark.hex}` }}
          >
            <path d={mark.path} fill="currentColor" />
          </svg>
        )}
    </span>
  )
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const rawState = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const state = useMemo(() => projectAntigravitySelector(rawState), [rawState])
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [modelQuery, setModelQuery] = useState('')
  const [effortDraftKey, setEffortDraftKey] = useState<string | null>(null)
  // Provider accordion: manual toggles win; otherwise only the group holding
  // the current model stays expanded, falling back to the first group when
  // the current model is no longer advertised. Keeping the catalog collapsed
  // by default stops long directories from burying or visually clipping the
  // first rows (the old always-expanded list scrolled under sticky headers).
  const [groupToggles, setGroupToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<{
    direction: 'above' | 'below'
    maxHeight: number
  }>({ direction: 'above', maxHeight: 360 })
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const normalizedQuery = modelQuery.trim().toLocaleLowerCase()
  const visibleGroups = useMemo(() => state.groups.map((group) => {
    const providerMatches = group.name.toLocaleLowerCase().includes(normalizedQuery)
      || group.id.toLocaleLowerCase().includes(normalizedQuery)
    return {
      ...group,
      models: normalizedQuery === '' || providerMatches
        ? group.models
        : group.models.filter((model) => {
          const displayName = isPhoenixAutoRouting(model.id, model.name)
            ? t('trigger.auto')
            : presentModel(model.name, model.description).displayName
          return [model.id, model.name, displayName]
            .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
        }),
    }
  }).filter(group => group.models.length > 0), [state.groups, normalizedQuery, t])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const codexSpeedAvailable = state.current?.provider === 'openai-codex'
  const activeSpeed = state.current?.serviceTier ?? 'default'
  const speedLabel = activeSpeed === 'fast' ? t('speed.fast') : t('speed.standard')
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      { key: 'provider-default', effort: undefined, label: t('effort.providerDefault') },
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (open && pane === 'effort') return
    setEffortDraftKey(null)
  }, [open, pane])

  // The model directory may be taller than the available space above the
  // composer. Clamp it to the actual trigger/viewport geometry before paint,
  // and flip below the trigger when there is more space there. This prevents
  // the first model from being hidden outside the top of the browser window.
  useLayoutEffect(() => {
    if (!open) return
    const measureMenu = (): void => {
      const trigger = triggerRef.current
      if (trigger === null) return
      const rect = trigger.getBoundingClientRect()
      const scrollPort = trigger.closest('[data-conversation-scroll]')?.getBoundingClientRect()
      const viewportTop = Math.max(12, (scrollPort?.top ?? 0) + 12)
      const viewportBottom = Math.min(window.innerHeight - 12, (scrollPort?.bottom ?? window.innerHeight) - 12)
      const above = rect.top - viewportTop - 8
      const below = viewportBottom - rect.bottom - 8
      const cap = pane === 'model' ? 520 : pane === 'effort' ? 440 : 360
      const direction = above >= Math.min(280, cap) || above >= below ? 'above' : 'below'
      const room = direction === 'above' ? above : below
      const maxHeight = Math.min(cap, Math.max(80, Math.floor(room)))
      setMenuPlacement(previous => previous.direction === direction && previous.maxHeight === maxHeight
        ? previous
        : { direction, maxHeight })
    }
    measureMenu()
    window.addEventListener('resize', measureMenu)
    window.addEventListener('scroll', measureMenu, true)
    return () => {
      window.removeEventListener('resize', measureMenu)
      window.removeEventListener('scroll', measureMenu, true)
    }
  }, [open, pane])

  // Codex can replace the startup catalog immediately after the model pane opens.
  // Chrome scroll anchoring may otherwise preserve a lower row and hide models
  // prepended by that refresh. Every fresh catalog starts at its first row.
  useLayoutEffect(() => {
    if (!open || pane !== 'model') return
    const groups = groupsRef.current
    if (groups !== null) groups.scrollTop = 0
  }, [open, pane, state.groups, modelQuery])

  if (!available) return null

  const show = (): void => {
    setModelQuery('')
    setPane('root')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    setEffortDraftKey(null)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
    setEffortDraftKey(null)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
      ...state.current.serviceTier === undefined ? {} : { serviceTier: state.current.serviceTier },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseSpeed = (serviceTier: 'default' | 'fast'): void => {
    if (state.current === null || state.current.provider !== 'openai-codex') return
    if ((state.current.serviceTier ?? 'default') === serviceTier) { close(true); return }
    lastActionRef.current = 'select'
    void select({ ...state.current, serviceTier }).then(settleSelection)
  }

  const selectedEffortChoice = effortChoices.find(level => level.effort === effectiveEffort)
  const draftEffortChoice = effortDraftKey === null
    ? undefined
    : effortChoices.find(level => level.key === effortDraftKey)
  const displayedEffortChoice = draftEffortChoice ?? selectedEffortChoice ?? effortChoices[0]
  const displayedEffortIndex = displayedEffortChoice === undefined
    ? 0
    : effortChoices.indexOf(displayedEffortChoice)

  const commitEffortIndex = (index: number): void => {
    const choice = effortChoices[index]
    if (choice === undefined) return
    setEffortDraftKey(choice.key)
    chooseEffort(choice.effort)
  }

  const updateEffortDraft = (index: number): void => {
    const choice = effortChoices[index]
    if (choice !== undefined) setEffortDraftKey(choice.key)
  }

  // The current host selection is authoritative even while the provider
  // catalog is loading, empty, or temporarily unavailable. Do not erase the
  // model's visible identity and make the control look like it disappeared.
  const displayedRoute = state.current
  const modelLabel = currentChoice === undefined
    ? displayedRoute === null
      ? t('trigger.fallback')
      : isPhoenixAutoRouting(displayedRoute.model, displayedRoute.model)
        ? t('trigger.auto')
        : presentModel(displayedRoute.model).displayName
    : isPhoenixAutoRouting(currentChoice.model.id, currentChoice.model.name)
      ? t('trigger.auto')
      : currentChoice.group.id === 'phoenix-local' ? currentChoice.model.name : presentModel(currentChoice.model.name).displayName
  const visibleEffort = effortLabel ?? displayedRoute?.reasoningEffort
  const triggerAria = displayedRoute === null
    ? t('trigger.selectAria')
    : visibleEffort === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: visibleEffort })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLElement | null) => { itemRefs.current[at] = node }
  }

  const defaultExpandedGroupId = (): string | undefined => {
    const current = state.current
    const holder = state.groups.find(group =>
      current !== null && group.models.some(model => model.id === current.model))
    return holder?.id ?? state.groups[0]?.id
  }

  const groupExpanded = (groupId: string): boolean => {
    if (normalizedQuery !== '') return true
    const manual = groupToggles.get(groupId)
    return manual ?? groupId === defaultExpandedGroupId()
  }

  const toggleGroup = (groupId: string): void => {
    setGroupToggles((previous) => {
      const next = new Map(previous)
      next.set(groupId, !groupExpanded(groupId))
      return next
    })
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        {(displayedRoute?.provider === 'phoenix-local' || displayedRoute?.provider === 'phoenix-nexus') && <PhoenixLogo size={17} />}
        <span className={css.triggerLabel}>{modelLabel}</span>
        {visibleEffort !== undefined && <span className={css.triggerEffort}>{visibleEffort}</span>}
        {codexSpeedAvailable && activeSpeed === 'fast' && <span className={css.triggerEffort}>{speedLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={clsx(
            css.menu,
            pane === 'model' && css.modelMenu,
            pane === 'effort' && css.effortMenu,
            pane === 'speed' && css.effortMenu,
          )}
          role="menu"
          style={{
            maxHeight: menuPlacement.maxHeight,
            ...(menuPlacement.direction === 'below'
              ? { top: 'calc(100% + 8px)', bottom: 'auto' }
              : { bottom: 'calc(100% + 8px)', top: 'auto' }),
          }}
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
              {codexSpeedAvailable && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('speed') }}>
                  <span className={css.cellLabel}>{t('menu.speed')}</span>
                  <span className={css.cellValue}>{speedLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              <div className={css.modelSearch}>
                <input
                  type="search"
                  className={css.modelSearchInput}
                  aria-label={t('search.aria')}
                  placeholder={t('search.placeholder')}
                  autoComplete="off"
                  value={modelQuery}
                  onChange={(event) => { setModelQuery(event.currentTarget.value) }}
                />
              </div>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div ref={groupsRef} className={clsx(css.groups, 'scrollable')}>
                {visibleGroups.length === 0 && state.status !== 'loading' && (
                  <div className={css.empty}>{normalizedQuery === '' ? t('empty.models') : t('search.noMatches')}</div>
                )}
                {visibleGroups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  const expanded = groupExpanded(group.id)
                  return (
                    <section
                      role="group"
                      aria-labelledby={headingId}
                      className={clsx(css.group, !expanded && css.groupCollapsed)}
                      key={group.id}
                    >
                      <button
                        ref={itemRef()}
                        type="button"
                        role="menuitem"
                        className={css.groupHeader}
                        id={headingId}
                        aria-expanded={expanded}
                        onClick={() => { toggleGroup(group.id) }}
                      >
                        <IconChevronRightOutline14 className={clsx(css.groupChevron, expanded && css.groupChevronOpen)} />
                        {(group.id === 'phoenix-local' || group.id === 'phoenix-nexus') && <PhoenixLogo size={18} />}
                        <span className={css.groupName}>{group.id === 'phoenix-local' ? group.name.replace(/^🔥\s*/u, '') : group.name}</span>
                        <span className={css.groupCount} aria-hidden="true">{group.models.length}</span>
                      </button>
                      {expanded && group.models.map((model) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        const presentation: ModelPresentation = isPhoenixAutoRouting(model.id, model.name)
                          ? { displayName: t('trigger.auto'), description: t('trigger.autoDetail') }
                          : group.id === 'phoenix-local'
                            ? { displayName: model.name, ...(model.description === undefined ? {} : { description: model.description }) }
                            : presentModel(model.name, model.description)
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-label={presentation.displayName}
                            aria-checked={selected}
                            className={clsx(css.option, css.modelOption, selected && css.selected)}
                            key={model.id}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id,
                              ...group.id === 'openai-codex' && state.current?.provider === 'openai-codex'
                                && state.current.serviceTier !== undefined ? { serviceTier: state.current.serviceTier } : {},
                            }) }}
                          >
                            <ProviderLogo providerId={group.id} providerName={group.name} modelId={model.id} modelName={model.name} />
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{presentation.displayName}</span>
                              {presentation.description !== undefined && (
                                <span className={css.description}>{presentation.description}</span>
                              )}
                            </span>
                            <span className={css.optionTrail}>
                              {presentation.badge !== undefined && (
                                <span className={css.badge} aria-hidden="true">{presentation.badge}</span>
                              )}
                              <span className={css.check}>
                                {selected ? <IconCheckOutline16 /> : null}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'speed' && codexSpeedAvailable && (
            <>
              {(['default', 'fast'] as const).map(tier => (
                <button
                  key={tier}
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeSpeed === tier}
                  className={clsx(css.option, activeSpeed === tier && css.selected)}
                  disabled={busy}
                  onClick={() => { chooseSpeed(tier) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.modelName}>{t(tier === 'fast' ? 'speed.fast' : 'speed.standard')}</span>
                    <span className={css.description}>{t(tier === 'fast' ? 'speed.fastDetail' : 'speed.standardDetail')}</span>
                  </span>
                  <span className={css.check}>{activeSpeed === tier ? <IconCheckOutline16 /> : null}</span>
                </button>
              ))}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : (
                  <div
                    className={css.effortSelector}
                    data-testid="effort-selector"
                    role="group"
                    aria-label={t('effort.selectorAria')}
                  >
                    <div className={css.effortHeader}>
                      <svg className={css.effortIcon} viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M13.9 1.6 3.2 10.5h6.1l-2.5 11.9 13.9-12.8h-6.5l2.8-8Z" />
                      </svg>
                      <div className={css.effortTitle}>
                        <span className={css.effortValue}>{displayedEffortChoice?.label ?? effortLabel}</span>
                        <IconChevronRightOutline14 className={css.effortValueChevron} />
                      </div>
                      <button
                        ref={itemRef()}
                        type="button"
                        className={css.effortReset}
                        aria-label={t('effort.reset')}
                        disabled={busy}
                        onClick={() => { commitEffortIndex(0) }}
                      >
                        <IconRefreshOutline16 />
                      </button>
                    </div>
                    <div className={css.effortModel}>{modelLabel}</div>
                    <div className={css.effortSlider}>
                      <div className={css.effortTrack} aria-hidden="true">
                        <span
                          className={css.effortTrackFill}
                          style={{ width: `${effortChoices.length <= 1 ? 100 : (displayedEffortIndex / (effortChoices.length - 1)) * 100}%` }}
                        />
                      </div>
                      <div className={css.effortStops} aria-hidden="true">
                        {effortChoices.map((level, index) => (
                          <span
                            className={clsx(css.effortStop, index === displayedEffortIndex && css.effortStopActive)}
                            key={level.key}
                            style={{ left: `${effortChoices.length <= 1 ? 50 : (index / (effortChoices.length - 1)) * 100}%` }}
                          />
                        ))}
                      </div>
                      <input
                        ref={itemRef()}
                        className={css.effortRange}
                        type="range"
                        min={0}
                        max={Math.max(effortChoices.length - 1, 0)}
                        step={1}
                        value={displayedEffortIndex}
                        aria-label={t('effort.sliderAria')}
                        aria-valuetext={displayedEffortChoice?.label ?? effortLabel}
                        disabled={busy}
                        onChange={(event) => { updateEffortDraft(Number(event.currentTarget.value)) }}
                        onPointerDown={(event) => {
                          if (typeof event.currentTarget.setPointerCapture === 'function') {
                            event.currentTarget.setPointerCapture(event.pointerId)
                          }
                        }}
                        onPointerUp={(event) => { commitEffortIndex(Number(event.currentTarget.value)) }}
                        onPointerCancel={() => { setEffortDraftKey(null) }}
                        onKeyUp={(event) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(event.key)) {
                            commitEffortIndex(Number(event.currentTarget.value))
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
