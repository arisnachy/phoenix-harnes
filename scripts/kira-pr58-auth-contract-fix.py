from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"missing expected pattern in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


def prepend_once(path: str, marker: str, prefix: str) -> None:
    file = Path(path)
    text = file.read_text()
    if prefix + marker in text:
        return
    if marker not in text:
        raise SystemExit(f"missing expected marker in {path}: {marker!r}")
    file.write_text(text.replace(marker, prefix + marker, 1))


# Source resolution for the host-only Google broker subpath.
replace_once(
    "tsconfig.base.json",
    '      "@deepseek-ai/dsh-authorization/types": ["./packages/credentials/authorization/src/types.ts"],\n',
    '      "@deepseek-ai/dsh-authorization/types": ["./packages/credentials/authorization/src/types.ts"],\n'
    '      "@deepseek-ai/dsh-authorization/google": ["./packages/credentials/authorization/src/google-broker.ts"],\n',
)

# Public authorization JSDoc contract.
replace_once(
    "packages/credentials/authorization/src/index.ts",
    "   * cannot be disconnected by deleting storage behind its back.\n   */\n"
    "  async disconnect(key: CredentialKey, signal?: AbortSignal): Promise<void> {",
    "   * cannot be disconnected by deleting storage behind its back.\n"
    "   * @param key - credential record whose provider session should be disconnected.\n"
    "   * @param signal - optional cancellation signal for provider teardown.\n"
    "   * @returns once provider teardown completed and the marker is verified absent.\n"
    "   */\n"
    "  async disconnect(key: CredentialKey, signal?: AbortSignal): Promise<void> {",
)

# Google broker JSDoc contract.
replace_once(
    "packages/credentials/authorization/src/google-broker.ts",
    "/** Resolve broker configuration without inventing scopes or a deployment identity. */\n"
    "export function resolveGoogleSpec(config: Config): ResolvedSpec {",
    "/**\n"
    " * Resolve broker configuration without inventing scopes or a deployment identity.\n"
    " * @param config - deployment-owned Google OAuth client id and requested scopes.\n"
    " * @returns validated, normalized broker configuration.\n"
    " */\n"
    "export function resolveGoogleSpec(config: Config): ResolvedSpec {",
)
replace_once(
    "packages/credentials/authorization/src/google-broker.ts",
    "  /** Secret-free telemetry exists only while this process owns a live grant. */\n"
    "  async inspect(): Promise<AuthorizationTelemetry | undefined> {",
    "  /**\n"
    "   * Secret-free telemetry exists only while this process owns a live grant.\n"
    "   * @returns sanitized Google account and service capability telemetry, when connected.\n"
    "   */\n"
    "  async inspect(): Promise<AuthorizationTelemetry | undefined> {",
)
replace_once(
    "packages/credentials/authorization/src/google-broker.ts",
    "  /** Execute one request inside a fixed Google service boundary. */\n"
    "  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {",
    "  /**\n"
    "   * Execute one request inside a fixed Google service boundary.\n"
    "   * @param request - service id, relative path, method, headers, and optional body.\n"
    "   * @returns the bounded response without forwarding credential-bearing headers.\n"
    "   */\n"
    "  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {",
)
replace_once(
    "packages/credentials/authorization/src/google-broker.ts",
    "  /** Clear the process grant and secret-free marker even when provider revocation fails. */\n"
    "  async disconnect(): Promise<{ revoked: boolean }> {",
    "  /**\n"
    "   * Clear the process grant and secret-free marker even when provider revocation fails.\n"
    "   * @returns whether Google acknowledged token revocation; local teardown always completes.\n"
    "   */\n"
    "  async disconnect(): Promise<{ revoked: boolean }> {",
)

# ExecPolicy public type/function documentation.
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export type ExecPolicyDecision = 'allow' | 'prompt' | 'forbidden'",
    "/** One monotonic command-policy outcome, ordered from permissive to restrictive. */\n",
)
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export type ExecPolicyPatternPart = string | readonly string[]",
    "/** One exact token or a closed set of accepted alternatives at one prefix position. */\n",
)
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export interface ExecPolicyRule {",
    "/** One validated token-prefix rule and its examples. */\n",
)
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export interface ExecPolicyConfig {",
    "/** Optional exec-policy configuration mounted into the existing pre-execute chain. */\n",
)
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export interface CompiledExecPolicy {",
    "/** Immutable runtime form of a validated exec policy. */\n",
)
prepend_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "export interface ExecPolicyEvaluation {",
    "/** Decision returned for one classified shell command. */\n",
)
replace_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "/** Compile and self-test an exec policy before it can affect live tools. */\n"
    "export function compileExecPolicy",
    "/**\n"
    " * Compile and self-test an exec policy before it can affect live tools.\n"
    " * @param config - source rules and shell-tool settings.\n"
    " * @returns immutable validated runtime policy.\n"
    " */\n"
    "export function compileExecPolicy",
)
replace_once(
    "packages/guard/timeout-policy/src/exec-policy.ts",
    "/** Evaluate one shell command without changing the surrounding policy chain. */\n"
    "export function evaluateExecPolicy",
    "/**\n"
    " * Evaluate one shell command without changing the surrounding policy chain.\n"
    " * @param command - raw shell command supplied to a governed tool.\n"
    " * @param policy - compiled policy to evaluate.\n"
    " * @returns the strictest matching decision, or undefined to inherit the surrounding chain.\n"
    " */\n"
    "export function evaluateExecPolicy",
)

# Publish ExecPolicy as a supported package surface.
replace_once(
    "packages/guard/timeout-policy/package.json",
    '    "./invariant": {\n      "types": "./lib/types/invariant.d.ts",\n      "default": "./lib/invariant.js"\n    },\n',
    '    "./invariant": {\n      "types": "./lib/types/invariant.d.ts",\n      "default": "./lib/invariant.js"\n    },\n'
    '    "./exec-policy": {\n      "types": "./lib/types/exec-policy.d.ts",\n      "default": "./lib/exec-policy.js"\n    },\n',
)
replace_once(
    "packages/guard/timeout-policy/package.json",
    '    "lib/invariant.js",\n    "lib/types/**/*.d.ts"',
    '    "lib/invariant.js",\n    "lib/exec-policy.js",\n    "lib/types/**/*.d.ts"',
)

# High-level SDK JSDoc.
prepend_once(
    "packages/sdk/client/src/api.ts",
    "  get client(): HarnessClient {",
    "  /** Current low-level transport client owned by this reusable harness. */\n",
)
replace_once(
    "packages/sdk/client/src/api.ts",
    "  /** Whether the current runtime explicitly advertised one v2 lifecycle capability. */\n"
    "  supports(capability: keyof HarnessSdkCapabilities): boolean {",
    "  /**\n"
    "   * Whether the current runtime explicitly advertised one v2 lifecycle capability.\n"
    "   * @param capability - lifecycle capability to query.\n"
    "   * @returns true only when the negotiated runtime advertised it.\n"
    "   */\n"
    "  supports(capability: keyof HarnessSdkCapabilities): boolean {",
)
prepend_once(
    "packages/sdk/client/src/api.ts",
    "  session(sessionId?: string): HarnessSession {",
    "  /**\n"
    "   * Create a lightweight handle for one SDK-owned session id.\n"
    "   * @param sessionId - optional stable id; a unique id is minted when omitted.\n"
    "   * @returns a session handle sharing this harness runtime.\n"
    "   */\n",
)
prepend_once(
    "packages/sdk/client/src/api.ts",
    "  run(input: string | ContentBlock[], options?: RunOptions): Promise<RunResult> {",
    "  /**\n"
    "   * Run one turn in a selected or newly minted session.\n"
    "   * @param input - prompt text or structured content blocks.\n"
    "   * @param options - optional target session and notification observer.\n"
    "   * @returns the settled turn result.\n"
    "   */\n",
)
prepend_once(
    "packages/sdk/client/src/api.ts",
    "  close(): Promise<void> {",
    "  /** @returns once the shared runtime subprocess is closed. */\n",
)
prepend_once(
    "packages/sdk/client/src/api.ts",
    "  async run(input: string | ContentBlock[], options?: Pick<RunOptions, 'onNotification'>): Promise<RunResult> {",
    "  /**\n"
    "   * Run one turn in this stable session.\n"
    "   * @param input - prompt text or structured content blocks.\n"
    "   * @param options - optional notification observer.\n"
    "   * @returns the settled turn result.\n"
    "   */\n",
)
replace_once(
    "packages/sdk/client/src/api.ts",
    "  /** Cancel this session's current activity without closing the runtime or discarding queued follow-up work. */\n"
    "  async interrupt()",
    "  /**\n"
    "   * Cancel this session's current activity without closing the runtime or discarding queued follow-up work.\n"
    "   * @returns whether the session existed and whether it was running.\n"
    "   */\n"
    "  async interrupt()",
)
replace_once(
    "packages/sdk/client/src/api.ts",
    "  /** Dispose this SDK-owned session while preserving the shared PHOENIX runtime for other sessions. */\n"
    "  async close()",
    "  /**\n"
    "   * Dispose this SDK-owned session while preserving the shared PHOENIX runtime for other sessions.\n"
    "   * @returns whether a live SDK-owned session was found and closed.\n"
    "   */\n"
    "  async close()",
)

# Codex bridge JSDoc.
prepend_once(
    "packages/subagent/subagent-codex/src/account.ts",
    "export async function readCodexAccountSnapshot(\n",
    "/**\n"
    " * Read one secret-free native Codex account snapshot, including optional apps.\n"
    " * @param ctx - PHOENIX service context used to launch the Codex app-server.\n"
    " * @param config - Codex account bridge configuration.\n"
    " * @param signal - optional cancellation signal for the inspection.\n"
    " * @returns account, quota, usage, and connector metadata with no OAuth token material.\n"
    " */\n",
)
prepend_once(
    "packages/subagent/subagent-codex/src/account.ts",
    "export function registerCodexAccountFlow(\n",
    "/**\n"
    " * Register native ChatGPT/Codex login, inspection, and logout with the authorization seam.\n"
    " * @param ctx - PHOENIX service context owning authorization and credentials.\n"
    " * @param config - Codex account bridge configuration.\n"
    " * @returns disposer for the registered authorization flow.\n"
    " */\n",
)

# Structured error surface JSDoc.
prepend_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "export interface StructuredErrorField {",
    "/** One bounded field promoted from a provider error payload. */\n",
)
prepend_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "export interface StructuredErrorPresentation {",
    "/** Safe, user-facing normalization of one structured provider failure. */\n",
)
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "/** Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs. */\n"
    "export function translateGenericErrorProse(value: string): string {",
    "/**\n"
    " * Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs.\n"
    " * @param value - provider prose to normalize.\n"
    " * @returns Spanish-friendly generic prose with identifiers preserved.\n"
    " */\n"
    "export function translateGenericErrorProse(value: string): string {",
)
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    " * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n */\n"
    "export function formatStructuredError(",
    " * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n"
    " * @param input - error string containing a JSON object or array.\n"
    " * @param explicitCode - optional transport/status code that outranks payload inference.\n"
    " * @returns a bounded presentation model, or undefined when the input is not structured JSON.\n"
    " */\n"
    "export function formatStructuredError(",
)

prepend_once(
    "packages/host/apiproxy/src/fetch/client.ts",
    "export class InProcessApiClient extends AbstractApiClient {",
    "/** API client that routes fetches directly into an in-process host handler for tests and embedded runtimes. */\n",
)

# Exact type-doc parity and package README model-experience structure.
replace_once(
    "docs/subsystems/sandbox.md",
    "  /** Explicit approved mode override, which outranks session policy. */",
    "  /** Explicit approved mode override, which outranks session policy but not HARDNESS runtime protection. */",
)
readme = Path("packages/sandbox/sandbox-policy/README.md")
readme_text = readme.read_text()
paragraph = (
    "One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. "
    "It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, "
    "approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s "
    "system section. With launcher HARDNESS protection active, the same contribution states that the live "
    "PHOENIX runtime and data home are protected and directs self-modification to the isolated evolution worktree.\n\n"
)
old_marker = "### Current file sandbox policy\n\n#### What the model sees\n\n" + paragraph
new_marker = "### Current file sandbox policy\n\n" + paragraph + "#### What the model sees\n\n"
if new_marker not in readme_text:
    if old_marker not in readme_text:
        raise SystemExit("sandbox README model-experience marker not found")
    readme.write_text(readme_text.replace(old_marker, new_marker, 1))

# Browser authorization list must project disconnectability + provider telemetry.
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

# These were temporary migration/repair helpers, not release entry points.
for stale in ["scripts/plan-phoenix-scope-migration.ts", "scripts/promote-client-artifacts.ts"]:
    Path(stale).unlink(missing_ok=True)
