import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Call the governed HARDNESS mission endpoint through PHOENIX's official connection. */
export function callHardnessMission<T = unknown>(
  connection: Pick<{ readonly rpc: ClientConnectionRpc }, 'rpc'>,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<RpcResult<T>> {
  return connection.rpc.call('/hardness', 'mission/run', payload, signal) as Promise<RpcResult<T>>
}
