/** Type declarations for the runtime updater state helper. */
export declare function writePhoenixUpdateState(path: string, value: unknown): void

/** Record a validated, secret-free updater command outcome in the Git journal. */
export declare function recordPhoenixUpdateStep(
  statePath: string,
  step: string,
  result: 'started' | 'ok' | 'failed' | 'info',
  target?: string,
  exitCode?: number,
  diagnostic?: string,
): void

/** Redact credentials while retaining bounded full exception details. */
export declare function sanitizePhoenixUpdateDiagnostic(raw: unknown): string | undefined

/** Record an unconfirmed activation only after a bounded wait for real Host evidence. */
export declare function diagnoseStalledPhoenixActivation(statePath: string, now?: number): boolean
