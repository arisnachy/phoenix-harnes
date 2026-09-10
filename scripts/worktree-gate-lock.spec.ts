import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGate } from './run-gates.ts'
import { acquireWorktreeGateLock } from './worktree-gate-lock.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'phoenix-gate-lock-'))
  roots.push(value)
  return value
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function waitForFile(path: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await fileExists(path))) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}

function waitForProcess(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => { resolve({ code, signal }) })
  })
}

describe('worktree gate lock', () => {
  it('serializes concurrent recovery without deleting a replacement owner', async () => {
    const cwd = await root()
    const moduleUrl = new URL('./worktree-gate-lock.ts', import.meta.url).href
    await writeFile(join(cwd, '.phoenix-gates.lock'), JSON.stringify({
      pid: 999_999, token: 'crashed', mode: 'crashed', createdAt: new Date().toISOString(),
    }))
    const results = await Promise.all([0, 1, 2].map(index => runGate({
      id: `reclaimer-${String(index)}`, label: 'concurrent reclaimer', displayCommand: 'concurrent reclaimer fixture',
      command: process.execPath,
      args: ['--import', 'tsx/esm', '--input-type=module', '--eval', `
        import { access, readFile, writeFile } from 'node:fs/promises';
        import { join } from 'node:path';
        import { acquireWorktreeGateLock } from ${JSON.stringify(moduleUrl)};
        const root = ${JSON.stringify(cwd)};
        await writeFile(join(root, 'ready-${String(index)}'), 'ready');
        const deadline = Date.now() + 5_000;
        for (;;) {
          try { await Promise.all([0, 1, 2].map(index => access(join(root, 'ready-' + index)))); break; }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            if (Date.now() >= deadline) throw new Error('reclaimer barrier timed out');
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
        const lock = await acquireWorktreeGateLock(root, 'reclaimer-${String(index)}', { retryMs: 1, timeoutMs: 5_000 });
        try {
          await new Promise(resolve => setTimeout(resolve, 50));
          const current = JSON.parse(await readFile(lock.path, 'utf8'));
          if (current.token !== lock.token) throw new Error('a competing recovery deleted the replacement owner');
        } finally { await lock.release(); }
      `],
    })))
    expect(results.map(result => ({ status: result.status, error: result.error })))
      .toEqual([0, 1, 2].map(() => ({ status: 'passed', error: undefined })))
  }, 15_000)

  it('shares ownership with a real child gate while excluding unrelated aggregates', async () => {
    const cwd = await root()
    const parent = await acquireWorktreeGateLock(cwd, 'ci-consumers')
    try {
      const moduleUrl = new URL('./worktree-gate-lock.ts', import.meta.url).href
      const result = await runGate({
        id: 'nested-lock', label: 'nested lock', displayCommand: 'nested lock fixture',
        command: process.execPath,
        args: ['--import', 'tsx/esm', '--input-type=module', '--eval', `
          import { acquireWorktreeGateLock } from ${JSON.stringify(moduleUrl)};
          const lock = await acquireWorktreeGateLock(${JSON.stringify(cwd)}, 'node-compat', {
            inheritedToken: process.env.PHOENIX_GATE_LOCK_TOKEN, timeoutMs: 100, retryMs: 5,
          });
          await lock.release();
        `],
        env: { PHOENIX_GATE_LOCK_TOKEN: parent.token },
      })
      expect(result.status, JSON.stringify(result.output)).toBe('passed')
      await expect(acquireWorktreeGateLock(cwd, 'independent', {
        retryMs: 1, timeoutMs: 5,
      })).rejects.toThrow(/ci-consumers/u)
    } finally {
      await parent.release()
    }
  })

  it('replaces a dead parent instead of borrowing its stale ownership', async () => {
    const cwd = await root()
    await writeFile(join(cwd, '.phoenix-gates.lock'), JSON.stringify({
      pid: 999_999, token: 'dead-parent', mode: 'old', createdAt: new Date().toISOString(),
    }))
    const lock = await acquireWorktreeGateLock(cwd, 'build', {
      inheritedToken: 'dead-parent', processAlive: () => false,
    })
    expect(lock.token).not.toBe('dead-parent')
    await lock.release()
  })

  it('lets a nested aggregate share its live parent lock without releasing it', async () => {
    const cwd = await root()
    const parent = await acquireWorktreeGateLock(cwd, 'ci-consumers')
    try {
      const child = await acquireWorktreeGateLock(cwd, 'node-compat', {
        inheritedToken: parent.token, retryMs: 1, timeoutMs: 1_000,
      })
      await child.release()
      expect(JSON.parse(await readFile(parent.path, 'utf8'))).toMatchObject({ mode: 'ci-consumers' })
    } finally {
      await parent.release()
    }
  })

  it('keeps the parent lock while release waits for a live borrower', async () => {
    const cwd = await root()
    const parent = await acquireWorktreeGateLock(cwd, 'ci-consumers', { retryMs: 5, timeoutMs: 1_000 })
    let borrower: Awaited<ReturnType<typeof acquireWorktreeGateLock>> | undefined
    let parentRelease: Promise<void> | undefined
    try {
      borrower = await acquireWorktreeGateLock(cwd, 'node-compat', {
        inheritedToken: parent.token, retryMs: 5, timeoutMs: 1_000,
      })
      parentRelease = parent.release()
      await waitForFile(`${parent.path}.closing-${parent.token}`)
      await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
      expect(JSON.parse(await readFile(parent.path, 'utf8'))).toMatchObject({
        pid: process.pid,
        token: parent.token,
        mode: 'ci-consumers',
      })

      await borrower.release()
      await parentRelease
      expect(await fileExists(parent.path)).toBe(false)
    } finally {
      await borrower?.release()
      if (parentRelease !== undefined) await parentRelease
      else await parent.release()
    }
  })

  it('keeps a crashed parent lock until its live borrower exits', async () => {
    const cwd = await root()
    const moduleUrl = new URL('./worktree-gate-lock.ts', import.meta.url).href
    const parentReady = join(cwd, 'parent-ready')
    const parentToken = join(cwd, 'parent-token')
    const borrowerReady = join(cwd, 'borrower-ready')
    const borrowerStop = join(cwd, 'borrower-stop')
    const borrowerDone = join(cwd, 'borrower-done')
    const borrowerScript = `
      import { access, writeFile } from 'node:fs/promises';
      import { acquireWorktreeGateLock } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(cwd)};
      const stop = ${JSON.stringify(borrowerStop)};
      const lock = await acquireWorktreeGateLock(root, 'borrower', {
        inheritedToken: process.env.PHOENIX_GATE_LOCK_TOKEN, timeoutMs: 1_000, retryMs: 5,
      });
      await writeFile(${JSON.stringify(borrowerReady)}, 'ready');
      for (;;) {
        try { await access(stop); break; } catch (error) {
          if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await lock.release();
      await writeFile(${JSON.stringify(borrowerDone)}, 'done');
    `
    const parentScript = `
      import { writeFile } from 'node:fs/promises';
      import { acquireWorktreeGateLock } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(cwd)};
      const parentReady = ${JSON.stringify(parentReady)};
      const parentToken = ${JSON.stringify(parentToken)};
      const lock = await acquireWorktreeGateLock(root, 'parent');
      await writeFile(parentToken, lock.token);
      await writeFile(parentReady, 'ready');
      await new Promise((resolve) => { setInterval(resolve, 2_147_483_647) });
    `
    const parent = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', parentScript], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    const parentExit = waitForProcess(parent)
    const parentErrors: string[] = []
    parent.stderr?.setEncoding('utf8')
    parent.stderr?.on('data', (chunk: string) => { parentErrors.push(chunk) })
    let borrower: ChildProcess | undefined
    let borrowerExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined
    try {
      try {
        await waitForFile(parentReady, 5_000)
      } catch (error: unknown) {
        const detail = parentErrors.join('').trim()
        throw new Error(`${error instanceof Error ? error.message : String(error)}${detail.length > 0 ? `: ${detail}` : ''}`)
      }
      const token = (await readFile(parentToken, 'utf8')).trim()
      expect(token).not.toBe('')
      borrower = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', borrowerScript], {
        cwd: process.cwd(),
        env: { ...process.env, PHOENIX_GATE_LOCK_TOKEN: token },
        stdio: 'ignore',
        windowsHide: true,
      })
      borrowerExit = waitForProcess(borrower)
      await waitForFile(borrowerReady)
      parent.kill()
      await parentExit
      await expect(acquireWorktreeGateLock(cwd, 'independent', { retryMs: 5, timeoutMs: 100 }))
        .rejects.toThrow(/PID .*parent/u)
      await writeFile(borrowerStop, 'stop')
      await waitForFile(borrowerDone)
      await borrowerExit
      const recovered = await acquireWorktreeGateLock(cwd, 'independent', { retryMs: 5, timeoutMs: 1_000 })
      await recovered.release()
    } finally {
      await writeFile(borrowerStop, 'stop')
      if (borrower !== undefined && borrower.exitCode === null && borrower.signalCode === null) borrower.kill()
      if (parent.exitCode === null && parent.signalCode === null) parent.kill()
      await Promise.all([
        parentExit,
        borrowerExit ?? Promise.resolve({ code: null, signal: null }),
      ])
    }
  }, 15_000)

  it('rejects an inherited token from another worktree', async () => {
    const first = await acquireWorktreeGateLock(await root(), 'ci-consumers')
    const cwd = await root()
    const second = await acquireWorktreeGateLock(cwd, 'build')
    try {
      await expect(acquireWorktreeGateLock(cwd, 'node-compat', {
        inheritedToken: first.token, retryMs: 1, timeoutMs: 5,
      })).rejects.toThrow(/PID .*build/u)
    } finally {
      await first.release()
      await second.release()
    }
  })

  it('retains ownership until the holder releases it', async () => {
    const cwd = await root()
    const first = await acquireWorktreeGateLock(cwd, 'typecheck')
    const waiting = acquireWorktreeGateLock(cwd, 'build', { retryMs: 5, timeoutMs: 2_000 })
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    await first.release()
    const second = await waiting
    expect(JSON.parse(await readFile(second.path, 'utf8'))).toMatchObject({ mode: 'build' })
    await second.release()
  })

  it('recovers a lock whose owner process no longer exists', async () => {
    const cwd = await root()
    await writeFile(join(cwd, '.phoenix-gates.lock'), JSON.stringify({
      pid: 999_999, token: 'dead', mode: 'old', createdAt: new Date().toISOString(),
    }))
    const lock = await acquireWorktreeGateLock(cwd, 'check-all', { processAlive: () => false })
    expect(JSON.parse(await readFile(lock.path, 'utf8'))).toMatchObject({ mode: 'check-all' })
    await lock.release()
  })

  it('does not delete a live owner when waiting times out', async () => {
    const cwd = await root()
    const first = await acquireWorktreeGateLock(cwd, 'doc-sync')
    await expect(acquireWorktreeGateLock(cwd, 'build', {
      retryMs: 1,
      timeoutMs: 5,
      processAlive: () => true,
    })).rejects.toThrow(/PID .*doc-sync/u)
    expect(await readFile(first.path, 'utf8')).toContain('doc-sync')
    await first.release()
  })
})
