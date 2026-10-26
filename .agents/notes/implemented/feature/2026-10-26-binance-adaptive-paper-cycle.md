# Agent Note: Adaptive Binance paper strategy selection

Status: implemented

## Problem

The Binance integration exposes public candles, a virtual ledger, and approval-gated access to the official Agent OS connector. Choosing a strategy for multiple assets previously required a language-model decision on every run, without a bounded deterministic portfolio allocator.

## Decision

The HARDNESS Binance adapter provides `binance_adaptive_cycle` for up to five USDT Spot symbols in one request. Closed, ordered, timely candles select a ranked breakout, trend-pullback, mean-reversion, defensive-exit, or no-trade signal. In `scan` mode the tool only reports evaluations. In `paper-step` it can place exactly one virtual order, prioritizing defensive exits, limiting fresh allocations to 5% of virtual equity, 20% total exposure, two active positions, and refusing new entries after 5% peak drawdown. Paper fills retain strategy ids in the existing journal.

The strategy calculation runs in the Host without LLM tokens per candle, performs bounded public market requests, and returns summaries instead of raw OHLCV history. Each cycle is serialized per broker to avoid competing virtual allocations in the same runtime.

The Host worker performs only virtual transactions. The in-chat visor reads live PAPER ledger snapshots and executes explicit user-clicked start/stop/check controls through a same-origin, POST-only route, without any model call. The route rejects mismatched Origins, oversized or invalid JSON, and REAL parameters. The execution path never accesses the Binance Agent OS connector or authorizes real orders. Official real-account actions remain subject to the existing explicit user approval, OAuth scopes and Binance order confirmations.

## Alternatives considered

**LLM evaluation for each symbol and bar.** Rejected because it incurs recurring model tokens and produces non-reproducible decisions unsuitable for deterministic risk limits.

**Automatic real execution from the new strategy scanner.** Rejected because a virtual strategy score is not a verified production advantage and official Agent OS requires user confirmation for fund-changing operations.

**Keeping the LLM awake to poll.** Rejected because token use scales with polling. Instead a Host-owned PAPER worker persists explicit user enablement and polls independently, with a configurable period, error shutdown, and a read-only in-chat viewer.

## Official MCP and testing distinction

The official Binance Agentic MCP uses the pinned OAuth-enabled Streamable HTTP
endpoint https://agent.binance.com/mcp/agentic. Tool synchronization is verified
separately from installation. Connecting does not prove Trade scopes, account
eligibility, or funding; every real Agentic order requires user confirmation.
The user funds the isolated sub-account manually in Binance. Phoenix offers
explicit reconnect/repair while preserving host-owned authorization records.

Binance Spot Testnet is a different test-funds environment. It uses dedicated
host-only API keys and a fixed signed endpoint at https://testnet.binance.vision,
not the Agentic MCP. The test order tool requires the user's specific request,
one-shot Phoenix approval and strict order amount bounds. Kira asks Testing or
Real before activation and distinguishes PAPER from Spot Testnet.

## Consequences

Phoenix can evaluate a small watchlist and execute a reproducible virtual action with no per-bar model cost. The score is a heuristic ranking, not an estimated probability or an independently validated source of profit. The broker assumes Spot-like virtual fills and its existing fee model; slippage, exchange filters, exchange-rate constraints, portfolio correlations, comprehensive strategy learning, Settings controls, Testnet, and autonomous live execution remain separate work. Repeated PAPER cycles are driven by the Host worker after explicit activation; account-changing REAL actions remain outside this worker.
