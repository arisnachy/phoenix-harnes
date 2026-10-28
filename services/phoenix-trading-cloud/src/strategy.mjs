/**
 * PHOENIX cloud trading research core. Pure, deterministic, no secrets, no LLM.
 * Deliberately PAPER-only. These heuristics are candidates, not proven alpha.
 */
export const MAX_UNIVERSE = 300;
export const MAX_PER_TICK = 4;
export const MAX_POSITIONS = 2;
export const FEE_RATE = 0.001;
export const SIMULATED_SLIPPAGE = 0.001;
export const MAX_POSITION_FRACTION = 0.05;
export const MAX_EXPOSURE_FRACTION = 0.20;
export const MAX_DAILY_LOSS_FRACTION = 0.03;
export const MAX_DRAWDOWN_FRACTION = 0.05;

const safe = n => typeof n === 'number' && Number.isFinite(n);
const mean = a => a.reduce((s, n) => s + n, 0) / a.length;
const stdev = a => Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2)));
const avg = (a, n) => mean(a.slice(-n));

export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period || values.some(v => !safe(v))) return NaN;
  let x = mean(values.slice(0, period));
  const weight = 2 / (period + 1);
  for (const v of values.slice(period)) x += (v - x) * weight;
  return x;
}

export function rsi(values, period = 14) {
  if (values.length < period + 2) return NaN;
  let up = 0, down = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    up += Math.max(delta, 0);
    down += Math.max(-delta, 0);
  }
  if (down === 0) return 100;
  return 100 - 100 / (1 + up / down);
}
export function atr(bars, period = 14) {
  if (bars.length < period + 1) return NaN;
  const ranges = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    ranges.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  return mean(ranges);
}
export function parseKlines(raw, now = Date.now(), intervalMs = 15 * 60_000) {
  if (!Array.isArray(raw) || raw.length < 60 || raw.length > 300) throw new Error('insufficient-bars');
  let lastStart = -1;
  const bars = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 7) throw new Error('malformed-bars');
    const [time, o, h, l, c, v, end] = row;
    const b = { time: Number(time), open: Number(o), high: Number(h), low: Number(l),
      close: Number(c), volume: Number(v), closeTime: Number(end) };
    if (!Object.values(b).every(safe) || b.open <= 0 || b.close <= 0 || b.low <= 0
        || b.high < Math.max(b.open, b.close) || b.low > Math.min(b.open, b.close)
        || b.volume < 0 || b.time <= lastStart || b.closeTime < b.time) throw new Error('invalid-bars');
    lastStart = b.time;
    if (b.closeTime <= now) bars.push(b);
  }
  if (bars.length < 60) throw new Error('no-confirmed-candles');
  if (now - bars.at(-1).closeTime > intervalMs * 2) throw new Error('stale-bars');
  return bars;
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const result = (symbol, regime, strategy, action, score, reason, extra = {}) =>
  ({ symbol, regime, strategy, action, score, reason, ...extra });

export function analyze(symbol, bars) {
  if (!/^[A-Z0-9]{3,16}USDT$/.test(symbol) || bars.length < 60) throw new Error('bad-analysis-input');
  const closes = bars.map(b => b.close), latest = closes.at(-1);
  const fast = ema(closes, 9), slow = ema(closes, 21), long = ema(closes, 50);
  const vol = atr(bars), volatility = vol / latest;
  const strength = rsi(closes);
  const vRatio = bars.at(-1).volume / Math.max(1e-9, avg(bars.slice(-21,-1).map(b => b.volume),20));
  const rangeHigh = Math.max(...bars.slice(-21, -1).map(b => b.high));
  const rangeLow = Math.min(...bars.slice(-21, -1).map(b => b.low));
  const baseline = avg(closes, 20);
  const z = (latest - baseline) / Math.max(stdev(closes.slice(-20)), latest * 1e-7);
  const trend = fast > slow * 1.004 && slow > long ? 'uptrend'
    : fast < slow * .996 && slow < long ? 'downtrend' : 'range';
  const base = { price: latest, atr: vol, rsi: strength, volatility, volumeRatio: vRatio };
  if (!safe(volatility) || volatility > .12 || volatility < .00001)
    return result(symbol, trend, 'volatility-filter', 'hold', 0, 'Unacceptable market volatility', base);
  const candidates = [];
  // Strategy competition: evidence-gated candidate generation, NOT a guaranteed winner.
  if (trend === 'uptrend' && latest > rangeHigh * 1.0005 && vRatio >= 1.2 && strength < 82)
    candidates.push({ strategy: 'donchian-breakout', score: 72 + Math.min(14, (vRatio - 1.2) * 12),
      reason: 'Confirmed range breakout with relative volume' });
  if (trend === 'uptrend' && latest > fast && latest < fast * 1.012 && strength > 45 && strength < 70
      && latest > closes.at(-2))
    candidates.push({ strategy: 'ema-pullback', score: 67 + Math.min(13, (strength - 45) / 2),
      reason: 'Trend pullback recovery above EMA9' });
  if (trend === 'range' && z < -1.4 && strength < 38 && latest > rangeLow * 0.99)
    candidates.push({ strategy: 'bollinger-mean-reversion', score: clamp(65 + (-z - 1.4) * 12, 65, 85),
      reason: 'Statistical oversold range with RSI confirmation' });
  if (trend === 'uptrend' && strength >= 55 && strength <= 75 && latest > closes.at(-5) * 1.01
      && vRatio >= 1.05)
    candidates.push({ strategy: 'momentum-continuation', score: 68 + Math.min(10, (strength - 55) / 2),
      reason: 'Multi-candle positive momentum and volume support' });
  candidates.sort((a,b)=>b.score-a.score || a.strategy.localeCompare(b.strategy));
  if (trend === 'downtrend')
    return result(symbol, trend, 'defensive-regime', 'hold', 0, 'Downtrend: no new long exposure', base);
  const chosen=candidates[0];
  if (!chosen || chosen.score < 70)
    return result(symbol, trend, 'none', 'hold', 0, 'No qualified strategy', base);
  return result(symbol, trend, chosen.strategy, 'buy', Math.round(chosen.score),
    chosen.reason, { ...base, candidateCount:candidates.length });
}

export function pickUniverse(exchangeInfo, tickers, cap = MAX_UNIVERSE) {
  if (!Array.isArray(exchangeInfo?.symbols) || !Array.isArray(tickers)) throw new Error('bad-market-universe');
  const available = new Set(exchangeInfo.symbols
    .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed !== false)
    .map(s => s.symbol)
    .filter(s => /^[A-Z0-9]{3,16}USDT$/.test(s) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s)));
  return tickers.filter(t => available.has(t.symbol) && Number(t.quoteVolume) >= 5_000_000
      && Number(t.lastPrice) > 0 && Number.isFinite(Number(t.quoteVolume)))
    .sort((a,b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, cap).map(x => x.symbol);
}
export function exitPlan(price, a, strategy) {
  if (!(price > 0) || !(a > 0)) throw new Error('invalid-entry');
  const risk = clamp(1.5 * a, price * .012, price * .035);
  // R-multiples are hypotheses to test; all exits are virtual until provider confirms a real order.
  return { strategy, entry: price, stop: price-risk, tp1: price + risk*1.5,
    tp2: price + risk*3, tp1Done: false, takeFraction: .5 };
}
export function exposure(state, prices) {
  return Object.values(state.positions).reduce((sum, p) => sum + p.quantity * (prices[p.symbol] ?? p.mark), 0);
}
export function riskBudget(state, signal, prices) {
  const positions=Object.values(state.positions);
  if (state.halted || signal.action !== 'buy' || signal.score < 70
      || positions.length >= MAX_POSITIONS || state.positions[signal.symbol]) return 0;
  if (state.maxEquity > 0 && state.equity <= state.maxEquity * (1 - MAX_DRAWDOWN_FRACTION)) return 0;
  if (state.dayLoss >= state.dayStartEquity * MAX_DAILY_LOSS_FRACTION) return 0;
  const existing = exposure(state,prices);
  const cap=Math.min(state.equity * MAX_POSITION_FRACTION,
    state.equity * MAX_EXPOSURE_FRACTION-existing, state.cash / (1+FEE_RATE));
  return Number.isFinite(cap) && cap >= 10 ? Math.floor(cap*100)/100 : 0;
}

/**
 * Pure virtual fill transition. Never connects to Binance private endpoints.
 * Idempotent when the same deterministic fill ID was previously committed.
 */
export function paperFill(state, fill) {
  if (state.journal.some(row => row.id === fill.id)) return state;
  if (!/^[A-Z0-9]{3,16}USDT$/.test(fill.symbol) || !safe(fill.price) || fill.price <= 0
      || !safe(fill.quantity) || fill.quantity <= 0 || !['buy','sell'].includes(fill.side))
    throw new Error('invalid-virtual-fill');
  const next = structuredClone(state);
  const p=next.positions[fill.symbol];
  const fee=fill.price*fill.quantity*FEE_RATE;
  if (fill.side === 'buy') {
    if (p || next.halted) throw new Error('duplicate-or-halted-buy');
    const debit=fill.price*fill.quantity+fee;
    if (debit > next.cash) throw new Error('insufficient-virtual-cash');
    next.cash -= debit;
    next.positions[fill.symbol]={ symbol:fill.symbol, quantity:fill.quantity, cost:debit,
      strategy:fill.strategy, plan:fill.plan, mark:fill.price };
  } else {
    if (!p || fill.quantity > p.quantity + 1e-10) throw new Error('virtual-oversell');
    const fraction=fill.quantity/p.quantity;
    const basis=p.cost*fraction;
    const realized=fill.price*fill.quantity-fee-basis;
    next.realized += realized;
    next.dayLoss += Math.max(0,-realized);
    next.cash += fill.price*fill.quantity-fee;
    const remaining=p.quantity-fill.quantity;
    if (remaining <= 1e-10) delete next.positions[fill.symbol];
    else {p.quantity=remaining;p.cost-=basis;p.plan.tp1Done ||= fill.reason === 'tp1';}
  }
  next.journal.push({ id:fill.id, at:new Date(fill.at).toISOString(), symbol:fill.symbol,
    side:fill.side, quantity:fill.quantity, price:fill.price, fee,
    strategy:fill.strategy, reason:fill.reason });
  next.journal=next.journal.slice(-500);
  return next;
}
export function freshState() {
  return { schema:1, enabled:false, halted:false, cash:10_000, equity:10_000,
    realized:0, dayLoss:0, dayStartEquity:10_000, day:'', maxEquity:10_000,
    positions:{}, journal:[], signals:[], events:[], universe:[], cursor:0,
    universeUpdated:0, lastScan:0, lastError:null, failureCount:0, revision:0 };
}
export function marketValue(state, marks) {
  let total=state.cash;
  for (const p of Object.values(state.positions)) {
    const mark=marks[p.symbol];
    if (!safe(mark) || mark<=0) throw new Error('missing-verified-position-mark:'+p.symbol);
    total+=p.quantity*mark;p.mark=mark;
  }
  state.equity=total;
  state.maxEquity=Math.max(state.maxEquity,total);
  return total;
}
