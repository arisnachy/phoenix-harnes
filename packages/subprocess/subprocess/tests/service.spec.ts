import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Context } from '@phoenix-ai/cordis'
import { scrubbedParentEnv, SubprocessRuntime } from '@phoenix-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@phoenix-ai/dsh-subprocess'

/**
 * Minimal concrete service: a hand-built handle. The seam is spawn-only —
 * defaulting, shell semantics, and deadlines belong to callers — so this stub
 * is all an implementation owes the abstract class.
 */
class StubSubprocessRuntime extends SubprocessRuntime {
  async resolveExecutable(command: string): Promise<string> {
    return `/bin/${command}`
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const read: SubprocessOutputRead = { text: '', nextOffset: 0, lossy: false }
    const collected = spec.stdio.stdout !== 'pipe' && spec.stdio.stdout !== 'inherit'
      ? { stdout: { readFrom: () => read } }
      : {}
    return {
      pid: spec.argv.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected,
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return {
      pid: spec.argv.length,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => ({ processGroupId: 1, inputWaiting: true }),
      signalForeground: async () => 1,
      terminate: async () => {},
    }
  }
}

describe('SubprocessRuntime seam', () => {
  it('a concrete subclass registers as ctx.subprocess and serves the abstract API', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    const handle = ctx.subprocess.spawn({
      argv: ['true'],
      cwd: '/stub',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1 }, stderr: 'inherit' },
      graceMs: 1,
    })
    expect(handle.pid).toBe(1)
    expect(handle.collected.stdout!.readFrom(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
  })

  it('loading a second implementation throws (one subprocess service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    class SecondService extends StubSubprocessRuntime {}
    await expect(ctx.plugin(SecondService)).rejects.toThrow(/service "subprocess" has been registered/)
  })

  it('does not pass broken Git inline configuration tuples into child processes', () => {
    const names = ['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0',
      'GIT_CONFIG_KEY_1','GIT_CONFIG_VALUE_1','GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG_GLOBAL'] as const
    const originals = names.map(name => process.env[name])
    try {
      process.env.GIT_CONFIG_COUNT = '2'
      process.env.GIT_CONFIG_KEY_0 = 'user.name'
      process.env.GIT_CONFIG_VALUE_0 = 'fixture'
      process.env.GIT_CONFIG_KEY_1 = 'user.email'
      process.env.GIT_CONFIG_VALUE_1 = 'fixture@example.test'
      process.env.GIT_CONFIG_PARAMETERS = "'user.name=fixture'"
      process.env.GIT_CONFIG_GLOBAL = 'test-git-config-path'
      const environment = scrubbedParentEnv()
      for (const key of names.slice(0,-1)) expect(environment[key]).toBeUndefined()
      expect(environment.GIT_CONFIG_GLOBAL).toBe('test-git-config-path')
    } finally {
      names.forEach((name,index) => {
        const original = originals[index]
        if (original === undefined) delete process.env[name]
        else process.env[name] = original
      })
    }
  })

  it('runs real git init without the original fatal GIT_CONFIG_KEY_0 error', () => {
    if (spawnSync('git', ['--version'], { encoding:'utf8' }).status !== 0) return
    const original = {
      count:process.env.GIT_CONFIG_COUNT,
      key:process.env.GIT_CONFIG_KEY_0,
      value:process.env.GIT_CONFIG_VALUE_0,
    }
    const cwd = mkdtempSync(join(tmpdir(), 'phoenix-git-config-'))
    try {
      process.env.GIT_CONFIG_COUNT = '1'
      delete process.env.GIT_CONFIG_KEY_0
      process.env.GIT_CONFIG_VALUE_0 = 'fixture'
      const broken = spawnSync('git', ['init', '--bare'], {
        cwd, encoding:'utf8', env: { ...process.env },
      })
      expect(broken.status).not.toBe(0)
      expect(broken.stderr).toMatch(/GIT_CONFIG_KEY_0|unable to parse command-line config/iu)
      const repaired = spawnSync('git', ['init', '--bare'], {
        cwd, encoding:'utf8', env: scrubbedParentEnv(),
      })
      expect(repaired.status).toBe(0)
    } finally {
      if (original.count === undefined) delete process.env.GIT_CONFIG_COUNT
      else process.env.GIT_CONFIG_COUNT = original.count
      if (original.key === undefined) delete process.env.GIT_CONFIG_KEY_0
      else process.env.GIT_CONFIG_KEY_0 = original.key
      if (original.value === undefined) delete process.env.GIT_CONFIG_VALUE_0
      else process.env.GIT_CONFIG_VALUE_0 = original.value
      rmSync(cwd, {recursive:true,force:true})
    }
  })

  it('scrubbedParentEnv drops credentials, harness state, and implicit loader injection while keeping ordinary runtime state', () => {
    process.env.DSH_SCRUB_PROBE = 'stale'
    process.env.dsh_scrub_probe_lower = 'stale'
    process.env.SCRUB_PROBE_TOKEN = 'secret'
    process.env.SCRUB_PROBE_PASSWORD = 'secret'
    process.env.SCRUB_PROBE_PLAIN = 'visible'
    process.env.LD_PRELOAD = '/tmp/evil.so'
    process.env.LD_AUDIT = '/tmp/audit.so'
    process.env.DYLD_INSERT_LIBRARIES = '/tmp/evil.dylib'
    process.env.NODE_OPTIONS = '--require=/tmp/evil.cjs'
    try {
      const env = scrubbedParentEnv()
      expect(env.DSH_SCRUB_PROBE).toBeUndefined()
      expect(env.dsh_scrub_probe_lower).toBeUndefined()
      expect(env.SCRUB_PROBE_TOKEN).toBeUndefined()
      expect(env.SCRUB_PROBE_PASSWORD).toBeUndefined()
      expect(env.LD_PRELOAD).toBeUndefined()
      expect(env.LD_AUDIT).toBeUndefined()
      expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined()
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(env.SCRUB_PROBE_PLAIN).toBe('visible')
      expect(env.PATH).toBeDefined()
    } finally {
      delete process.env.DSH_SCRUB_PROBE
      delete process.env.dsh_scrub_probe_lower
      delete process.env.SCRUB_PROBE_TOKEN
      delete process.env.SCRUB_PROBE_PASSWORD
      delete process.env.SCRUB_PROBE_PLAIN
      delete process.env.LD_PRELOAD
      delete process.env.LD_AUDIT
      delete process.env.DYLD_INSERT_LIBRARIES
      delete process.env.NODE_OPTIONS
    }
  })
})
