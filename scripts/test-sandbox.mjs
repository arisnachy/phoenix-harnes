// Runs the vitest unit suite inside the PHOENIX execution sandbox, which
// rejects child_process.spawn with `EPERM`. Two things make vitest fail there:
//
//   1. Vite 8 bundles vitest.config.ts and, on Windows, runs `exec("net use")`
//      to map UNC drives — a spawn the sandbox rejects. vitest-sandbox-preload.cjs
//      neutralizes exactly that call (loaded here via NODE_OPTIONS).
//   2. The default `pool: 'forks'` forks a child per worker. `--pool=threads`
//      uses worker threads instead, so no worker subprocess is spawned.
//
// CI and ordinary local runs keep `forks` (vitest.config.ts is unchanged); this
// launcher is an opt-in path for sandboxed hosts.
//
// Usage: pnpm run test:sandbox [-- <filters/args>]
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const preload = fileURLToPath(new URL('./vitest-sandbox-preload.cjs', import.meta.url))
const existing = process.env.NODE_OPTIONS ?? ''
const env = {
  ...process.env,
  NODE_OPTIONS: `${existing} --require=${preload}`.trim(),
}

// Prefer corepack's pnpm.cjs entry: `pnpm`/`pnpm.cmd` are shell shims that
// spawnSync cannot start without a shell, and the sandbox forbids shells.
const pnpm = process.env.npm_execpath ?? 'pnpm'
const args = ['exec', 'vitest', 'run', '--pool=threads', ...process.argv.slice(2)]

const result = spawnSync(process.execPath, [pnpm, ...args], { stdio: 'inherit', env })
if (result.error) {
  console.error(`test-sandbox: failed to start vitest: ${result.error.code} ${result.error.message}`)
  process.exit(2)
}
process.exit(result.status ?? 1)
