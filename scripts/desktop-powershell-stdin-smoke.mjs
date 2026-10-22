// Verify that the Windows PowerShell stdin transport compiles multiline
// here-strings as one script, and passes action values only through env.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'

if (process.platform !== 'win32') {
  console.log('desktop PowerShell stdin smoke requires Windows')
  process.exit(0)
}

const trustedScript = [
  "$ErrorActionPreference = 'Stop'",
  '$source = @"',
  'using System;',
  'public class PhoenixDesktopStdinSmoke { public static string Run() { return "ok"; } }',
  '"@',
  'Add-Type -TypeDefinition $source -Language CSharp',
  '[PhoenixDesktopStdinSmoke]::Run()',
  'Write-Output $env:PHX_ACTION',
].join('\n')
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command',
  '& ([scriptblock]::Create([Console]::In.ReadToEnd()))']
const output = await new Promise((resolve, reject) => {
  const child = execFile('powershell.exe', args, {
    encoding: 'utf8', windowsHide: true, timeout: 25_000,
    env: { ...process.env, PHX_ACTION: 'windows' },
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message))
    else resolve(stdout.trim())
  })
  if (!child.stdin) return reject(new Error('stdin unavailable'))
  child.stdin.end(trustedScript, 'utf8')
})
assert.deepEqual(String(output).split(/\r?\n/).map(x => x.trim()).filter(Boolean), ['ok', 'windows'])
const source = readFileSync(new URL('../packages/shell/tool-pwsh/src/computer.ts', import.meta.url), 'utf8')
const match = source.match(/const WINDOWS_DRIVER = String.raw`\r?\n([\s\S]*?)\r?\n`/u)
assert.ok(match, 'real Phoenix driver source must be present')
const actualDriver = match[1]
assert.ok(actualDriver && actualDriver.length > 1000)
const actualOutput = await new Promise((resolve, reject) => {
  const child = execFile('powershell.exe', args, {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PHX_ACTION: 'windows' },
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message))
    else resolve(stdout.trim())
  })
  if (!child.stdin) return reject(new Error('real driver stdin unavailable'))
  child.stdin.end(actualDriver, 'utf8')
})
assert.ok(String(actualOutput).length > 0, 'real driver must not return empty output')
// FocusWindow triggers this Win32 import. Check the actual private import
// dynamically without relying on an interactive GUI in the CI runner.
const testImport = actualDriver + '\n' + [
  '$method = [PhoenixDesktop].GetMethod("GetCurrentThreadId", [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Static)',
  'if ($null -eq $method) { throw "missing GetCurrentThreadId import" }',
  '$threadId = [uint32]$method.Invoke($null, @())',
  'if ($threadId -eq 0) { throw "GetCurrentThreadId returned zero" }',
  'Write-Output ("thread-import-ok:" + $threadId)',
].join('\n')
const validatedImport = await new Promise((resolve, reject) => {
  const child = execFile('powershell.exe', args, {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PHX_ACTION: 'windows' },
  }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message))
    else resolve(stdout.trim())
  })
  if (!child.stdin) return reject(new Error('P/Invoke smoke stdin unavailable'))
  child.stdin.end(testImport, 'utf8')
})
assert.match(String(validatedImport), /thread-import-ok:[1-9][0-9]*/u)
console.log('Actual Phoenix GetCurrentThreadId import succeeded')
console.log('Real Phoenix Windows driver enumeration smoke passed')

console.log('PowerShell complete-driver stdin smoke passed')
