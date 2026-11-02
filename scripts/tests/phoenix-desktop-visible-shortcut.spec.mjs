import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shortcut = readFileSync(join(root, 'scripts', 'phoenix-desktop-shortcut.ps1'), 'utf8')
const launcher = readFileSync(join(root, 'scripts', 'phoenix-desktop-launch.ps1'), 'utf8')

test('Phoenix desktop icon opens visible CMD with pnpm phoenix in the checkout', () => {
  assert.match(shortcut, /\$targetPath = \$commandProcessor/u)
  assert.match(shortcut, /Join-Path \$env:SystemRoot 'System32\\cmd\.exe'/u)
  assert.match(shortcut, /\$arguments = '\/k "cd \/d ' \+ \$rootPath \+ ' && pnpm phoenix"'/u)
  assert.match(shortcut, /\$windowStyle = 1/u)
  assert.match(shortcut, /\$workingDirectory = \$rootPath/u)
  assert.doesNotMatch(shortcut, /\$targetPath = \$nativeExecutable/u)
  assert.doesNotMatch(shortcut, /-WindowStyle Hidden -ExecutionPolicy Bypass -File/u)
  assert.match(shortcut, /phoenix-emblem\.png/u)
  assert.match(shortcut, /\$iconRevision = 'v6'/u)
  assert.match(shortcut, /\$sizes = @\(16, 24, 32, 48, 64, 128, 256\)/u)
  assert.match(shortcut, /\$iconHash/u)
  assert.match(shortcut, /Set-PhoenixShortcut \$shortcutPath/u)
  assert.match(shortcut, /Set-PhoenixShortcut \$startMenuShortcutPath/u)
  assert.match(shortcut, /Set-PhoenixShortcut \$taskbarShortcutPath/u)
})

test('the background source launcher remains available for other supervised callers', () => {
  assert.match(launcher, /\$env:PHOENIX_SOURCE_ROOT = \$rootPath/u)
  assert.match(launcher, /Set-Location -LiteralPath \$rootPath/u)
  assert.match(launcher, /Tee-Object -FilePath \$logPath -Append/u)
  assert.match(launcher, /& \$pnpm.Source phoenix @launchArgs/u)
})
