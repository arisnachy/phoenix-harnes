# Agent Note: Adaptive Binance paper strategy selection

Status: implemented

## Problem

The Binance integration exposes public candles, a virtual ledger, and approval-gated access to the official Agent OS connector. Choosing a strategy for multiple assets previously required a language-model decision on every run, without a bounded deterministic portfolio allocator.

## Decision

The HARDNESS Binance adapter provides `binance_adaptive_cycle` for up to five USDT Spot symbols in one request. Closed, ordered, timely candles select a ranked breakout, trend-pullback, mean-reversion, defensive-exit, or no-trade signal. In `scan` mode the tool only reports evaluations. In `paper-step` it can place exactly one virtual order, prioritizing defensive exits, limiting fresh allocations to 5% of virtual equity, 20% total exposure, two active positions, and refusing new entries after 5% peak drawdown. Paper fills retain strategy ids in the existing journal.

The strategy calculation runs in the Host without LLM tokens per candle, performs bounded public market requests, and returns summaries instead of raw OHLCV history. Each cycle is serialized per broker to avoid competing virtual allocations in the same runtime.

The execution path never accesses the Binance Agent OS connector or authorizes real orders. Official real-account actions remain subject to the existing explicit user approval, OAuth scopes and Binance order confirmations.

## Alternatives considered

**LLM evaluation for each symbol and bar.** Rejected because it incurs recurring model tokens and produces non-reproducible decisions unsuitable for deterministic risk limits.

**Automatic real execution from the new strategy scanner.** Rejected because a virtual strategy score is not a verified production advantage and official Agent OS requires user confirmation for fund-changing operations.

**A perpetual polling task in the agent process.** Rejected because long-running monitoring needs its own lifecycle, failure recovery, and durable execution authorization; this change only owns one bounded cycle.

## Consequences

Phoenix can evaluate a small watchlist and execute a reproducible virtual action with no per-bar model cost. The score is a heuristic ranking, not an estimated probability or an independently validated source of profit. The broker assumes Spot-like virtual fills and its existing fee model; slippage, exchange filters, exchange-rate constraints, portfolio correlations, comprehensive strategy learning, Settings controls, Testnet, and autonomous live execution remain separate work. Repeated cycles require an existing scheduled-task invocation, not a background worker added by this feature.
