import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = resolve(fileURLToPath(new URL('.', import.meta.url)), 'phoenix-windows-storage-repair.ps1')
const contents = readFileSync(script, 'utf8')

function occurrences(text, needle) {
  return text.split(needle).length - 1
}

// This regression catches the 2026-10-14 bug in which "$'" in a JS
// replacement string expanded to the entire original file suffix, truncating
// a regex and duplicating the remainder of this PowerShell repair script.
test('storage repair has one complete guarded execution path', () => {
  assert.match(contents, /^\$legacyPattern = '.*\)\$'$/m)
  assert.equal(occurrences(contents, 'if (-not $Apply) {'), 1)
  assert.equal(occurrences(contents, 'Get-NetTCPConnection -LocalPort 3080'), 1)
  assert.equal(occurrences(contents, '$node.Source $supervisor --cleanup-storage'), 1)
  assert.equal(occurrences(contents, 'function Get-LegacyStorageDirectories {'), 1)
  assert.ok(contents.indexOf('if (-not $Apply) {') < contents.indexOf('Get-NetTCPConnection -LocalPort 3080'))
})

// Windows PowerShell 5.1 is the supported runtime for the repair command.
// Parse the file without executing it or deleting any storage. Linux/macOS
// still execute the platform-independent structural check above.
test('Windows PowerShell parser accepts the storage repair script', { skip: process.platform !== 'win32' }, () => {
  const quotedPath = script.replaceAll("'", "''")
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$file = '" + quotedPath + "'",
    '$tokens = $null',
    '$errors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors) | Out-Null',
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output $_.ToString() }; exit 1 }',
  ].join("\n")
  const encoded = Buffer.from(command, 'utf16le').toString('base64')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join('\n'))
})
