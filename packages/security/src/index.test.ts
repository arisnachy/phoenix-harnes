import { describe, expect, it } from 'vitest';
import {
  AuthorityKernel,
  MotherGuard,
  QuarantineRegistry,
  SecurityPolicyError,
  SecurityTripwire,
} from './index.js';

describe('PHOENIX Security Membrane', () => {
  it('rejects forged authority, mission mismatch and replay of dangerous one-use leases', () => {
    const kernel = new AuthorityKernel({ secret: 'test-secret-that-model-never-sees' });
    const approval = kernel.issueApproval({
      approverId: 'judge-1',
      kind: 'judge',
      subjectId: 'model-a',
      missionId: 'mission-1',
      action: 'exec',
    });
    const lease = kernel.issueLease({
      subject: { id: 'model-a', kind: 'model', modelKey: 'provider::model-a' },
      missionId: 'mission-1',
      scopes: ['exec'],
      resourcePrefixes: ['workspace/scripts/'],
      approvals: [approval],
    });

    expect(() => kernel.verifyLease(`${lease}tampered`, {
      subjectId: 'model-a', missionId: 'mission-1', scope: 'exec', resource: 'workspace/scripts/check.js',
    })).toThrow(SecurityPolicyError);

    expect(() => kernel.verifyLease(lease, {
      subjectId: 'model-a', missionId: 'other-mission', scope: 'exec', resource: 'workspace/scripts/check.js',
    })).toThrow(/mission mismatch/);

    expect(kernel.verifyLease(lease, {
      subjectId: 'model-a', missionId: 'mission-1', scope: 'exec', resource: 'workspace/scripts/check.js',
    }).subject.id).toBe('model-a');

    expect(() => kernel.verifyLease(lease, {
      subjectId: 'model-a', missionId: 'mission-1', scope: 'exec', resource: 'workspace/scripts/check.js',
    })).toThrow(/already consumed/);
  });

  it('requires independent approval for write/exec and human approval for sovereign authority', () => {
    const kernel = new AuthorityKernel({ secret: 'authority-secret' });
    expect(() => kernel.issueLease({
      subject: { id: 'model-a', kind: 'model' },
      missionId: 'm1',
      scopes: ['write'],
      resourcePrefixes: ['workspace/'],
    })).toThrow(/Independent approval/);

    const judge = kernel.issueApproval({
      approverId: 'judge', kind: 'judge', subjectId: 'model-a', missionId: 'm1', action: 'promote',
    });
    expect(() => kernel.issueLease({
      subject: { id: 'model-a', kind: 'model' },
      missionId: 'm1',
      scopes: ['promote'],
      approvals: [judge],
    })).toThrow(/Human approval/);
  });

  it('quarantines a subject after a critical tripwire and blocks future leases', () => {
    const quarantine = new QuarantineRegistry();
    const tripwire = new SecurityTripwire(quarantine);
    const kernel = new AuthorityKernel({ secret: 'quarantine-secret', quarantine });
    tripwire.record({ subjectId: 'rogue-model', type: 'self_promotion' });
    expect(quarantine.isQuarantined('rogue-model')).toBe(true);
    expect(() => kernel.issueLease({
      subject: { id: 'rogue-model', kind: 'model' },
      missionId: 'm1',
      scopes: ['read'],
      resourcePrefixes: ['workspace/'],
    })).toThrow(/quarantined/);
  });

  it('rejects Mother changes when builders judge themselves or checks regress', () => {
    const kernel = new AuthorityKernel({ secret: 'mother-secret' });
    const guard = new MotherGuard(kernel, { minimumIndependentJudges: 3, minimumReproducibleRuns: 3 });
    const decision = guard.evaluate({
      candidateId: 'candidate-1',
      baseSha: 'abc123',
      targetBranch: 'main',
      directWrite: false,
      forceUpdate: false,
      changedPaths: ['packages/router/src/index.ts'],
      contributorNodeIds: ['n1'],
      contributorModelKeys: ['p::builder'],
      judgeNodeIds: ['n1', 'n2', 'n3'],
      judgeModelKeys: ['p::builder', 'q::judge', 'r::judge'],
      checks: {
        buildPassed: true,
        testsPassed: true,
        securityPassed: true,
        regressions: 1,
        reproducibleRuns: 5,
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('regressions_detected');
    expect(decision.reasons).toContain('insufficient_independent_judge_nodes');
  });

  it('allows an ordinary candidate only with independent evidence and keeps security-kernel changes behind a human gate', () => {
    const kernel = new AuthorityKernel({ secret: 'mother-human-secret' });
    const guard = new MotherGuard(kernel, { minimumIndependentJudges: 3, minimumReproducibleRuns: 3 });
    const base = {
      candidateId: 'candidate-2',
      baseSha: 'abc123',
      targetBranch: 'main',
      directWrite: false,
      forceUpdate: false,
      contributorNodeIds: ['builder-node'],
      contributorModelKeys: ['provider::builder'],
      judgeNodeIds: ['j1', 'j2', 'j3'],
      judgeModelKeys: ['a::judge', 'b::judge', 'c::judge'],
      checks: {
        buildPassed: true,
        testsPassed: true,
        securityPassed: true,
        regressions: 0,
        reproducibleRuns: 5,
      },
    } as const;

    expect(guard.evaluate({ ...base, changedPaths: ['packages/router/src/index.ts'] }).allowed).toBe(true);
    const critical = guard.evaluate({ ...base, changedPaths: ['packages/security/src/index.ts'] });
    expect(critical.allowed).toBe(false);
    expect(critical.reasons).toContain('human_gate_required_for_security_kernel_or_repo_control_plane');

    const approval = kernel.issueApproval({
      approverId: 'owner',
      kind: 'human',
      subjectId: 'phoenix-mother-change',
      missionId: 'candidate-2',
      action: 'promote',
    });
    const gateLease = kernel.issueLease({
      subject: { id: 'phoenix-mother-change', kind: 'human' },
      missionId: 'candidate-2',
      scopes: ['promote'],
      approvals: [approval],
      oneUse: false,
      ttlMs: 60_000,
    });
    expect(guard.evaluate({
      ...base,
      changedPaths: ['packages/security/src/index.ts'],
      approvalTokens: [gateLease],
    }).allowed).toBe(true);
  });
});
