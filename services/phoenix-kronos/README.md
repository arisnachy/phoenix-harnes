# PHOENIX Quant: Kronos predictive sidecar (PAPER only)

English | [中文](README.zh.md)

The Kronos open-source candlestick model is optional decision support. A forecast
is not a calibrated probability, proven profitable strategy, or authority to
place REAL orders. The existing strategy works with prediction turned off.

## Automatic installation

In the PAPER trading dashboard select **Instalar Kronos gratis**, or run:

```sh
node scripts/phoenix-kronos-install.mjs
```

Python 3.10–3.12, Git, internet access, disk space and memory are required.
The installer creates an isolated CPU-only Python environment at
`~/.phoenix/kronos` and checks out the official upstream commit
`67b630e67f6a18c9e9be918d9b4337c960db1e9a`. Model weights download on
first use. Installation does not establish model readiness or any order fill.

## Models

- Kronos-mini: 4.1 million parameters; default for lighter CPU inference.
- Kronos-small: 24.7 million parameters; set `PHOENIX_KRONOS_MODEL=small` before
  starting the Host for a larger model.

Both weights and code are open source. There is no per-forecast API fee, but
hardware resources and download bandwidth are required.

## Algorithm and safety

1. Fetch public Binance Spot OHLCV and evaluate closed candles.
2. Process existing protective exits before any new predictive entry.
3. Invoke Kronos only for a technically qualified PAPER entry when enabled.
4. Check exact candle timestamp, symbol, interval, forecast validity and
   projected return after estimated two-way fees, slippage and safety margin.
5. Apply existing PAPER position and exposure limits; record only ledger fills.
6. Fail closed for missing, stale, malformed or timed-out model responses.

The isolated inference process receives no account credentials, API key,
production order command, or user-controlled endpoint. Local unattended
execution still requires the PHOENIX Host to remain running.

## Evaluation before any REAL trading

Validate chronological walk-forward results across market regimes, after fees,
slippage and exchange filters. Measure out-of-sample expectancy, drawdown,
trade fills, risk exposure and consistency over long PAPER campaigns. This
feature does not enable autonomous REAL Binance execution or promise profits.

## Sources

- [Upstream Kronos](https://github.com/shiyu-coder/Kronos)
- [Kronos-mini weights](https://huggingface.co/NeoQuasar/Kronos-mini)
- [Research paper](https://arxiv.org/abs/2508.02739)
