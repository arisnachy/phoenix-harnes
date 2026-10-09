#!/usr/bin/env node
/**
 * Read-only Windows capability inventory for PHOENIX.
 * No installs, network requests, OAuth access, registry writes, or device IDs.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const WINDOWS_PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @('winget', 'wsl', 'ollama', 'foundry', 'pwsh')
$executables = @{}
foreach ($name in $names) {
  $executables[$name] = [bool](Get-Command -Name $name -ErrorAction SilentlyContinue)
}
$operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$computer = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$adapters = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
  ForEach-Object { [string]$_.Name } | Where-Object { $_ } | Select-Object -Unique)
@{
  build = [string]$operatingSystem.BuildNumber
  caption = [string]$operatingSystem.Caption
  memoryBytes = [string]$computer.TotalPhysicalMemory
  adapters = $adapters
  executables = $executables
} | ConvertTo-Json -Depth 4 -Compress
`

const EXECUTABLES = ['winget', 'wsl', 'ollama', 'foundry', 'pwsh']

function normalizeExecutables(candidate) {
  return Object.fromEntries(EXECUTABLES.map((name) => [name, candidate?.[name] === true]))
}

function report(platform, nodeVersion, payload, issue = null) {
  const build = Number.parseInt(payload?.build ?? '', 10)
  const windows11 = Number.isFinite(build) && build >= 22000
  const nodeMajor = Number.parseInt(nodeVersion, 10)
  const executables = normalizeExecutables(payload?.executables)
  const memoryBytes = Number(payload?.memoryBytes)
  const adapters = Array.isArray(payload?.adapters)
    ? payload.adapters.filter((value) => typeof value === 'string' && value.length > 0).slice(0, 8)
    : []
  const present = platform === 'win32' && issue === null

  return {
    schemaVersion: 1,
    platform,
    probe: present ? 'completed' : 'unavailable',
    reason: issue,
    windows: {
      caption: typeof payload?.caption === 'string' ? payload.caption : null,
      build: Number.isFinite(build) ? build : null,
      windows11: present && windows11,
    },
    hardware: {
      memoryGiB: present && Number.isFinite(memoryBytes) && memoryBytes > 0
        ? Math.round(memoryBytes / 1073741824 * 10) / 10
        : null,
      graphicsAdapters: adapters,
      // A graphics-adapter name does not establish GPU/NPU inference support.
      acceleration: 'not-benchmarked',
    },
    executables,
    features: {
      packageInventory: present && executables.winget ? 'tool-detected' : 'unavailable',
      windowsSubsystemForLinux: present && executables.wsl ? 'command-detected' : 'unavailable',
      localInference: present && (executables.ollama || executables.foundry)
        ? 'runtime-command-detected'
        : 'runtime-not-detected',
      nativeNotifications: present && windows11 ? 'native-bridge-required' : 'unavailable',
      windowsAI: present && windows11 ? 'sdk-and-device-check-required' : 'unavailable',
      mxc: !present ? 'unavailable'
        : Number.isFinite(nodeMajor) && nodeMajor >= 24
          ? 'sdk-and-host-check-required'
          : 'node-24-required',
    },
  }
}

/**
 * Detect prerequisites, not permission to act or proof that a runtime works.
 * @param {{ platform?: string, nodeVersion?: string, spawn?: typeof spawnSync }} [options]
 */
export function probeWindowsFreeCapabilities(options = {}) {
  const platform = options.platform ?? process.platform
  const nodeVersion = options.nodeVersion ?? process.versions.node
  if (platform !== 'win32') return report(platform, nodeVersion, null, 'not-windows')
  const spawn = options.spawn ?? spawnSync
  try {
    const result = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-EncodedCommand', Buffer.from(WINDOWS_PROBE, 'utf16le').toString('base64'),
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 262144,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
      return report(platform, nodeVersion, null, 'probe-failed')
    }
    const payload = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return report(platform, nodeVersion, null, 'invalid-probe-output')
    }
    return report(platform, nodeVersion, payload)
  } catch {
    // Failed local inspection must never impact Phoenix startup or expose stderr.
    return report(platform, nodeVersion, null, 'probe-failed')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(probeWindowsFreeCapabilities(), null, 2)}\n`)
}
