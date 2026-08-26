from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected pattern in {path}")
    file.write_text(text.replace(old, new, 1))


# Product host RPC: AuthorizationApi requires a real disconnect implementation.
replace_once(
    "packages/host/apiproxy/src/api-proxy.ts",
    "        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n    },\n\n    events:",
    "        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n\n      async disconnect(request, signal) {\n        const authorization = ctx.get('authorization')\n        if (authorization === undefined) {\n          return err(request, {\n            code: 'internal',\n            message: 'authorization service is absent: this deployment does not mount an authorization provider',\n            details: {},\n          })\n        }\n        let key: ReturnType<typeof parseCredentialKey>\n        try {\n          key = parseCredentialKey(request.payload.key)\n        } catch {\n          return err(request, { code: 'internal', message: 'authorization key is invalid', details: {} })\n        }\n        try {\n          await authorization.disconnect(key, signal)\n          return ok(request, { disconnected: true as const })\n        } catch (error: unknown) {\n          if (signal?.aborted === true) {\n            return err(request, {\n              code: 'cancelled',\n              message: 'authorization disconnect was aborted',\n              details: {},\n            })\n          }\n          return err(request, {\n            code: 'internal',\n            message: authorizationFailure(error),\n            details: {},\n          })\n        }\n      },\n    },\n\n    events:",
)

# Compiler-complete scripted API used by client-handler tests.
replace_once(
    "packages/host/apiproxy/tests/client-handler.spec.ts",
    "      cancel: err,\n      ...overrides.authorization,",
    "      cancel: err,\n      disconnect: err,\n      ...overrides.authorization,",
)

# Compiler-complete in-memory API used by fetch carrier tests.
replace_once(
    "packages/host/apiproxy/tests/fetch-carrier.spec.ts",
    "      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },\n    events:",
    "      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n      async disconnect(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },\n    events:",
)
