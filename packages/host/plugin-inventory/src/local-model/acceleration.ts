import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

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

/** A measured local acceleration profile; never supplied by model output. */
export interface LocalAccelerationProfile {
  executable: string
  backend: string
  gpuLayers: number
  threads: number
}

async function findExecutable(dir: string): Promise<string | undefined> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const candidate = path.join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === 'llama-server.exe') return candidate
    if (entry.isDirectory()) {
      const found = await findExecutable(candidate)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * Read a previously calibrated profile for the exact managed GGUF. Reject stale,
 * malformed or missing receipts and never accept an executable path from JSON.
 * @param root - Phoenix Local root.
 * @param version - Pinned CPU runtime version.
 * @param modelId - Selected managed model identifier.
 * @param modelPath - Managed GGUF path.
 * @param maxThreads - Current available logical processors.
 * @returns Validated profile or undefined for CPU fallback.
 */
export async function readLocalAccelerationProfile(root: string, version: string, modelId: string, modelPath: string, maxThreads: number): Promise<LocalAccelerationProfile | undefined> {
  try {
    const base = path.join(root, 'accelerators', version)
    const status = JSON.parse(await readFile(path.join(base, 'status.json'), 'utf8')) as {
      version?: string; checkedAt?: string; calibration?: {
        state?: string; modelId?: string; modelSize?: number; modelModified?: number;
        selected?: { backend?: string; offloadConfirmed?: boolean; speedup?: number; gpuLayersRequested?: number; threads?: number }
      }
    }
    const c = status.calibration
    const selected = c?.selected
    const age = Date.now() - Date.parse(status.checkedAt ?? '')
    if (status.version !== version || !Number.isFinite(age) || age < 0 || age > 7 * 86_400_000
      || c?.state !== 'measured' || c.modelId !== modelId || selected === undefined
      || selected.offloadConfirmed !== true || typeof selected.speedup !== 'number'
      || !Number.isFinite(selected.speedup) || selected.speedup < 1.10
      || typeof selected.backend !== 'string' || selected.backend === 'cpu' || !Object.hasOwn(assets, selected.backend)
      || typeof selected.gpuLayersRequested !== 'number' || ![8, 16, 99].includes(selected.gpuLayersRequested)
      || typeof selected.threads !== 'number' || !Number.isInteger(selected.threads) || selected.threads < 1 || selected.threads > maxThreads) return undefined
    const metadata = await stat(modelPath)
    if (metadata.size !== c.modelSize || metadata.mtimeMs !== c.modelModified) return undefined
    const target = path.join(base, selected.backend)
    const receipt = JSON.parse(await readFile(path.join(target, 'receipt.json'), 'utf8')) as { version?: string; backend?: string; digests?: string[] }
    if (receipt.version !== version || receipt.backend !== selected.backend
      || JSON.stringify(receipt.digests) !== JSON.stringify(assets[selected.backend as keyof typeof assets])) return undefined
    const executable = await findExecutable(target)
    if (executable === undefined) return undefined
    const actual = await realpath(executable)
    const relative = path.relative(await realpath(base), actual)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
    return { executable: actual, backend: selected.backend, gpuLayers: selected.gpuLayersRequested, threads: selected.threads }
  } catch {
    // Optional calibration is never required for CPU inference.
    return undefined
  }
}
