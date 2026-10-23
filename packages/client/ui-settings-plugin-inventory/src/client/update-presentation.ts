const PROTECTED_PAUSE_PHASES = new Set([
  'development-branch',
  'diverged',
  'ahead',
  'foreign-remote',
  'worktree',
])

/**
 * Decide whether a paused updater state is informational protection rather than
 * an operation that needs a sidebar action.
 * @param phase - durable updater phase associated with the pause.
 * @returns Whether the pause should stay out of the visible updater action.
 */
export function isHiddenUpdaterPause(phase: string | undefined): boolean {
  return phase !== undefined && PROTECTED_PAUSE_PHASES.has(phase)
}

/** Exact localized labels for trusted updater journal step codes. */
export const UPDATE_STEP_LABEL_KEYS = {
  'git-worktree': 'updateStepWorktree',
  'git-reset': 'updateStepGitReset',
  'git-clean': 'updateStepGitClean',
  dependencies: 'updateStepDependencies',
  build: 'updateStepBuild',
  smoke: 'updateStepSmoke',
  'boot-preflight': 'updateStepBoot',
  handoff: 'updateStepHandoff',
  'host-restart': 'updateStepRestart',
  'health-check': 'updateStepHealth',
  'runtime-activation': 'updateStepActivation',
  rollback: 'updateStepRollback',
  checking: 'updateChecking',
  available: 'updateAvailable',
  preparing: 'updateDependencies',
  ready: 'updateReady',
  restarting: 'updateRestarting',
  applying: 'updateApplying',
  updated: 'updateUpdated',
  current: 'updateUpdated',
  'rolling-back': 'updateRollingBack',
  'rolled-back': 'updateRolledBack',
  error: 'updateError',
  'rollback-failed': 'updateError',
  paused: 'updatePaused',
} as const

/**
 * Select an existing localization key for a verified journal step.
 * @param step - fixed code from the Host's sanitized journal.
 * @returns locale key or undefined for unknown and untrusted codes.
 */
export function updateStepLabelKey(step: string): typeof UPDATE_STEP_LABEL_KEYS[keyof typeof UPDATE_STEP_LABEL_KEYS] | undefined {
  return Object.hasOwn(UPDATE_STEP_LABEL_KEYS, step)
    ? UPDATE_STEP_LABEL_KEYS[step as keyof typeof UPDATE_STEP_LABEL_KEYS]
    : undefined
}

/** Whether a finished update still deserves a visible success confirmation. */
export function recentlyUpdated(events: readonly { readonly step: string; readonly result: string; readonly at: string }[] | undefined, now = Date.now()): boolean {
  return events?.some(event => event.step === 'updated' && event.result === 'ok'
    && Number.isFinite(Date.parse(event.at))
    && now - Date.parse(event.at) >= 0 && now - Date.parse(event.at) < 10 * 60_000) ?? false
}
