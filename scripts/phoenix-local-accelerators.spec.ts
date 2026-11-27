import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const installer = resolve(root, 'scripts/phoenix-local-accelerators.mjs')

describe('local accelerator provisioning', () => {
  it('plans only candidate backends for detected PCI vendors without downloading anything', () => {
    const script = [
      'import { candidatesForHardware } from ' + JSON.stringify(pathToFileURL(installer).href),
      "console.log(JSON.stringify([[], ['PCI\\\\VEN_10DE'], ['PCI\\\\VEN_1002'], ['PCI\\\\VEN_8086'], ['PCI\\\\VEN_1234']].map(candidatesForHardware)))",
    ].join('\n')
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual([
      [], ['vulkan', 'cuda-12.4', 'cuda-13.3'], ['vulkan', 'rocm-10.0'],
      ['vulkan', 'sycl', 'openvino-2026.3.1'], [],
    ])
  })

  it('chooses a measured GPU only with positive offload and a meaningful speedup', () => {
    const policy = pathToFileURL(resolve(root, 'scripts/phoenix-local-acceleration-policy.mjs')).href
    const script = [
      'import { selectAccelerator, confirmedOffload } from ' + JSON.stringify(policy),
      "const cpu = { backend: 'cpu', promptTokensPerSecond: 100, generationTokensPerSecond: 10 }",
      "const gpu = { backend: 'vulkan', promptTokensPerSecond: 200, generationTokensPerSecond: 20, offloadConfirmed: true }",
      "const fake = { ...gpu, backend: 'cuda', generationTokensPerSecond: 1000, offloadConfirmed: false }",
      "const slow = { ...gpu, promptTokensPerSecond: 101, generationTokensPerSecond: 10.1 }",
      "console.log(JSON.stringify([selectAccelerator([cpu, gpu, fake]).selected.backend, selectAccelerator([cpu, slow]).selected.backend, selectAccelerator([gpu]).state, confirmedOffload('offloaded 8/32 layers to GPU'), confirmedOffload('offloaded 0/32 layers to GPU')]))",
    ].join('\n')
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual(['vulkan', 'cpu', 'no-cpu-baseline', true, false])
  })

  it('uses reported free device memory and rejects unknown or insufficient capacity', () => {
    const policy = pathToFileURL(resolve(root, 'scripts/phoenix-local-acceleration-policy.mjs')).href
    const script = [
      'import { parseDeviceMemory, candidateGpuLayers } from ' + JSON.stringify(policy),
      "const devices = parseDeviceMemory('  Vulkan0: Intel GPU (8192 MiB, 4096 MiB free)\\n  CUDA0: invalid (2048 MiB, 4096 MiB free)')",
      "const size = 3000 * 1024 ** 2",
      "console.log(JSON.stringify([devices, candidateGpuLayers(0, size), candidateGpuLayers(3000, size), candidateGpuLayers(4000, size), candidateGpuLayers(6000, size)]))",
    ].join('\n')
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual([
      [{ name: 'Vulkan0', totalMiB: 8192, freeMiB: 4096 }], [], [8], [8, 16], [8, 16, 99],
    ])
  })

  it('starts the optional provisioner only after a successful updater result', () => {
    const updater = readFileSync(resolve(root, 'update-phoenix.ps1'), 'utf8')
    expect(updater).toContain("$localAcceleratorAuto = Join-Path $root 'scripts\\phoenix-local-accelerators.mjs'")
    expect(updater).toContain("($null -eq $code -or $code -eq 0) -and $env:PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL -ne '0'")
    expect(updater).toContain('& node $localAcceleratorAuto --ensure')
  })
})
