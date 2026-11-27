/**
 * Windows x64 pilot: compare the pinned Phoenix CPU runtime with the official Vulkan
 * runtime without changing installed models, Phoenix settings, or the active server.
 * Usage: node scripts/phoenix-local-acceleration-bench.mjs "C:\\path\\model.gguf"
 * Downloads and executes hash-pinned upstream release assets only on explicit invocation.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir, freemem, availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const version = 'b10964'
const assets = {
  cpu: '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7',
  vulkan: '1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642',
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

async function prepare(root, backend) {
  const archive = join(root, backend + '.zip')
  const target = join(root, backend)
  const name = 'llama-' + version + '-bin-win-' + backend + '-x64.zip'
  const response = await fetch('https://github.com/ggml-org/llama.cpp/releases/download/' + version + '/' + name, {
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!response.ok || !response.body) throw new Error('Download failed: ' + response.status)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }))
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  if (hash.digest('hex') !== assets[backend]) throw new Error('SHA-256 mismatch: ' + name)
  await mkdir(target)
  await exec('tar.exe', ['-xf', archive, '-C', target], options)
  const bench = await findBench(target)
  if (!bench) throw new Error('llama-bench.exe missing: ' + name)
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
    generationTokensPerSecond: generation.avg_ts }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/phoenix-local-acceleration-bench.mjs <existing-model.gguf>')
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 required')
  if (process.argv.length !== 3) throw new Error('Supply exactly one existing GGUF file')
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
    try {
      const vulkan = await prepare(root, 'vulkan')
      for (const layers of [8, 16, 99]) {
        try {
          results.push(await benchmark(vulkan, model, 'vulkan', layers, threads))
        } catch (error) {
          failures.push({ backend: 'vulkan', gpuLayersRequested: layers, error: String(error.message).slice(0, 500) })
        }
      }
    } catch (error) {
      failures.push({ backend: 'vulkan', error: String(error.message).slice(0, 500) })
    }
    const baseline = results[0].generationTokensPerSecond
    const ranked = results.map(result => ({
      ...result, generationSpeedup: result.generationTokensPerSecond / baseline,
    })).sort((a, b) => b.generationTokensPerSecond - a.generationTokensPerSecond)
    console.log(JSON.stringify({ version, ranked, failures, installedRuntimeChanged: false }, null, 2))
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
