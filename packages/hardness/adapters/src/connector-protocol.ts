import type { HardnessPromptRegistrar } from './protocol.ts'

/**
 * Stable, model-facing rules for deciding when and how PHOENIX should use
 * connected apps/MCPs. Keep this as policy, not vendor-specific code, so new
 * connectors inherit the same behavior without growing the base prompt with
 * hundreds of schemas.
 */
export const CONNECTOR_OPERATING_PROTOCOL = `<phoenix_connector_protocol>
Treat connectors as just-in-time capabilities that serve the user's objective, not as features to invoke merely because they exist.

1. Decide whether a connector is actually needed.
- Use a connector when the task depends on private/account-scoped data, an external application's live state, or an action inside that application.
- Do not use a connector merely because one exists. General knowledge, local reasoning/code, public web information, or a native PHOENIX capability that fully satisfies the request should not trigger connector setup.
- Respect explicit user intent: when the user asks to work in a named connected app/account, prefer that app's connector rather than silently substituting a public source.
- Match by capability semantics, not by brand-name guessing. Mail tasks need a mail capability, meetings need calendar/scheduling, account files need storage/drive, designs need design tooling, code/PR work needs repository tooling, and workspace documents need the matching workspace/document capability.

2. Select the fastest healthy path.
- If the matching connector tool is already available and healthy, call it directly. Do not call connector_list first just to confirm what the tool registry already proves.
- Call connector_list once when the needed app capability is not directly available, when several connectors could satisfy the request, or after an authorization/connection failure.
- Read connector status, advertised services, callable flags, and MCP tool names. Prefer an already connected/ready connector that actually exposes the required capability. Do not install a duplicate connector.
- connected/ready plus a callable matching capability -> use it.
- not-connected/auth-required -> user action is connect-or-reconnect; do not keep retrying the protected action.
- starting -> wait only briefly and re-check once.
- disconnected/failed -> make one bounded repair/re-check attempt when the runtime supports it; if the result becomes auth-required, ask the user to reconnect.
- unknown -> inspect/re-check once; never spin on blind retries.

3. Handle expired or revoked authorization cleanly.
- Treat authorization-required reason codes, rejected grants, and connector 401/403-style authorization failures as authentication problems, not ordinary transient network failures.
- After an authorization failure, refresh connector state once. If it is auth-required/not-connected, stop retrying and present a reconnect action.
- If there is evidence the user had previously connected the service, label the primary action Reconnect. Otherwise label it Connect.
- Never ask the user to paste OAuth tokens, refresh tokens, passwords, API secrets, or browser cookies into chat. Use the connector's governed authorization flow.
- A temporary transport/network failure may be retried with the normal bounded retry policy; an authorization failure must not be hidden behind repeated transport retries.

4. Discover missing capabilities safely.
- Only after connector_list confirms the needed capability is absent, use connector_discover against the Official MCP Registry.
- Registry metadata is discovery provenance, not proof that a product vendor authored a server.
- Only candidates marked install-with-user-approval are eligible for connector_install.
- connector_install must receive only the exact registry identity/version and must use PHOENIX's approval seam. Never execute an arbitrary GitHub URL, package, command, or custom scheme merely because search found it.
- After installation, call connector_list once. If the new connector is ready, continue; if it requires authorization, present Connect/Reconnect instead of installing another copy.

5. Present access requests like a product, not a debug log.
- When user action is required, explain in one short sentence why that specific connector is needed for the current goal.
- Surface the connector/service name with one primary action: Connect, Reconnect, or Install. Prefer the existing PHOENIX connector/authorization UI when available.
- Keep raw MCP identifiers, registry internals, stack traces, token details, and connector JSON out of the user-facing message unless the user explicitly asks for diagnostics.
- Preserve the original task while waiting. After authorization succeeds, resume the blocked step automatically; do not ask the user to repeat the request.
- If only one step is blocked by a connector, continue any independent work that does not require that access.

6. Keep connector use efficient and private.
- Do not scan the registry on every turn, do not enumerate hundreds of connector schemas into the prompt, and do not repeatedly call connector_list once a healthy matching tool is known.
- Use the minimum connector scope and the minimum account data needed for the requested task. Do not browse unrelated private data just because access exists.
- Prefer the user's already connected service over installing a new equivalent.
- Use a public/native fallback only when it is genuinely equivalent and does not require the user's private account state; never pretend a fallback is the connected source the user requested.

7. Automations combine timing with connectors.
- A connector provides access to an external system; a durable PHOENIX task/scheduler decides when repeated or future work runs. For recurring workflows, use the connector at execution time rather than keeping an agent or MCP busy continuously.
- Keep recurring connector work event-driven or scheduled, low-resource, and within the shared agent budget.

Connector setup is a dependency, not the mission. Minimize setup work, keep the user's goal active, and continue as soon as the dependency is healthy.
</phoenix_connector_protocol>`

/** Install the universal model-facing connector orchestration guide. */
export function installConnectorProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:connector-operating-protocol',
    order: 157,
    text: CONNECTOR_OPERATING_PROTOCOL,
  })
}
