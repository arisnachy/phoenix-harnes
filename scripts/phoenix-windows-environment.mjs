#!/usr/bin/env node
/**
 * Windows environment hydration for long-lived PHOENIX supervisors.
 *
 * A supervisor can outlive a user-environment change, so its process.env may be
 * stale when it launches a replacement Host. Only the explicitly supported
 * Google MCP token is read from HKCU; values are returned to the caller and are
 * never logged, serialized, or included in diagnostics.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const PHOENIX_USER_ENV_KEYS = Object.freeze([
  'GOOGLE_OAUTH_ACCESS_TOKEN',
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function defaultRegistryRead(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/**
 * Read one allow-listed value from the current Windows user's environment.
 *
 * @param {string} name - Environment variable name.
 * @param {{ platform?: string, run?: (command: string, args: string[]) => { status: number | null, stdout?: string | Buffer } }} [options]
 * @returns {string | undefined} The value, or undefined when unavailable.
 */
export function readWindowsUserEnvironment(name, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32' || !PHOENIX_USER_ENV_KEYS.includes(name)) return undefined
  const run = options.run ?? defaultRegistryRead
  const result = run('reg.exe', ['query', 'HKCU\\Environment', '/v', name])
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined

  const pattern = new RegExp(`^\\s*${escapeRegExp(name)}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'imu')
  const match = pattern.exec(result.stdout)
  const value = match?.[1]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Fill only missing supported values from the current user's environment.
 * Explicit process values always win, which keeps test and deployment
 * overrides deterministic.
 *
 * @param {NodeJS.ProcessEnv} parentEnvironment - Environment inherited by the supervisor.
 * @param {{ platform?: string, readUserValue?: (name: string) => string | undefined }} [options]
 * @returns {NodeJS.ProcessEnv} A new environment object for a child process.
 */
export function hydratePhoenixEnvironment(parentEnvironment, options = {}) {
  const environment = { ...parentEnvironment }
  if ((options.platform ?? process.platform) !== 'win32') return environment
  const readUserValue = options.readUserValue ?? (name => readWindowsUserEnvironment(name, options))

  for (const name of PHOENIX_USER_ENV_KEYS) {
    if (typeof environment[name] === 'string' && environment[name].length > 0) continue
    const value = readUserValue(name)
    if (value !== undefined) environment[name] = value
  }
  return environment
}
