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
      [], ['vulkan', 'cuda-12.4'], ['vulkan', 'rocm-10.0'],
      ['vulkan', 'sycl', 'openvino-2026.3.1'], [],
    ])
  })

  it('starts the optional provisioner only after a successful updater result', () => {
    const updater = readFileSync(resolve(root, 'update-phoenix.ps1'), 'utf8')
    expect(updater).toContain("$localAcceleratorAuto = Join-Path $root 'scripts\\phoenix-local-accelerators.mjs'")
    expect(updater).toContain("($null -eq $code -or $code -eq 0) -and $env:PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL -ne '0'")
    expect(updater).toContain('& node $localAcceleratorAuto --ensure')
  })
})
