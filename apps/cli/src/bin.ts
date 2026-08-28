#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const rawArgs = process.argv.slice(2)

// Codex marketplace management is a PHOENIX launcher capability rather than a
// profile capability. Keep it outside the legacy `dsh plugin` pnpm forwarder:
// the two commands manage different plugin formats and must not reinterpret
// each other's arguments.
if (rawArgs[0] === 'codex-plugin') {
  const { runCodexPlugin } = await import('./codex-plugin.ts')
  process.exit(runCodexPlugin(rawArgs.slice(1)))
}

// OpenClaw skills are a launcher capability rather than a profile plugin:
// syncing and auditing them must work before any profile is parsed or booted.
if (rawArgs[0] === 'openclaw-skills') {
  const { runOpenClawSkills } = await import('./openclaw-skills.ts')
  process.exit(runOpenClawSkills(rawArgs.slice(1)))
}

const invocation = parseDshArgs(rawArgs, readVersion())

switch (invocation.mode) {
  case 'profile': {
    const [{ runProfile }, { startPhoenixUpdateWatcher }] = await Promise.all([
      import('./profile-boot.ts'),
      import('./phoenix-update-watch.ts'),
    ])
    startPhoenixUpdateWatcher()

    // `dsh codex-plugin enable <name>` builds this patch entirely from public
    // plugin metadata and environment-variable references. Loading it here
    // makes enabled Codex MCP servers native PHOENIX tools on the next boot,
    // while PHOENIX_CODEX_PLUGINS=off provides a fail-safe bypass.
    const patches = [...invocation.patches]
    const codexPatch = dshHomePath('codex', 'enabled.patch.yml')
    if ((process.env.PHOENIX_CODEX_PLUGINS ?? 'on').trim().toLowerCase() !== 'off'
      && existsSync(codexPatch) && !patches.includes(codexPatch)) {
      patches.push(codexPatch)
    }

    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
