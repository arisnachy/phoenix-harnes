#!/usr/bin/env node
/**
 * Opt-in, offline launcher for the FlaUI Windows desktop MCP.
 * This file never downloads, installs or executes model-provided paths.
 * Put the audited FlaUI.Mcp.exe under %LOCALAPPDATA%\\PHOENIX\\mcp\\flaui.
 */
import { lstatSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

export function locateFlaUiExecutable(options = {}) {
  const platform = options.platform ?? process.platform
  const appData = options.localAppData ?? process.env.LOCALAPPDATA
  if (platform !== 'win32') throw new Error('WINDOWS_FLAUI_REQUIRES_WINDOWS')
  if (!appData || !/^[a-zA-Z]:[\\/]/.test(appData)) {
    throw new Error('WINDOWS_FLAUI_LOCALAPPDATA_MISSING')
  }
  const file = join(appData, 'PHOENIX', 'mcp', 'flaui', 'FlaUI.Mcp.exe')
  try {
    const directory = lstatSync(dirname(file))
    const binary = lstatSync(file)
    if (directory.isSymbolicLink() || !directory.isDirectory()
      || binary.isSymbolicLink() || !binary.isFile()) {
      throw new Error('WINDOWS_FLAUI_UNTRUSTED_INSTALL_PATH')
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('WINDOWS_FLAUI_NOT_INSTALLED: install an audited release under %LOCALAPPDATA%\\PHOENIX\\mcp\\flaui')
    }
    throw error
  }
  return file
}

/**
 * Intentionally omit provider secrets and PHOENIX connection credentials from
 * the third-party process. No shell, dynamic executable, network server or
 * background autostart. Execution still needs individual ASK approvals.
 */
export function flaUiChildEnvironment(source = process.env) {
  const safeKeys = [
    'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'LOCALAPPDATA',
    'APPDATA', 'USERPROFILE', 'DOTNET_ROOT', 'DOTNET_ROOT_X64',
    'PROCESSOR_ARCHITECTURE',
  ]
  const env = {}
  for (const key of safeKeys) {
    if (typeof source[key] === 'string') env[key] = source[key]
  }
  return env
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const executable = locateFlaUiExecutable()
    const child = spawn(executable, [], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: flaUiChildEnvironment(),
    })
    child.on('error', error => {
      process.stderr.write('WINDOWS_FLAUI_START_FAILED: ' + error.message + '\n')
      process.exitCode = 1
    })
    child.on('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0)
    })
    process.on('SIGTERM', () => child.kill('SIGTERM'))
    process.on('SIGINT', () => child.kill('SIGINT'))
  } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n')
    process.exitCode = 1
  }
}
