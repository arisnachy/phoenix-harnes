/** Type declarations for the runtime updater state helper. */
export declare function writePhoenixUpdateState(path: string, value: unknown): void

/** Record a validated, secret-free updater command outcome in the Git journal. */
export declare function recordPhoenixUpdateStep(
  statePath: string,
  step: string,
  result: 'started' | 'ok' | 'failed' | 'info',
  target?: string,
  exitCode?: number,
): void
