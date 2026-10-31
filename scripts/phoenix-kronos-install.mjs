#!/usr/bin/env node
/** Opt-in isolated CPU environment, pinned official upstream; no trading credentials. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
const home = resolve(process.env.PHOENIX_KRONOS_HOME || join(homedir(), '.phoenix', 'kronos'))
const source = join(home, 'source')
const python = process.platform === 'win32' ? join(home, '.venv', 'Scripts', 'python.exe') : join(home, '.venv', 'bin', 'python')
const checkout = '67b630e67f6a18c9e9be918d9b4337c960db1e9a'
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 600_000 })
  if (result.error || result.status !== 0) throw new Error('Kronos bootstrap failed: ' + command)
}
function findPython() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3.11']], ['py', ['-3.12']], ['py', ['-3.10']], ['python', []]]
    : [['python3', []], ['python', []]]
  for (const [binary, args] of candidates) {
    const version = spawnSync(binary, [...args, '--version'], { encoding: 'utf8', timeout: 5000 })
    if (version.status === 0 && /Python 3\.(10|11|12)\./.test((version.stdout || '') + (version.stderr || ''))) {
      return [binary, args]
    }
  }
  throw new Error('Python 3.10–3.12 is required')
}
try {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  if (!existsSync(python)) {
    const [binary, prefix] = findPython()
    run(binary, [...prefix, '-m', 'venv', join(home, '.venv')])
  }
  if (!existsSync(join(source, 'model'))) {
    if (!existsSync(join(source, '.git'))) run('git', ['init', source])
    const remote = spawnSync('git', ['-C', source, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
    if (remote.status !== 0) {
      run('git', ['-C', source, 'remote', 'add', 'origin', 'https://github.com/shiyu-coder/Kronos.git'])
    } else if (remote.stdout.trim() !== 'https://github.com/shiyu-coder/Kronos.git') {
      throw new Error('Unexpected Kronos source remote; refusing untrusted dependency')
    }
    run('git', ['-C', source, 'fetch', '--depth=1', 'origin', checkout])
    run('git', ['-C', source, 'checkout', '--detach', 'FETCH_HEAD'])
  } else {
    const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    if (head.status !== 0 || head.stdout.trim() !== checkout) throw new Error('Pinned Kronos source mismatch')
  }
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'torch==2.6.0', '--index-url', 'https://download.pytorch.org/whl/cpu'])
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check',
    'numpy>=1.26,<3', 'pandas==2.2.2', 'einops==0.8.1', 'huggingface_hub==0.33.1',
    'safetensors==0.6.2', 'tqdm==4.67.1'])
  console.log('Kronos CPU environment installed. Model downloaded on first forecast.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Kronos installation failed')
  process.exitCode = 1
}
