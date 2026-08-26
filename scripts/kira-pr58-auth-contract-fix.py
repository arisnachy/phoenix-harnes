from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected pattern in {path}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1))


# Browser authorization list: project disconnectability and sanitized provider telemetry.
replace_once(
    "packages/host/apiproxy/src/api-proxy.ts",
    "          return {\n"
    "            key: String(entry.key),\n"
    "            label: entry.label,\n"
    "            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n"
    "            inFlight: entry.inFlight,\n"
    "            ...stored === undefined ? {} : { stored },\n"
    "          }\n",
    "          let telemetry\n"
    "          try {\n"
    "            telemetry = await authorization.inspect(entry.key)\n"
    "          } catch {\n"
    "            // Live provider inspection is optional; the flow itself remains usable.\n"
    "          }\n"
    "          return {\n"
    "            key: String(entry.key),\n"
    "            label: entry.label,\n"
    "            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n"
    "            inFlight: entry.inFlight,\n"
    "            ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),\n"
    "            ...stored === undefined ? {} : { stored },\n"
    "            ...telemetry === undefined ? {} : { telemetry },\n"
    "          }\n",
)

# Product host RPC: AuthorizationApi requires a real disconnect implementation.
replace_once(
    "packages/host/apiproxy/src/api-proxy.ts",
    "        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n    },\n\n    events:",
    "        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n\n"
    "      async disconnect(request, signal) {\n"
    "        const authorization = ctx.get('authorization')\n"
    "        if (authorization === undefined) {\n"
    "          return err(request, {\n"
    "            code: 'internal',\n"
    "            message: 'authorization service is absent: this deployment does not mount an authorization provider',\n"
    "            details: {},\n"
    "          })\n"
    "        }\n"
    "        let key: ReturnType<typeof parseCredentialKey>\n"
    "        try {\n"
    "          key = parseCredentialKey(request.payload.key)\n"
    "        } catch {\n"
    "          return err(request, { code: 'internal', message: 'authorization key is invalid', details: {} })\n"
    "        }\n"
    "        try {\n"
    "          await authorization.disconnect(key, signal)\n"
    "          return ok(request, { disconnected: true as const })\n"
    "        } catch (error: unknown) {\n"
    "          if (signal?.aborted === true) {\n"
    "            return err(request, { code: 'cancelled', message: 'authorization disconnect was aborted', details: {} })\n"
    "          }\n"
    "          return err(request, { code: 'internal', message: authorizationFailure(error), details: {} })\n"
    "        }\n"
    "      },\n"
    "    },\n\n    events:",
)

# Compiler-complete API test doubles.
replace_once(
    "packages/host/apiproxy/tests/client-handler.spec.ts",
    "      cancel: err,\n      ...overrides.authorization,",
    "      cancel: err,\n      disconnect: err,\n      ...overrides.authorization,",
)
replace_once(
    "packages/host/apiproxy/tests/fetch-carrier.spec.ts",
    "      async cancel(request) {\n"
    "        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n"
    "      },\n    },\n    events:",
    "      async cancel(request) {\n"
    "        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n"
    "      },\n"
    "      async disconnect(request) {\n"
    "        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n"
    "      },\n    },\n    events:",
)

# Regression: telemetry and disconnect must reach the browser-facing host API.
auth_spec = Path("packages/host/apiproxy/tests/api-proxy-authorization.spec.ts")
auth_text = auth_spec.read_text()
if "projects live connector telemetry and forwards provider-owned disconnect" not in auth_text:
    auth_text = auth_text.replace("    inFlight: false,\n  }", "    inFlight: false,\n    disconnectable: true,\n  }", 1)
    auth_text = auth_text.replace(
        "  let finish: ((outcome: { status: 'authorized' | 'cancelled' }) => void) | undefined\n  const service = {",
        "  let finish: ((outcome: { status: 'authorized' | 'cancelled' }) => void) | undefined\n"
        "  let disconnected = false\n  const service = {",
        1,
    )
    auth_text = auth_text.replace(
        "    describe: () => ({ ...entry, inFlight: running !== undefined }),\n    begin:",
        "    describe: () => ({ ...entry, inFlight: running !== undefined }),\n"
        "    inspect: async () => ({\n"
        "      kind: 'account' as const,\n"
        "      provider: 'Codex',\n"
        "      connectors: [{ id: 'drive', name: 'Drive', accessible: true, enabled: true, installed: true, callable: true }],\n"
        "    }),\n"
        "    disconnect: async () => { disconnected = true },\n"
        "    begin:",
        1,
    )
    auth_text = auth_text.replace(
        "  return { service, key }\n}",
        "  return { service, key, wasDisconnected: () => disconnected }\n}",
        1,
    )
    test = """

  it('projects live connector telemetry and forwards provider-owned disconnect', async () => {
    const ctx = new Context()
    const { service, key, wasDisconnected } = fakeAuthorization()
    ctx.provide('authorization', service)
    ctx.provide('userQuestions', { registerProvider: () => () => {} } as never)
    const api = createApiProxy(ctx, DEFAULTS)

    const entries = ok(await api.authorization.list(request({})))
    expect(entries.entries[0]?.disconnectable).toBe(true)
    expect(entries.entries[0]?.telemetry?.connectors?.[0]?.name).toBe('Drive')

    const disconnected = ok(await api.authorization.disconnect(request({ key: String(key) })))
    expect(disconnected.disconnected).toBe(true)
    expect(wasDisconnected()).toBe(true)
  })
"""
    if not auth_text.endswith("\n})\n"):
        raise SystemExit("authorization spec end marker not found")
    auth_text = auth_text[:-4] + test + "\n})\n"
    auth_spec.write_text(auth_text)
