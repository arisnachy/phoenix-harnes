import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('manual build discovery stops when recycled Windows PIDs form a cycle', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('./phoenix-prepared-restart-bridge.mjs', import.meta.url), 'utf8')
  const array = source.match(/const script = (\[[\s\S]*?\])\.join\('\\n'\)/)?.[1]
  assert.ok(array, 'production ancestry script exists')
  const script = new Function('process', `return ${array}`)({ pid: 100 }).join('\n')
  const fixture = [
    '$ErrorActionPreference = "Stop"',
    '$script:queryCount = 0',
    'function Get-CimInstance { param($ClassName, $Filter, $ErrorAction)',
    '$script:queryCount++; if ($script:queryCount -gt 8) { throw "unbounded ancestry" }',
    '$id = [int]($Filter -replace "ProcessId=", "")',
    '$parent = if ($id -eq 100) { 200 } else { 100 }',
    '[pscustomobject]@{ ProcessId=$id; ParentProcessId=$parent; CommandLine="fixture" }',
    '}',
    script,
    '[Console]::Out.WriteLine("queries=" + $script:queryCount)',
  ].join('\n')
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(fixture, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /queries=2/)
})
