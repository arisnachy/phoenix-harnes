/** User-scoped, optional Windows accelerator provisioning. Never changes drivers or active models. */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, openSync, closeSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { homedir, freemem, availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

import { selectAccelerator, confirmedOffload } from './phoenix-local-acceleration-policy.mjs'

const exec = promisify(execFile)
const version = 'b10964'
// SHA-256 values published by ggml-org/llama.cpp in attestation 47376843.
const assets = {
  cpu: ['917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7'],
  vulkan: ['1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642'],
  'cuda-12.4': ['264f20d7ee3860aecca9ec12418357a9f3e80349a2b186f66c63859ded1a9593',
    '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'],
  'cuda-13.3': ['cd63ae76ad78a1540aa0f30f6c6284bab14c146d99a58f70c3f0a38cb9c62351',
    '1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e'],
  'rocm-10.0': ['1f75c2a7cc64b7d4ee30f1e5a65ebec3681e4a67be788fc7251abc898f98748e'],
  sycl: ['18820bc29cd38ceb664034acd426a59b3bae3704c580added5fd17dd1ddd632e'],
  'openvino-2026.3.1': ['f607ea279c0ffd85c13bcd050768631c73b400d16c6e5e1de9ff468ad33c6456'],
}
const localRoot = join(resolve(process.env.PHOENIX_HOME?.trim() || join(homedir(), '.phoenix')), 'local-models')
const base = join(localRoot, 'accelerators', version)
const statusPath = join(base, 'status.json')
const execOptions = { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }

/** Plan candidate backends by PCI vendor, not marketing names. An adapter is not proof of compute support. */
export function candidatesForHardware(pnpIds) {
  const ids = pnpIds.map(id => String(id).toUpperCase())
  const choices = []
  if (ids.some(id => id.includes('VEN_10DE'))) choices.push('cuda-12.4', 'cuda-13.3')
  if (ids.some(id => id.includes('VEN_1002'))) choices.push('rocm-10.0')
  if (ids.some(id => id.includes('VEN_8086'))) choices.push('sycl', 'openvino-2026.3.1')
  if (choices.length) choices.unshift('vulkan')
  return [...new Set(choices)]
}

async function hardware() {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_VideoController | Where-Object { $_.ConfigManagerErrorCode -eq 0 } | Select-Object -ExpandProperty PNPDeviceID | ConvertTo-Json -Compress'], execOptions)
  const parsed = stdout.trim() ? JSON.parse(stdout) : []
  return Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : []
}

async function findServer(dir, filename = 'llama-server.exe') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const candidate = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === filename) return candidate
    if (entry.isDirectory()) {
      const nested = await findServer(candidate, filename)
      if (nested) return nested
    }
  }
  return undefined
}

async function unpack(stage, name, digest, destination) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid pinned SHA-256')
  const disk = await statfs(stage)
  if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw new Error('Insufficient temporary storage (8 GiB reserve)')
  const archive = join(stage, name)
  try {
    const response = await fetch('https://github.com/ggml-org/llama.cpp/releases/download/' + version + '/' + name,
      { signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) throw new Error('HTTP ' + response.status + ': ' + name)
    const size = Number(response.headers.get('content-length'))
    if (!Number.isSafeInteger(size) || size <= 0 || size * 4 + 4 * 1024 ** 3 > disk.bavail * disk.bsize) {
      throw new Error('Unknown or excessive archive size: ' + name)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }))
    if ((await stat(archive)).size !== size) throw new Error('Archive length mismatch')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest('hex') !== digest) throw new Error('SHA-256 mismatch: ' + name)
    await exec('tar.exe', ['-xf', archive, '-C', destination], { ...execOptions, timeout: 120_000 })
  } finally {
    await rm(archive, { force: true })
  }
}

async function probe(server, backend) {
  const { stdout, stderr } = await exec(server, ['--list-devices'], { ...execOptions, cwd: dirname(server) })
  // Require an enumerated accelerator entry, not merely a loaded library.
  const pattern = backend === 'vulkan' ? /Vulkan\d+\s*:/i
    : backend.startsWith('cuda') ? /CUDA\d+\s*:/i
    : backend.startsWith('rocm') ? /(?:ROCm|HIP|CUDA)\d+\s*:/i
    : backend === 'sycl' ? /SYCL\d+\s*:/i
    : /(?:OpenVINO|GPU|NPU)[\w.]*\s*:/i
  if (!pattern.test(stdout + '\n' + stderr)) throw new Error('No matching compute device enumerated')
}

async function ensure(backend) {
  const target = join(base, backend)
  // Never overwrite a previously published directory: a live process may own its DLLs.
  let exists = false
  try { await stat(target); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (exists) {
    const receipt = JSON.parse(await readFile(join(target, 'receipt.json'), 'utf8'))
    if (receipt.version !== version || receipt.backend !== backend || JSON.stringify(receipt.digests) !== JSON.stringify(assets[backend])) {
      throw new Error('Existing installation receipt does not match; repair required')
    }
    const server = await findServer(target)
    if (!server) throw new Error('Existing server missing; repair required')
    await probe(server, backend)
    return 'already-present'
  }
  const stage = await mkdtemp(join(base, '.stage-' + backend + '-'))
  try {
    const payload = join(stage, 'payload')
    await mkdir(payload)
    await unpack(stage, 'llama-' + version + '-bin-win-' + backend + '-x64.zip', assets[backend][0], payload)
    const server = await findServer(payload)
    if (!server) throw new Error('llama-server.exe missing')
    if (assets[backend].length > 1) {
      await unpack(stage, 'cudart-llama-bin-win-' + backend + '-x64.zip', assets[backend][1], dirname(server))
    }
    await probe(server, backend)
    await writeFile(join(payload, 'receipt.json'), JSON.stringify({ version, backend, digests: assets[backend], installedAt: new Date().toISOString() }) + '\n')
    await rename(payload, target)
    return 'installed-device-enumerated'
  } finally {
    await rm(stage, { recursive: true, force: true, maxRetries: 3 })
  }
}

// Benchmark only known managed GGUF models; never pull a model or touch an external Ollama service.
async function benchmarkTarget() {
  const names = {
    'gemma-4-e2b-it-q4-0': 'gemma-4-E2B-it-Q4_0.gguf',
    'qwen3.5-4b-q4-k-m': 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
  }
  let state
  try { state = JSON.parse(await readFile(join(localRoot, 'state.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (state.mode !== 'on-demand' || !Array.isArray(state.installedModelIds) ||
      !state.installedModelIds.includes(state.selectedModelId) || !Object.hasOwn(names, state.selectedModelId)) return null
  const model = join(localRoot, 'models', names[state.selectedModelId])
  const metadata = await stat(model)
  if (!metadata.isFile() || freemem() < metadata.size + 2_000_000_000) return null
  const cpu = await findServer(join(localRoot, 'runtimes', version), 'llama-bench.exe')
  if (!cpu) return null
  return { model, cpu, modelId: state.selectedModelId, size: metadata.size, modified: metadata.mtimeMs,
    threads: Math.max(1, Math.floor(availableParallelism() / 2)) }
}

async function idleForBenchmark(target) {
  if (freemem() < target.size + 2_000_000_000) return false
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '@(Get-Process -Name llama-server,llama-bench,ollama -ErrorAction SilentlyContinue).Count'], execOptions)
  return stdout.trim() === '0'
}

async function measure(target, executable, backend, layers) {
  if (!await idleForBenchmark(target)) throw new Error('Local inference busy or insufficient free RAM; calibration deferred')
  const { stdout, stderr } = await exec(executable, [
    '-m', target.model, '-p', '256', '-n', '64', '-r', '3', '-t', String(target.threads),
    '-ngl', String(layers), '-o', 'json', '-v',
  ], { ...execOptions, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, cwd: dirname(executable) })
  const rows = JSON.parse(stdout)
  const pp = rows.find(row => row.n_prompt === 256 && row.n_gen === 0)
  const tg = rows.find(row => row.n_prompt === 0 && row.n_gen === 64)
  if (![pp?.avg_ts, tg?.avg_ts].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid throughput')
  return { backend, gpuLayersRequested: layers, threads: target.threads, promptTokensPerSecond: pp.avg_ts,
    generationTokensPerSecond: tg.avg_ts, offloadConfirmed: backend !== 'cpu' && confirmedOffload(stderr) }
}

async function worker() {
  await mkdir(base, { recursive: true })
  const lock = join(base, 'worker.lock')
  // Exclusive creation avoids concurrent provisioning. Never steal a live worker's lock.
  try { await writeFile(lock, String(process.pid), { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(lock, 'utf8'))
    if (!Number.isSafeInteger(pid) || pid <= 0) return
    try { process.kill(pid, 0); return } catch (failure) { if (failure.code !== 'ESRCH') return }
    // Stale locks require explicit repair; avoid racing another updater.
    console.error('Stale accelerator lock; remove only after verifying the worker has stopped.')
    return
  }
  const results = []
  const measurements = []
  let calibration = { state: 'deferred-no-idle-managed-model', selected: null }
  let target = null
  try {
    const candidates = candidatesForHardware(await hardware())
    try { target = await benchmarkTarget() } catch (error) {
      results.push({ state: 'calibration-deferred', reason: String(error.message).slice(0, 400) })
    }
    if (target) {
      try { measurements.push(await measure(target, target.cpu, 'cpu', 0)) }
      catch (error) { results.push({ backend: 'cpu', state: 'benchmark-deferred', reason: String(error.message).slice(0, 400) }) }
    }
    for (const backend of candidates) {
      try {
        const state = await ensure(backend)
        results.push({ backend, state })
        if (!measurements.length) break
        const bench = await findServer(join(base, backend), 'llama-bench.exe')
        if (!bench) throw new Error('llama-bench.exe missing')
        for (const layers of [8, 16, 99]) {
          try { measurements.push(await measure(target, bench, backend, layers)) }
          catch (error) { results.push({ backend, gpuLayersRequested: layers, state: 'benchmark-deferred', reason: String(error.message).slice(0, 400) }) }
        }
      } catch (error) {
        results.push({ backend, state: 'unavailable', reason: String(error.message).slice(0, 400) })
      }
    }
    if (measurements.length) {
      calibration = { ...selectAccelerator(measurements), modelId: target.modelId,
        modelSize: target.size, modelModified: target.modified, measurements,
        complete: candidates.every(backend => measurements.filter(row => row.backend === backend && row.offloadConfirmed).length === 3) }
    }
  } finally {
    try {
      const temporary = statusPath + '.' + process.pid + '.tmp'
      await writeFile(temporary, JSON.stringify({ version, results, calibration, cpuFallbackUnchanged: true, activeRuntimeChanged: false, checkedAt: new Date().toISOString() }, null, 2) + '\n')
      await rename(temporary, statusPath)
    } finally { await rm(lock, { force: true }) }
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--help') { console.log('--ensure | --status | --worker'); return }
  if (mode === '--status') {
    try { console.log(await readFile(statusPath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      console.log(JSON.stringify({ version, state: 'not-checked' }))
    }
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.env.PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL === '0') return
  if (mode === '--worker') { await worker(); return }
  if (mode !== '--ensure') throw new Error('Use --ensure, --status or --help')
  await mkdir(base, { recursive: true })
  const fd = openSync(join(base, 'installer.log'), 'a')
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
    })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  } finally { closeSync(fd) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
