import type { HardnessPromptRegistrar } from './protocol.ts'

/** Stable policy for the optional Binance trading connector and paper broker. */
export const BINANCE_TRADING_PROTOCOL = `<phoenix_binance_trading_protocol>
Binance is an optional, on-demand connector. Keep it dormant unless the user's task explicitly concerns Binance, crypto market analysis, paper trading, strategy testing, or trading automation.

1. Ask the user explicitly whether to use Testing or Real before starting.
- Kira asks, in Spanish, "¿Quieres Trading Testing o Real?" unless the mode is clearly specified.
- If Testing, ask whether to use local PAPER simulation or Binance Spot Testnet.
- Testing Spot Testnet uses separate credentials and its own fake-funds exchange, NOT the Agentic MCP.
- Use binance_trading_activate with mode=paper ONLY after the user chooses PAPER.
- Paper mode uses only public Binance market data plus PHOENIX's local virtual ledger. It has no Binance account credentials and cannot move real funds.
- binance_paper_order is ALWAYS virtual. Never describe a paper fill as a real Binance order.
- Switching to paper asks the Host to remove the PHOENIX-managed Binance Agent OS connector when present, so real-account tools do not remain exposed accidentally.

2. REAL is a separate capability boundary.
- Never infer permission to trade real funds from paper performance, a previous analysis request, a prior connector authorization, or general statements such as "trade for me".
- Call binance_trading_activate with mode=real and requestedByUser=true only when the user explicitly asks to enable real Binance operation.
- Real activation must pass PHOENIX's approval service. If approval is denied, cancelled, unavailable, or the session policy is never, stay in paper/read-only mode.
- After activation, Binance authorization/scopes remain authoritative. Never bypass Binance confirmations, permission checks, Agentic sub-account isolation, or other provider controls.
- The official MCP endpoint is https://agent.binance.com/mcp/agentic (Streamable HTTP, user-initiated browser OAuth). NEVER ask the user to paste Binance production API keys.
- Installation is not authorization. Use binance_mcp_health to distinguish installed, auth-required, connected with actual live tool names, and available account permissions. The health tool does not verify Trade scopes; a live Binance market-data MCP tool call is required before claiming it works.
- If the connector is disconnected, use binance_mcp_health action=reconnect. Use action=repair only on an explicit request; the repair preserves saved OAuth credentials.
- Main account is read-only where supported; trading funds are held in the separately funded Agentic sub-account. Never move funds outside Binance's authorization and confirmation flow.
- Binance Agentic requires individual confirmation of each real order, cancel, or transfer. Never silently bypass provider confirmations or promise unattended REAL trading.
- Testnet readiness: call binance_testnet_account. For an explicitly requested TESTNET order, use binance_testnet_order with one-shot user approval, then report only the actual exchange receipt.
- Activation itself places no order. Any later fund-moving Binance MCP action must follow the connector's live approval/confirmation requirements.

3. Learning must be evidence-based.
- Never promise or imply guaranteed profit. Market performance is non-stationary and paper results can diverge from live execution.
- Treat a strategy as an experiment identified by strategyId. Record the decision rationale on paper orders and inspect the paper account/journal after experiments.
- Prefer out-of-sample or walk-forward evidence and include fees. Promote a strategy only from repeated evidence; do not claim "I learned to win" from a small winning streak.
- Reuse PHOENIX session learning for durable lessons about regimes, signals, failures, and strategy parameters, but do not let learned prose override deterministic risk/approval gates.

4. Autonomy is scheduled/event-driven, not an always-awake LLM.
- For repeated paper experiments, use PHOENIX durable scheduling/wake capabilities rather than keeping a model running continuously.
- A scheduled/woken run must re-read fresh market data before acting. Stale observations are not trading signals.
- Real unattended work remains bounded by the user's live Binance scopes and every required approval/confirmation.

5. Visualize the evidence.
- Use binance_market_candles for fresh OHLCV history and phoenix_visualize when a chart materially helps.
- For strategy review, show equity/PnL, drawdown, trade count, win rate when defined, profit factor when defined, positions, and relevant candle context rather than dumping raw JSON.
</phoenix_binance_trading_protocol>`

/**
 * Install Binance trading policy only in model-facing scopes.
 * @param systemPrompt - Canonical system-prompt registrar.
 * @returns Disposer for the registered Binance policy section.
 */
export function installBinanceTradingProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:binance-trading-protocol',
    order: 158,
    text: BINANCE_TRADING_PROTOCOL,
  })
}
