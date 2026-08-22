import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export type AuthorityScope =
  | 'read'
  | 'network'
  | 'write'
  | 'exec'
  | 'forge'
  | 'orchestrate'
  | 'judge'
  | 'promote'
  | 'release'
  | 'secrets';

export type SecuritySubjectKind = 'model' | 'node' | 'tool' | 'human' | 'system';
export type ApprovalKind = 'judge' | 'human' | 'system';
export type MotherRisk = 'normal' | 'critical';

export interface SecuritySubject {
  id: string;
  kind: SecuritySubjectKind;
  modelKey?: string;
}

export interface ApprovalClaim {
  id: string;
  approverId: string;
  kind: ApprovalKind;
  subjectId: string;
  missionId: string;
  action: AuthorityScope;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface CapabilityLeaseClaim {
  id: string;
  subject: SecuritySubject;
  missionId: string;
  scopes: readonly AuthorityScope[];
  resourcePrefixes: readonly string[];
  issuedAt: string;
  expiresAt: string;
  oneUse: boolean;
  nonce: string;
}

export interface LeaseRequest {
  subject: SecuritySubject;
  missionId: string;
  scopes: readonly AuthorityScope[];
  resourcePrefixes?: readonly string[];
  ttlMs?: number;
  oneUse?: boolean;
  approvals?: readonly string[];
}

export interface LeaseExpectation {
  subjectId: string;
  missionId: string;
  scope: AuthorityScope;
  resource?: string;
  now?: Date;
  consume?: boolean;
}

export interface AuthorityVerifier {
  verifyLease(token: string, expectation: LeaseExpectation): CapabilityLeaseClaim;
}

export interface QuarantineRecord {
  subjectId: string;
  reason: string;
  quarantinedAt: string;
}

export interface TripwireEvent {
  subjectId: string;
  type:
    | 'forged_authority'
    | 'protected_path_write'
    | 'secret_access'
    | 'self_promotion'
    | 'denied_write'
    | 'denied_exec'
    | 'policy_violation';
  at?: string;
}

export interface MotherChangeProposal {
  candidateId: string;
  baseSha: string;
  targetBranch: string;
  directWrite: boolean;
  forceUpdate: boolean;
  changedPaths: readonly string[];
  contributorNodeIds: readonly string[];
  contributorModelKeys: readonly string[];
  judgeNodeIds: readonly string[];
  judgeModelKeys: readonly string[];
  checks: {
    buildPassed: boolean;
    testsPassed: boolean;
    securityPassed: boolean;
    regressions: number;
    reproducibleRuns: number;
  };
  approvalTokens?: readonly string[];
}

export interface MotherGuardPolicy {
  minimumIndependentJudges?: number;
  minimumReproducibleRuns?: number;
  protectedPaths?: readonly string[];
}

export interface MotherGuardDecision {
  allowed: boolean;
  risk: MotherRisk;
  reasons: readonly string[];
  requiresPullRequest: true;
  requiresProtectedBranch: true;
}

const DANGEROUS_SCOPES = new Set<AuthorityScope>(['write', 'exec', 'forge']);
const SOVEREIGN_SCOPES = new Set<AuthorityScope>(['promote', 'release', 'secrets']);

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function matchesResource(resource: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return false;
  const normalized = normalizePath(resource);
  return prefixes.some((prefix) => {
    const p = normalizePath(prefix);
    return p === '*' || normalized === p || normalized.startsWith(p.endsWith('/') ? p : `${p}/`);
  });
}

export class SecurityPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SecurityPolicyError';
  }
}

export class QuarantineRegistry {
  readonly #records = new Map<string, QuarantineRecord>();

  public quarantine(subjectId: string, reason: string, now = new Date()): QuarantineRecord {
    const existing = this.#records.get(subjectId);
    if (existing) return existing;
    const record: QuarantineRecord = {
      subjectId,
      reason,
      quarantinedAt: now.toISOString(),
    };
    this.#records.set(subjectId, record);
    return record;
  }

  public release(subjectId: string): boolean {
    return this.#records.delete(subjectId);
  }

  public isQuarantined(subjectId: string): boolean {
    return this.#records.has(subjectId);
  }

  public record(subjectId: string): QuarantineRecord | undefined {
    return this.#records.get(subjectId);
  }
}

export class SecurityTripwire {
  readonly #scores = new Map<string, number>();
  readonly #quarantine: QuarantineRegistry;
  readonly #threshold: number;

  public constructor(quarantine: QuarantineRegistry, threshold = 10) {
    this.#quarantine = quarantine;
    this.#threshold = Math.max(1, Math.floor(threshold));
  }

  public score(subjectId: string): number {
    return this.#scores.get(subjectId) ?? 0;
  }

  public record(event: TripwireEvent): number {
    const points: Record<TripwireEvent['type'], number> = {
      forged_authority: 10,
      protected_path_write: 10,
      secret_access: 10,
      self_promotion: 10,
      denied_write: 4,
      denied_exec: 5,
      policy_violation: 2,
    };
    const next = this.score(event.subjectId) + points[event.type];
    this.#scores.set(event.subjectId, next);
    if (next >= this.#threshold) {
      this.#quarantine.quarantine(event.subjectId, `security_tripwire:${event.type}`, event.at ? new Date(event.at) : new Date());
    }
    return next;
  }

  public reset(subjectId: string): void {
    this.#scores.delete(subjectId);
  }
}

export class AuthorityKernel implements AuthorityVerifier {
  readonly #secret: Buffer;
  readonly #quarantine: QuarantineRegistry;
  readonly #revoked = new Set<string>();
  readonly #consumed = new Set<string>();

  public constructor(options: { secret?: Buffer | string; quarantine?: QuarantineRegistry } = {}) {
    this.#secret = typeof options.secret === 'string'
      ? Buffer.from(options.secret, 'utf8')
      : options.secret ?? randomBytes(32);
    this.#quarantine = options.quarantine ?? new QuarantineRegistry();
  }

  public quarantine(): QuarantineRegistry {
    return this.#quarantine;
  }

  public issueApproval(input: {
    approverId: string;
    kind: ApprovalKind;
    subjectId: string;
    missionId: string;
    action: AuthorityScope;
    ttlMs?: number;
  }): string {
    const now = Date.now();
    const ttlMs = Math.max(1_000, Math.min(input.ttlMs ?? 60_000, 10 * 60_000));
    const claim: ApprovalClaim = {
      id: randomUUID(),
      approverId: input.approverId,
      kind: input.kind,
      subjectId: input.subjectId,
      missionId: input.missionId,
      action: input.action,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      nonce: randomUUID(),
    };
    return this.#seal('approval', claim);
  }

  public issueLease(request: LeaseRequest): string {
    if (this.#quarantine.isQuarantined(request.subject.id)) {
      throw new SecurityPolicyError(`Subject is quarantined: ${request.subject.id}`);
    }
    if (!request.missionId.trim()) throw new SecurityPolicyError('Lease missionId is required');
    const scopes = [...new Set(request.scopes)];
    if (scopes.length === 0) throw new SecurityPolicyError('Lease requires at least one scope');

    const approvals = (request.approvals ?? []).map((token) => this.#verifyApproval(token));
    for (const scope of scopes) {
      if (DANGEROUS_SCOPES.has(scope)) {
        const valid = approvals.some((approval) =>
          approval.subjectId === request.subject.id
          && approval.missionId === request.missionId
          && approval.action === scope
          && (approval.kind === 'judge' || approval.kind === 'human' || approval.kind === 'system'));
        if (!valid) throw new SecurityPolicyError(`Independent approval required for ${scope}`);
      }
      if (SOVEREIGN_SCOPES.has(scope)) {
        const valid = approvals.some((approval) =>
          approval.subjectId === request.subject.id
          && approval.missionId === request.missionId
          && approval.action === scope
          && approval.kind === 'human');
        if (!valid) throw new SecurityPolicyError(`Human approval required for sovereign scope ${scope}`);
      }
    }

    const now = Date.now();
    const maxTtl = scopes.some((scope) => DANGEROUS_SCOPES.has(scope) || SOVEREIGN_SCOPES.has(scope))
      ? 2 * 60_000
      : 15 * 60_000;
    const ttlMs = Math.max(1_000, Math.min(request.ttlMs ?? 60_000, maxTtl));
    const dangerous = scopes.some((scope) => DANGEROUS_SCOPES.has(scope) || SOVEREIGN_SCOPES.has(scope));
    const claim: CapabilityLeaseClaim = {
      id: randomUUID(),
      subject: { ...request.subject },
      missionId: request.missionId,
      scopes,
      resourcePrefixes: [...(request.resourcePrefixes ?? [])],
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      oneUse: request.oneUse ?? dangerous,
      nonce: randomUUID(),
    };
    return this.#seal('lease', claim);
  }

  public revokeLease(leaseId: string): void {
    this.#revoked.add(leaseId);
  }

  public verifyLease(token: string, expectation: LeaseExpectation): CapabilityLeaseClaim {
    const claim = this.#open<CapabilityLeaseClaim>('lease', token);
    const now = (expectation.now ?? new Date()).getTime();
    if (this.#quarantine.isQuarantined(expectation.subjectId)) {
      throw new SecurityPolicyError(`Subject is quarantined: ${expectation.subjectId}`);
    }
    if (claim.subject.id !== expectation.subjectId) throw new SecurityPolicyError('Lease subject mismatch');
    if (claim.missionId !== expectation.missionId) throw new SecurityPolicyError('Lease mission mismatch');
    if (!claim.scopes.includes(expectation.scope)) throw new SecurityPolicyError(`Lease lacks scope: ${expectation.scope}`);
    if (Date.parse(claim.expiresAt) <= now) throw new SecurityPolicyError('Lease expired');
    if (this.#revoked.has(claim.id)) throw new SecurityPolicyError('Lease revoked');
    if (claim.oneUse && this.#consumed.has(claim.id)) throw new SecurityPolicyError('One-use lease already consumed');
    if (expectation.resource !== undefined && !matchesResource(expectation.resource, claim.resourcePrefixes)) {
      throw new SecurityPolicyError(`Lease resource denied: ${expectation.resource}`);
    }
    if ((expectation.consume ?? true) && claim.oneUse) this.#consumed.add(claim.id);
    return claim;
  }

  #verifyApproval(token: string): ApprovalClaim {
    const claim = this.#open<ApprovalClaim>('approval', token);
    if (Date.parse(claim.expiresAt) <= Date.now()) throw new SecurityPolicyError('Approval expired');
    return claim;
  }

  #seal(kind: 'lease' | 'approval', payload: CapabilityLeaseClaim | ApprovalClaim): string {
    const encoded = b64url(JSON.stringify(payload));
    const body = `${kind}.${encoded}`;
    const signature = createHmac('sha256', this.#secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  #open<T>(kind: 'lease' | 'approval', token: string): T {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== kind) throw new SecurityPolicyError('Malformed authority token');
    const encoded = parts[1];
    const signature = parts[2];
    if (!encoded || !signature) throw new SecurityPolicyError('Malformed authority token');
    const body = `${kind}.${encoded}`;
    const expected = createHmac('sha256', this.#secret).update(body).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      throw new SecurityPolicyError('Invalid authority signature');
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new SecurityPolicyError('Invalid authority signature');
    }
    try {
      return JSON.parse(fromB64url(encoded)) as T;
    } catch {
      throw new SecurityPolicyError('Invalid authority payload');
    }
  }
}

const DEFAULT_PROTECTED_PATHS = [
  '.github/',
  'packages/security/',
  'SECURITY.md',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
];

function protectedPath(path: string, prefixes: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return prefixes.some((prefix) => {
    const p = normalizePath(prefix);
    return normalized === p || normalized.startsWith(p.endsWith('/') ? p : `${p}/`);
  });
}

export class MotherGuard {
  readonly #kernel: AuthorityKernel;
  readonly #minimumJudges: number;
  readonly #minimumRuns: number;
  readonly #protectedPaths: readonly string[];

  public constructor(kernel: AuthorityKernel, policy: MotherGuardPolicy = {}) {
    this.#kernel = kernel;
    this.#minimumJudges = Math.max(3, Math.floor(policy.minimumIndependentJudges ?? 3));
    this.#minimumRuns = Math.max(1, Math.floor(policy.minimumReproducibleRuns ?? 5));
    this.#protectedPaths = policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS;
  }

  public evaluate(proposal: MotherChangeProposal): MotherGuardDecision {
    const reasons: string[] = [];
    const touchesCritical = proposal.changedPaths.some((path) => protectedPath(path, this.#protectedPaths));
    const risk: MotherRisk = touchesCritical ? 'critical' : 'normal';

    if (proposal.directWrite) reasons.push('direct_mother_write_forbidden');
    if (proposal.forceUpdate) reasons.push('force_update_forbidden');
    if (proposal.targetBranch !== 'main') reasons.push('mother_target_must_be_main');
    if (!proposal.baseSha.trim()) reasons.push('base_sha_required');
    if (!proposal.checks.buildPassed) reasons.push('build_not_passed');
    if (!proposal.checks.testsPassed) reasons.push('tests_not_passed');
    if (!proposal.checks.securityPassed) reasons.push('security_not_passed');
    if (proposal.checks.regressions > 0) reasons.push('regressions_detected');
    if (proposal.checks.reproducibleRuns < this.#minimumRuns) reasons.push('insufficient_reproduction');

    const contributors = new Set(proposal.contributorNodeIds);
    const contributorModels = new Set(proposal.contributorModelKeys);
    const independentJudgeNodes = new Set(proposal.judgeNodeIds.filter((id) => !contributors.has(id)));
    const independentJudgeModels = new Set(proposal.judgeModelKeys.filter((key) => !contributorModels.has(key)));
    if (independentJudgeNodes.size < this.#minimumJudges) reasons.push('insufficient_independent_judge_nodes');
    if (independentJudgeModels.size < Math.min(2, this.#minimumJudges)) reasons.push('insufficient_independent_judge_models');

    if (touchesCritical) {
      const humanApproval = (proposal.approvalTokens ?? []).some((token) => {
        try {
          const claim = this.#kernel.verifyLease(token, {
            subjectId: 'phoenix-mother-change',
            missionId: proposal.candidateId,
            scope: 'promote',
            consume: false,
          });
          return claim.subject.kind === 'human';
        } catch {
          return false;
        }
      });
      if (!humanApproval) reasons.push('human_gate_required_for_security_kernel_or_repo_control_plane');
    }

    return {
      allowed: reasons.length === 0,
      risk,
      reasons,
      requiresPullRequest: true,
      requiresProtectedBranch: true,
    };
  }
}
