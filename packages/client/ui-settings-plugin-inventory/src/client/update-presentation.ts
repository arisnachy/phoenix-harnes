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
