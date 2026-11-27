/**
 * Windows x64 pilot: compare the pinned Phoenix CPU runtime with official accelerator
 * runtimes without changing installed models, Phoenix settings, or the active server.
 * Usage: node scripts/phoenix-local-acceleration-bench.mjs "C:\\path\\model.gguf"
 * Downloads and executes hash-pinned upstream release assets only on explicit invocation.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, stat, statfs } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir, freemem, availableParallelism } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const version = 'b10964'
// Upstream attestation: https://github.com/ggml-org/llama.cpp/attestations/47376843
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
const options = { windowsHide: true, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }

async function findBench(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === 'llama-bench.exe') return target
    if (entry.isDirectory()) {
      const found = await findBench(target)
      if (found) return found
    }
  }
  return undefined
}

async function unpack(root, name, digest, target) {
  const archive = join(root, name)
  const disk = await statfs(root)
  if (disk.bavail * disk.bsize < 4 * 1024 ** 3) throw new Error('Less than 4 GiB free on temporary volume')
  try {
    const response = await fetch('https://github.com/ggml-org/llama.cpp/releases/download/' + version + '/' + name, {
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!response.ok || !response.body) throw new Error('Download failed: ' + response.status)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }))
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest('hex') !== digest) throw new Error('SHA-256 mismatch: ' + name)
    await exec('tar.exe', ['-xf', archive, '-C', target], options)
  } finally {
    await rm(archive, { force: true })
  }
}

async function prepare(root, backend) {
  const target = join(root, backend)
  const name = 'llama-' + version + '-bin-win-' + backend + '-x64.zip'
  await mkdir(target)
  await unpack(root, name, assets[backend][0], target)
  const bench = await findBench(target)
  if (!bench) throw new Error('llama-bench.exe missing: ' + name)
  if (assets[backend].length > 1) {
    await unpack(root, 'cudart-llama-bin-win-' + backend + '-x64.zip',
      assets[backend][1], dirname(bench))
  }
  return bench
}

async function benchmark(executable, model, backend, layers, threads) {
  const { stdout } = await exec(executable, [
    '-m', model, '-p', '256', '-n', '64', '-r', '3', '-t', String(threads),
    '-ngl', String(layers), '-o', 'json',
  ], options)
  const rows = JSON.parse(stdout)
  if (!Array.isArray(rows)) throw new Error('Unexpected llama-bench JSON')
  const prompt = rows.find(row => row.n_prompt === 256 && row.n_gen === 0)
  const generation = rows.find(row => row.n_prompt === 0 && row.n_gen === 64)
  if (![prompt?.avg_ts, generation?.avg_ts].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Missing benchmark throughput')
  }
  return { backend, gpuLayersRequested: layers, threads, promptTokensPerSecond: prompt.avg_ts,
    generationTokensPerSecond: generation.avg_ts, reportedBackends: generation.backends ?? null,
    reportedGpu: generation.gpu_info ?? null, reportedGpuLayers: generation.n_gpu_layers ?? null }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/phoenix-local-acceleration-bench.mjs <existing-model.gguf> [backend,backend,...]')
    console.log('Optional backends: ' + Object.keys(assets).filter(key => key !== 'cpu').join(', '))
    console.log('Default: vulkan. CPU baseline is always included. Only select compatible hardware.')
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 required')
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Supply a GGUF file and optional backend list')
  const backends = [...new Set((process.argv[3] ?? 'vulkan').split(',').map(value => value.trim()))]
  if (backends.some(key => key === 'cpu' || !Object.hasOwn(assets, key))) throw new Error('Unsupported accelerator; use --help')
  const model = resolve(process.argv[2])
  const metadata = await stat(model)
  if (!metadata.isFile() || !model.toLowerCase().endsWith('.gguf')) throw new Error('Existing GGUF file required')
  if (freemem() < metadata.size + 2_000_000_000) throw new Error('Insufficient free RAM for safe CPU baseline')
  const root = await mkdtemp(join(tmpdir(), 'phoenix-local-bench-'))
  const results = []
  const failures = []
  const threads = Math.max(1, Math.floor(availableParallelism() / 2))
  try {
    const cpu = await prepare(root, 'cpu')
    results.push(await benchmark(cpu, model, 'cpu', 0, threads))
    for (const backend of backends) {
      try {
        const executable = await prepare(root, backend)
        for (const layers of [8, 16, 99]) {
          try {
            results.push(await benchmark(executable, model, backend, layers, threads))
          } catch (error) {
            failures.push({ backend, gpuLayersRequested: layers, error: String(error.message).slice(0, 500) })
          }
        }
      } catch (error) {
        failures.push({ backend, error: String(error.message).slice(0, 500) })
      } finally {
        await rm(join(root, backend), { recursive: true, force: true, maxRetries: 3 })
      }
    }
    const baseline = results[0].generationTokensPerSecond
    const ranked = results.map(result => ({
      ...result, generationSpeedup: result.generationTokensPerSecond / baseline,
    })).sort((a, b) => b.generationTokensPerSecond - a.generationTokensPerSecond)
    console.log(JSON.stringify({ version, ranked, failures, installedRuntimeChanged: false, note: 'Requested GPU layers and backend labels do not prove GPU execution; inspect device telemetry.' }, null, 2))
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
