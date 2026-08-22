export type CollectiveNetworkMode = 'off' | 'observe-only';

export interface CollectiveSafetyPolicy {
  networkMode: CollectiveNetworkMode;
  allowRemoteProblemSignals: boolean;
  allowRemoteEvidence: boolean;
  allowRemoteSourceCode: false;
  allowRemoteArtifacts: false;
  allowRemoteMcp: false;
  allowRemoteCommands: false;
  allowRemoteSecrets: false;
  allowPeerToPeerExecution: false;
  allowAutomaticRemotePromotion: false;
}

export interface RemoteCollectiveEnvelope {
  kind: 'problem-signal' | 'evidence';
  problemId: string;
  fingerprint: string;
  summary: string;
  metrics?: Readonly<Record<string, number | string | boolean>>;
  sourceCode?: string;
  artifact?: string;
  mcpDefinition?: unknown;
  command?: string;
  secrets?: Readonly<Record<string, string>>;
}

export class CollectiveSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CollectiveSafetyError';
  }
}

export const DEFAULT_COLLECTIVE_SAFETY_POLICY: CollectiveSafetyPolicy = Object.freeze({
  networkMode: 'off',
  allowRemoteProblemSignals: false,
  allowRemoteEvidence: false,
  allowRemoteSourceCode: false,
  allowRemoteArtifacts: false,
  allowRemoteMcp: false,
  allowRemoteCommands: false,
  allowRemoteSecrets: false,
  allowPeerToPeerExecution: false,
  allowAutomaticRemotePromotion: false,
});

export function observeOnlyCollectivePolicy(): CollectiveSafetyPolicy {
  return {
    ...DEFAULT_COLLECTIVE_SAFETY_POLICY,
    networkMode: 'observe-only',
    allowRemoteProblemSignals: true,
    allowRemoteEvidence: true,
  };
}

function assertNoExecutablePayload(envelope: RemoteCollectiveEnvelope): void {
  if (envelope.sourceCode !== undefined) throw new CollectiveSafetyError('Remote source code is forbidden');
  if (envelope.artifact !== undefined) throw new CollectiveSafetyError('Remote executable artifacts are forbidden');
  if (envelope.mcpDefinition !== undefined) throw new CollectiveSafetyError('Remote MCP definitions are forbidden');
  if (envelope.command !== undefined) throw new CollectiveSafetyError('Remote commands are forbidden');
  if (envelope.secrets !== undefined) throw new CollectiveSafetyError('Remote secrets are forbidden');
}

export function validateRemoteCollectiveEnvelope(
  envelope: RemoteCollectiveEnvelope,
  policy: CollectiveSafetyPolicy = DEFAULT_COLLECTIVE_SAFETY_POLICY,
): RemoteCollectiveEnvelope {
  if (policy.networkMode === 'off') throw new CollectiveSafetyError('Collective network is disabled');
  if (policy.allowPeerToPeerExecution || policy.allowAutomaticRemotePromotion) {
    throw new CollectiveSafetyError('Unsafe collective policy: peer execution and automatic remote promotion must remain disabled');
  }

  assertNoExecutablePayload(envelope);

  if (envelope.kind === 'problem-signal' && !policy.allowRemoteProblemSignals) {
    throw new CollectiveSafetyError('Remote problem signals are disabled');
  }
  if (envelope.kind === 'evidence' && !policy.allowRemoteEvidence) {
    throw new CollectiveSafetyError('Remote evidence is disabled');
  }
  if (!envelope.problemId.trim() || !envelope.fingerprint.trim() || !envelope.summary.trim()) {
    throw new CollectiveSafetyError('Remote collective envelope is missing required inert metadata');
  }

  return {
    kind: envelope.kind,
    problemId: envelope.problemId,
    fingerprint: envelope.fingerprint,
    summary: envelope.summary,
    ...(envelope.metrics ? { metrics: { ...envelope.metrics } } : {}),
  };
}
