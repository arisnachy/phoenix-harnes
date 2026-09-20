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

export interface RealityContextConfig {
  readonly refreshMs: number
  readonly latitude?: number
  readonly longitude?: number
  readonly accuracyMeters?: number
  readonly locationLabel?: string
  readonly currency?: string
}

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

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

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
    'subagents',
    'codeRuntime',
    'pythonCodeRuntime',
    'connection',
    'goals',
    'tokenMeter',
    'userProfile',
    'homeGateway',
  ]
  return services.filter(name => get.call(ctx, name) !== undefined)
}

function nearestProbability(payload: Record<string, unknown>, currentTime: string | undefined): number | null {
  const hourly = payload.hourly
  if (hourly === null || typeof hourly !== 'object' || Array.isArray(hourly)) return null
  const record = hourly as Record<string, unknown>
  if (!Array.isArray(record.time) || !Array.isArray(record.precipitation_probability)) return null
  const times = record.time.filter((value): value is string => typeof value === 'string')
  const values = record.precipitation_probability
  if (times.length === 0 || values.length === 0) return null
  const target = currentTime === undefined ? Date.now() : Date.parse(currentTime)
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < times.length; index += 1) {
    const parsed = Date.parse(times[index]!)
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

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function fetchWeather(config: RealityContextConfig): Promise<WeatherPayload> {
  if (config.latitude === undefined || config.longitude === undefined) {
    throw new Error('precise location is not configured')
  }
  const query = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability',
    daily: 'sunrise,sunset',
    forecast_days: '1',
    timezone: 'auto',
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
  const first = (value: unknown): string | null =>
    Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
  const currentTime = stringField(current, 'time') ?? undefined
  return {
    temperatureC: numberField(current, 'temperature_2m'),
    apparentTemperatureC: numberField(current, 'apparent_temperature'),
    humidityPercent: numberField(current, 'relative_humidity_2m'),
    precipitationMm: numberField(current, 'precipitation'),
    rainMm: numberField(current, 'rain'),
    precipitationProbabilityPercent: nearestProbability(payload, currentTime),
    windKph: numberField(current, 'wind_speed_10m'),
    weatherCode: numberField(current, 'weather_code'),
    sunrise: first(daily.sunrise),
    sunset: first(daily.sunset),
    timezone: typeof payload.timezone === 'string' ? payload.timezone : null,
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

export class RealityContextEngine {
  private internet = cache<boolean>(null, 'not-probed', 1, 0)
  private clockSync = cache<boolean>(null, 'not-probed', 1, 0)
  private weather = cache<WeatherPayload>(null, 'not-configured', 1, 0)
  private timer: ReturnType<typeof setInterval> | undefined
  private refreshing = false

  constructor(readonly config: RealityContextConfig) {}

  start(): void {
    if (this.timer !== undefined) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.config.refreshMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const now = Date.now()
      if (now > this.internet.expiresAt) {
        try {
          await lookup('example.com')
          this.internet = cache(true, 'dns:example.com', this.config.refreshMs * 2, 0.85)
        } catch {
          this.internet = cache(false, 'dns:example.com', this.config.refreshMs, 0.75)
        }
      }
      if (now > this.clockSync.expiresAt) {
        const probe = await probeClockSync()
        this.clockSync = cache(probe.value, probe.source, 5 * 60_000, probe.confidence)
      }
      if (this.config.latitude !== undefined
        && this.config.longitude !== undefined
        && now > this.weather.expiresAt) {
        try {
          this.weather = cache(await fetchWeather(this.config), 'open-meteo', 10 * 60_000, 0.95)
        } catch {
          this.weather = cache(null, 'open-meteo-unavailable', 60_000, 0)
        }
      }
    } finally {
      this.refreshing = false
    }
  }

  snapshot(ctx: Context, now = new Date()): RealitySnapshot {
    const epoch = now.getTime()
    const intl = new Intl.DateTimeFormat().resolvedOptions()
    const timezone = intl.timeZone || 'UTC'
    const dst = daylightSavings(now)
    const weather = signal(this.weather, epoch)
    const locationConfigured = this.config.latitude !== undefined && this.config.longitude !== undefined
    const weatherValue = weather.value
    const sunrise = weatherValue?.sunrise ?? null
    const sunset = weatherValue?.sunset ?? null
    const sunriseMs = sunrise === null ? Number.NaN : Date.parse(sunrise)
    const sunsetMs = sunset === null ? Number.NaN : Date.parse(sunset)
    const daylightKnown = Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs)

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
      location: locationConfigured
        ? {
            status: 'authorized-configured',
            label: this.config.locationLabel ?? null,
            latitude: this.config.latitude,
            longitude: this.config.longitude,
            accuracyMeters: this.config.accuracyMeters ?? null,
            source: 'explicit PHOENIX_REALITY_* configuration',
          }
        : {
            status: 'unknown',
            reason: 'precise coordinates were not explicitly authorized/configured',
            source: 'none',
          },
      weather: locationConfigured
        ? {
            status: weather.value === null ? 'unavailable' : 'available',
            signal: weather,
            alerts: {
              value: null,
              source: 'not-provided-by-current-weather-adapter',
              stale: true,
            },
          }
        : {
            status: 'unknown',
            reason: 'weather is not queried without authorized coordinates',
            source: 'none',
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
        status: 'requires-live-connector-check',
        rule: 'verify holidays, meetings, commitments, and availability through an authorized calendar connector before relying on them',
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
        battery: { value: null, source: 'no-cross-platform-host-adapter', stale: true },
        gpu: { value: null, source: 'no-cross-platform-host-adapter', stale: true },
        temperature: { value: null, source: 'no-cross-platform-host-adapter', stale: true },
      },
      network: {
        local: localNetworkState(),
        internetReachable: signal(this.internet, epoch),
        latencyMs: { value: null, source: 'not-yet-measured', stale: true },
        bandwidthMbps: { value: null, source: 'not-yet-measured', stale: true },
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
        status: 'requires-live-connector-check',
        authorizationServiceAvailable: serviceCapabilities(ctx).includes('authorization'),
        rule: 'inspect connector state immediately before actions that depend on credentials; never assume a token remains valid',
      },
      phoenix: {
        channel: process.env.PHOENIX_CHANNEL ?? process.env.PHOENIX_UPDATE_CHANNEL ?? null,
        commit: process.env.PHOENIX_RUNTIME_SHA ?? process.env.GIT_COMMIT ?? null,
        version: process.env.npm_package_version ?? null,
        updateState: process.env.PHOENIX_UPDATE_STATE ?? null,
        supervisor: process.env.PHOENIX_SUPERVISOR === '1' ? 'active' : 'unknown',
      },
      ai: {
        status: 'requires-live-runtime-check',
        rule: 'verify selected model, remaining context, quota, rate limits, provider health, and cost before relying on them',
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
        status: 'unknown-unless-observed',
        rule: 'use only explicit activity, DND, schedule, or preference signals; never infer emotional or physical state as fact',
      },
    }
  }

  render(ctx: Context): string {
    return [
      '<phoenix_reality_context>',
      'This is a fresh/best-effort machine snapshot. Every field carries its own provenance or an explicit unknown state. Treat stale/unknown fields as unavailable and verify them before environment-sensitive action.',
      JSON.stringify(this.snapshot(ctx)),
      '</phoenix_reality_context>',
    ].join('\n')
  }
}

export interface RealityPromptRegistrar {
  context: (context: {
    readonly name: string
    readonly order: number
    readonly text: string | (() => string)
    readonly interpolateVariables?: boolean
  }) => () => void
}

export function installRealityContextProjection(
  systemPrompt: RealityPromptRegistrar,
  engine: RealityContextEngine,
  ctx: Context,
): () => void {
  return systemPrompt.context({
    name: 'hardness:reality-context',
    order: 20,
    text: () => engine.render(ctx),
    interpolateVariables: false,
  })
}
