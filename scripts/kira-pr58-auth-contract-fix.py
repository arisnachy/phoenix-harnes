from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected pattern in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# Host projection: carry reviewed provider telemetry + disconnectability.
patch(
    "packages/host/apiproxy/src/api-proxy.ts",
    "          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...stored === undefined ? {} : { stored },\n          }",
    "          let telemetry\n          try {\n            telemetry = await authorization.inspect(parseCredentialKey(String(entry.key)))\n          } catch {\n            // Live provider inspection is optional; one unavailable account must not hide the catalog.\n          }\n          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),\n            ...stored === undefined ? {} : { stored },\n            ...telemetry === undefined ? {} : { telemetry },\n          }",
)

# Host RPC: delegate teardown to the provider-owned authorization seam.
patch(
    "packages/host/apiproxy/src/api-proxy.ts",
    "      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n    },",
    "      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n\n      async disconnect(request, signal) {\n        const authorization = ctx.get('authorization')\n        if (authorization === undefined) {\n          return err(request, {\n            code: 'internal',\n            message: 'authorization service is absent: this deployment does not mount an authorization provider',\n            details: {},\n          })\n        }\n        let key: ReturnType<typeof parseCredentialKey>\n        try {\n          key = parseCredentialKey(request.payload.key)\n        } catch {\n          return err(request, { code: 'internal', message: 'authorization key is invalid', details: {} })\n        }\n        try {\n          await authorization.disconnect(key, signal)\n          return ok(request, { disconnected: true as const })\n        } catch (error: unknown) {\n          if (signal?.aborted === true) {\n            return err(request, { code: 'cancelled', message: 'authorization disconnect was aborted', details: {} })\n          }\n          return err(request, { code: 'internal', message: authorizationFailure(error), details: {} })\n        }\n      },\n    },",
)

# Compiler-complete scripted API used by fetch/client contract tests.
patch(
    "packages/host/apiproxy/tests/client-handler.spec.ts",
    "      cancel: err,\n      ...overrides.authorization,",
    "      cancel: err,\n      disconnect: err,\n      ...overrides.authorization,",
)

# Compiler-complete in-memory ApiProxy used by carrier tests.
patch(
    "packages/host/apiproxy/tests/fetch-carrier.spec.ts",
    "      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },",
    "      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n      async disconnect(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },",
)

# Trigger the focal workflow after the workflow definition exists on the branch.
