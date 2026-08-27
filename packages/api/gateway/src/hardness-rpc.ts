import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

export type HardnessMissionRpcRunner = (payload: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<unknown>

function failure(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mount the loopback-only HARDNESS mission endpoint on the official RPC transport. */
export function installHardnessMissionRpc(connection: HostConnectionHandle, run: HardnessMissionRpcRunner): () => Promise<void> {
  const handler: ConnectionRpcHandler = async (endpoint, payload, signal): Promise<RpcResult<unknown>> => {
    if (endpoint !== 'mission/run') return failure(`unknown HARDNESS endpoint: ${endpoint}`)
    if (!isRecord(payload)) return failure('HARDNESS mission payload must be an object')
    try {
      return { ok: true, value: await run(payload, signal) }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  }
  return connection.rpc.handle('/hardness', handler, { authority: 'loopback' })
}
