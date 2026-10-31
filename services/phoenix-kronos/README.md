# PHOENIX Quant: Kronos predictive sidecar (experimental, PAPER-only)

PHOENIX uses the official open-source Kronos candlestick model for entry
confirmation. It does not forecast guaranteed profits, calibrate probabilities,
or authorize real-money orders. The existing technical strategy works with
prediction turned off.

## Automatic installation

In the PAPER trading dashboard press **Instalar Kronos gratis**. The Host
starts an isolated local installer and exposes its actual state in the viewer;
"installed" is not "ready" until the weights have loaded and the predictor
has answered. Alternatively run:

    node scripts/phoenix-kronos-install.mjs

Prerequisites are Python 3.10–3.12, Git, disk space, and internet access for the
initial download. Installation uses a dedicated CPU-only Python environment in
the user's home directory (~/.phoenix/kronos). The official upstream source is
pinned to commit 67b630e67f6a18c9e9be918d9b4337c960db1e9a; PyTorch and
other dependencies are installed in the isolated environment, not system-wide.
Weight retrieval is deferred until the first prediction (a model-download step
can take time). No paid API key, Binance key, or model subscription is needed.

Kronos-mini (4.1M parameters) is the default. Set PHOENIX_KRONOS_MODEL=small
before starting the Host to use the 24.7M version instead. Small requires more
memory and CPU. Inference startup and timing are hardware/network dependent.

## Algorithm and safety

1. Binance Spot scans publicly available *closed* OHLCV bars.
2. Existing stops, profit targets, delist risk, and defensive exits run first.
3. Only a technically qualified entry candidate invokes Kronos when enabled.
4. The forecast must match the exact closed candle, symbol and interval. The
   entry is blocked if the expected gain does not exceed estimated 2-way fees,
   a 0.30% slippage allowance and 0.30% target edge, or if predicted downside
   exceeds 2.5%. These are experimental heuristics requiring calibration.
5. The existing virtual ledger records actual PAPER fills independently from
   candidate signals; one trade per cycle and portfolio limits remain intact.
6. Failures, timeouts, malformed responses and missing weights block
   prediction-gated entries, while the Host still services open position exits.

The worker runs in a separate process and never receives trading credentials,
order commands, cloud secrets or user-supplied network endpoints. The Host
scheduler must be running; this does not create a standalone cloud worker.
The predictive button is an explicit local user action, not a download on every
startup.

## Required evaluation before using real funds

Run a chronological walk-forward comparison against the unchanged technical
scanner across bullish, bearish and sideways markets. Include fees and actual
slippage, risk limits, exchange eligibility, non-survivorship-biased symbols,
benchmark returns and out-of-sample expectancy. Require stable positive net
results over a sufficiently long PAPER campaign before even considering
changes to Testnet or REAL. No profitability has been established by this PR.

Upstream: https://github.com/shiyu-coder/Kronos
Model: https://huggingface.co/NeoQuasar/Kronos-mini
Paper: https://arxiv.org/abs/2508.02739
