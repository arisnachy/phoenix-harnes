/**
 * Fail-closed on known Binance Spot delisting/monitoring risks.
 *
 * Binance's supported /api/v3/exchangeInfo does NOT publish a complete,
 * supported Monitoring/Seed Tag or future-delisting feed. This dated denylist
 * is deliberately conservative, NOT a claim to know every unsafe asset.
 * Operators must reconcile it against official Binance announcements.
 *
 * Evidence:
 * - 2026-10-09 Monitoring: https://www.binance.com/fr-AF/support/announcement/detail/0dfee98051814fccb9f18ce49b8425bb
 * - 2026-04-14 Monitoring: https://www.binance.com/en/support/announcement/detail/f2286b6232434b31927ccd3e7187afd3
 * - 2026-10-14 EPIC/QUICK delisting: https://www.binance.com/en/support/announcement/list/000000000000000000000000000000161
 * A pair-level delisting, e.g. AAVE/BTC, does NOT delist AAVE/USDT.
 */
export const BINANCE_RISK_SNAPSHOT_DATE = '2026-10-29'
export const BINANCE_RISK_FEED_COMPLETENESS = 'partial-announcement-snapshot' as const

const MONITORING_ASSETS = new Set([
  'BICO', 'CVC', 'FARM', 'HIGH', 'MLN', 'RESOLV', 'SYS', 'TRU', 'VELODROME',
])
const DELISTED_ASSETS = new Set(['EPIC', 'QUICK'])
const UNSUPPORTED_TAGS = new Set(['MONITORING', 'MONITORING_TAG', 'SEED', 'SEED_TAG'])
const LEVERAGED_ASSET = /(?:UP|DOWN|BULL|BEAR)$/u

export type BinanceAssetRiskReason =
  | 'symbol-invalid' | 'not-trading' | 'not-spot' | 'not-usdt'
  | 'untradeable-leveraged-token' | 'monitoring-tag' | 'delisted-asset'
  | 'risk-tag' | 'spot-permission-missing'

/** Block known risky bases even when a user pins them or the ticker is liquid. */
export function binanceKnownAssetRisk(symbol: string): BinanceAssetRiskReason | undefined {
  if (!/^[A-Z0-9]{3,16}USDT$/u.test(symbol)) return 'symbol-invalid'
  const base = symbol.slice(0, -4)
  if (DELISTED_ASSETS.has(base)) return 'delisted-asset'
  if (MONITORING_ASSETS.has(base)) return 'monitoring-tag'
  if (LEVERAGED_ASSET.test(base)) return 'untradeable-leveraged-token'
  return undefined
}

/** Dynamic exchange eligibility + known risk markers if the provider supplies them.
 * Nonstandard tag fields are defense in depth, never proof of a full tag feed.
 */
export function assessBinanceSpotSymbol(row: unknown): BinanceAssetRiskReason | undefined {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return 'symbol-invalid'
  const value = row as Record<string, unknown>
  if (typeof value.symbol !== 'string') return 'symbol-invalid'
  const known = binanceKnownAssetRisk(value.symbol)
  if (known !== undefined) return known
  if (value.status !== 'TRADING') return 'not-trading'
  if (value.quoteAsset !== 'USDT') return 'not-usdt'
  if (value.isSpotTradingAllowed === false) return 'not-spot'
  if (Array.isArray(value.permissions) && value.permissions.length > 0
    && !value.permissions.includes('SPOT')) return 'spot-permission-missing'
  if (Array.isArray(value.permissionSets) && value.permissionSets.length > 0
    && !value.permissionSets.some(item => Array.isArray(item) && item.includes('SPOT'))) {
    return 'spot-permission-missing'
  }
  const tags = [
    ...(Array.isArray(value.tags) ? value.tags : []),
    value.tag, value.riskTag,
  ]
  if (tags.some(tag => typeof tag === 'string'
    && UNSUPPORTED_TAGS.has(tag.toUpperCase().replaceAll(' ', '_')))) return 'risk-tag'
  return undefined
}
