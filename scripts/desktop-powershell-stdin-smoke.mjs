// Verify that the Windows PowerShell stdin transport compiles multiline
// here-strings as one script, and passes action values only through env.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'

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
console.log('PowerShell complete-driver stdin smoke passed')
