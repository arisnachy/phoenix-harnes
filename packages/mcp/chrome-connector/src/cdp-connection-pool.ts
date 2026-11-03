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
  disconnect: (reason: string) => void
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

  /**
   * Closes one tab transport and rejects every command still in flight.
   * @param url - WebSocket URL identifying the tab transport.
   * @param reason - Error text used to reject pending commands.
   */
  close(url: string, reason = 'Cierre solicitado de la conexión Chrome CDP'): void {
    const connection = this.connections.get(url)
    if (!connection) return
    connection.disconnect(reason)
    connection.socket.close()
  }

  /**
   * Closes all transports owned by this connector instance.
   * @param reason - Error text used to reject pending commands.
   */
  closeAll(reason = 'Cierre solicitado de las conexiones Chrome CDP'): void {
    for (const url of [...this.connections.keys()]) this.close(url, reason)
  }

  private get(url: string): Connection {
    const existing = this.connections.get(url)
    if (existing && existing.socket.readyState !== 2 && existing.socket.readyState !== 3) return existing
    if (existing) this.connections.delete(url)

    const socket = this.createSocket(url)
    let resolveReady!: () => void
    let rejectReady!: (reason: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const connection: Connection = {
      socket, ready, requests: new Map(), nextId: 0,
      disconnect: () => { /* assigned before any socket event can fire */ },
    }
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
    connection.disconnect = disconnect
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
    socket.addEventListener('message', (event) => {
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
      } else if (packet.result?.result !== undefined
        && Object.prototype.hasOwnProperty.call(packet.result.result, 'value')) {
        pending.resolve(packet.result.result.value)
      } else pending.resolve(packet.result)
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
        this.close(url, 'Conexión Chrome CDP inactiva')
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
        const error = new Error(`Tiempo agotado ejecutando ${method}`)
        reject(error)
        connection.disconnect(error.message)
        connection.socket.close()
      }, timeoutMs)
      connection.requests.set(id, {
        resolve: (value) => { resolve(value as T) },
        reject,
        timer,
      })
      try {
        connection.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        connection.requests.delete(id)
        const failure = error instanceof Error ? error : new Error(String(error))
        reject(failure)
        connection.disconnect(failure.message)
        connection.socket.close()
      }
    })
  }
}
