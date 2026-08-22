import { describe, expect, it } from 'vitest';
import { AuthorityKernel } from '@phoenix/security';
import { ToolPolicyError, ToolRegistry } from './tools.js';

describe('secure tool execution', () => {
  it('blocks dangerous tools without a capability lease and allows a bounded approved lease once', async () => {
    const tools = new ToolRegistry();
    let executed = 0;
    tools.register({
      name: 'write-file',
      inputSchema: { type: 'object' },
      risk: 'write',
      async execute() {
        executed += 1;
        return { ok: true };
      },
    });

    const kernel = new AuthorityKernel({ secret: 'tool-boundary-secret' });
    await expect(tools.execute('write-file', { path: 'workspace/a.txt' }, {
      requireAuthorityFor: ['write'],
      authority: kernel,
    })).rejects.toThrow(ToolPolicyError);
    expect(executed).toBe(0);

    const approval = kernel.issueApproval({
      approverId: 'judge-a',
      kind: 'judge',
      subjectId: 'agent-a',
      missionId: 'mission-a',
      action: 'write',
    });
    const lease = kernel.issueLease({
      subject: { id: 'agent-a', kind: 'model' },
      missionId: 'mission-a',
      scopes: ['write'],
      resourcePrefixes: ['workspace/'],
      approvals: [approval],
    });
    const policy = {
      requireAuthorityFor: ['write'] as const,
      authority: kernel,
      async authorityFor() {
        return { token: lease, subjectId: 'agent-a', missionId: 'mission-a', resource: 'workspace/a.txt' };
      },
    };

    await expect(tools.execute('write-file', { path: 'workspace/a.txt' }, policy)).resolves.toEqual({ ok: true });
    expect(executed).toBe(1);
    await expect(tools.execute('write-file', { path: 'workspace/a.txt' }, policy)).rejects.toThrow(/already consumed/);
    expect(executed).toBe(1);
  });
});
