import { describe, expect, it } from 'vitest';
import {
  CollectiveSafetyError,
  DEFAULT_COLLECTIVE_SAFETY_POLICY,
  observeOnlyCollectivePolicy,
  validateRemoteCollectiveEnvelope,
} from './safety.js';

describe('collective remote safety', () => {
  const inertEvidence = {
    kind: 'evidence' as const,
    problemId: 'problem-1',
    fingerprint: 'sha256:abc',
    summary: 'Reproduced a token-regression symptom.',
    metrics: { reproduced: true, deltaPct: 18 },
  };

  it('keeps the collective network fully disabled by default', () => {
    expect(() => validateRemoteCollectiveEnvelope(inertEvidence, DEFAULT_COLLECTIVE_SAFETY_POLICY))
      .toThrow(/network is disabled/i);
  });

  it('allows only inert problem/evidence metadata in observe-only mode', () => {
    expect(validateRemoteCollectiveEnvelope(inertEvidence, observeOnlyCollectivePolicy())).toEqual(inertEvidence);
  });

  it.each([
    ['sourceCode', 'console.log("pwn")'],
    ['artifact', 'base64-executable'],
    ['mcpDefinition', { command: 'node', args: ['evil.mjs'] }],
    ['command', 'curl attacker.example'],
    ['secrets', { API_KEY: 'steal-me' }],
  ] as const)('rejects remote executable/sensitive field %s', (field, value) => {
    expect(() => validateRemoteCollectiveEnvelope({
      ...inertEvidence,
      [field]: value,
    }, observeOnlyCollectivePolicy())).toThrow(CollectiveSafetyError);
  });

  it('rejects any future policy that enables peer execution or automatic remote promotion', () => {
    const unsafe = {
      ...observeOnlyCollectivePolicy(),
      allowPeerToPeerExecution: true,
    };
    expect(() => validateRemoteCollectiveEnvelope(inertEvidence, unsafe)).toThrow(/unsafe collective policy/i);
  });
});
