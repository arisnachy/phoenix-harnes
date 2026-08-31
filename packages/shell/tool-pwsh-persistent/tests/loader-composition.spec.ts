import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import Include from '@phoenix-ai/cordis-plugin-include'
import { CallId } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import TerminalSessionService from '@phoenix-ai/dsh-terminal'
import * as TerminalBash from '@phoenix-ai/dsh-terminal-bash'
import SandboxProvider from '@phoenix-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@phoenix-ai/dsh-sandbox'
import SandboxPolicyService from '@phoenix-ai/dsh-sandbox-policy'
import LocalSubprocessService from '@phoenix-ai/dsh-subprocess-local'
import { resolvePwshPath } from '@phoenix-ai/dsh-pwsh-local/src/resolve.ts'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRegistry from '@phoenix-ai/dsh-tools'
import * as ToolPwshPersistent from '@phoenix-ai/dsh-tool-pwsh-persistent'

const hasPwsh = spawnSync(
  resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'],
  { encoding: 'utf8' },
).status === 0

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context, cwd: string): Agent {
  const id = SessionId('persistent-pwsh-loader-agent')
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function expectSameDirectory(actual: string, expected: string): Promise<void> {
  const [actualStat, expectedStat] = await Promise.all([stat(actual), stat(expected)])
  expect({ dev: actualStat.dev, ino: actualStat.ino }).toEqual({ dev: expectedStat.dev, ino: expectedStat.ino })
}

describe.skipIf(!hasPwsh)('persistent pwsh through a real cordis.yml Loader composition', () => {
  it('preserves cwd and environment across calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-persistent-pwsh-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@phoenix-ai/dsh-agent'",
      "- name: '@phoenix-ai/dsh-system-prompt'",
      "- name: '@phoenix-ai/dsh-tools'",
      "- name: '@phoenix-ai/dsh-terminal'",
      "- name: '@phoenix-ai/dsh-test-sandbox'",
      "- name: '@phoenix-ai/dsh-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@phoenix-ai/dsh-subprocess-local'",
      "- name: '@phoenix-ai/dsh-terminal-bash'",
      '  config:',
      '    shellDialect: pwsh',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 300',
      '    handoffGraceMs: 300',
      '    scrollbackLines: 20000',
      '    timeoutMs: 8000',
      '    disposeGraceMs: 500',
      "- name: '@phoenix-ai/dsh-tool-pwsh-persistent'",
      '  config:',
      '    timeoutMs: 20000',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@phoenix-ai/dsh-agent', AgentRegistry],
      ['@phoenix-ai/dsh-system-prompt', SystemPrompt],
      ['@phoenix-ai/dsh-tools', ToolRegistry],
      ['@phoenix-ai/dsh-terminal', TerminalSessionService],
      ['@phoenix-ai/dsh-test-sandbox', PassthroughSandbox],
      ['@phoenix-ai/dsh-sandbox-policy', SandboxPolicyService],
      ['@phoenix-ai/dsh-subprocess-local', LocalSubprocessService],
      ['@phoenix-ai/dsh-terminal-bash', TerminalBash],
      ['@phoenix-ai/dsh-tool-pwsh-persistent', ToolPwshPersistent],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context, root)
    const signal = new AbortController().signal
    const execute = (id: string, command: string) => context!.tools.execute({
      signal,
      callId: CallId(id),
      name: 'pwsh',
      arguments: { command },
      agent: owner,
    })

    expect(context.tools.schemas().map(schema => schema.name)).toEqual(['pwsh'])
    await execute('state', '$env:KEEP = "loader"; New-Item -ItemType Directory -Force -Path nested | Out-Null; Set-Location nested')
    const observed = text(await execute('observe', 'Write-Output "cwd=$PWD keep=$env:KEEP"'))
    const observedState = /^cwd=(.+) keep=loader$/m.exec(observed)
    expect(observedState).not.toBeNull()
    await expectSameDirectory(observedState![1]!, join(root, 'nested'))
    expect(observed).not.toContain('DSH_PERSISTENT_PWSH')

    const multiline = text(await execute(
      'multiline',
      '$value = "line one"\nWrite-Output "${value}:it\'s fine"',
    ))
    expect(multiline).toBe("line one:it's fine")
    expect(multiline).not.toContain('DSH_PERSISTENT_PWSH')

    const hereString = text(await execute(
      'here-string',
      "$h = @'\nalpha\nbeta\n'@\nWrite-Output $h",
    ))
    expect(hereString).toBe('alpha\nbeta')

    const large = text(await execute('large-output', "[Console]::Out.Write('x' * 20000)"))
    expect(large.startsWith('xxxx')).toBe(true)
    expect(large).toContain('<response clipped>')
    expect(large).not.toContain('beginning of this command output was dropped')

    const exited = text(await execute('exit', 'exit'))
    expect(exited).toContain('next pwsh call starts from the workspace')
    await expectSameDirectory(text(await execute('after-exit', 'Write-Output "$PWD"')), root)
  }, 60_000)
})
