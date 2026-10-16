/**
 * Reusable CDP transport for Chrome form actions and viewport previews.
 * An idle connection is closed; a lost socket rejects all in-flight calls.
 * @module phoenix-cdp-connection-pool
 */
interface CdpPacket {
  id?: number
  result?: { data?: string; result?: { value?: unknown }; exceptionDetails?: { text?: string } }
  error?: { message: string }
}
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
interface Connection {
  socket: WebSocket
  ready: Promise<void>
  requests: Map<number, Pending>
  nextId: number
  viewportReady?: Promise<void>
  idleTimer?: ReturnType<typeof setTimeout>
}

/** Keeps one live DevTools socket per tab instead of reconnecting for every field. */
export class CdpConnectionPool {
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly createSocket: (url: string) => WebSocket = url => new globalThis.WebSocket(url),
    private readonly idleMs = 60_000,
  ) {}

  /**
   * Executes one typed CDP command, sharing a tab socket and viewport setup.
   * @param url - Chrome's loopback DevTools WebSocket URL for one page.
   * @param method - CDP command name.
   * @param params - Command parameters.
   * @param timeoutMs - Bounded command deadline after connection.
   * @returns The response value or the native CDP result.
   */
  async request<T = unknown>(
    url: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000,
  ): Promise<T> {
    const connection = this.get(url)
    this.touch(url, connection)
    await connection.ready
    if (method === 'Page.captureScreenshot' || method === 'Input.dispatchMouseEvent') {
      connection.viewportReady ??= this.exchange(
        connection, 'Emulation.setDeviceMetricsOverride',
        { width: 1280, height: 720, screenWidth: 1280, screenHeight: 720,
          deviceScaleFactor: 1, mobile: false }, timeoutMs,
      ).then(() => undefined).catch((error: unknown) => {
        delete connection.viewportReady
        throw error
      })
      await connection.viewportReady
    }
    return await this.exchange<T>(connection, method, params, timeoutMs)
  }

  private get(url: string): Connection {
    const existing = this.connections.get(url)
    if (existing && existing.socket.readyState <= 1) return existing
    if (existing) this.connections.delete(url)

    const socket = this.createSocket(url)
    let resolveReady!: () => void
    let rejectReady!: (reason: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const connection: Connection = { socket, ready, requests: new Map(), nextId: 0 }
    this.connections.set(url, connection)
    let closed = false
    const disconnect = (reason: string) => {
      if (closed) return
      closed = true
      if (this.connections.get(url) === connection) this.connections.delete(url)
      if (connection.idleTimer) clearTimeout(connection.idleTimer)
      const error = new Error(reason)
      rejectReady(error)
      for (const pending of connection.requests.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      connection.requests.clear()
    }
    const opening = setTimeout(() => {
      if (socket.readyState !== 1) {
        disconnect('Tiempo agotado conectando con Chrome CDP')
        socket.close()
      }
    }, 6_000)
    socket.addEventListener('open', () => {
      clearTimeout(opening)
      resolveReady()
    })
    socket.addEventListener('message', event => {
      let packet: CdpPacket
      try { packet = JSON.parse(String(event.data)) as CdpPacket } catch { return }
      if (packet.id === undefined) return
      const pending = connection.requests.get(packet.id)
      if (!pending) return
      connection.requests.delete(packet.id)
      clearTimeout(pending.timer)
      if (packet.error) pending.reject(new Error(packet.error.message))
      else if (packet.result?.exceptionDetails) {
        pending.reject(new Error(packet.result.exceptionDetails.text || 'Error de ejecución del DOM'))
      } else pending.resolve(packet.result?.result?.value ?? packet.result)
    })
    socket.addEventListener('error', () => {
      clearTimeout(opening)
      disconnect('Se perdió la conexión con Chrome CDP')
      socket.close()
    })
    socket.addEventListener('close', () => {
      clearTimeout(opening)
      disconnect('Chrome cerró la conexión CDP')
    })
    return connection
  }

  private touch(url: string, connection: Connection): void {
    if (connection.idleTimer) clearTimeout(connection.idleTimer)
    connection.idleTimer = setTimeout(() => {
      if (connection.requests.size > 0) {
        this.touch(url, connection)
      } else if (this.connections.get(url) === connection) {
        this.connections.delete(url)
        connection.socket.close()
      }
    }, this.idleMs)
  }

  private exchange<T>(
    connection: Connection, method: string, params: Record<string, unknown>, timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++connection.nextId
      const timer = setTimeout(() => {
        connection.requests.delete(id)
        reject(new Error(`Tiempo agotado ejecutando ${method}`))
      }, timeoutMs)
      connection.requests.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      })
      try {
        connection.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        connection.requests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
