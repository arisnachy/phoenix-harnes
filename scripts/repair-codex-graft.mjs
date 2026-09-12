import { readFileSync, writeFileSync } from 'node:fs'

function read(path) { return readFileSync(path, 'utf8') }
function write(path, text) { writeFileSync(path, text) }
function replaceOnce(path, before, after) {
  const text = read(path)
  if (!text.includes(before)) throw new Error(`repair: expected text not found in ${path}: ${before.slice(0, 100)}`)
  if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`repair: expected unique text is duplicated in ${path}`)
  write(path, text.replace(before, after))
}
function insertAfter(path, anchor, addition) {
  const text = read(path)
  if (text.includes(addition.trim())) return
  if (!text.includes(anchor)) throw new Error(`repair: anchor not found in ${path}`)
  write(path, text.replace(anchor, `${anchor}${addition}`))
}

// Source-level alias for the Google broker subpath used by Cordis YAML.
insertAfter(
  'tsconfig.base.json',
  '      "@deepseek-ai/dsh-authorization/types": ["./packages/credentials/authorization/src/types.ts"],\n',
  '      "@deepseek-ai/dsh-authorization/google": ["./packages/credentials/authorization/src/google-broker.ts"],\n',
)

// Authorization public contract documentation.
replaceOnce(
  'packages/credentials/authorization/src/index.ts',
  `  /**\n   * Ask the owning flow to revoke/logout its provider session, then verify the\n   * corresponding credential marker is gone. A flow that exposes no teardown\n   * cannot be disconnected by deleting storage behind its back.\n   */\n  async disconnect(key: CredentialKey, signal?: AbortSignal): Promise<void> {`,
  `  /**\n   * Ask the owning flow to revoke/logout its provider session, then verify the\n   * corresponding credential marker is gone. A flow that exposes no teardown\n   * cannot be disconnected by deleting storage behind its back.\n   * @param key - credential record whose provider-owned session should be torn down.\n   * @param signal - optional cancellation signal for provider teardown.\n   */\n  async disconnect(key: CredentialKey, signal?: AbortSignal): Promise<void> {`,
)

// Google broker public JSDoc.
replaceOnce(
  'packages/credentials/authorization/src/google-broker.ts',
  '/** Resolve broker configuration without inventing scopes or a deployment identity. */\nexport function resolveGoogleSpec(config: Config): ResolvedSpec {',
  '/**\n * Resolve broker configuration without inventing scopes or a deployment identity.\n * @param config - deployment-owned OAuth client and requested scopes.\n * @returns validated immutable broker configuration.\n */\nexport function resolveGoogleSpec(config: Config): ResolvedSpec {',
)
replaceOnce(
  'packages/credentials/authorization/src/google-broker.ts',
  '  /** Secret-free telemetry exists only while this process owns a live grant. */\n  async inspect(): Promise<AuthorizationTelemetry | undefined> {',
  '  /**\n   * Secret-free telemetry exists only while this process owns a live grant.\n   * @returns sanitized Google Workspace service telemetry, or undefined while disconnected.\n   */\n  async inspect(): Promise<AuthorizationTelemetry | undefined> {',
)
replaceOnce(
  'packages/credentials/authorization/src/google-broker.ts',
  '  /** Execute one request inside a fixed Google service boundary. */\n  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {',
  '  /**\n   * Execute one request inside a fixed Google service boundary.\n   * @param request - service-relative request that cannot supply credential headers.\n   * @returns the secret-free Google response projection.\n   */\n  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {',
)
replaceOnce(
  'packages/credentials/authorization/src/google-broker.ts',
  '  /** Clear the process grant and secret-free marker even when provider revocation fails. */\n  async disconnect(): Promise<{ revoked: boolean }> {',
  '  /**\n   * Clear the process grant and secret-free marker even when provider revocation fails.\n   * @returns whether Google confirmed remote token revocation.\n   */\n  async disconnect(): Promise<{ revoked: boolean }> {',
)

// ExecPolicy public documentation.
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  `export type ExecPolicyDecision = 'allow' | 'prompt' | 'forbidden'\nexport type ExecPolicyPatternPart = string | readonly string[]\n\nexport interface ExecPolicyRule {`,
  `/** Final policy decision for one matching command prefix. */\nexport type ExecPolicyDecision = 'allow' | 'prompt' | 'forbidden'\n/** One literal token or a closed set of allowed alternatives at that token position. */\nexport type ExecPolicyPatternPart = string | readonly string[]\n\n/** Declarative lexical command-prefix rule with optional self-testing examples. */\nexport interface ExecPolicyRule {`,
)
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  'export interface ExecPolicyConfig {',
  '/** Configuration for the monotonic shell-command policy gate. */\nexport interface ExecPolicyConfig {',
)
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  'export interface CompiledExecPolicy {',
  '/** Validated runtime form of an ExecPolicy configuration. */\nexport interface CompiledExecPolicy {',
)
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  'export interface ExecPolicyEvaluation {',
  '/** Strictest decision selected for one command, with an optional user-facing rationale. */\nexport interface ExecPolicyEvaluation {',
)
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  '/** Compile and self-test an exec policy before it can affect live tools. */\nexport function compileExecPolicy(config: ExecPolicyConfig = {}): CompiledExecPolicy {',
  '/**\n * Compile and self-test an exec policy before it can affect live tools.\n * @param config - untrusted deployment configuration to validate and compile.\n * @returns immutable compiled matching state for runtime evaluation.\n */\nexport function compileExecPolicy(config: ExecPolicyConfig = {}): CompiledExecPolicy {',
)
replaceOnce(
  'packages/guard/timeout-policy/src/exec-policy.ts',
  `/** Evaluate one shell command without changing the surrounding policy chain. */\nexport function evaluateExecPolicy(\n  command: string,\n  policy: CompiledExecPolicy,\n): ExecPolicyEvaluation | undefined {`,
  `/**\n * Evaluate one shell command without changing the surrounding policy chain.\n * @param command - raw shell command supplied to the model-facing shell tool.\n * @param policy - compiled policy produced by {@link compileExecPolicy}.\n * @returns the strictest matching decision, or undefined when surrounding policy should decide.\n */\nexport function evaluateExecPolicy(\n  command: string,\n  policy: CompiledExecPolicy,\n): ExecPolicyEvaluation | undefined {`,
)

// Publish the exec-policy subpath instead of exporting a path that is omitted from the tarball.
{
  const path = 'packages/guard/timeout-policy/package.json'
  const value = JSON.parse(read(path))
  value.exports['./exec-policy'] = {
    types: './lib/types/exec-policy.d.ts',
    default: './lib/exec-policy.js',
  }
  if (!value.files.includes('lib/exec-policy.js')) value.files.splice(1, 0, 'lib/exec-policy.js')
  write(path, `${JSON.stringify(value, null, 2)}\n`)
}

// SDK high-level public API docs.
replaceOnce(
  'packages/sdk/client/src/api.ts',
  '  get client(): HarnessClient {',
  '  /** Underlying transport client owned by this reusable harness. */\n  get client(): HarnessClient {',
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  '  /** Whether the current runtime explicitly advertised one v2 lifecycle capability. */\n  supports(capability: keyof HarnessSdkCapabilities): boolean {',
  '  /**\n   * Whether the current runtime explicitly advertised one v2 lifecycle capability.\n   * @param capability - negotiated lifecycle capability to query.\n   * @returns true only when the runtime explicitly advertised support.\n   */\n  supports(capability: keyof HarnessSdkCapabilities): boolean {',
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  '  session(sessionId?: string): HarnessSession {',
  '  /** Create a lightweight handle for one stable SDK session id. */\n  session(sessionId?: string): HarnessSession {',
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  '  run(input: string | ContentBlock[], options?: RunOptions): Promise<RunResult> {',
  '  /** Run one prompt in a selected or newly minted session. */\n  run(input: string | ContentBlock[], options?: RunOptions): Promise<RunResult> {',
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  '  close(): Promise<void> {',
  '  /** Close the shared runtime transport owned by this harness. */\n  close(): Promise<void> {',
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  `  async run(input: string | ContentBlock[], options?: Pick<RunOptions, 'onNotification'>): Promise<RunResult> {`,
  `  /** Run one prompt and collect this session's notifications until it next becomes idle. */\n  async run(input: string | ContentBlock[], options?: Pick<RunOptions, 'onNotification'>): Promise<RunResult> {`,
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  `  /** Cancel this session's current activity without closing the runtime or discarding queued follow-up work. */\n  async interrupt(): Promise<SessionInterruptResult> {`,
  `  /**\n   * Cancel this session's current activity without closing the runtime or discarding queued follow-up work.\n   * @returns whether the session existed and whether it was actively running.\n   */\n  async interrupt(): Promise<SessionInterruptResult> {`,
)
replaceOnce(
  'packages/sdk/client/src/api.ts',
  `  /** Dispose this SDK-owned session while preserving the shared PHOENIX runtime for other sessions. */\n  async close(): Promise<SessionCloseResult> {`,
  `  /**\n   * Dispose this SDK-owned session while preserving the shared PHOENIX runtime for other sessions.\n   * @returns whether a live SDK-owned session was found and closed.\n   */\n  async close(): Promise<SessionCloseResult> {`,
)

// Codex bridge public API docs.
replaceOnce(
  'packages/subagent/subagent-codex/src/account.ts',
  'export async function readCodexAccountSnapshot(\n',
  '/** Read the native Codex account plus fail-soft quota, usage, and Apps metadata. */\nexport async function readCodexAccountSnapshot(\n',
)
replaceOnce(
  'packages/subagent/subagent-codex/src/account.ts',
  'export function registerCodexAccountFlow(\n',
  '/** Register the password-free native Codex/ChatGPT authorization flow with PHOENIX. */\nexport function registerCodexAccountFlow(\n',
)

// Existing structured-error public surface was missing repository-required JSDoc.
replaceOnce(
  'packages/client/ui-conversation/src/client/chat/structured-error.ts',
  'export interface StructuredErrorField {',
  '/** One bounded field promoted from a provider error payload into the friendly error card. */\nexport interface StructuredErrorField {',
)
replaceOnce(
  'packages/client/ui-conversation/src/client/chat/structured-error.ts',
  'export interface StructuredErrorPresentation {',
  '/** Safe, bounded presentation model for a structured provider failure. */\nexport interface StructuredErrorPresentation {',
)
replaceOnce(
  'packages/client/ui-conversation/src/client/chat/structured-error.ts',
  '/** Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs. */\nexport function translateGenericErrorProse(value: string): string {',
  '/**\n * Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs.\n * @param value - provider prose to translate conservatively.\n * @returns localized prose with identifiers and routing facts preserved.\n */\nexport function translateGenericErrorProse(value: string): string {',
)
replaceOnce(
  'packages/client/ui-conversation/src/client/chat/structured-error.ts',
  `/**\n * Convert a JSON-bearing error string into safe Spanish presentation data.\n * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n */\nexport function formatStructuredError(\n  input: string,\n  explicitCode?: string | number,\n): StructuredErrorPresentation | undefined {`,
  `/**\n * Convert a JSON-bearing error string into safe Spanish presentation data.\n * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n * @param input - bounded error text that may contain a JSON provider envelope.\n * @param explicitCode - optional trusted transport status overriding an embedded status.\n * @returns a safe structured presentation, or undefined when the input is not a supported envelope.\n */\nexport function formatStructuredError(\n  input: string,\n  explicitCode?: string | number,\n): StructuredErrorPresentation | undefined {`,
)

replaceOnce(
  'packages/host/apiproxy/src/fetch/client.ts',
  'export class InProcessApiClient extends AbstractApiClient {',
  '/** Fetch-carrier client that invokes an in-process WHATWG fetch handler without opening a socket. */\nexport class InProcessApiClient extends AbstractApiClient {',
)

// Complete the host AuthorizationApi: project live sanitized telemetry and provider teardown.
replaceOnce(
  'packages/host/apiproxy/src/api-proxy.ts',
  `        const entries = await Promise.all(authorization.list().map(async (entry) => {\n          let stored: { kind: 'api-key' | 'grant' } | undefined\n          if (credentials !== undefined) {\n            try {\n              const info = await credentials.describeRecord(parseCredentialKey(String(entry.key)))\n              if (info.configured && info.kind !== undefined) stored = { kind: info.kind }\n            } catch {\n              // The key did not address a record this deployment stores; leave stored off.\n            }\n          }\n          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...stored === undefined ? {} : { stored },\n          }\n        }))`,
  `        const entries = await Promise.all(authorization.list().map(async (entry) => {\n          let stored: { kind: 'api-key' | 'grant' } | undefined\n          let telemetry: Awaited<ReturnType<typeof authorization.inspect>> | undefined\n          const key = parseCredentialKey(String(entry.key))\n          if (credentials !== undefined) {\n            try {\n              const info = await credentials.describeRecord(key)\n              if (info.configured && info.kind !== undefined) stored = { kind: info.kind }\n            } catch {\n              // The key did not address a record this deployment stores; leave stored off.\n            }\n          }\n          try {\n            telemetry = await authorization.inspect(key)\n          } catch {\n            // Live provider inspection is optional/fail-soft; one provider cannot break the catalog.\n          }\n          return {\n            key: String(entry.key),\n            label: entry.label,\n            methods: entry.methods.map(method => ({ id: method.id, label: method.label })),\n            inFlight: entry.inFlight,\n            ...(entry.disconnectable === true ? { disconnectable: true as const } : {}),\n            ...stored === undefined ? {} : { stored },\n            ...telemetry === undefined ? {} : { telemetry },\n          }\n        }))`,
)
replaceOnce(
  'packages/host/apiproxy/src/api-proxy.ts',
  `      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n    },`,
  `      cancel(request) {\n        const attempt = authorizationAttempts.get(request.payload.attemptId)\n        if (attempt === undefined) {\n          return Promise.resolve(err(request, {\n            code: 'internal', message: 'authorization attempt was not found', details: {},\n          }))\n        }\n        if (attempt.status === 'pending') {\n          rejectAuthorizationPrompt(attempt, new AuthorizationDeclinedError('authorization was cancelled'))\n          attempt.controller.abort()\n          ctx.get('authorization')?.cancel(parseCredentialKey(attempt.key))\n        }\n        return Promise.resolve(ok(request, { cancelled: true as const }))\n      },\n\n      async disconnect(request, signal) {\n        const authorization = ctx.get('authorization')\n        if (authorization === undefined) {\n          return err(request, {\n            code: 'internal',\n            message: 'authorization service is absent: this deployment does not mount an authorization provider',\n            details: {},\n          })\n        }\n        let key: ReturnType<typeof parseCredentialKey>\n        try {\n          key = parseCredentialKey(request.payload.key)\n        } catch {\n          return err(request, { code: 'internal', message: 'authorization key is invalid', details: {} })\n        }\n        try {\n          await authorization.disconnect(key, signal)\n          return ok(request, { disconnected: true as const })\n        } catch (error: unknown) {\n          return err(request, {\n            code: 'internal',\n            message: error instanceof Error ? error.message : String(error),\n            details: {},\n          })\n        }\n      },\n    },`,
)

// Test fixtures must satisfy the complete AuthorizationApi contract.
replaceOnce(
  'packages/host/apiproxy/tests/client-handler.spec.ts',
  `      cancel: err,\n      ...overrides.authorization,`,
  `      cancel: err,\n      disconnect: err,\n      ...overrides.authorization,`,
)
replaceOnce(
  'packages/host/apiproxy/tests/fetch-carrier.spec.ts',
  `      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },`,
  `      async cancel(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n      async disconnect(request) {\n        return { rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'stub', details: {} } } }\n      },\n    },`,
)

// Keep type-equiv docs byte-equivalent to the authoritative source JSDoc.
replaceOnce(
  'docs/subsystems/sandbox.md',
  '  /** Explicit approved mode override, which outranks session policy. */\n  mode?: SandboxMode',
  '  /** Explicit approved mode override, which outranks session policy but not HARDNESS runtime protection. */\n  mode?: SandboxMode',
)

// README model-experience grammar permits only titled H5 + markdown fences after the explanatory paragraph.
replaceOnce(
  'packages/sandbox/sandbox-policy/README.md',
  'With launcher HARDNESS protection active, the same contribution states that the live PHOENIX runtime and data home are protected and directs self-modification to the isolated evolution worktree.\n',
  'With launcher HARDNESS protection active, the same contribution states that the live PHOENIX runtime and data home are protected, directs self-modification to the isolated evolution worktree, and makes danger-full-access reachable only when launcher HARDNESS protection is absent.\n',
)
replaceOnce(
  'packages/sandbox/sandbox-policy/README.md',
  '\nThe `danger-full-access` text is reachable only when launcher HARDNESS protection is absent. A protected PHOENIX launch resolves model-controlled full access to `workspace-write` before this context is rendered.\n',
  '\n',
)

// These two operator tools are intentional executable entrypoints; make that ownership explicit to Knip.
{
  const path = 'package.json'
  const value = JSON.parse(read(path))
  value.scripts['plan:phoenix-scope-migration'] = 'tsx scripts/plan-phoenix-scope-migration.ts'
  value.scripts['promote:client-artifacts'] = 'tsx scripts/promote-client-artifacts.ts'
  write(path, `${JSON.stringify(value, null, 2)}\n`)
}

console.log('repair-codex-graft: deterministic source repairs applied')
