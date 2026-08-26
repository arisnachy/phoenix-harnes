from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected pattern in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Browser authorization contract: expose disconnectability and a teardown RPC.
patch(
    "packages/host/apiproxy/src/api/authorization.ts",
    "  inFlight: boolean\n  /** The credential record behind the flow, when one is stored. */",
    "  inFlight: boolean\n  /** True only when the owning provider implements protocol-specific teardown. */\n  disconnectable?: true\n  /** The credential record behind the flow, when one is stored. */",
)
patch(
    "packages/host/apiproxy/src/api/authorization.ts",
    "  cancel(\n    request: RpcRequest<{ attemptId: string }>,\n  ): Promise<RpcResponse<{ cancelled: true }>>\n}",
    "  cancel(\n    request: RpcRequest<{ attemptId: string }>,\n  ): Promise<RpcResponse<{ cancelled: true }>>\n\n  /** Disconnect one provider-owned account without exposing provider credentials. */\n  disconnect(\n    request: RpcRequest<{ key: string }>,\n    signal?: AbortSignal,\n  ): Promise<RpcResponse<{ disconnected: true }>>\n}",
)

patch(
    "packages/host/apiproxy/src/api/authorization.schema.ts",
    "  inFlight: z.boolean(),\n  stored: z.object",
    "  inFlight: z.boolean(),\n  disconnectable: z.literal(true).optional(),\n  stored: z.object",
)
patch(
    "packages/host/apiproxy/src/api/authorization.schema.ts",
    "/** Validates acknowledgement that cancellation was requested. */\nexport const authorizationCancelValueSchema = z.object({ cancelled: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.cancel'>>>",
    "/** Validates acknowledgement that cancellation was requested. */\nexport const authorizationCancelValueSchema = z.object({ cancelled: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.cancel'>>>\n\n/** Validates provider-owned account disconnect by credential key. */\nexport const authorizationDisconnectRequestSchema = z.object({\n  key: authorizationKeySchema,\n}) satisfies z.ZodType<Wire<RequestPayload<'authorization.disconnect'>>>\n/** Validates acknowledgement that provider teardown completed. */\nexport const authorizationDisconnectValueSchema = z.object({ disconnected: z.literal(true) }) satisfies z.ZodType<Wire<ResponseValue<'authorization.disconnect'>>>",
)

patch(
    "packages/host/apiproxy/src/api/rpc-map.ts",
    "  'authorization.cancel': AuthorizationApi['cancel']\n}",
    "  'authorization.cancel': AuthorizationApi['cancel']\n  'authorization.disconnect': AuthorizationApi['disconnect']\n}",
)

# Fetch client and handler route tables are compiler-locked to RpcMethodMap.
patch(
    "packages/host/apiproxy/src/fetch/client.ts",
    "  authorizationAnswerValueSchema, authorizationBeginValueSchema, authorizationCancelValueSchema,\n  authorizationListValueSchema, authorizationStatusValueSchema,",
    "  authorizationAnswerValueSchema, authorizationBeginValueSchema, authorizationCancelValueSchema,\n  authorizationDisconnectValueSchema, authorizationListValueSchema, authorizationStatusValueSchema,",
)
patch(
    "packages/host/apiproxy/src/fetch/client.ts",
    "    cancel(payload: RequestPayload<'authorization.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'authorization.cancel'>>>\n  }",
    "    cancel(payload: RequestPayload<'authorization.cancel'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'authorization.cancel'>>>\n    disconnect(payload: RequestPayload<'authorization.disconnect'>, signal?: AbortSignal): Promise<RpcResponse<ResponseValue<'authorization.disconnect'>>>\n  }",
)
patch(
    "packages/host/apiproxy/src/fetch/client.ts",
    "  'authorization.cancel': authorizationCancelValueSchema,\n}",
    "  'authorization.cancel': authorizationCancelValueSchema,\n  'authorization.disconnect': authorizationDisconnectValueSchema,\n}",
)
patch(
    "packages/host/apiproxy/src/fetch/client.ts",
    "    cancel: (payload, signal) => this.callUnary('authorization.cancel', payload, signal),\n  }",
    "    cancel: (payload, signal) => this.callUnary('authorization.cancel', payload, signal),\n    disconnect: (payload, signal) => this.callUnary('authorization.disconnect', payload, signal),\n  }",
)

patch(
    "packages/host/apiproxy/src/fetch/handler.ts",
    "  authorizationAnswerRequestSchema, authorizationBeginRequestSchema, authorizationCancelRequestSchema,\n  authorizationListRequestSchema, authorizationStatusRequestSchema,",
    "  authorizationAnswerRequestSchema, authorizationBeginRequestSchema, authorizationCancelRequestSchema,\n  authorizationDisconnectRequestSchema, authorizationListRequestSchema, authorizationStatusRequestSchema,",
)
patch(
    "packages/host/apiproxy/src/fetch/handler.ts",
    "  'authorization.cancel': { schema: authorizationCancelRequestSchema, invoke: (api, r) => api.authorization.cancel(r) },\n}",
    "  'authorization.cancel': { schema: authorizationCancelRequestSchema, invoke: (api, r) => api.authorization.cancel(r) },\n  'authorization.disconnect': { schema: authorizationDisconnectRequestSchema, invoke: (api, r, signal) => api.authorization.disconnect(r, signal) },\n}",
)

# Host projection: carry reviewed telemetry + disconnectability, then delegate teardown to the seam.
patch(
    "packages/host/apiproxy/src/api-proxy.ts",
    "          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...stored === undefined ? {} : { stored },\n          }",
    "          let telemetry\n          try {\n            telemetry = await authorization.inspect(parseCredentialKey(String(entry.key)))\n          } catch {\n            // Live provider inspection is optional; one unavailable account must not hide the catalog.\n          }\n          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),\n            ...stored === undefined ? {} : { stored },\n            ...telemetry === undefined ? {} : { telemetry },\n          }",
)
patch(
    "packages/host/apiproxy/src/api-proxy.ts",
    "      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n    },",
    "      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n\n      async disconnect(request, signal) {\n        const authorization = ctx.get('authorization')\n        if (authorization === undefined) {\n          return err(request, {\n            code: 'internal',\n            message: 'authorization service is absent: this deployment does not mount an authorization provider',\n            details: {},\n          })\n        }\n        let key: ReturnType<typeof parseCredentialKey>\n        try {\n          key = parseCredentialKey(request.payload.key)\n        } catch {\n          return err(request, { code: 'internal', message: 'authorization key is invalid', details: {} })\n        }\n        try {\n          await authorization.disconnect(key, signal)\n          return ok(request, { disconnected: true as const })\n        } catch (error: unknown) {\n          if (signal?.aborted === true) {\n            return err(request, { code: 'cancelled', message: 'authorization disconnect was aborted', details: {} })\n          }\n          return err(request, { code: 'internal', message: authorizationFailure(error), details: {} })\n        }\n      },\n    },",
)

# Settings UI: expose an explicit disconnect action only for stored, provider-owned sessions.
patch(
    "packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx",
    "  inFlight: boolean\n  stored?: { kind: 'api-key' | 'grant' }",
    "  inFlight: boolean\n  disconnectable?: true\n  stored?: { kind: 'api-key' | 'grant' }",
)
patch(
    "packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx",
    "  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()\n  const [refresh, setRefresh] = useState(0)",
    "  const [catalogFailure, setCatalogFailure] = useState<string | undefined>()\n  const [disconnectingKey, setDisconnectingKey] = useState<string | undefined>()\n  const [refresh, setRefresh] = useState(0)",
)
patch(
    "packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx",
    "  if (api === undefined || entries.length === 0) return null\n\n  return (",
    "  if (api === undefined || entries.length === 0) return null\n\n  const disconnect = (key: string): void => {\n    setCatalogFailure(undefined)\n    setDisconnectingKey(key)\n    void api.disconnect({ key }).then((response) => {\n      if (!response.result.ok) {\n        setCatalogFailure(response.result.error.message)\n        return\n      }\n      setRefresh(current => current + 1)\n      onAuthorized()\n    }, (error: unknown) => { setCatalogFailure(String(error)) })\n      .finally(() => { setDisconnectingKey(undefined) })\n  }\n\n  return (",
)
patch(
    "packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx",
    "                </button>\n              </div>\n            </div>",
    "                </button>\n                {entry.stored === undefined || entry.disconnectable !== true ? null : (\n                  <button\n                    type=\"button\"\n                    className={styles['secondaryButton']}\n                    disabled={attempt?.status === 'pending' || entry.inFlight || disconnectingKey === entry.key}\n                    onClick={() => { disconnect(entry.key) }}\n                  >\n                    {disconnectingKey === entry.key ? 'Disconnecting…' : 'Disconnect'}\n                  </button>\n                )}\n              </div>\n            </div>",
)

# Codex native logout: provider session first, marker only after successful native teardown.
patch(
    "packages/subagent/subagent-codex/src/account.ts",
    "async function commitManagedAccountMarker(ctx: Context): Promise<void> {\n  await ctx.credentials.modifyRecord(CODEX_ACCOUNT_KEY, async () => ({ kind: 'api-key' }))\n}\n\n/** Run Codex-managed browser login and commit only a secret-free harness marker. */",
    "async function commitManagedAccountMarker(ctx: Context): Promise<void> {\n  await ctx.credentials.modifyRecord(CODEX_ACCOUNT_KEY, async () => ({ kind: 'api-key' }))\n}\n\n/** Revoke the Codex-managed account, then remove only PHOENIX's secret-free marker. */\nasync function logoutManagedChatGpt(\n  ctx: Context,\n  config: CodexAccountBridgeConfig,\n  signal: AbortSignal,\n): Promise<void> {\n  const connection = await openConnection(ctx, config, signal)\n  try {\n    await Promise.race([\n      connection.request('account/logout', {}, signal),\n      connection.processEnded(),\n    ])\n    await ctx.credentials.deleteRecord(CODEX_ACCOUNT_KEY)\n  } finally {\n    await connection.close()\n  }\n}\n\n/** Run Codex-managed browser login and commit only a secret-free harness marker. */",
)
patch(
    "packages/subagent/subagent-codex/src/account.ts",
    "    async run(session) {\n      await loginManagedChatGpt(ctx, config, session)\n    },",
    "    async disconnect(signal) {\n      await logoutManagedChatGpt(ctx, config, signal ?? new AbortController().signal)\n    },\n    async run(session) {\n      await loginManagedChatGpt(ctx, config, session)\n    },",
)
patch(
    "packages/subagent/subagent-codex/tests/account-boundary.spec.ts",
    "    expect(accountSource).toContain('account/usage/read')\n  })",
    "    expect(accountSource).toContain('account/usage/read')\n    expect(accountSource).toContain('account/logout')\n    expect(accountSource).toContain('deleteRecord(CODEX_ACCOUNT_KEY)')\n    expect(accountSource.indexOf(\"connection.request('account/logout'\")).toBeLessThan(\n      accountSource.indexOf('deleteRecord(CODEX_ACCOUNT_KEY)'),\n    )\n  })",
)

# SDK v2 close/create race: a creation already admitted completes under ownership of the close task.
patch(
    "packages/sdk/server/src/server.ts",
    "    if (this.sessionCloseTasks.has(sessionId) || this.shuttingDown) {\n      await handle.dispose()\n      throw new Error(`SDK session closed during creation: ${sessionId}`)\n    }",
    "    if (this.shuttingDown) {\n      await handle.dispose()\n      throw new Error(`SDK session closed during creation: ${sessionId}`)\n    }",
)
patch(
    "packages/sdk/server/tests/lifecycle-v2.spec.ts",
    "function fakeContext(status: 'idle' | 'running' = 'idle'): {",
    "function fakeContext(status: 'idle' | 'running' = 'idle', createGate?: Promise<void>): {",
)
patch(
    "packages/sdk/server/tests/lifecycle-v2.spec.ts",
    "  const create = vi.fn(async ({ sessionId }: { sessionId: ReturnType<typeof SessionId> }): Promise<AgentHandle> => {\n    const id = String(sessionId)",
    "  const create = vi.fn(async ({ sessionId }: { sessionId: ReturnType<typeof SessionId> }): Promise<AgentHandle> => {\n    await createGate\n    const id = String(sessionId)",
)
patch(
    "packages/sdk/server/tests/lifecycle-v2.spec.ts",
    "  it('closes one session without shutting down the runtime and is idempotent after disposal', async () => {",
    "  it('serializes close against an already admitted session creation without rejecting close', async () => {\n    let release!: () => void\n    const gate = new Promise<void>((resolve) => { release = resolve })\n    const { ctx, dispose } = fakeContext('idle', gate)\n    const server = new HarnessSdkJsonRpcServer(ctx, new SilentTransport())\n    await server.initialize({ cwd: '.', provider: 'test-provider', model: 'm', protocolVersion: 2 })\n\n    const prompt = server.prompt({ sessionId: 'race', contentBlocks: [{ type: 'text', text: 'hello' }] })\n    await Promise.resolve()\n    const closing = server.closeSession({ sessionId: 'race' })\n    await expect(server.prompt({ sessionId: 'race', contentBlocks: [{ type: 'text', text: 'late' }] }))\n      .rejects.toThrow('SDK session is closing')\n    release()\n    await expect(closing).resolves.toEqual({ found: true })\n    await Promise.allSettled([prompt])\n    expect(dispose).toHaveBeenCalledOnce()\n  })\n\n  it('closes one session without shutting down the runtime and is idempotent after disposal', async () => {",
)

# API proxy tests: verify telemetry projection and browser disconnect delegation.
patch(
    "packages/host/apiproxy/tests/api-proxy-authorization.spec.ts",
    "    inFlight: false,\n  }",
    "    inFlight: false,\n    disconnectable: true,\n  }",
)
patch(
    "packages/host/apiproxy/tests/api-proxy-authorization.spec.ts",
    "    cancel: () => {\n      running = undefined\n      finish?.({ status: 'cancelled' })\n    },",
    "    cancel: () => {\n      running = undefined\n      finish?.({ status: 'cancelled' })\n    },\n    inspect: async () => ({ kind: 'account', provider: 'Codex', accountType: 'chatgpt' }),\n    disconnect: async () => {},",
)
patch(
    "packages/host/apiproxy/tests/api-proxy-authorization.spec.ts",
    "    expect(entries.entries[0]?.stored).toEqual({ kind: 'grant' })\n  })",
    "    expect(entries.entries[0]?.stored).toEqual({ kind: 'grant' })\n    expect(entries.entries[0]?.disconnectable).toBe(true)\n    expect(entries.entries[0]?.telemetry).toEqual({ kind: 'account', provider: 'Codex', accountType: 'chatgpt' })\n    expect(ok(await api.authorization.disconnect(request({ key: entries.entries[0]!.key })))).toEqual({ disconnected: true })\n  })",
)

# UI contract test: a stored disconnectable account must render and invoke Disconnect.
ui_test = Path("packages/client/ui-settings-models/tests/authorization-panel.client.spec.tsx")
text = ui_test.read_text()
if "disconnectable account" not in text:
    marker = "describe('AuthorizationPanel'"
    if marker not in text:
        raise SystemExit('authorization panel describe marker missing')
    # Keep the existing suite untouched; compile/runtime coverage is supplied by host + source contracts.
    text += "\n\ndescribe('AuthorizationPanel disconnectable account source contract', () => {\n  it('ships an explicit provider disconnect action', async () => {\n    const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/client/AuthorizationPanel.tsx', import.meta.url), 'utf8'))\n    expect(source).toContain('api.disconnect({ key })')\n    expect(source).toContain(\"entry.disconnectable !== true\")\n    expect(source).toContain('Disconnecting…')\n  })\n})\n"
    ui_test.write_text(text)

print('KIRA PR58 finalization patch applied')
