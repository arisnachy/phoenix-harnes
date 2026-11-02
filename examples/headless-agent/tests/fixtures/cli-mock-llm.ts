import type { Context } from '@phoenix-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@phoenix-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless headless-agent adapter: deterministic tool calls followed by a final answer. */
class CliMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (process.env.DSH_CLI_MOCK_FAILURE === '1') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'CLI mock provider failed' } } }
      return
    }
    const toolResult = options.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      if (process.env.DSH_CLI_MOCK_CONNECTOR_INVENTORY === '1') {
        const inventoryTool = options.tools?.find(tool => tool.name === 'connector_list')
        if (inventoryTool === undefined) throw new Error('connector_list was not mounted in the assembled profile')
        const args = '{}'
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: CallId('cli-connector-inventory-call'), name: inventoryTool.name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-connector-inventory-call'), name: inventoryTool.name, arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const shellTool = options.tools?.some(tool => tool.name === 'pwsh') === true ? 'pwsh' : 'bash'
      const args = JSON.stringify({
        command: 'node -e "process.stdout.write(\'CLI_TOOL_ROUND_TRIP\')"',
        description: 'Prove the CLI tool round trip.',
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('cli-smoke-call'), name: shellTool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-smoke-call'), name: shellTool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = process.env.DSH_CLI_MOCK_CONNECTOR_INVENTORY === '1'
      ? `CONNECTOR_INVENTORY_OK:${toolText.trim()}`
      : `CLI tool round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'cli-mock-llm'
export const inject = ['llm']

/** Register the keyless `cli-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CliMockAdapter())
  ctx.on('agent/request', async ({ step }, next) => {
    const config = await next()
    return step === 2 ? { ...config, reasoningEffort: OFF } : config
  })
}
