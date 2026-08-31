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
  return { ctx, runtime: ctx.pythonCodeRuntime as PythonCodeRuntime }
}

function tools(functions: Record<string, (args: unknown) => Promise<unknown>>): CodeBindingNamespace[] {
  return [{
    global: 'tools',
    functions: functions as Record<string, CodeBindingFunction>,
    errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
  }]
}

describe.skipIf(!available)('PythonCodeRuntime — real CPython subprocesses', () => {
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
})
