# PHOENIX Universal Web Access：免费且身份可验证

[English](phoenix-free-web-identity.md) | 中文

PHOENIX 默认使用免费网页搜索。这条检索路径不需要付费提供商。
其公开代理身份可通过密码学签名验证，但这并不代表网站必须放行，
也不能保证所有网站都不会出现 CAPTCHA。

## 已集成的行为

- 基础配置优先使用 `free-html`，不再将付费 OpenRouter 搜索设为首选。
- Bing 和 DuckDuckGo 提供不需要 API 密钥的 HTML 检索，但可能限制自动化。
- 西班牙语维基百科的官方 MediaWiki API 提供第三种免费检索路线。
- HTTP 请求使用 `PHOENIX-ResearchBot/1.0` 身份，并提供项目 GitHub 链接；
  不伪装成人类浏览器。
- 访问公共网页前，限制大小的 `robots.txt` 检查会应用代理规则、
  Allow/Disallow 和 Crawl-delay。
- 按来源域名限速，并在 HTTP 403/429/503 后暂缓请求，避免反复触发封锁。
  CAPTCHA 和挑战页面不会作为研究证据。
- 保留原有的内网访问保护、DNS 重绑定防护、重定向、大小和取消机制。
- 相同的成功免费搜索会在内存中短暂缓存，以减少重复请求。

## 可选的 Ed25519 Web Bot Auth（无需订阅）

使用 OpenSSL 在本地生成独立的 Ed25519 私钥：

```sh
openssl genpkey -algorithm ed25519 -out phoenix-bot-private.pem
openssl pkey -in phoenix-bot-private.pem -pubout -out phoenix-bot-public.pem
```

**绝不可将私钥提交到仓库。** 请存放在受限制的私有目录。

验证方需要通过 HTTPS 访问准确路径
`/.well-known/http-message-signatures-directory`，并取得已签名的 JWK
公钥目录。仅提供静态 JSON 不够，因为目录的 HTTP 响应也必须签名。
`deploy/phoenix-bot-auth` 中提供了 Cloudflare Workers 免费方案示例，
可以使用免费的 `workers.dev` 域名。

```sh
cd deploy/phoenix-bot-auth
npx wrangler login
npx wrangler secret put PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM
npx wrangler deploy
```

向 Worker Secret 输入**同一把** PEM 私钥，不要写入公共日志或消息。
在本地 PHOENIX 主机设置以下变量并重启：

```text
PHOENIX_WEB_BOT_AUTH_AGENT_URL=https://your-worker.workers.dev
PHOENIX_WEB_BOT_AUTH_PRIVATE_KEY_FILE=C:/private/phoenix-bot-private.pem
```

代理 URL 必须是准确的 HTTPS **源站地址**，不能包含路径。
PHOENIX 将为每个 HTTPS 请求生成新的 RFC 9421 签名标头。
如果两个配置都不存在，则继续使用明示身份的普通未签名请求。
配置不完整时会拒绝启动该签名设置，不会谎称已经签名。

部署后，需要把公钥目录提交至 Cloudflare 机器人验证计划，并单独
检查审核结果。审核并非自动通过，验证成功也不能凌驾于网站权限之上。

## 故障处理与验证

- `WEB_ROBOTS_DISALLOWED`：该路径不允许访问，改用授权来源。
- `WEB_ROBOTS_UNAVAILABLE`：无法可靠确定网站的爬取规则。
- `WEB_PROVIDER_RATE_LIMIT`：遵守 Crawl-delay 或网站临时限流。
- 签名标头不能消除 CAPTCHA；应使用公开 API、授权替代来源或人工验证。

运行目标测试：

```sh
pnpm exec vitest run packages/web/web-fetch-http/tests/phoenix-bot-identity.spec.ts packages/web/web-fetch-http/tests/fetch-http.spec.ts packages/web/web-search-free/tests/free-search.spec.ts
```

参考资料：
https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
https://developers.cloudflare.com/bots/concepts/bot/verified-bots/
https://developers.cloudflare.com/workers/platform/limits/
