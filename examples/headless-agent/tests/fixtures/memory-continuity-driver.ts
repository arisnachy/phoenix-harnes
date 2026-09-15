#!/usr/bin/env node
/** Snapshot-only Loader driver for durable cognitive-memory continuity. */

import type { Context } from '@phoenix-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@phoenix-ai/dsh-app-boot'
import { SessionId } from '@phoenix-ai/dsh-session'
import { renderContextSnapshot } from '@phoenix-ai/dsh-system-prompt'

const NAME = 'memory-continuity-snapshot-driver'
const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const resolvedConfig = resolveConfigPath(configPath, undefined)
const uninstallFailLoud = installFailLoud(NAME)
let first: Context | undefined
let restarted: Context | undefined
try {
  loadEnv(NAME)
  first = await boot(NAME, resolvedConfig)
  const prior = first.sessions.create(SessionId('memory-snapshot-prior'), { meta: { cwd: '/workspace/phoenix-harnes' } })
  prior.append('user/message', {
    content: [{ type: 'text', text: 'Arregla los avatares reactivos de KIRA y verifica sus estados.' }],
    source: { kind: 'user' },
  } as never, { surfaceOp: 'append' })
  prior.append('tool/call', {
    turn: 1,
    step: 1,
    name: 'github',
    arguments: 'api_key=must-not-appear',
  } as never, { surfaceOp: 'append' })
  prior.append('goal/change' as never, { operation: 'complete' } as never)
  await first.learningMemory.ready()
  await first.fiber.dispose()
  first = undefined

  restarted = await boot(NAME, resolvedConfig)
  const current = restarted.sessions.create(SessionId('memory-snapshot-current'), { meta: { cwd: '/workspace/other-project' } })
  current.append('user/message', {
    content: [{ type: 'text', text: '¿Qué hicimos en los proyectos anteriores?' }],
    source: { kind: 'user' },
  } as never, { surfaceOp: 'append' })
  await restarted.learningMemory.ready()

  const snapshot = renderContextSnapshot(await restarted.systemPrompt.assemble())
  const marker = '## Relevant prior evidence'
  const start = snapshot.indexOf(marker)
  if (start < 0) throw new Error('directed memory context was not assembled')
  const end = snapshot.indexOf('\n## ', start + marker.length)
  const block = snapshot.slice(start, end < 0 ? undefined : end)
    .replace(/"occurred_at":\d+/gu, '"occurred_at":0')
  if (block.includes('must-not-appear')) throw new Error('secret-bearing tool arguments leaked into directed memory')
  process.stdout.write(`${block}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await restarted?.fiber.dispose()
  await first?.fiber.dispose()
  uninstallFailLoud()
}
