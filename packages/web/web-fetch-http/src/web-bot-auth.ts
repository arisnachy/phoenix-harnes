/**
 * Optional PHOENIX Web Bot Auth (RFC 9421 / Cloudflare Web Bot Auth draft).
 * Identity is never impersonated: a key is loaded from a private local file,
 * not checked into the repository, and requests are signed only over HTTPS.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** The three signed headers required by Web Bot Auth. */
export interface WebBotAuthHeaders {
  readonly 'signature-agent': string
  readonly 'signature-input': string
  readonly signature: string
}

/** Ed25519 request signer for PHOENIX's own explicitly registered public identity. */
export class PhoenixWebBotSigner {
  /** RFC 7638 thumbprint of the registered public JWK. */
  readonly keyId: string
  /** Public JWK permitted for disclosure in the signed directory. */
  readonly publicJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string }
  /** HTTPS origin serving the signed JWK directory. */
  readonly agentOrigin: string
  private readonly key: KeyObject

  constructor(agentUrl: string, privateKeyPem: string) {
    const url = new URL(agentUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('PHOENIX Web Bot Auth requires a public HTTPS agent origin without credentials or paths')
    }
    this.agentOrigin = url.origin
    this.key = createPrivateKey(privateKeyPem)
    if (this.key.asymmetricKeyType !== 'ed25519') throw new Error('PHOENIX Web Bot Auth requires an Ed25519 private key')
    const jwk = createPublicKey(this.key).export({ format: 'jwk' })
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
      throw new Error('PHOENIX Web Bot Auth public key must be Ed25519 JWK')
    }
    this.publicJwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x }
    // RFC 7638 canonical member order: crv, kty, x.
    this.keyId = createHash('sha256')
      .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: jwk.x }))
      .digest('base64url')
  }

  /**
   * Sign a fresh GET request. Headers must be regenerated for each request.
   * @param url - Target HTTPS URL, used to sign the destination authority.
   * @param now - Signature creation time as a Unix timestamp in seconds.
   * @returns Three headers containing the PHOENIX origin and request signature.
   */
  signRequest(url: URL, now = Math.floor(Date.now() / 1000)): WebBotAuthHeaders {
    if (url.protocol !== 'https:') throw new Error('Web Bot Auth signatures must be sent only over HTTPS')
    const agent = JSON.stringify(this.agentOrigin)
    const params = this.parameters('("@authority" "signature-agent")', 'web-bot-auth', now)
    const base = `"@authority": ${url.host}\n"signature-agent": ${agent}\n"@signature-params": ${params}`
    return {
      'signature-agent': agent,
      'signature-input': `sig1=${params}`,
      signature: `sig1=:${sign(null, Buffer.from(base), this.key).toString('base64')}:`,
    }
  }

  /**
   * Return the public key directory payload, never exposing private material.
   * @returns JSON Web Key Set payload for an HTTPS directory service.
   */
  publicKeyDirectory(): { keys: Array<{ kty: 'OKP'; crv: 'Ed25519'; x: string }> } {
    return { keys: [this.publicJwk] }
  }

  private parameters(components: string, tag: string, now: number): string {
    return `${components};created=${now};keyid="${this.keyId}";alg="ed25519";expires=${now + 60};nonce="${randomBytes(24).toString('base64')}";tag="${tag}"`
  }
}

/**
 * Load the opt-in key from a local file, never from Git source.
 * @param env - Process environment containing both key-file path and public agent origin.
 * @returns A signer when configured, or undefined if both settings are absent.
 */
export function signerFromEnvironment(env: NodeJS.ProcessEnv = process.env): PhoenixWebBotSigner | undefined {
  const agent = env.PHOENIX_WEB_BOT_AUTH_AGENT_URL
  const keyFile = env.PHOENIX_WEB_BOT_AUTH_PRIVATE_KEY_FILE
  if (!agent && !keyFile) return undefined
  if (!agent || !keyFile) throw new Error('set both PHOENIX_WEB_BOT_AUTH_AGENT_URL and PHOENIX_WEB_BOT_AUTH_PRIVATE_KEY_FILE')
  return new PhoenixWebBotSigner(agent, readFileSync(keyFile, 'utf8'))
}
