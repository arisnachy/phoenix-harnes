import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLocalAccelerationProfile } from '../src/local-model/acceleration.js'

describe('managed accelerator profile', () => {
  it('accepts only a recent measured profile for the exact model and pinned installation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phoenix-acceleration-'))
    try {
      const base = path.join(root, 'accelerators', 'b10964')
      const target = path.join(base, 'vulkan')
      await mkdir(target, { recursive: true })
      const model = path.join(root, 'model.gguf')
      const exe = path.join(target, 'llama-server.exe')
      await writeFile(model, 'test model')
      await writeFile(exe, 'not executed')
      const metadata = await stat(model)
      await writeFile(path.join(target, 'receipt.json'), JSON.stringify({
        version: 'b10964', backend: 'vulkan',
        digests: ['1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642'],
      }))
      const profile = {
        version: 'b10964', checkedAt: new Date().toISOString(),
        calibration: { state: 'measured', modelId: 'qwen', modelSize: metadata.size, modelModified: metadata.mtimeMs,
          selected: { backend: 'vulkan', offloadConfirmed: true, speedup: 1.5, gpuLayersRequested: 8, threads: 4, deviceName: 'Vulkan0', deviceFreeMiB: 4096, deviceTotalMiB: 8192 } },
      }
      const status = path.join(base, 'status.json')
      const read = () => readLocalAccelerationProfile(root, 'b10964', 'qwen', model, 8)
      await writeFile(status, JSON.stringify(profile))
      expect(await read()).toMatchObject({ backend: 'vulkan', gpuLayers: 8, threads: 4 })
      profile.calibration.selected.offloadConfirmed = false
      await writeFile(status, JSON.stringify(profile))
      expect(await read()).toBeUndefined()
      profile.calibration.selected.offloadConfirmed = true
      profile.calibration.selected.speedup = 1.01
      await writeFile(status, JSON.stringify(profile))
      expect(await read()).toBeUndefined()
      profile.calibration.selected.speedup = 1.5
      profile.calibration.selected.backend = '../outside'
      await writeFile(status, JSON.stringify(profile))
      expect(await read()).toBeUndefined()
      profile.calibration.selected.backend = 'vulkan'
      await writeFile(status, JSON.stringify(profile))
      await writeFile(model, 'changed model bytes')
      expect(await read()).toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
