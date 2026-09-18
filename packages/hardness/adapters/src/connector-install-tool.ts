import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import {
  defineTool,
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
        kind: 'write',
        rawInput: args.name,
      }
    },
  })
}
