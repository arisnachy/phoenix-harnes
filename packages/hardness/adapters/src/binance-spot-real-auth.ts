import { createHmac } from 'node:crypto'

const REAL_BASE = 'https://api.binance.com'
const TIMEOUT_MS = 10_000

/** Codes are safe to show in UI; provider response bodies and secrets never are. */
export type BinanceRealAuthIssue = 'invalid-key-format' | 'signature-rejected'
  | 'ip-or-permission' | 'access-restricted' | 'clock-skew' | 'rate-limited'
  | 'network-unavailable' | 'provider-unavailable' | 'invalid-response'

export interface BinanceRealReadOnlyCredentials {
  readonly apiKey: string
  readonly secret: string
}

export interface BinanceRealReadOnlyStatus {
  readonly mode: 'real-readonly'
  readonly configured: boolean
  readonly connected: boolean
  readonly canRead: boolean
  readonly tradingAuthorized: false
  readonly issue?: BinanceRealAuthIssue
  readonly nextAction: string
}

const MESSAGES: Record<BinanceRealAuthIssue,string> = {
  'invalid-key-format': 'Binance REAL no reconoce el formato de esta API Key HMAC. Confirma el tipo de clave y el entorno.',
  'signature-rejected': 'Binance REAL rechazó la firma HMAC. Comprueba que el secreto coincida con la API Key y que sea una clave HMAC, no RSA/Ed25519.',
  'ip-or-permission': 'Binance REAL rechazó el acceso por clave, IP permitida o permisos. Revisa la lista blanca de IP y que la clave permita leer la cuenta; esto NO prueba que la clave sea falsa.',
  'access-restricted': 'Binance REAL devolvió acceso restringido (HTTP 403). Verifica región, red, WAF y permisos de la API; no se puede concluir que la clave sea inválida.',
  'clock-skew': 'El reloj del Host está desincronizado con Binance REAL. Corrige la fecha y hora de Windows.',
  'rate-limited': 'Binance REAL limitó temporalmente las solicitudes; la clave permanece guardada.',
  'network-unavailable': 'No se pudo acceder al endpoint de Binance REAL; comprueba tu conexión y la disponibilidad del servicio.',
  'provider-unavailable': 'Binance REAL no pudo confirmar los permisos de lectura ahora.',
  'invalid-response': 'Binance REAL devolvió una respuesta inesperada y no se confirmó la autenticación.',
}

/** Only signed GET /api/v3/account on the REAL Spot endpoint; NO order methods. */
export class BinanceSpotRealReadOnly {
  constructor(
    private readonly credentials: () => BinanceRealReadOnlyCredentials | undefined
      | Promise<BinanceRealReadOnlyCredentials | undefined>,
    private readonly request: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Verify an already stored candidate entirely inside the Host, without exposing it in UI. */
  forCredentials(value: BinanceRealReadOnlyCredentials): BinanceSpotRealReadOnly {
    return new BinanceSpotRealReadOnly(() => value, this.request, this.clock)
  }

  private async account(apiKey: string, secret: string, offset = 0, retried = false): Promise<void> {
    const query = new URLSearchParams({
      recvWindow: '5000', timestamp: String(Math.round(this.clock() + offset)),
    }).toString()
    const signature = createHmac('sha256', secret).update(query).digest('hex')
    const response = await this.request(REAL_BASE + '/api/v3/account?' + query + '&signature=' + signature, {
      method: 'GET', headers: { 'X-MBX-APIKEY': apiKey },
      redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined)
      const code = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).code : undefined
      if (code === -1021 && !retried) {
        try {
          const clockResponse = await this.request(REAL_BASE + '/api/v3/time', {
            method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          if (!clockResponse.ok) throw new Error('clock')
          const timeValue: unknown = await clockResponse.json()
          if (!timeValue || typeof timeValue !== 'object' || Array.isArray(timeValue)) throw new Error('clock')
          const serverTime = (timeValue as Record<string, unknown>).serverTime
          if (!Number.isSafeInteger(serverTime)) throw new Error('clock')
          await this.account(apiKey, secret, (serverTime as number) - this.clock(), true)
          return
        } catch (error) {
          if (error instanceof BinanceRealAuthError) throw error
          throw new BinanceRealAuthError('clock-skew')
        }
      }
      if (code === -1021) throw new BinanceRealAuthError('clock-skew')
      if (code === -1022) throw new BinanceRealAuthError('signature-rejected')
      if (code === -2015) throw new BinanceRealAuthError('ip-or-permission')
      if (code === -2014) throw new BinanceRealAuthError('invalid-key-format')
      if (response.status === 403) throw new BinanceRealAuthError('access-restricted')
      if (response.status === 429 || code === -1003) throw new BinanceRealAuthError('rate-limited')
      throw new BinanceRealAuthError('provider-unavailable')
    }
    const responseBody: unknown = await response.json().catch(() => undefined)
    if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)
      || !Array.isArray((responseBody as Record<string, unknown>).balances)) {
      throw new BinanceRealAuthError('invalid-response')
    }
  }

  async status(): Promise<BinanceRealReadOnlyStatus> {
    const pair = await this.credentials()
    if (!pair?.apiKey || !pair.secret) {
      return { mode:'real-readonly', configured:false, connected:false, canRead:false,
        tradingAuthorized:false, nextAction:'Guarda una clave HMAC de Binance REAL (solo lectura) o utiliza el OAuth oficial Agentic.' }
    }
    try {
      await this.account(pair.apiKey,pair.secret)
      return { mode:'real-readonly', configured:true, connected:true, canRead:true,
        tradingAuthorized:false,
        nextAction:'Binance REAL autenticado en SOLO LECTURA. Las órdenes reales requieren el OAuth Agentic y aprobación independiente.' }
    } catch (error) {
      const issue: BinanceRealAuthIssue = error instanceof BinanceRealAuthError
        ? error.issue : 'network-unavailable'
      return { mode:'real-readonly', configured:true, connected:false, canRead:false,
        tradingAuthorized:false, issue, nextAction:MESSAGES[issue] }
    }
  }
}

class BinanceRealAuthError extends Error {
  constructor(readonly issue: BinanceRealAuthIssue) { super(issue);this.name='BinanceRealAuthError' }
}
