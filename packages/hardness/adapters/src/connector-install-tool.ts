import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import {
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'

/** Host-owned install seam for registry-listed Streamable HTTP MCPs. */
export interface McpRegistryInstallerService {
  installMcpRegistryServer(request: { name: string; version?: string }): Promise<{
    status: 'installed' | 'already-installed'
    connector: {
      entryId: string
      serverName: string
      url: string
    }
  }>
}


/** Secret-free lifecycle state returned by the Host-owned official X MCP bundle. */
export interface XMcpHostSnapshot {
  readonly clientIdConfigured: boolean
  readonly clientSecretConfigured: boolean
  readonly api: {
    readonly configured: boolean
    readonly status?: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
    readonly reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
  }
  readonly phoenixApi: {
    readonly configured: boolean
    readonly status?: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
    readonly reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
  }
  readonly docs: {
    readonly configured: boolean
    readonly status?: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
    readonly reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
  }
}

/**
 * Project the secret-free Host lifecycle snapshot into the tool runtime's JSON
 * contract. Every field in XMcpHostSnapshot is already recursively JSON-safe;
 * this cast records that structural fact without cloning or adding branches.
 * @param state - Secret-free X MCP lifecycle state.
 * @returns The same snapshot under the generic tool JSON contract.
 */
function xMcpSnapshotJson(state: XMcpHostSnapshot): JsonValue {
  return state as unknown as JsonValue
}

/** Host operations for the exact official X API and Docs MCP pair. */
export interface XMcpHostService {
  xMcpState(): Promise<XMcpHostSnapshot>
  enableXMcp(options?: { identity?: 'user' | 'phoenix'; username?: string }): Promise<{
    api: { status: 'installed' | 'already-installed'; connector: { serverName: string; url: string } }
    docs: { status: 'installed' | 'already-installed'; connector: { serverName: string; url: string } }
  }>
}

/**
 * Create the user-approved MCP installer used after connector_discover.
 * Discovery metadata never becomes executable input: the tool passes only the
 * selected registry identity and the Host re-resolves the endpoint.
 * @param approval - Canonical PHOENIX approval service.
 * @param installer - Host-owned managed MCP installer.
 * @returns Model-facing connector installation tool.
 */
export function createConnectorInstallTool(
  approval: Pick<ApprovalService, 'request'>,
  installer: McpRegistryInstallerService,
): ToolDefinition {
  return defineTool({
    name: 'connector_install',
    description: 'Install a missing MCP only after connector_discover found it in the Official MCP Registry. This always asks the user for one-shot approval. Pass only the exact registry name/version; PHOENIX re-resolves the HTTPS endpoint Host-side and never executes an arbitrary GitHub URL or package from this tool.',
    parameters: {
      name: { type: 'string', required: true },
      version: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['installed', 'already-installed', 'denied'], required: true },
          serverName: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const name = args.name.trim()
      if (name.length < 2) throw new Error('connector_install requires an exact registry server name')
      if (exec.agent === undefined) throw new Error('connector_install requires an active agent session')
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'connector_install',
        callId: exec.callId,
        reason: `Install registry-listed MCP ${name}${args.version === undefined ? '' : ` @ ${args.version}`} into PHOENIX`,
        risk: 'medium',
        reversible: true,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') {
        return {
          status: 'denied' as const,
          message: `MCP installation was not approved (${outcome}).`,
        }
      }
      const receipt = await installer.installMcpRegistryServer({
        name,
        ...(args.version === undefined ? {} : { version: args.version }),
      })
      return {
        status: receipt.status,
        serverName: receipt.connector.serverName,
        message: receipt.status === 'installed'
          ? `Installed ${name}. Use connector_list to check whether it is ready or needs authorization.`
          : `${name} is already installed. Use connector_list to check its current authorization state.`,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Install MCP: ${args.name}`,
        kind: 'edit',
        rawInput: args.name,
      }
    },
  })
}

/**
 * Create the explicit activation tool for X's official MCP bundle. Activation
 * installs only the pinned X endpoints/bridge and never posts or mutates X data.
 * @param approval - Canonical PHOENIX approval service.
 * @param host - Optional Host-owned X MCP lifecycle service.
 * @returns Model-facing X MCP activation tool.
 */
export function createXMcpActivateTool(
  approval: Pick<ApprovalService, 'request'>,
  host?: Partial<XMcpHostService>,
): ToolDefinition {
  return defineTool({
    name: 'x_mcp_activate',
    description: 'Activate the official X MCP integration for either the user account or a separate Phoenix-owned X account. The user identity uses x-api; the Phoenix identity uses x-api-phoenix and xurl -u/--username so both OAuth users can coexist without mixing tokens. If the Phoenix identity does not exist yet and no username is known, begin the official X signup onboarding through Computer Use and stop for required human verification before activation.',
    parameters: {
      requestedByUser: { type: 'boolean', required: true, description: 'Must be true only when the user explicitly requested X/Twitter MCP access.' },
      identity: { type: 'string', enum: ['user', 'phoenix'], description: 'Which X identity Phoenix should connect. Defaults to user.' },
      username: { type: 'string', description: 'Required for the Phoenix-owned identity; optional for the user identity.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!args.requestedByUser) {
        return {
          status: 'denied',
          message: 'X MCP activation requires an explicit user request.',
        }
      }
      if (exec.agent === undefined) throw new Error('X MCP activation requires an active agent session')
      const identity = args.identity === 'phoenix' ? 'phoenix' : 'user'
      const username = args.username?.trim() || undefined
      if (host?.enableXMcp === undefined || host.xMcpState === undefined) {
        throw new Error('Official X MCP host integration is unavailable in this Phoenix runtime')
      }
      const currentState = await host.xMcpState()
      if (identity === 'phoenix' && username === undefined && currentState.phoenixApi.configured) {
        return {
          status: 'enabled',
          identity,
          credentialsReady: currentState.clientIdConfigured && currentState.clientSecretConfigured,
          state: xMcpSnapshotJson(currentState),
          message: 'Phoenix-owned X identity is already configured as x-api-phoenix.',
        }
      }
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'x_mcp_activate',
        callId: exec.callId,
        reason: identity === 'phoenix' && username === undefined
          ? 'Start one-time setup for a Phoenix-owned X account using the official X signup flow. Phoenix will use Computer Use and stop for any required human verification.'
          : `Enable the official X MCP for the ${identity === 'phoenix' ? 'Phoenix-owned' : 'user'} identity. This installs connector access only and performs no X account action.`,
        risk: 'medium',
        reversible: true,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') {
        return {
          status: 'denied',
          approvalOutcome: outcome,
          message: 'Official X MCP activation was not approved.',
        }
      }
      if (identity === 'phoenix' && username === undefined) {
        exec.deferContext(createUserMessage({
          content: [{
            type: 'text',
            text: 'Continue the approved Phoenix-owned X account onboarding now. Use the computer tool with browser_open to https://x.com/signup in the Phoenix embedded browser. Advance through the official signup flow using only information the user has already authorized. Stop and ask for human intervention when X requires email/SMS verification, CAPTCHA, MFA, acceptance of materially changed terms, or any other verification that must be completed by a person. After signup succeeds, inspect the resulting profile to determine the new X username. If X exposes its automated-account transparency/label setup, stop for the human owner to complete or confirm that linkage before autonomous social actions. Then call x_mcp_activate again with requestedByUser=true, identity="phoenix", and that username. Do not post, follow, DM, or perform any other X account action during setup.',
          }],
          source: { kind: 'plugin', plugin: 'x-mcp' },
        }))
        return {
          status: 'setup-required',
          identity,
          signupUrl: 'https://x.com/signup',
          requiresHumanVerification: true,
          state: xMcpSnapshotJson(currentState),
          message: 'Phoenix-owned X account setup is ready. Phoenix will continue in the official X signup flow and stop only when X requires human verification.',
        }
      }
      const receipt = await host.enableXMcp({
        identity,
        ...(username === undefined ? {} : { username }),
      })
      const state = await host.xMcpState()
      const credentialsReady = state.clientIdConfigured && state.clientSecretConfigured
      return {
        status: 'enabled',
        identity,
        api: receipt.api.status,
        docs: receipt.docs.status,
        credentialsReady,
        state: xMcpSnapshotJson(state),
        message: credentialsReady
          ? `Official X MCP is installed for the ${identity} identity. Complete the X browser authorization if xurl requests it; Phoenix can keep the user and Phoenix-owned accounts authorized separately.`
          : 'Official X MCP is installed. X Docs can work without credentials; X API needs X_CLIENT_ID and X_CLIENT_SECRET stored with the human-only /secret command before xurl can authorize.',
      }
    },
    presentCall() {
      return {
        card: 'generic',
        title: 'Enable official X MCP',
        kind: 'edit',
        rawInput: 'X',
      }
    },
  })
}
