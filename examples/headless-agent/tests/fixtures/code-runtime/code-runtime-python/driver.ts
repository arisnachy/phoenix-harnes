#!/usr/bin/env node
/** Exercise the configured Python provider through the real Cordis Loader. */
import { boot, installFailLoud, resolveConfigPath } from '@phoenix-ai/dsh-app-boot'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-code-runtime-python'
import type { CodeJsonValue } from '@phoenix-ai/dsh-code-runtime'

const name = 'python-runtime-loader-fixture'
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('Expected a config path')
const uninstall = installFailLoud(name)
let ctx: Context | undefined
try {
  ctx = await boot(name, resolveConfigPath(configPath, undefined))
  const result = await ctx.pythonCodeRuntime.run({
    program: "for i in range(100):\n    assert await tools.echo({'n': i}) == {'n': i}\n    try:\n        await tools.fail({})\n    except ToolCallError as error:\n        assert error.toolName == 'fail'\nprint('PHOENIX Python bridge verified')\nreturn {'calls': 200}",
    bindings: [{
      global: 'tools',
      functions: {
        echo: async args => args as CodeJsonValue,
        fail: async () => { throw new Error('Expected fixture rejection') },
      },
      errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
    }],
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
