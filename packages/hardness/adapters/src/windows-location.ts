/** Local, permission-gated Windows position and offline civic-area matching. */
import { execFile } from 'node:child_process'
import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const MAX_AGE_MS = 90_000
const MAX_CATALOG_BYTES = 16 * 1024 * 1024

/** A sensor reading, never a prediction or a user identity. */
export interface WindowsLocationFix {
  readonly latitude: number
  readonly longitude: number
  readonly accuracyMeters: number
  readonly observedAt: number
  readonly expiresAt: number
}

/** Local catalog entry with a conservative circular area, in meters. */
export interface CivicArea {
  readonly latitude: number
  readonly longitude: number
  readonly radiusMeters: number
  readonly country: string
  readonly region?: string
  readonly city?: string
  readonly sector?: string
}

/** Civic labels are approximate, derived from a locally supplied catalog. */
export interface CivicLocation {
  readonly country: string
  readonly region: string | null
  readonly city: string | null
  readonly sector: string | null
  readonly source: 'local-civic-catalog'
  readonly precision: 'approximate-area'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function label(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean.length > 0 && clean.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(clean) ? clean : undefined
}

/** Validate real sensor time, bounds, and explicit permission. */
export function parseWindowsLocation(value: unknown, now = Date.now()): WindowsLocationFix | undefined {
  const raw = record(value)
  if (!raw || raw.permission !== 'Granted' || !bounded(raw.latitude, -90, 90)
    || !bounded(raw.longitude, -180, 180) || !bounded(raw.accuracyMeters, 0.01, 100_000)
    || !bounded(raw.observedAt, now - MAX_AGE_MS + 1, now + 5_000)) return undefined
  return {
    latitude: raw.latitude, longitude: raw.longitude, accuracyMeters: raw.accuracyMeters,
    observedAt: raw.observedAt, expiresAt: Math.min(now, raw.observedAt) + MAX_AGE_MS,
  }
}

// Fixed script: no caller-controlled arguments, no visible window, no surprise
// consent prompt. OS location access must already be enabled by the user.
const LOCATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Device
$watcher = New-Object System.Device.Location.GeoCoordinateWatcher
try {
  $started = $watcher.TryStart($true, [TimeSpan]::FromSeconds(6))
  $permission = $watcher.Permission.ToString()
  $position = $watcher.Position
  if (-not $started -or $permission -ne 'Granted' -or $position.Location.IsUnknown) {
    @{ permission = $permission } | ConvertTo-Json -Compress
  } else {
    $coordinate = $position.Location
    if ([double]::IsNaN($coordinate.HorizontalAccuracy) -or [double]::IsInfinity($coordinate.HorizontalAccuracy)) {
      @{ permission = $permission } | ConvertTo-Json -Compress
    } else {
      @{
        permission = $permission
        latitude = $coordinate.Latitude
        longitude = $coordinate.Longitude
        accuracyMeters = $coordinate.HorizontalAccuracy
        observedAt = $position.Timestamp.ToUnixTimeMilliseconds()
      } | ConvertTo-Json -Compress
    }
  }
} finally {
  $watcher.Stop()
  $watcher.Dispose()
}
`

/** Native read-only position; unsupported or denied access fails closed. */
export async function probeWindowsLocation(): Promise<WindowsLocationFix | undefined> {
  if (platform() !== 'win32') return undefined
  try {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await execute(executable, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(LOCATION_SCRIPT, 'utf16le').toString('base64'),
    ], { cwd: homedir(), timeout: 10_000, windowsHide: true, maxBuffer: 16_384 })
    return parseWindowsLocation(JSON.parse(stdout.trim().replace(/^\uFEFF/u, '')))
  } catch { return undefined }
}

/** Parse only well-formed, bounded civic circles from a local JSON file. */
export function parseCivicCatalog(value: unknown): readonly CivicArea[] {
  if (!Array.isArray(value) || value.length > 150_000) return []
  return value.flatMap((item) => {
    const raw = record(item)
    if (!raw || !bounded(raw.latitude, -90, 90) || !bounded(raw.longitude, -180, 180)
      || !bounded(raw.radiusMeters, 1, 500_000)) return []
    const country = label(raw.country)
    if (!country) return []
    const region = label(raw.region)
    const city = label(raw.city)
    const sector = label(raw.sector)
    return [{
      latitude: raw.latitude, longitude: raw.longitude, radiusMeters: raw.radiusMeters,
      country, ...(region ? { region } : {}), ...(city ? { city } : {}),
      ...(sector && city ? { sector } : {}),
    }]
  })
}

/** Read an explicitly configured local catalog, never upload coordinates. */
export function loadCivicCatalog(path?: string): readonly CivicArea[] {
  if (!path) return []
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > MAX_CATALOG_BYTES) return []
    return parseCivicCatalog(JSON.parse(readFileSync(fd, 'utf8')))
  } catch { return [] }
  finally { if (fd !== undefined) closeSync(fd) }
}

function distanceMeters(a: number, b: number, c: number, d: number): number {
  const rad = Math.PI / 180
  const h = Math.sin((c - a) * rad / 2) ** 2
    + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2
  return 12_742_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))))
}

/** Only label a place if the full sensor uncertainty circle fits within an area.
 * Conflicting local labels at any level fail closed rather than picking a city. */
export function resolveCivicLocation(
  catalog: readonly CivicArea[], latitude: number, longitude: number, accuracyMeters: number | null,
): CivicLocation | undefined {
  if (!bounded(latitude, -90, 90) || !bounded(longitude, -180, 180)
    || !bounded(accuracyMeters, 0.01, 100_000)) return undefined
  const candidates = catalog.filter(area =>
    distanceMeters(latitude, longitude, area.latitude, area.longitude) + accuracyMeters <= area.radiusMeters)
  const unique = (values: readonly (string | undefined)[]): string | null => {
    const known = [...new Set(values.filter((v): v is string => v !== undefined))]
    return known.length === 1 ? known[0] ?? null : null
  }
  const country = unique(candidates.map(area => area.country))
  if (!country) return undefined
  const region = unique(candidates.map(area => area.region))
  const city = unique(candidates.map(area => area.city))
  const sector = city ? unique(candidates.filter(area => area.city === city).map(area => area.sector)) : null
  return { country, region, city, sector, source: 'local-civic-catalog', precision: 'approximate-area' }
}
