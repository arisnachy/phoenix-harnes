import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))
const shortcut = readFileSync(join(root, 'scripts', 'phoenix-desktop-shortcut.ps1'), 'utf8')
const launcher = readFileSync(join(root, 'scripts', 'phoenix-desktop-launch.ps1'), 'utf8')

test('Phoenix shortcut keeps PowerShell visible with the correct icon', () => {
  assert.match(shortcut, /\$arguments = ".*-NoExit -File/)
  assert.match(shortcut, /\$windowStyle = 1/)
  assert.doesNotMatch(shortcut, /-WindowStyle Hidden -File `"\$launcherPath/)
  assert.match(shortcut, /phoenix-emblem\.png/)
  assert.match(shortcut, /\$iconRevision = 'v5'/)
  assert.match(shortcut, /\$sizes = @\(16, 24, 32, 48, 64, 128, 256\)/)
  assert.match(shortcut, /\$iconHash/)
  assert.match(shortcut, /Set-PhoenixShortcut \$shortcutPath/)
  assert.match(shortcut, /Set-PhoenixShortcut \$startMenuShortcutPath/)
  assert.match(shortcut, /Set-PhoenixShortcut \$taskbarShortcutPath/)
})

test('Phoenix desktop launcher keeps visible live output and native desktop session', () => {
  assert.match(launcher, /\$env:PHOENIX_DESKTOP_CONSOLE = '1'/)
  assert.match(launcher, /Start-Process -FilePath \$installedPhoenixExe -Wait/)
  assert.match(launcher, /Tee-Object -FilePath \$logPath -Append/)
  assert.doesNotMatch(launcher, /\$env:PHOENIX_DESKTOP_CONSOLE = '0'/)
})
