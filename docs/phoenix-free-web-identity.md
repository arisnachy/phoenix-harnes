# PHOENIX Universal Web Access: free and verifiable

English | [中文](phoenix-free-web-identity.zh.md)

PHOENIX now uses free web search by default. No paid provider is needed for this route.
A public agent identity can be cryptographically verified, but it does **not**
override websites' access rules or guarantee CAPTCHA-free browsing.

## Integrated behavior

- The base profile uses `free-html` first instead of a paid OpenRouter search.
- Bing and DuckDuckGo are keyless HTML options; both can restrict automation.
- Wikipedia's official Spanish MediaWiki API is a third free discovery option.
- HTTP fetching identifies itself as `PHOENIX-ResearchBot/1.0`, with a source
  link to the PHOENIX GitHub repository. It never impersonates a human browser.
- Before public fetches, a bounded `robots.txt` preflight applies user-agent,
  Allow/Disallow, and Crawl-delay directives.
- Per-origin throttling and cooldowns prevent loops after HTTP 403/429/503.
  CAPTCHA and challenge HTML are not treated as research evidence.
- PHOENIX retains the existing network, DNS-rebinding, redirect, size, and
  cancellation safeguards.
- Successful identical free-search requests are cached briefly in memory to
  limit repeated automated queries.

## Optional Ed25519 Web Bot Auth, without subscription

Create a dedicated Ed25519 private key locally with OpenSSL:

```sh
openssl genpkey -algorithm ed25519 -out phoenix-bot-private.pem
openssl pkey -in phoenix-bot-private.pem -pubout -out phoenix-bot-public.pem
```

**Never commit the private key.** Store it in a restricted private directory.

A verifier must retrieve a signed HTTPS JSON Web Key directory at the exact
path `/.well-known/http-message-signatures-directory`.
A static JSON file is insufficient because the directory response must also
be signed. The example at `deploy/phoenix-bot-auth` can run on the free
Cloudflare Workers plan, with a free `workers.dev` hostname.

```sh
cd deploy/phoenix-bot-auth
npx wrangler login
npx wrangler secret put PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM
npx wrangler deploy
```

Paste the **same** PEM key content into the Worker secret. Do not expose
it to logs or public text. Set these two environment variables on the local
PHOENIX host and restart its process:

```text
PHOENIX_WEB_BOT_AUTH_AGENT_URL=https://your-worker.workers.dev
PHOENIX_WEB_BOT_AUTH_PRIVATE_KEY_FILE=C:/private/phoenix-bot-private.pem
```

The agent URL must be the exact HTTPS **origin**, without a path.
PHOENIX will sign each HTTPS request with fresh RFC 9421 headers.
If both settings are absent, normal named HTTP access continues unsigned.
Incomplete configuration fails closed rather than silently pretending to sign.

After deployment, submit the public directory to Cloudflare's bot verification
program and verify the resulting status separately. Approval is not automatic.
An authenticated agent is still subject to every site's individual controls.

## Failures and validation

- `WEB_ROBOTS_DISALLOWED`: the target path is blocked; choose an authorized source.
- `WEB_ROBOTS_UNAVAILABLE`: the site's crawl policy cannot be confirmed.
- `WEB_PROVIDER_RATE_LIMIT`: honor Crawl-delay or a site's temporary pause.
- A challenge or CAPTCHA is not defeated by signature headers. Use public
  APIs, authorized alternative sources, or permitted human interaction.

Run the focused tests:

```sh
pnpm exec vitest run packages/web/web-fetch-http/tests/phoenix-bot-identity.spec.ts packages/web/web-fetch-http/tests/fetch-http.spec.ts packages/web/web-search-free/tests/free-search.spec.ts
```

References:
https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
https://developers.cloudflare.com/bots/concepts/bot/verified-bots/
https://developers.cloudflare.com/workers/platform/limits/
