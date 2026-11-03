/**
 * Optional, owner-enabled OpenClaw Gateway read-only bridge.
 * Registered in PHOENIX's existing ctx.tools registry, never a second agent.
 * The OpenClaw HTTP Gateway bearer is a full operator credential: never
 * accept arbitrary tool names, actions, URLs or model-supplied headers.
 */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'

export type OpenClawReadSource = 'memory' | 'web'

interface BridgeOptions {
  readonly token: string
  readonly port?: number
  readonly signal?: AbortSignal
  readonly fetcher?: typeof fetch
}

const TOOL_FOR_SOURCE: Record<OpenClawReadSource, string> = {
  memory: 'memory_search',
  web: 'web_search',
}

function validQuery(value: string): string {
  const clean = value.trim()
  if (clean.length === 0 || clean.length > 300 || /[\u0000-\u001f\u007f]/u.test(clean)) {
    throw new Error('OpenClaw lookup requires 1–300 printable query characters')
  }
  return clean
}

function validPort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('OpenClaw Gateway port must be between 1024 and 65535')
  }
  return value
}

/** Fixed tool and loopback address; caller cannot select another Gateway or tool. */
export async function invokeOpenClawRead(
  source: OpenClawReadSource,
  query: string,
  options: BridgeOptions,
): Promise<{ source: OpenClawReadSource; result_json: string }> {
  if (source !== 'memory' && source !== 'web') throw new Error('Unsupported OpenClaw read source')
  if (options.token.trim().length < 16) throw new Error('OpenClaw Gateway credential is not configured')
  const text = validQuery(query)
  const port = validPort(options.port ?? 18789)
  const signal = options.signal === undefined
    ? AbortSignal.timeout(12_000)
    : AbortSignal.any([options.signal, AbortSignal.timeout(12_000)])
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(`http://127.0.0.1:${port}/tools/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ tool: TOOL_FOR_SOURCE[source], args: { query: text } }),
      signal,
    })
  } catch {
    throw new Error('OpenClaw Gateway is unreachable or the read request timed out')
  }
  if (!response.ok) {
    // Error bodies may contain credentials or internal config; keep them private.
    throw new Error(`OpenClaw read tool was not available (HTTP ${response.status})`)
  }
  const payload: unknown = await response.json().catch(() => undefined)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
    || (payload as { ok?: unknown }).ok !== true) {
    throw new Error('OpenClaw Gateway returned an invalid tool response')
  }
  return {
    source,
    result_json: JSON.stringify((payload as { result?: unknown }).result ?? null).slice(0, 24_000),
  }
}

/**
 * The owner's explicit environment configuration enables discovery by Kira.
 * No token -> no tool; no silent Gateway credentials import or plugin loading.
 */
export function registerOpenClawReadBridge(ctx: Context): void {
  // Existing owner-configured Gateway credentials activate the read-only bridge on restart.
  // A hard opt-out remains available; never auto-read OpenClaw's operator credential.
  if (process.env.PHOENIX_OPENCLAW_READ_BRIDGE === '0') return
  const token = process.env.PHOENIX_OPENCLAW_GATEWAY_TOKEN ?? process.env.OPENCLAW_GATEWAY_TOKEN
  if (token === undefined || token.trim().length < 16) return
  const rawPort = process.env.PHOENIX_OPENCLAW_GATEWAY_PORT
  const port = rawPort === undefined ? 18789 : Number(rawPort)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return

  ctx.tools.register(defineTool({
    name: 'openclaw_external_search',
    description: 'Search the owner-configured OpenClaw Gateway memory or its web search provider, only when the user asks for OpenClaw-backed information. Uses a restricted read-only bridge; never controls the browser, executes plugins, or mutates files.',
    parameters: {
      source: { type: 'string', required: true, enum: ['memory', 'web'] as const },
      query: { type: 'string', required: true, description: 'Short search query; never include passwords or tokens.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true, enum: ['memory', 'web'] as const },
          result_json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: value.result_json }],
    },
    execute(args, execution) {
      return invokeOpenClawRead(args.source, args.query, { token, port, signal: execution.signal })
    },
    presentCall: args => ({ card: 'generic', kind: 'read', title: `OpenClaw ${args.source} lookup`, rawInput: args.query }),
  }))
}
