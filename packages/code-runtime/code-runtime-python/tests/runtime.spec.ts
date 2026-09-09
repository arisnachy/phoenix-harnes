import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context } from '@phoenix-ai/cordis'
import type { CodeBindingFunction, CodeBindingNamespace } from '@phoenix-ai/dsh-code-runtime'
import { PythonCodeRuntime } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

async function pythonAvailable(): Promise<boolean> {
  for (const command of process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) {
    try {
      await execFileAsync(command, ['--version'])
      return true
    } catch { /* try the next platform spelling */ }
  }
  return false
}

const available = await pythonAvailable()

async function setup(config: Config = {}) {
  const ctx = new Context()
  const command = process.platform === 'win32' ? 'python' : 'python3'
  await ctx.plugin(PythonCodeRuntime, { maxWallMs: 10_000, ...config, pythonCommand: command })
  return { ctx, runtime: ctx.pythonCodeRuntime }
}

function tools(functions: Record<string, (args: unknown) => Promise<unknown>>): CodeBindingNamespace[] {
  return [{
    global: 'tools',
    functions: functions as Record<string, CodeBindingFunction>,
    errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
  }]
}

describe.skipIf(!available)('PythonCodeRuntime — real CPython subprocesses', () => {
  it('disposal aborts an active subprocess and rejects later runs', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(PythonCodeRuntime, {
      pythonCommand: process.platform === 'win32' ? 'python' : 'python3',
      maxWallMs: 10_000,
    })
    const runtime = ctx.pythonCodeRuntime
    const started = Promise.withResolvers<undefined>()
    const inflight = runtime.run({
      program: 'await tools.started({})\nimport asyncio\nawait asyncio.sleep(60)',
      bindings: tools({ started: async () => { started.resolve(undefined); return null } }),
    })
    try {
      await started.promise
      await fiber.dispose()
      expect((await inflight).error).toEqual({ kind: 'abort', message: 'runtime disposed' })
      await expect(runtime.run({ program: 'return 1', bindings: [] })).rejects.toThrow(/after disposal/u)
    } finally {
      await fiber.dispose()
    }
  }, 15_000)

  it('registers a Python process runtime and executes a program', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: "print('hello')\nreturn {'answer': 6 * 7}", bindings: [] })
    expect(runtime.language).toBe('python')
    expect(runtime.isolation).toBe('process')
    expect(result.error).toBeUndefined()
    expect(result.logs).toEqual(['hello\n'])
    expect(result.value).toEqual({ answer: 42 })
  })

  it('bridges async bindings and exposes the declared member on failures', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({
      program: "first = await tools.echo({'n': 2})\ntry:\n    await tools.fail({})\nexcept ToolCallError as error:\n    caught = {'tool': error.toolName, 'message': str(error)}\nreturn {'first': first, 'caught': caught}",
      bindings: tools({
        echo: async args => ({ echoed: args }),
        fail: async () => { throw new Error('nope') },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual({ first: { echoed: { n: 2 } }, caught: { tool: 'fail', message: 'nope' } })
  })

  it('reports a program exception as a result field', async () => {
    const { runtime } = await setup()
    const result = await runtime.run({ program: 'raise ValueError("bad input")', bindings: [] })
    expect(result.error?.kind).toBe('exception')
    expect(result.error?.message).toContain('bad input')
  })

  it('exchanges repeated successful and rejected bindings while the reply reader is active', async () => {
    const { runtime } = await setup({ maxWallMs: 3000 })
    const result = await runtime.run({
      program: "for i in range(100):\n    value = await tools.echo({'n': i})\n    assert value['n'] == i\n    try:\n        await tools.fail({})\n    except ToolCallError as error:\n        assert error.toolName == 'fail'\nreturn 100",
      bindings: tools({
        echo: async args => args,
        fail: async () => { throw new Error('expected rejection') },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(100)
  })

  it('correlates concurrent binding replies that complete out of order', async () => {
    const { runtime } = await setup({ maxWallMs: 3000 })
    const secondStarted = Promise.withResolvers<undefined>()
    const completed: string[] = []
    const result = await runtime.run({
      program: 'import asyncio\nreturn await asyncio.gather(tools.first({}), tools.second({}))',
      bindings: tools({
        first: async () => { await secondStarted.promise; completed.push('first'); return 'first' },
        second: async () => { completed.push('second'); secondStarted.resolve(undefined); return 'second' },
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual(['first', 'second'])
    expect(completed).toEqual(['second', 'first'])
  })
})
