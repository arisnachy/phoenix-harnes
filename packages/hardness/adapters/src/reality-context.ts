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

function method<T>(
  value: unknown,
  name: string,
): T | undefined {
  const record = asRecord(value)
  const candidate = record?.[name]
  return typeof candidate === 'function' ? candidate.bind(value) as T : undefined
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

export class RealityContextEngine {
  private internet = cache<boolean>(null, 'not-probed', 1, 0)
  private clockSync = cache<boolean>(null, 'not-probed', 1, 0)
  private weather = cache<WeatherPayload>(null, 'not-configured', 1, 0)
  private runtimeServices = cache<RuntimeServiceTelemetry>(null, 'not-probed', 1, 0)
  private timer: ReturnType<typeof setInterval> | undefined
  private refreshing = false
  private runtimeRefreshing = false

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
          this.weather = cache<WeatherPayload>(null, 'open-meteo-unavailable', 60_000, 0)
        }
      }
    } finally {
      this.refreshing = false
    }
  }

  async refreshRuntimeServices(ctx: Context): Promise<void> {
    if (this.runtimeRefreshing || Date.now() <= this.runtimeServices.expiresAt) return
    this.runtimeRefreshing = true
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
    } finally {
      this.runtimeRefreshing = false
    }
  }

  snapshot(ctx: Context, now = new Date()): RealitySnapshot {
    void this.refreshRuntimeServices(ctx)
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
    const runtimeServices = signal(this.runtimeServices, epoch)
    const runtimeValue = runtimeServices.value

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
        activeModel: runtimeValue?.ai.activeModel ?? null,
        registeredProviders: runtimeValue?.ai.registeredProviders ?? [],
        configurableProviders: runtimeValue?.ai.configurableProviders ?? [],
        contextWindowTokens: runtimeValue?.ai.contextWindowTokens ?? null,
        remainingContextTokens: runtimeValue?.ai.remainingContextTokens ?? null,
        accumulatedCost: runtimeValue?.ai.accumulatedCost ?? null,
        accountLimits: runtimeValue?.ai.accountLimits ?? [],
        tokenMeterAvailable: serviceCapabilities(ctx).includes('tokenMeter'),
        observedAt: runtimeServices.observedAt,
        expiresAt: runtimeServices.expiresAt,
        stale: runtimeServices.stale,
        rule: 'registered provider is not the same as healthy provider. Remaining context requires the active session token meter; accumulated cost remains unknown unless a provider exposes it.',
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
