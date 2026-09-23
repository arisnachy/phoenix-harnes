import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync, statfsSync } from 'node:fs'
import {
  arch,
  cpus,
  freemem,
  networkInterfaces,
  platform,
  release,
  totalmem,
  uptime,
} from 'node:os'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import type { Context } from '@phoenix-ai/cordis'

const execFileAsync = promisify(execFile)

/**
 * Public reality context config shape.
 */
export interface RealityContextConfig {
  readonly refreshMs: number
  readonly latitude?: number
  readonly longitude?: number
  readonly accuracyMeters?: number
  readonly locationLabel?: string
  readonly currency?: string
}

/**
 * Public reality signal shape.
 */
export interface RealitySignal<T> {
  readonly value: T | null
  readonly source: string
  readonly observedAt: string
  readonly expiresAt: string
  readonly confidence: number
  readonly stale: boolean
  readonly precision?: string
}

interface CachedProbe<T> {
  value: T | null
  source: string
  observedAt: number
  expiresAt: number
  confidence: number
}

interface WeatherPayload {
  temperatureC: number | null
  apparentTemperatureC: number | null
  humidityPercent: number | null
  precipitationMm: number | null
  rainMm: number | null
  precipitationProbabilityPercent: number | null
  windKph: number | null
  weatherCode: number | null
  sunrise: string | null
  sunset: string | null
  timezone: string | null
}

interface BatteryPayload {
  readonly present: boolean
  readonly batteries: readonly {
    readonly chargePercent: number | null
    readonly statusCode: number | null
    readonly status: string | null
    readonly estimatedRunTimeMinutes: number | null
  }[]
}

interface GpuPayload {
  readonly devices: readonly {
    readonly name: string
    readonly adapterRamBytes: number | null
    readonly driverVersion: string | null
    readonly status: string | null
  }[]
}

interface InternetProbePayload {
  readonly reachable: boolean
  readonly target: string
  readonly dnsLookupMs: number | null
  readonly httpsRoundTripMs: number | null
  readonly httpStatus: number | null
}

interface UserActivityPayload {
  readonly idleSeconds: number
}

interface AuthorizationEntryLike {
  readonly key: string
  readonly label: string
  readonly inFlight: boolean
  readonly methods: readonly { readonly id: string; readonly label: string }[]
}

interface AuthorizationTelemetryLike {
  readonly kind: 'account'
  readonly provider: string
  readonly accountType?: string
  readonly email?: string
  readonly plan?: string
  readonly primaryLimit?: {
    readonly usedPercent: number
    readonly windowDurationMins?: number
    readonly resetsAt?: number
  }
  readonly secondaryLimit?: {
    readonly usedPercent: number
    readonly windowDurationMins?: number
    readonly resetsAt?: number
  }
  readonly credits?: {
    readonly hasCredits: boolean
    readonly unlimited: boolean
    readonly balance?: string
  }
  readonly usage?: {
    readonly lifetimeTokens?: number
    readonly peakDailyTokens?: number
    readonly longestRunningTurnSec?: number
    readonly currentStreakDays?: number
    readonly longestStreakDays?: number
  }
  readonly connectors?: readonly {
    readonly id: string
    readonly name: string
    readonly category?: string
    readonly accessible: boolean
    readonly enabled: boolean
    readonly installed?: boolean
    readonly callable?: boolean
  }[]
}

interface RuntimeServiceTelemetry {
  readonly authorization: {
    readonly accounts: readonly Record<string, unknown>[]
    readonly mcp: readonly Record<string, unknown>[]
  }
  readonly ai: {
    readonly activeModel: Record<string, unknown> | null
    readonly registeredProviders: readonly Record<string, unknown>[]
    readonly configurableProviders: readonly Record<string, unknown>[]
    readonly contextWindowTokens: number | null
    readonly remainingContextTokens: null
    readonly accumulatedCost: null
    readonly accountLimits: readonly Record<string, unknown>[]
  }
  readonly calendar: {
    readonly connectorCandidates: readonly Record<string, unknown>[]
    readonly events: null
    readonly availability: null
  }
  readonly phoenix: {
    readonly pluginSummary: Record<string, unknown>
    readonly degradedPlugins: readonly Record<string, unknown>[]
    readonly update: Record<string, unknown> | null
    readonly localModel: Record<string, unknown> | null
  }
}

/**
 * Public reality snapshot shape.
 */
export interface RealitySnapshot {
  readonly schema: 1
  readonly generatedAt: string
  readonly time: Record<string, unknown>
  readonly location: Record<string, unknown>
  readonly weather: Record<string, unknown>
  readonly daylight: Record<string, unknown>
  readonly calendar: Record<string, unknown>
  readonly device: Record<string, unknown>
  readonly network: Record<string, unknown>
  readonly runtime: Record<string, unknown>
  readonly capabilities: Record<string, unknown>
  readonly authentication: Record<string, unknown>
  readonly phoenix: Record<string, unknown>
  readonly ai: Record<string, unknown>
  readonly region: Record<string, unknown>
  readonly userState: Record<string, unknown>
}

interface RealityAssemblyContext {
  readonly agent?: {
    readonly id?: unknown
    readonly options: {
      readonly provider?: string
      readonly model?: string
      readonly maxTokens?: number
      readonly reasoningEffort?: unknown
    }
    readonly session: unknown
  }
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

/**
 * Execute reality config from environment.
 * @param env - The env value.
 * @returns The resulting value.
 */
export function realityConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): RealityContextConfig {
  const latitude = finiteNumber(env.PHOENIX_REALITY_LATITUDE)
  const longitude = finiteNumber(env.PHOENIX_REALITY_LONGITUDE)
  const validCoordinates = latitude !== undefined
    && longitude !== undefined
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  const configuredRefresh = finiteNumber(env.PHOENIX_REALITY_REFRESH_MS)
  return {
    refreshMs: configuredRefresh !== undefined && configuredRefresh >= 5_000
      ? Math.round(configuredRefresh)
      : 30_000,
    ...(validCoordinates ? { latitude, longitude } : {}),
    ...(positiveNumber(env.PHOENIX_REALITY_ACCURACY_METERS) === undefined
      ? {}
      : { accuracyMeters: positiveNumber(env.PHOENIX_REALITY_ACCURACY_METERS)! }),
    ...(env.PHOENIX_REALITY_LOCATION_LABEL?.trim()
      ? { locationLabel: env.PHOENIX_REALITY_LOCATION_LABEL.trim() }
      : {}),
    ...(env.PHOENIX_REALITY_CURRENCY?.trim()
      ? { currency: env.PHOENIX_REALITY_CURRENCY.trim().toUpperCase() }
      : {}),
  }
}

function cache<T>(value: T | null, source: string, ttlMs: number, confidence: number): CachedProbe<T> {
  const observedAt = Date.now()
  return { value, source, observedAt, expiresAt: observedAt + ttlMs, confidence }
}

function signal<T>(entry: CachedProbe<T>, now = Date.now(), precision?: string): RealitySignal<T> {
  return {
    value: entry.value,
    source: entry.source,
    observedAt: new Date(entry.observedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    confidence: entry.confidence,
    stale: now > entry.expiresAt,
    ...(precision === undefined ? {} : { precision }),
  }
}

function localIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hh = String(Math.floor(absolute / 60)).padStart(2, '0')
  const mm = String(absolute % 60).padStart(2, '0')
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .replace(/Z$/u, '')
  return `${local}${sign}${hh}:${mm}`
}

function daylightSavings(date: Date): { observesDst: boolean; active: boolean } {
  const year = date.getFullYear()
  const january = new Date(year, 0, 1).getTimezoneOffset()
  const july = new Date(year, 6, 1).getTimezoneOffset()
  const standard = Math.max(january, july)
  return { observesDst: january !== july, active: date.getTimezoneOffset() < standard }
}

function measurementSystem(locale: string): 'metric' | 'us' {
  const upper = locale.toUpperCase()
  return /(?:-|_)(US|LR|MM)(?:-|_|$)/u.test(upper) ? 'us' : 'metric'
}

function diskSnapshot(): Record<string, unknown> {
  try {
    const stats = statfsSync(process.cwd(), { bigint: true })
    const freeBytes = stats.bavail * stats.bsize
    const totalBytes = stats.blocks * stats.bsize
    return {
      freeBytes: freeBytes.toString(),
      totalBytes: totalBytes.toString(),
      source: 'node:fs.statfs',
    }
  } catch (error: unknown) {
    return {
      freeBytes: null,
      totalBytes: null,
      source: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function localNetworkState(): Record<string, unknown> {
  const interfaces = networkInterfaces()
  const active = Object.entries(interfaces)
    .filter(([, entries]) => entries?.some(entry => !entry.internal))
    .map(([name]) => name)
    .sort()
  return {
    connected: active.length > 0,
    activeInterfaces: active,
    source: 'node:os.networkInterfaces',
  }
}

function serviceCapabilities(ctx: Context): string[] {
  const get = ctx.get as unknown as (name: string) => unknown
  const services = [
    'tools',
    'skills',
    'web',
    'authorization',
    'mcpConnectors',
    'llm',
    'agentDefaultModel',
    'subagents',
    'codeRuntime',
    'pythonCodeRuntime',
    'connection',
    'goals',
    'tokenMeter',
    'userProfile',
    'homeGateway',
    'clientReality',
  ]
  return services.filter(name => get.call(ctx, name) !== undefined)
}

function nearestProbability(payload: Record<string, unknown>, currentEpochSeconds: number | undefined): number | null {
  const hourly = payload.hourly
  if (hourly === null || typeof hourly !== 'object' || Array.isArray(hourly)) return null
  const record = hourly as Record<string, unknown>
  if (!Array.isArray(record.time) || !Array.isArray(record.precipitation_probability)) return null
  const times = record.time
  const values = record.precipitation_probability
  if (times.length === 0 || values.length === 0) return null
  const target = currentEpochSeconds === undefined ? Date.now() : currentEpochSeconds * 1000
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < times.length; index += 1) {
    const raw = times[index]
    const parsed = typeof raw === 'number'
      ? raw * 1000
      : typeof raw === 'string'
        ? Date.parse(raw)
        : Number.NaN
    if (!Number.isFinite(parsed)) continue
    const nextDistance = Math.abs(parsed - target)
    if (nextDistance < distance) {
      distance = nextDistance
      best = index
    }
  }
  const value = best >= 0 ? values[best] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}


async function fetchWeatherAt(latitude: number, longitude: number): Promise<WeatherPayload> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability',
    daily: 'sunrise,sunset',
    forecast_days: '1',
    timezone: 'auto',
    timeformat: 'unixtime',
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`weather provider returned HTTP ${response.status}`)
  const payload = await response.json() as Record<string, unknown>
  const currentRaw = payload.current
  const current = currentRaw !== null && typeof currentRaw === 'object' && !Array.isArray(currentRaw)
    ? currentRaw as Record<string, unknown>
    : {}
  const dailyRaw = payload.daily
  const daily = dailyRaw !== null && typeof dailyRaw === 'object' && !Array.isArray(dailyRaw)
    ? dailyRaw as Record<string, unknown>
    : {}
  const firstEpochIso = (value: unknown): string | null => {
    if (!Array.isArray(value)) return null
    const first = value[0]
    if (typeof first === 'number' && Number.isFinite(first)) return new Date(first * 1000).toISOString()
    if (typeof first === 'string' && first.length > 0) return first
    return null
  }
  const currentEpochSeconds = numberField(current, 'time') ?? undefined
  return {
    temperatureC: numberField(current, 'temperature_2m'),
    apparentTemperatureC: numberField(current, 'apparent_temperature'),
    humidityPercent: numberField(current, 'relative_humidity_2m'),
    precipitationMm: numberField(current, 'precipitation'),
    rainMm: numberField(current, 'rain'),
    precipitationProbabilityPercent: nearestProbability(payload, currentEpochSeconds),
    windKph: numberField(current, 'wind_speed_10m'),
    weatherCode: numberField(current, 'weather_code'),
    sunrise: firstEpochIso(daily.sunrise),
    sunset: firstEpochIso(daily.sunset),
    timezone: typeof payload.timezone === 'string' ? payload.timezone : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function batteryStatusLabel(code: number | null): string | null {
  switch (code) {
    case 1: return 'discharging'
    case 2: return 'on-ac'
    case 3: return 'fully-charged'
    case 4: return 'low'
    case 5: return 'critical'
    case 6: return 'charging'
    case 7: return 'charging-high'
    case 8: return 'charging-low'
    case 9: return 'charging-critical'
    case 10: return 'undefined'
    case 11: return 'partially-charged'
    default: return null
  }
}

async function windowsCimJson(script: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], {
    timeout: 4_000,
    windowsHide: true,
    maxBuffer: 512 * 1024,
  })
  const text = String(stdout).trim()
  if (text === '' || text === 'null') return []
  const parsed: unknown = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows
    .map(row => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== undefined)
}

async function probeBattery(): Promise<{ value: BatteryPayload | null; source: string; confidence: number }> {
  if (platform() !== 'win32') return { value: null, source: `unsupported-platform:${platform()}`, confidence: 0 }
  try {
    const rows = await windowsCimJson(
      '$items = @(Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime); ConvertTo-Json -InputObject $items -Compress',
    )
    return {
      value: {
        present: rows.length > 0,
        batteries: rows.map((row) => {
          const charge = numericValue(row.EstimatedChargeRemaining)
          const statusCode = numericValue(row.BatteryStatus)
          const runtime = numericValue(row.EstimatedRunTime)
          return {
            chargePercent: charge !== null && charge >= 0 && charge <= 100 ? charge : null,
            statusCode,
            status: batteryStatusLabel(statusCode),
            estimatedRunTimeMinutes: runtime !== null && runtime >= 0 && runtime < 10_080 ? runtime : null,
          }
        }),
      },
      source: 'windows-cim:Win32_Battery',
      confidence: 0.95,
    }
  } catch {
    return { value: null, source: 'windows-cim:Win32_Battery-unavailable', confidence: 0 }
  }
}

async function probeGpu(): Promise<{ value: GpuPayload | null; source: string; confidence: number }> {
  if (platform() !== 'win32') return { value: null, source: `unsupported-platform:${platform()}`, confidence: 0 }
  try {
    const rows = await windowsCimJson(
      '$items = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,Status); ConvertTo-Json -InputObject $items -Compress',
    )
    return {
      value: {
        devices: rows.flatMap((row) => {
          const name = textValue(row.Name)
          if (name === null) return []
          const ram = numericValue(row.AdapterRAM)
          return [{
            name,
            adapterRamBytes: ram !== null && ram >= 0 ? ram : null,
            driverVersion: textValue(row.DriverVersion),
            status: textValue(row.Status),
          }]
        }),
      },
      source: 'windows-cim:Win32_VideoController',
      confidence: rows.length > 0 ? 0.9 : 0.5,
    }
  } catch {
    return { value: null, source: 'windows-cim:Win32_VideoController-unavailable', confidence: 0 }
  }
}

async function probeUserActivity(): Promise<{ value: UserActivityPayload | null; source: string; confidence: number }> {
  if (platform() !== 'win32') return { value: null, source: `unsupported-platform:${platform()}`, confidence: 0 }
  const source = String.raw`
using System;
using System.Runtime.InteropServices;
public static class PhoenixLastInput {
  [StructLayout(LayoutKind.Sequential)]
  private struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")]
  private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("kernel32.dll")]
  private static extern ulong GetTickCount64();
  public static long IdleMilliseconds() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return -1;
    ulong currentLow = GetTickCount64() & 0xffffffffUL;
    ulong last = info.dwTime;
    ulong elapsed = currentLow >= last
      ? currentLow - last
      : 0x100000000UL + currentLow - last;
    return (long)elapsed;
  }
}`
  const encodedSource = Buffer.from(source, 'utf8').toString('base64')
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSource}'))`,
    'Add-Type -TypeDefinition $source -Language CSharp',
    '$milliseconds = [PhoenixLastInput]::IdleMilliseconds()',
    'if ($milliseconds -lt 0) { throw "GetLastInputInfo failed" }',
    '[pscustomobject]@{ idleSeconds = [math]::Round($milliseconds / 1000.0, 1) } | ConvertTo-Json -Compress',
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    const record = asRecord(JSON.parse(String(stdout).trim()))
    const idleSeconds = numericValue(record?.idleSeconds)
    if (idleSeconds === null || idleSeconds < 0) {
      return { value: null, source: 'windows-user32:GetLastInputInfo-invalid', confidence: 0 }
    }
    return {
      value: { idleSeconds },
      source: 'windows-user32:GetLastInputInfo',
      confidence: 0.98,
    }
  } catch {
    return { value: null, source: 'windows-user32:GetLastInputInfo-unavailable', confidence: 0 }
  }
}

function presenceFromActivity(activity: RealitySignal<UserActivityPayload>): Record<string, unknown> {
  const idleSeconds = activity.value?.idleSeconds ?? null
  const awayThresholdSeconds = 300
  return {
    status: idleSeconds === null ? 'unknown' : idleSeconds >= awayThresholdSeconds ? 'away' : 'active',
    idleSeconds,
    awayThresholdSeconds,
    source: activity.source,
    observedAt: activity.observedAt,
    expiresAt: activity.expiresAt,
    confidence: activity.confidence,
    stale: activity.stale,
    screenLocked: {
      value: null,
      source: 'not-authoritatively-probed',
      stale: true,
    },
    doNotDisturb: {
      value: null,
      source: 'not-authoritatively-probed',
      stale: true,
    },
    rule: 'active/away is derived only from host idle time using the explicit 300-second threshold; it is not a claim about attention, emotion, location, or availability',
  }
}

async function probeInternet(): Promise<{ value: InternetProbePayload; source: string; confidence: number }> {
  const target = 'https://example.com/'
  const dnsStarted = performance.now()
  try {
    await lookup('example.com')
  } catch {
    return {
      value: { reachable: false, target, dnsLookupMs: null, httpsRoundTripMs: null, httpStatus: null },
      source: 'dns+https:example.com',
      confidence: 0.9,
    }
  }
  const dnsLookupMs = Math.max(0, Math.round(performance.now() - dnsStarted))
  const requestStarted = performance.now()
  try {
    const response = await fetch(target, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(4_000),
    })
    return {
      value: {
        reachable: true,
        target,
        dnsLookupMs,
        httpsRoundTripMs: Math.max(0, Math.round(performance.now() - requestStarted)),
        httpStatus: response.status,
      },
      source: 'dns+https:example.com',
      confidence: 0.95,
    }
  } catch {
    return {
      value: { reachable: false, target, dnsLookupMs, httpsRoundTripMs: null, httpStatus: null },
      source: 'dns+https:example.com',
      confidence: 0.85,
    }
  }
}

function method<T>(
  value: unknown,
  name: string,
): T | undefined {
  const record = asRecord(value)
  const candidate = record?.[name]
  return typeof candidate === 'function' ? candidate.bind(value) as T : undefined
}

interface EffectiveLocation {
  readonly kind: 'configured' | 'browser'
  readonly latitude: number
  readonly longitude: number
  readonly accuracyMeters: number | null
  readonly label: string | null
  readonly source: string
  readonly observedAt: number | null
  readonly expiresAt: number | null
}

function transientClientLocation(
  ctx: Context,
  assembly: RealityAssemblyContext | undefined,
): EffectiveLocation | undefined {
  const sessionId = assembly?.agent?.id
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  const get = ctx.get as unknown as (name: string) => unknown
  const service = get.call(ctx, 'clientReality')
  const locationFor = method<(id: unknown) => unknown>(service, 'locationFor')
  const raw = asRecord(locationFor?.(sessionId))
  if (raw === undefined) return undefined
  const latitude = numericValue(raw.latitude)
  const longitude = numericValue(raw.longitude)
  const accuracyMeters = numericValue(raw.accuracyMeters)
  const observedAt = numericValue(raw.observedAt)
  const expiresAt = numericValue(raw.expiresAt)
  if (latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180
    || accuracyMeters === null || accuracyMeters <= 0
    || observedAt === null || expiresAt === null || expiresAt <= Date.now()) return undefined
  return {
    kind: 'browser',
    latitude,
    longitude,
    accuracyMeters,
    label: null,
    source: 'browser-geolocation',
    observedAt,
    expiresAt,
  }
}

function effectiveLocation(
  ctx: Context,
  config: RealityContextConfig,
  assembly: RealityAssemblyContext | undefined,
): EffectiveLocation | undefined {
  if (config.latitude !== undefined && config.longitude !== undefined) {
    return {
      kind: 'configured',
      latitude: config.latitude,
      longitude: config.longitude,
      accuracyMeters: config.accuracyMeters ?? null,
      label: config.locationLabel ?? null,
      source: 'explicit PHOENIX_REALITY_* configuration',
      observedAt: null,
      expiresAt: null,
    }
  }
  return transientClientLocation(ctx, assembly)
}

function locationKey(location: EffectiveLocation): string {
  return `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`
}

function sameModel(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  return left !== null
    && right !== null
    && typeof left.provider === 'string'
    && typeof left.model === 'string'
    && left.provider === right.provider
    && left.model === right.model
}

function sessionAiSnapshot(
  ctx: Context,
  assembly: RealityAssemblyContext | undefined,
  runtimeAi: RuntimeServiceTelemetry['ai'] | undefined,
): Record<string, unknown> {
  const agent = assembly?.agent
  const provider = agent?.options.provider
  const model = agent?.options.model
  const activeModel = typeof provider === 'string'
    && provider.length > 0
    && typeof model === 'string'
    && model.length > 0
    ? {
        provider,
        model,
        ...(agent?.options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: String(agent.options.reasoningEffort) }),
      }
    : null
  const defaultModel = runtimeAi?.activeModel ?? null
  const modelMatchesCachedMetadata = sameModel(activeModel, defaultModel)
  const contextWindowTokens = modelMatchesCachedMetadata
    ? runtimeAi?.contextWindowTokens ?? null
    : null

  let currentContextTokens: number | null = null
  let tokenMeasurement: Record<string, unknown> | null = null
  if (agent !== undefined) {
    const get = ctx.get as unknown as (name: string) => unknown
    const meter = get.call(ctx, 'tokenMeter')
    const measure = method<(session: unknown) => Record<string, unknown>>(meter, 'measure')
    if (measure !== undefined) {
      try {
        const measured = measure(agent.session)
        const total = numericValue(measured.totalTokens)
        if (total !== null && total >= 0) currentContextTokens = total
        const baseline = asRecord(measured.baseline)
        tokenMeasurement = {
          source: 'tokenMeter.measure(active-session)',
          logRevision: numericValue(measured.logRevision),
          baselineKind: typeof baseline?.kind === 'string' ? baseline.kind : null,
          surfaceTokens: numericValue(measured.surfaceTokens),
        }
      } catch {
        tokenMeasurement = {
          source: 'tokenMeter.measure(active-session)',
          error: 'measurement-unavailable',
        }
      }
    }
  }

  const outputReservation = agent?.options.maxTokens
  const outputReservationTokens = typeof outputReservation === 'number'
    && Number.isSafeInteger(outputReservation)
    && outputReservation > 0
    ? outputReservation
    : null
  const remainingContextTokens = contextWindowTokens !== null && currentContextTokens !== null
    ? Math.max(0, contextWindowTokens - currentContextTokens)
    : null
  const inputHeadroomAfterOutputReserveTokens = remainingContextTokens !== null && outputReservationTokens !== null
    ? Math.max(0, remainingContextTokens - outputReservationTokens)
    : null

  return {
    activeModel,
    defaultModel,
    selectionSource: activeModel === null ? 'no-active-agent-model' : 'active-agent',
    contextWindowTokens,
    contextWindowSource: contextWindowTokens === null
      ? 'unavailable-for-active-model'
      : 'cached-exact-model-metadata',
    currentContextTokens,
    remainingContextTokens,
    outputReservationTokens,
    inputHeadroomAfterOutputReserveTokens,
    tokenMeasurement,
    precision: 'remainingContextTokens = contextWindowTokens - currentContextTokens; inputHeadroomAfterOutputReserveTokens additionally subtracts the agent maxTokens reservation when explicitly configured',
  }
}

function authorizationAccountView(
  entry: AuthorizationEntryLike,
  telemetry: AuthorizationTelemetryLike | undefined,
  inspectFailed: boolean,
): Record<string, unknown> {
  return {
    key: entry.key,
    label: entry.label,
    inFlight: entry.inFlight,
    methods: entry.methods.map(item => ({ id: item.id, label: item.label })),
    credentialState: telemetry !== undefined ? 'valid' : inspectFailed ? 'unknown' : 'missing',
    expiryState: 'unreported',
    ...(telemetry === undefined ? {} : {
      provider: telemetry.provider,
      accountType: telemetry.accountType ?? null,
      plan: telemetry.plan ?? null,
      primaryLimit: telemetry.primaryLimit ?? null,
      secondaryLimit: telemetry.secondaryLimit ?? null,
      credits: telemetry.credits ?? null,
      usage: telemetry.usage ?? null,
      connectors: telemetry.connectors?.map(connector => ({
        id: connector.id,
        name: connector.name,
        category: connector.category ?? null,
        accessible: connector.accessible,
        enabled: connector.enabled,
        installed: connector.installed ?? null,
        callable: connector.callable ?? null,
      })) ?? [],
    }),
  }
}

function calendarCandidates(
  accounts: readonly Record<string, unknown>[],
  mcp: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = []
  for (const account of accounts) {
    const connectors = account.connectors
    if (!Array.isArray(connectors)) continue
    for (const raw of connectors) {
      const connector = asRecord(raw)
      const haystack = [
        connector?.id,
        connector?.name,
        connector?.category,
      ].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase()
      if (haystack.includes('calendar')) candidates.push({ source: 'authorization', ...connector })
    }
  }
  for (const row of mcp) {
    const tools = Array.isArray(row.tools) ? row.tools.filter((value): value is string => typeof value === 'string') : []
    if (tools.some(tool => tool.toLowerCase().includes('calendar'))) {
      candidates.push({ source: 'mcp', serverName: row.serverName ?? null, status: row.status ?? null, tools })
    }
  }
  return candidates
}

async function probeRuntimeServices(ctx: Context): Promise<RuntimeServiceTelemetry> {
  const get = ctx.get as unknown as (name: string) => unknown
  const authorization = get.call(ctx, 'authorization')
  const authList = method<() => readonly AuthorizationEntryLike[]>(authorization, 'list')
  const authInspect = method<(key: string) => Promise<AuthorizationTelemetryLike | undefined>>(authorization, 'inspect')
  const accounts: Record<string, unknown>[] = []
  if (authList !== undefined) {
    for (const entry of authList()) {
      let telemetry: AuthorizationTelemetryLike | undefined
      let inspectFailed = false
      if (authInspect !== undefined) {
        try {
          telemetry = await authInspect(entry.key)
        } catch {
          inspectFailed = true
        }
      }
      accounts.push(authorizationAccountView(entry, telemetry, inspectFailed))
    }
  }

  const mcpRegistry = get.call(ctx, 'mcpConnectors')
  const mcpList = method<() => readonly Record<string, unknown>[]>(mcpRegistry, 'list')
  const mcp = (mcpList?.() ?? []).map((row) => ({
    serverName: row.serverName ?? null,
    status: row.status ?? 'unknown',
    transport: row.transport ?? null,
    reasonCode: row.reasonCode ?? null,
    tools: Array.isArray(row.toolNames) ? [...row.toolNames] : [],
  }))

  const llm = get.call(ctx, 'llm')
  const listProviders = method<() => readonly { id: string; name: string }[]>(llm, 'listProviders')
  const listConfigurableProviders = method<() => readonly Record<string, unknown>[]>(llm, 'listConfigurableProviders')
  const resolveModelInfo = method<(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>>(llm, 'resolveModelInfo')

  const defaultModel = get.call(ctx, 'agentDefaultModel')
  const currentSelection = method<() => Record<string, unknown>>(defaultModel, 'currentSelection')
  const activeModel = currentSelection?.() ?? null
  let contextWindowTokens: number | null = null
  if (activeModel !== null
    && typeof activeModel.provider === 'string'
    && typeof activeModel.model === 'string'
    && resolveModelInfo !== undefined) {
    try {
      const model = await resolveModelInfo(activeModel.provider, activeModel.model, AbortSignal.timeout(2_000))
      const context = asRecord(model.context)
      const window = context?.contextWindow
      if (typeof window === 'number' && Number.isSafeInteger(window) && window > 0) contextWindowTokens = window
    } catch {
      // Exact-model metadata is advisory; provider/runtime availability is still projected below.
    }
  }

  const accountLimits = accounts
    .filter(account => account.primaryLimit !== undefined
      || account.secondaryLimit !== undefined
      || account.credits !== undefined
      || account.usage !== undefined)
    .map(account => ({
      key: account.key,
      provider: account.provider ?? null,
      primaryLimit: account.primaryLimit ?? null,
      secondaryLimit: account.secondaryLimit ?? null,
      credits: account.credits ?? null,
      usage: account.usage ?? null,
    }))

  const pluginInventory = get.call(ctx, 'pluginInventory')
  const pluginList = method<() => { readonly entries: readonly Record<string, unknown>[] }>(pluginInventory, 'list')
  const updateState = method<() => Record<string, unknown>>(pluginInventory, 'updateState')
  const localModelState = method<() => Promise<Record<string, unknown>>>(pluginInventory, 'localModelState')
  const pluginEntries = pluginList?.().entries ?? []
  const countPhase = (phase: string): number =>
    pluginEntries.filter(entry => entry.fiberPhase === phase).length
  const pluginSummary = {
    total: pluginEntries.length,
    enabled: pluginEntries.filter(entry => entry.enabled === true).length,
    active: countPhase('active'),
    loading: countPhase('loading'),
    pending: countPhase('pending'),
    failed: countPhase('failed'),
    unloading: countPhase('unloading'),
  }
  const degradedPlugins = pluginEntries
    .filter(entry => entry.fiberPhase === 'failed')
    .slice(0, 20)
    .map(entry => ({
      entryId: entry.entryId ?? null,
      moduleName: entry.moduleName ?? null,
      enabled: entry.enabled ?? null,
      fiberPhase: entry.fiberPhase ?? null,
    }))
  let localModel: Record<string, unknown> | null = null
  if (localModelState !== undefined) {
    try {
      const raw = await localModelState()
      localModel = {
        mode: raw.mode ?? null,
        selectedModelId: raw.selectedModelId ?? null,
        installedModelIds: Array.isArray(raw.installedModelIds) ? [...raw.installedModelIds] : [],
        phase: raw.phase ?? null,
        progress: raw.progress ?? null,
        error: raw.error ?? null,
      }
    } catch {
      localModel = null
    }
  }

  return {
    authorization: { accounts, mcp },
    ai: {
      activeModel,
      registeredProviders: (listProviders?.() ?? []).map(provider => ({
        id: provider.id,
        name: provider.name,
        health: 'registered-not-probed',
      })),
      configurableProviders: (listConfigurableProviders?.() ?? []).map(provider => ({
        provider: provider.provider ?? null,
        displayName: provider.displayName ?? null,
        settingsNs: provider.settingsNs ?? null,
      })),
      contextWindowTokens,
      remainingContextTokens: null,
      accumulatedCost: null,
      accountLimits,
    },
    calendar: {
      connectorCandidates: calendarCandidates(accounts, mcp),
      events: null,
      availability: null,
    },
    phoenix: {
      pluginSummary,
      degradedPlugins,
      update: updateState?.() ?? null,
      localModel,
    },
  }
}

async function probeClockSync(): Promise<{ value: boolean | null; source: string; confidence: number }> {
  try {
    if (platform() === 'win32') {
      const { stdout } = await execFileAsync('w32tm', ['/query', '/status'], {
        timeout: 2_000,
        windowsHide: true,
      })
      const text = String(stdout)
      if (/free-running system clock/iu.test(text)) return { value: false, source: 'w32tm', confidence: 0.95 }
      if (/source\s*:/iu.test(text)) return { value: true, source: 'w32tm', confidence: 0.9 }
      return { value: null, source: 'w32tm-unrecognized', confidence: 0 }
    }
    if (platform() === 'linux') {
      const { stdout } = await execFileAsync('timedatectl', ['show', '-p', 'NTPSynchronized', '--value'], {
        timeout: 2_000,
      })
      const text = String(stdout).trim().toLowerCase()
      if (text === 'yes') return { value: true, source: 'timedatectl', confidence: 0.98 }
      if (text === 'no') return { value: false, source: 'timedatectl', confidence: 0.98 }
    }
  } catch {
    // Clock synchronization is an optional best-effort OS probe.
  }
  return { value: null, source: 'unverified', confidence: 0 }
}

/**
 * Public reality context engine contract.
 */
export class RealityContextEngine {
  private internet = cache<InternetProbePayload>(null, 'not-probed', 1, 0)
  private userActivity = cache<UserActivityPayload>(null, 'not-probed', 1, 0)
  private battery = cache<BatteryPayload>(null, 'not-probed', 1, 0)
  private gpu = cache<GpuPayload>(null, 'not-probed', 1, 0)
  private clockSync = cache<boolean>(null, 'not-probed', 1, 0)
  private weather = cache<WeatherPayload>(null, 'not-configured', 1, 0)
  private browserWeather = cache<WeatherPayload>(null, 'not-probed', 1, 0)
  private browserWeatherKey: string | undefined
  private runtimeServices = cache<RuntimeServiceTelemetry>(null, 'not-probed', 1, 0)
  private timer: ReturnType<typeof setInterval> | undefined
  private refreshJob: Promise<void> | undefined
  private runtimeRefreshJob: Promise<void> | undefined
  private browserWeatherJob: Promise<void> | undefined

  constructor(readonly config: RealityContextConfig) {}

  /**
   * Execute reality context engine start.
   */
  start(): void {
    if (this.timer !== undefined) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.config.refreshMs)
    this.timer.unref?.()
  }

  /**
   * Execute reality context engine stop.
   */
  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  private refresh(): Promise<void> {
    if (this.refreshJob !== undefined) return this.refreshJob
    const job = this.performRefresh().finally(() => {
      if (this.refreshJob === job) this.refreshJob = undefined
    })
    this.refreshJob = job
    return job
  }

  private async performRefresh(): Promise<void> {
    const now = Date.now()
    const hostProbes: Promise<void>[] = []
    if (now > this.internet.expiresAt) {
        hostProbes.push((async () => {
          const probe = await probeInternet()
          this.internet = cache(
            probe.value,
            probe.source,
            probe.value.reachable ? this.config.refreshMs * 2 : this.config.refreshMs,
            probe.confidence,
          )
      })())
    }
    if (now > this.battery.expiresAt) {
        hostProbes.push((async () => {
          const probe = await probeBattery()
          this.battery = cache(probe.value, probe.source, 60_000, probe.confidence)
      })())
    }
    if (now > this.gpu.expiresAt) {
        hostProbes.push((async () => {
          const probe = await probeGpu()
          this.gpu = cache(probe.value, probe.source, 10 * 60_000, probe.confidence)
      })())
    }
    if (now > this.userActivity.expiresAt) {
        hostProbes.push((async () => {
          const probe = await probeUserActivity()
          this.userActivity = cache(probe.value, probe.source, this.config.refreshMs, probe.confidence)
      })())
    }
    await Promise.all(hostProbes)
    if (now > this.clockSync.expiresAt) {
      const probe = await probeClockSync()
      this.clockSync = cache(probe.value, probe.source, 5 * 60_000, probe.confidence)
    }
    if (this.config.latitude !== undefined
      && this.config.longitude !== undefined
      && now > this.weather.expiresAt) {
      try {
        this.weather = cache(
          await fetchWeatherAt(this.config.latitude, this.config.longitude),
          'open-meteo',
          10 * 60_000,
          0.95,
        )
      } catch {
        this.weather = cache<WeatherPayload>(null, 'open-meteo-unavailable', 60_000, 0)
      }
    }
  }

  /**
   * Execute reality context engine refresh runtime services.
   * @param ctx - The ctx value.
   */
  async refreshRuntimeServices(ctx: Context): Promise<void> {
    if (Date.now() <= this.runtimeServices.expiresAt) return
    if (this.runtimeRefreshJob !== undefined) return this.runtimeRefreshJob
    const job = this.performRuntimeRefresh(ctx).finally(() => {
      if (this.runtimeRefreshJob === job) this.runtimeRefreshJob = undefined
    })
    this.runtimeRefreshJob = job
    return job
  }

  private async performRuntimeRefresh(ctx: Context): Promise<void> {
    try {
      this.runtimeServices = cache(
        await probeRuntimeServices(ctx),
        'phoenix-runtime-services',
        this.config.refreshMs,
        0.95,
      )
    } catch {
      this.runtimeServices = cache<RuntimeServiceTelemetry>(
        null,
        'phoenix-runtime-services-unavailable',
        Math.min(this.config.refreshMs, 30_000),
        0,
      )
    }
  }

  private async refreshBrowserWeather(
    ctx: Context,
    assembly: RealityAssemblyContext | undefined,
    force = false,
  ): Promise<void> {
    const location = effectiveLocation(ctx, this.config, assembly)
    if (location?.kind !== 'browser') return
    const key = locationKey(location)
    if (this.browserWeatherJob !== undefined) {
      await this.browserWeatherJob
      if (!force && this.browserWeatherKey === key && Date.now() <= this.browserWeather.expiresAt) return
    }
    if (!force && this.browserWeatherKey === key && Date.now() <= this.browserWeather.expiresAt) return

    const job = (async () => {
      try {
        const value = await fetchWeatherAt(location.latitude, location.longitude)
        this.browserWeatherKey = key
        this.browserWeather = cache(value, 'open-meteo:browser-location', 10 * 60_000, 0.95)
      } catch {
        this.browserWeatherKey = key
        this.browserWeather = cache<WeatherPayload>(
          null,
          'open-meteo:browser-location-unavailable',
          60_000,
          0,
        )
      }
    })().finally(() => {
      if (this.browserWeatherJob === job) this.browserWeatherJob = undefined
    })
    this.browserWeatherJob = job
    await job
  }

  /**
   * Wait for a usable Reality Context refresh. Full mode deliberately expires
   * cached probes first; ordinary mode respects per-signal TTLs and only waits
   * for currently due work.
   * @param ctx - Cordis scope supplying live Phoenix runtime services.
   * @param full - Whether to invalidate every configured probe before refreshing.
   * @param assembly - The assembly value.
   */
  async refreshNow(
    ctx: Context,
    full = false,
    assembly?: RealityAssemblyContext,
  ): Promise<void> {
    if (full) {
      await Promise.all([
        this.refreshJob ?? Promise.resolve(),
        this.runtimeRefreshJob ?? Promise.resolve(),
        this.browserWeatherJob ?? Promise.resolve(),
      ])
      for (const entry of [
        this.internet,
        this.userActivity,
        this.battery,
        this.gpu,
        this.clockSync,
        this.weather,
        this.browserWeather,
        this.runtimeServices,
      ]) {
        entry.expiresAt = 0
      }
    }
    await Promise.all([
      this.refresh(),
      this.refreshRuntimeServices(ctx),
      this.refreshBrowserWeather(ctx, assembly, full),
    ])
  }

  /**
   * Execute reality context engine snapshot.
   * @param assembly - The assembly value.
   * @param now - The now value.
   * @param ctx - The ctx value.
   * @returns The resulting value.
   */
  snapshot(
    ctx: Context,
    now = new Date(),
    assembly?: RealityAssemblyContext,
  ): RealitySnapshot {
    void this.refreshRuntimeServices(ctx)
    const epoch = now.getTime()
    const intl = new Intl.DateTimeFormat().resolvedOptions()
    const timezone = intl.timeZone || 'UTC'
    const dst = daylightSavings(now)
    const location = effectiveLocation(ctx, this.config, assembly)
    if (location?.kind === 'browser') void this.refreshBrowserWeather(ctx, assembly)
    const weather = location?.kind === 'browser'
      ? this.browserWeatherKey === locationKey(location)
        ? signal(this.browserWeather, epoch)
        : {
            value: null,
            source: 'not-probed',
            observedAt: now.toISOString(),
            expiresAt: now.toISOString(),
            confidence: 0,
            stale: true,
          }
      : signal(this.weather, epoch)
    const weatherValue = weather.value
    const sunrise = weatherValue?.sunrise ?? null
    const sunset = weatherValue?.sunset ?? null
    const sunriseMs = sunrise === null ? Number.NaN : Date.parse(sunrise)
    const sunsetMs = sunset === null ? Number.NaN : Date.parse(sunset)
    const daylightKnown = Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs)
    const runtimeServices = signal(this.runtimeServices, epoch)
    const runtimeValue = runtimeServices.value
    const internet = signal(this.internet, epoch)
    const battery = signal(this.battery, epoch)
    const gpu = signal(this.gpu, epoch)
    const userActivity = signal(this.userActivity, epoch)
    const sessionAi = sessionAiSnapshot(ctx, assembly, runtimeValue?.ai)

    return {
      schema: 1,
      generatedAt: now.toISOString(),
      time: {
        wallClockLocal: localIso(now),
        wallClockUtc: now.toISOString(),
        timezone,
        dayOfWeek: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(now),
        utcOffsetMinutes: -now.getTimezoneOffset(),
        observesDst: dst.observesDst,
        dstActive: dst.active,
        monotonicMilliseconds: Math.round(performance.now()),
        processUptimeSeconds: Math.round(uptime()),
        ntpSynchronized: signal(this.clockSync, epoch),
      },
      location: location === undefined
        ? {
            status: 'unknown',
            country: null,
            region: null,
            city: null,
            reason: 'precise coordinates were not explicitly configured and no non-expired browser geolocation permission sample is available',
            source: 'none',
          }
        : {
            status: location.kind === 'configured' ? 'authorized-configured' : 'authorized-browser',
            country: null,
            region: null,
            city: null,
            label: location.label,
            latitude: location.latitude,
            longitude: location.longitude,
            accuracyMeters: location.accuracyMeters,
            source: location.source,
            observedAt: location.observedAt === null ? null : new Date(location.observedAt).toISOString(),
            expiresAt: location.expiresAt === null ? null : new Date(location.expiresAt).toISOString(),
            retention: location.kind === 'browser' ? 'ephemeral-host-cache' : 'configuration',
            rule: location.kind === 'browser'
              ? 'browser coordinates exist only because geolocation permission was already granted; do not infer city/region/country or persist the coordinates as memory'
              : 'configured coordinates are explicit host configuration',
          },
      weather: location === undefined
        ? {
            status: 'unknown',
            reason: 'weather is not queried without authorized coordinates',
            source: 'none',
          }
        : {
            status: weather.value === null ? 'unavailable' : 'available',
            signal: weather,
            alerts: {
              value: null,
              source: 'not-provided-by-current-weather-adapter',
              stale: true,
            },
          },
      daylight: daylightKnown
        ? {
            status: 'available',
            sunrise,
            sunset,
            isDaylight: epoch >= sunriseMs && epoch < sunsetMs,
            source: weather.source,
            observedAt: weather.observedAt,
            expiresAt: weather.expiresAt,
            stale: weather.stale,
          }
        : {
            status: 'unknown',
            reason: 'sunrise/sunset require fresh weather/location evidence',
          },
      calendar: {
        status: runtimeValue === null ? 'unknown' : 'connector-state-known',
        connectorCandidates: runtimeValue?.calendar.connectorCandidates ?? [],
        events: runtimeValue?.calendar.events ?? null,
        availability: runtimeValue?.calendar.availability ?? null,
        observedAt: runtimeServices.observedAt,
        expiresAt: runtimeServices.expiresAt,
        stale: runtimeServices.stale,
        rule: 'connector presence is not calendar content; query the authorized calendar before relying on meetings, commitments, holidays, or availability',
      },
      device: {
        os: platform(),
        osRelease: release(),
        architecture: arch(),
        cpuLogicalCores: cpus().length,
        cpuModel: cpus()[0]?.model ?? null,
        memoryFreeBytes: freemem(),
        memoryTotalBytes: totalmem(),
        disk: diskSnapshot(),
        battery,
        gpu,
        temperature: {
          value: null,
          source: 'not-authoritatively-exposed-by-current-host-adapter',
          stale: true,
          rule: 'do not infer thermals from load, fan noise, GPU status, or battery state',
        },
      },
      network: {
        local: localNetworkState(),
        internetReachable: {
          ...internet,
          value: internet.value?.reachable ?? null,
        },
        latencyMs: {
          ...internet,
          value: internet.value?.httpsRoundTripMs ?? null,
          precision: 'HTTPS HEAD round trip to example.com after DNS resolution; not ICMP ping',
        },
        dnsLookupLatencyMs: {
          ...internet,
          value: internet.value?.dnsLookupMs ?? null,
          precision: 'DNS lookup wall-clock duration for example.com',
        },
        probeTarget: internet.value?.target ?? 'https://example.com/',
        httpStatus: internet.value?.httpStatus ?? null,
        bandwidthMbps: {
          value: null,
          source: 'not-measured-to-avoid-bulk-background-traffic',
          stale: true,
        },
        serviceOutages: { value: null, source: 'requires-target-specific-check', stale: true },
      },
      runtime: {
        node: process.version,
        pid: process.pid,
        cwd: process.cwd(),
        desktopApp: process.env.PHOENIX_DESKTOP === '1' || process.env.PHOENIX_DESKTOP_APP === '1',
        web: process.env.DSH_WEB_URL !== undefined,
        wsl: process.env.WSL_INTEROP !== undefined || /microsoft/iu.test(release()),
        docker: existsSync('/.dockerenv'),
        ci: process.env.CI !== undefined,
      },
      capabilities: {
        activeServices: serviceCapabilities(ctx),
        rule: 'presence means available in this Cordis scope; a missing service must not be invented',
      },
      authentication: {
        status: runtimeValue === null ? 'unknown' : 'available',
        authorizationServiceAvailable: serviceCapabilities(ctx).includes('authorization'),
        accounts: runtimeValue?.authorization.accounts ?? [],
        mcp: runtimeValue?.authorization.mcp ?? [],
        observedAt: runtimeServices.observedAt,
        expiresAt: runtimeServices.expiresAt,
        stale: runtimeServices.stale,
        rule: 'credentialState=valid means the provider returned sanitized account telemetry at observation time; expiryState remains unreported unless a provider exposes it. Re-check before sensitive actions.',
      },
      phoenix: {
        channel: process.env.PHOENIX_CHANNEL ?? process.env.PHOENIX_UPDATE_CHANNEL ?? null,
        commit: process.env.PHOENIX_RUNTIME_SHA ?? process.env.GIT_COMMIT ?? null,
        version: process.env.npm_package_version ?? null,
        update: runtimeValue?.phoenix.update ?? (
          process.env.PHOENIX_UPDATE_STATE === undefined
            ? null
            : { status: process.env.PHOENIX_UPDATE_STATE, source: 'environment' }
        ),
        supervisor: process.env.PHOENIX_SUPERVISOR === '1' ? 'active' : 'unknown',
        pluginSummary: runtimeValue?.phoenix.pluginSummary ?? {
          total: null,
          enabled: null,
          active: null,
          loading: null,
          pending: null,
          failed: null,
          unloading: null,
        },
        degradedPlugins: runtimeValue?.phoenix.degradedPlugins ?? [],
        localModel: runtimeValue?.phoenix.localModel ?? null,
        observedAt: runtimeServices.observedAt,
        expiresAt: runtimeServices.expiresAt,
        stale: runtimeServices.stale,
      },
      ai: {
        status: runtimeValue === null ? 'unknown' : 'available',
        ...sessionAi,
        registeredProviders: runtimeValue?.ai.registeredProviders ?? [],
        configurableProviders: runtimeValue?.ai.configurableProviders ?? [],
        accumulatedCost: runtimeValue?.ai.accumulatedCost ?? null,
        accountLimits: runtimeValue?.ai.accountLimits ?? [],
        tokenMeterAvailable: serviceCapabilities(ctx).includes('tokenMeter'),
        observedAt: runtimeServices.observedAt,
        expiresAt: runtimeServices.expiresAt,
        stale: runtimeServices.stale,
        rule: 'activeModel and token pressure are scoped to the agent assembling this prompt. Registered provider is not the same as healthy provider. Context headroom is reported only when the active model matches exact cached model metadata; accumulated cost remains unknown unless a provider exposes it.',
      },
      region: {
        locale: intl.locale,
        calendar: intl.calendar,
        numberingSystem: intl.numberingSystem,
        measurementSystem: measurementSystem(intl.locale),
        currency: this.config.currency ?? null,
        dateAmbiguityRule: 'use ISO dates internally and include month names or YYYY-MM-DD when user-facing numeric dates could be ambiguous',
      },
      userState: {
        ...presenceFromActivity(userActivity),
        workSchedule: {
          value: null,
          source: 'requires-explicit-preference-or-authorized-calendar',
          stale: true,
        },
      },
    }
  }

  /**
   * Execute reality context engine render.
   * @param assembly - The assembly value.
   * @param ctx - The ctx value.
   * @returns The resulting value.
   */
  render(ctx: Context, assembly?: RealityAssemblyContext): string {
    return [
      '<phoenix_reality_context>',
      'This is a fresh/best-effort machine snapshot. Every field carries its own provenance or an explicit unknown state. Treat stale/unknown fields as unavailable and verify them before environment-sensitive action.',
      JSON.stringify(this.snapshot(ctx, new Date(), assembly)),
      '</phoenix_reality_context>',
    ].join('\n')
  }
}

/**
 * Public reality prompt registrar shape.
 */
export interface RealityPromptRegistrar {
  context: (context: {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: RealityAssemblyContext) => string)
    readonly interpolateVariables?: boolean
  }) => () => void
}

/**
 * Execute install reality context projection.
 * @param ctx - The ctx value.
 * @param engine - The engine value.
 * @param systemPrompt - The system prompt value.
 * @returns The resulting value.
 */
export function installRealityContextProjection(
  systemPrompt: RealityPromptRegistrar,
  engine: RealityContextEngine,
  ctx: Context,
): () => void {
  return systemPrompt.context({
    name: 'hardness:reality-context',
    order: 20,
    text: context => engine.render(ctx, context),
    interpolateVariables: false,
  })
}
