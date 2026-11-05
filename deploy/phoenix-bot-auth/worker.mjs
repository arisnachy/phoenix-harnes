/**
 * Free Cloudflare Worker: public, signed PHOENIX Web Bot Auth key directory.
 * Deploy this Worker separately; never commit the PEM private key.
 * Secret PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM must match the local PHOENIX key file.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const headers = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' }
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers })
    if (url.pathname === '/') return Response.json({
      name: 'PHOENIX Research Agent',
      user_agent: 'PHOENIX-ResearchBot/1.0',
      source: 'https://github.com/arisnachy/phoenix-harnes',
      purpose: 'User-directed, non-abusive, source-cited web research',
      access: 'Respects robots.txt, crawl-delay, 403/429 and site preferences',
    }, { headers })
    if (url.pathname !== '/.well-known/http-message-signatures-directory') {
      return new Response('Not Found', { status: 404, headers })
    }
    if (!env.PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM) return new Response('Identity not configured', { status: 503, headers })
    const privateKey = createPrivateKey(env.PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM)
    if (privateKey.asymmetricKeyType !== 'ed25519') return new Response('Invalid key algorithm', { status: 500, headers })
    const jwk = createPublicKey(privateKey).export({ format: 'jwk' })
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
      return new Response('Invalid public key', { status: 500, headers })
    }
    const keyid = createHash('sha256')
      .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: jwk.x }))
      .digest('base64url')
    const now = Math.floor(Date.now() / 1000)
    const params = `("@authority";req);alg="ed25519";keyid="${keyid}";nonce="${randomBytes(24).toString('base64')}";tag="http-message-signatures-directory";created=${now};expires=${now + 60}`
    const signatureBase = `"@authority";req: ${url.host}\n"@signature-params": ${params}`
    const signature = sign(null, Buffer.from(signatureBase), privateKey).toString('base64')
    return new Response(JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: jwk.x }] }), {
      headers: {
        ...headers,
        'content-type': 'application/http-message-signatures-directory+json',
        'cache-control': 'public, max-age=30',
        'signature-input': `sig1=${params}`,
        signature: `sig1=:${signature}:`,
      },
    })
  },
}
