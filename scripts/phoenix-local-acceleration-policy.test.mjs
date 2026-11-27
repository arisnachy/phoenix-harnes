import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidateGpuLayers, confirmedOffload, parseDeviceMemory, selectAccelerator } from './phoenix-local-acceleration-policy.mjs'

test('measured offload and minimum speedup are mandatory', () => {
  const cpu = { backend: 'cpu', promptTokensPerSecond: 100, generationTokensPerSecond: 10 }
  const gpu = { backend: 'vulkan', promptTokensPerSecond: 200, generationTokensPerSecond: 20, offloadConfirmed: true }
  assert.equal(selectAccelerator([cpu, gpu, { ...gpu, offloadConfirmed: false, generationTokensPerSecond: 1000 }]).selected.backend, 'vulkan')
  assert.equal(selectAccelerator([cpu, { ...gpu, promptTokensPerSecond: 101, generationTokensPerSecond: 10.1 }]).selected.backend, 'cpu')
  assert.equal(selectAccelerator([gpu]).state, 'no-cpu-baseline')
  assert.equal(confirmedOffload('offloaded 8/32 layers to GPU'), true)
  assert.equal(confirmedOffload('offloaded 0/32 layers to GPU'), false)
})

test('native device memory and conservative offload admission', () => {
  const size = 3000 * 1024 ** 2
  assert.deepEqual(parseDeviceMemory('  Vulkan0: Intel GPU (8192 MiB, 4096 MiB free)\r\n  CUDA0: invalid (2048 MiB, 4096 MiB free)'), [{ name: 'Vulkan0', totalMiB: 8192, freeMiB: 4096 }])
  assert.deepEqual(parseDeviceMemory('unavailable'), [])
  assert.deepEqual(candidateGpuLayers(0, size), [])
  assert.deepEqual(candidateGpuLayers(3000, size), [8])
  assert.deepEqual(candidateGpuLayers(4000, size), [8, 16])
  assert.deepEqual(candidateGpuLayers(6000, size), [8, 16, 99])
  assert.deepEqual(candidateGpuLayers(NaN, size), [])
})
