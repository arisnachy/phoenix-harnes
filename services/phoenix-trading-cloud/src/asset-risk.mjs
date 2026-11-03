/** Binance Spot asset risk gate for the Cloud PAPER runner.
 * Supported exchangeInfo has trading status but NO complete future delisting
 * or Monitoring Tag feed. Conservative, dated snapshot; never claim full coverage.
 * Official notices: https://www.binance.com/fr-AF/support/announcement/detail/0dfee98051814fccb9f18ce49b8425bb
 * https://www.binance.com/en/support/announcement/detail/f2286b6232434b31927ccd3e7187afd3
 * https://www.binance.com/en/support/announcement/list/000000000000000000000000000000161
 */
export const RISK_SNAPSHOT_DATE='2026-10-29';
export const RISK_COVERAGE='partial-announcement-snapshot';
const monitoring=new Set(['BICO','CVC','FARM','HIGH','MLN','RESOLV','SYS','TRU','VELODROME']);
const delisted=new Set(['EPIC','QUICK']);
const excludedTags=new Set(['MONITORING','MONITORING_TAG','SEED','SEED_TAG']);
export function knownAssetRisk(symbol){
  if(typeof symbol!=='string'||!/^[A-Z0-9]{3,16}USDT$/.test(symbol))return 'invalid-symbol';
  const base=symbol.slice(0,-4);
  if(delisted.has(base))return 'announced-delisting';
  if(monitoring.has(base))return 'monitoring-tag';
  if(/(?:UP|DOWN|BULL|BEAR)$/.test(base))return 'leveraged-token';
  return null;
}
export function spotAssetRisk(symbol){
  if(!symbol||typeof symbol!=='object')return 'invalid-symbol';
  const known=knownAssetRisk(symbol.symbol);
  if(known)return known;
  if(symbol.status!=='TRADING')return 'not-trading';
  if(symbol.quoteAsset!=='USDT'||symbol.isSpotTradingAllowed===false)return 'not-spot-usdt';
  if(Array.isArray(symbol.permissionSets)&&symbol.permissionSets.length&&
    !symbol.permissionSets.some(set=>Array.isArray(set)&&set.includes('SPOT')))return 'no-spot-permission';
  if(Array.isArray(symbol.permissions)&&symbol.permissions.length&&
    !symbol.permissions.includes('SPOT'))return 'no-spot-permission';
  const tags=[...(Array.isArray(symbol.tags)?symbol.tags:[]),symbol.tag,symbol.riskTag];
  if(tags.some(t=>typeof t==='string'&&excludedTags.has(t.toUpperCase().replaceAll(' ','_'))))
    return 'risk-tag';
  return null;
}
