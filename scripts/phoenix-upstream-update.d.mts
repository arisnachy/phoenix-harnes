export declare function normalizeMode(value: string): 'auto' | 'notify' | 'off'
export declare function parseRemoteHead(output: string): string
export declare function classifyUpdate(currentCommit: string, latestCommit: string): 'invalid' | 'current' | 'available'
export declare function containsUnsafeGeneratedLiteral(text: string): boolean
export declare function buildActivationPlan(
  home: string,
  stageHome: string,
  backupRoot: string,
  changed: Array<{
    key: 'codex' | 'openclaw'
    previous: { managedSkills?: unknown }
    candidate: { managedSkills?: unknown }
  }>,
): Array<{ kind: string; from: string; to: string; state: string }>
