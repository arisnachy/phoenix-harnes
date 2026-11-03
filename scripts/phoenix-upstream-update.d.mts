export declare function normalizeMode(value: string): 'auto' | 'notify' | 'off'
export declare function parseRemoteHead(output: string): string
export declare function classifyUpdate(currentCommit: string, latestCommit: string): 'invalid' | 'current' | 'available'
export declare function containsUnsafeGeneratedLiteral(text: string): boolean
export type PhoenixUpstreamProviderKey = 'codex' | 'openclaw' | 'superpowers'

export declare function buildActivationPlan(
  home: string,
  stageHome: string,
  backupRoot: string,
  changed: Array<{
    key: PhoenixUpstreamProviderKey
    previous: { managedSkills?: unknown }
    candidate: { managedSkills?: unknown }
  }>,
): Array<{ kind: string; from: string; to: string; state: string }>
export declare function pruneObsoleteTransactionBackups(home: string): { removed: number }

// Public typings must mirror exports in phoenix-upstream-update.mjs. Keep these
// synchronized when adding an updater helper used by TypeScript tests.
export declare function shouldDeferAutomaticUpstreamApply(
  previous: { lastSuccessfulApplyAt?: string } | null | undefined,
  now: number,
  gapMs: number,
): boolean

/** Remove only abandoned, namespaced upstream staging directories. */
export declare function pruneAbandonedUpstreamStaging(
  home: string,
  now?: number,
): { removed: number }

/** A second updater cannot claim the same DSH_HOME while this lease is held. */
export declare function acquireUpstreamUpdateLease(
  home: string,
): (() => void) | undefined
