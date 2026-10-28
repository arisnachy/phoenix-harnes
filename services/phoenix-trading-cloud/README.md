# PHOENIX Trading Cloud — PAPER research runner

English | [中文](README.zh.md)

Standalone, no LLM and no local Windows dependency. **PAPER ONLY**: never submits a real Binance order, and never accesses private account balances. The project is intentionally outside the pnpm monorepo workspace so it cannot accidentally become a production broker on build.

## Current scope
- Discover up to 300 liquid **active Spot USDT markets** from Binance public market-data endpoints.
- Rank with liquidity filter (>=5m USDT 24h quote volume), exclude leveraged tokens, and scan 4 markets per minute in round-robin batches (300 -> approx. 75 minutes for a full pass).
- Four deterministic strategy hypotheses: Donchian breakout, EMA trend pullback, Bollinger-style statistical mean reversion with RSI, and volume-confirmed momentum.
- PAPER fill accounting with fee and simulated adverse slippage, 5% per-position cap, 20% gross exposure, maximum 2 open positions.
- ATR-based stop, partial TP1, final TP2; periodic mark-to-market, cumulative circuit breaker, immutable journal IDs, and database optimistic-lock protection.
- Durable cursor-paginated D1 event log, with a PHOENIX Host bridge that replays unseen cloud alerts to Kira after reconnect. Events are NOT a remotely running Kira: desktop cannot wake when powered off.
- Next-bar conservative backtesting and train/holdout experiments are available in src/research.mjs (not executed in 10ms free-tier Cron and not used to assert profitability).
- No profitable returns promised. No evidence of sustained historical alpha or live exchange executions.

## Preconditions / authorization
Requires a Cloudflare account already authorized to administer Workers/D1, deployment permissions and an owner-set 32+ character ADMIN_TOKEN stored through Cloudflare secrets. Phoenix's managed catalog includes a Cloudflare MCP endpoint, but mere presence in the catalog does not mean the user granted OAuth or the provider can create resources.

**Do not publish default worker with trading enabled.** The default D1 state starts disabled and can only be started via an authenticated control call. No unattended REAL account orders are supported.

## Provisioning guide (after explicit infrastructure authorization)
1. Create a D1 database named phoenix-trading-paper using an authenticated Cloudflare workflow.
2. Replace the placeholder D1 ID in wrangler.toml with the verified provider resource ID.
3. Apply migrations using Wrangler: npx wrangler d1 migrations apply phoenix-trading-paper --remote.
4. Configure the admin secret via Cloudflare's secrets management, **not** repository commits: npx wrangler secret put ADMIN_TOKEN.
5. Deploy the Worker with npx wrangler deploy. Verify /health then fetch /snapshot with the token (never log the bearer token).
6. Perform at least one test Cron run and verify that the revision changes and /snapshot displays a recent successful scan.
7. Configure PHOENIX_TRADING_CLOUD_URL on the PHOENIX Host and its PHOENIX_TRADING_CLOUD_ADMIN_TOKEN in the Host credential vault. Never place either secret in the Git repository or a prompt. The URL must use the dedicated .workers.dev HTTPS hostname.
8. Kira can use binance_cloud_status and binance_cloud_control after the Host is configured and the service is verified. Host event polling forwards queued cloud PAPER events into the existing wake rules without LLM calls each minute.
9. Start PAPER with POST /admin/control and body {"action":"start"} using a valid Bearer token, then confirm persisted state. The Cloud service remains a separate virtual portfolio from local PAPER. Stopping is action=stop.

Do not automatically buy paid resources or enter payments; absent permissions, return a concrete setup-required result instead. Cloudflare Workers Free currently imposes strict per-trigger CPU and subrequest limits. This job intentionally batches only four analyses per minute and may require further reductions or migration to a VM; measure actual CPU usage before 24/7 reliance.

## Endpoints
- GET /health — public minimal readiness, not proof of a running bot
- GET /snapshot — private authenticated PAPER ledger and status
- GET /events?after=SEQ — private authenticated append-only D1 event log in pages of 100 with nextCursor
- POST /admin/control — private authenticated start/stop only

The bearer token is an administrator secret: rotate it if exposed; never put it in chat, URLs or source.

## Boundaries and next steps
This is **not** live-funded autonomous trading. Before that capability could exist, require a compatible provider-approved unattended execution interface, verified order scopes, exchange filters/precision, order idempotency/reconciliation, risk tests, infrastructure failover, user opt-in, and order receipts. The official Binance Agentic MCP may require interactive confirmation per order and must not be bypassed.

For Kira to reason while Windows is powered off, deploy a separately authenticated cloud agent runtime or independent notifications provider. The Host bridge alone does not supply remote Kira execution. Prevent separate local PAPER and cloud PAPER ledgers both being presented as one portfolio until explicit migration/reconciliation exists.

Run deterministic tests locally with node --test services/phoenix-trading-cloud/test/*.test.mjs.
