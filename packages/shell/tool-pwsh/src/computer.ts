/**
 * Product-facing Windows Computer Use registration.
 *
 * The native action driver stays in `computer-core.ts`; this layer adds
 * routing guidance and a text-only observation path so desktop screenshots
 * remain useful even when the active model cannot accept image input.
 *
 * @module @phoenix-ai/dsh-tool-pwsh/computer
 */

import type { Context } from '@phoenix-ai/cordis'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SandboxMode } from '@phoenix-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@phoenix-ai/dsh-sandbox-policy'
import { defineTool, type ToolRunContext } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-user-approval'
import {
  assertComputerActionAllowed,
  computerModeForSandbox,
  runWindowsComputerAction,
  validateComputerArgs,
} from './computer-core.ts'
import type { ComputerAction, ComputerToolArgs } from './computer-core.ts'
import { formatVisibleWindows, runWindowsVisibleWindows } from './computer-observation.ts'

export {
  assertComputerActionAllowed,
  computerModeForSandbox,
  runWindowsComputerAction,
  validateComputerArgs,
  windowsComputerInvocation,
} from './computer-core.ts'
export type { ComputerAction, ComputerButton, ComputerMode, ComputerToolArgs } from './computer-core.ts'
export {
  formatVisibleWindows,
  parseVisibleWindows,
  runWindowsVisibleWindows,
  visibleWindowsInvocation,
} from './computer-observation.ts'
export type { VisibleWindow, VisibleWindowsInvocation } from './computer-observation.ts'

interface DesktopImageAttachment {
  readonly width: number
  readonly height: number
}

interface AttachmentWriter {
  saveImage(input: { data: Buffer; mediaType: 'image/png'; name: string }): Promise<DesktopImageAttachment>
}

/** Model-facing routing law for desktop tasks. */
export const COMPUTER_USE_GUIDANCE = [
  'Computer Use routing on Windows:',
  '- If the user explicitly says "Computer Use", or asks about the OS desktop/screen, visible applications or windows, mouse, keyboard, clicking, typing, dragging, or scrolling outside a web page, use the `computer` tool directly.',
  '- Do not substitute `web-recon`, browser/Chrome tools or skills, or raw `pwsh` for desktop Computer Use.',
  '- For observe-only requests such as "take a screenshot", "what applications are visible", or "do not click or type", call only `computer` with action `screenshot`.',
  '- `computer.screenshot` returns a textual visible-window inventory even when the active model cannot consume images. Use that inventory instead of asking the user what they see or falling back to OCR/PowerShell.',
  '- Use browser/web tools only for webpage/DOM tasks. Never guess desktop coordinates when a fresh `computer.screenshot` can ground them.',
].join('\n')

/**
 * Check explicit model modality metadata without optimistic guessing.
 * @param modalities - Input modalities declared by the resolved model.
 * @returns True only when image input is explicitly declared.
 */
export function declaresImageInput(modalities: readonly string[] | undefined): boolean {
  return modalities?.includes('image') === true
}

function attachmentWriter(ctx: Context): AttachmentWriter | undefined {
  return ctx.get('attachments') as AttachmentWriter | undefined
}

function inputRisk(action: ComputerAction): { risk: 'low' | 'medium' | 'high'; reversible: boolean } {
  if (action === 'move' || action === 'scroll') return { risk: 'low', reversible: true }
  if (action === 'click' || action === 'double_click' || action === 'drag') return { risk: 'medium', reversible: false }
  return { risk: 'high', reversible: false }
}

async function authorizeComputerAction(
  ctx: Context,
  exec: ToolRunContext,
  action: ComputerAction,
  sandboxMode: SandboxMode | undefined,
): Promise<void> {
  const mode = computerModeForSandbox(sandboxMode)
  assertComputerActionAllowed(mode, action)
  if (action === 'screenshot' || sandboxMode === 'danger-full-access') return
  const agent = exec.agent
  if (agent === undefined) throw new Error('Computer input requires an owning agent session')
  const approval = ctx.get('approval')
  if (approval === undefined) throw new Error('Computer input requires the approval service; refusing action')
  const risk = inputRisk(action)
  const outcome = await approval.request({
    agent,
    toolName: 'computer',
    callId: exec.callId,
    reason: `Allow PHOENIX to perform desktop ${action.replace('_', ' ')}?`,
    risk: risk.risk,
    reversible: risk.reversible,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(`Computer action "${action}" was not approved (${outcome}).`)
  }
}

async function currentModelSupportsImageInput(ctx: Context, exec: ToolRunContext): Promise<boolean> {
  const provider = exec.agent?.options.provider
  const model = exec.agent?.options.model
  if (provider === undefined || model === undefined) return false
  try {
    const info = await ctx.llm.resolveModelInfo(provider, model, exec.signal)
    return declaresImageInput(info.inputModalities)
  } catch {
    // Unknown or unavailable metadata must never inject an image into a text-only request.
    return false
  }
}

async function screenshotObservation(signal: AbortSignal): Promise<string> {
  try {
    return formatVisibleWindows(await runWindowsVisibleWindows(signal))
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : ''
    return `Desktop screenshot captured, but the visible-window inventory was unavailable${detail}.`
  }
}

/**
 * Register the model-facing Computer Use tool on Windows compositions.
 * @param ctx - PHOENIX composition carrying tools, model metadata, shell policy, and optional attachment/approval capabilities.
 */
export function registerComputerTool(ctx: Context): void {
  if (process.platform !== 'win32') return
  const sandboxPolicy: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  const deploymentDefault = ctx.shell.sandboxMode

  ctx.systemPrompt.section({
    name: 'tool:computer-routing',
    order: 103,
    text: COMPUTER_USE_GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'computer',
    description: 'Observe and control the Windows OS desktop with a closed action set. Prefer this tool whenever the user says Computer Use or asks about the desktop, visible apps/windows, mouse, keyboard, clicks, typing, dragging, or OS scrolling. `screenshot` captures the virtual desktop and returns a textual visible-window inventory that works for text-only models; image-capable models also receive the stored screenshot as context. Do not replace desktop tasks with web-recon, Chrome/browser skills, or raw PowerShell. read-only is observe-only; workspace-write allows input through approval; danger-full-access allows input without prompts.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['screenshot', 'move', 'click', 'double_click', 'drag', 'type', 'key', 'scroll'],
        description: 'Desktop operation to perform. Use screenshot for observation and visible-app/window discovery.',
      },
      x: { type: 'integer', description: 'Screen X coordinate. Required for move/click/double_click/drag; optional with scroll.' },
      y: { type: 'integer', description: 'Screen Y coordinate. Required for move/click/double_click/drag; optional with scroll.' },
      x2: { type: 'integer', description: 'Drag destination X coordinate.' },
      y2: { type: 'integer', description: 'Drag destination Y coordinate.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button; defaults to left.' },
      text: { type: 'string', description: 'Unicode text for the type action.' },
      keys: { type: 'string', description: 'Key or combo such as ENTER, CTRL+L, ALT+TAB, F5, or SHIFT+F10.' },
      delta: { type: 'integer', description: 'Mouse-wheel delta for scroll; positive scrolls up and negative scrolls down.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          status: { type: 'string', required: true, const: 'ok' },
          observation: { type: 'string' },
          imageContext: { type: 'string', enum: ['attached', 'stored', 'unavailable'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'screenshot'
          ? `${value.observation ?? 'Desktop screenshot captured.'}\nImage context: ${value.imageContext ?? 'unavailable'}.`
          : `Desktop ${value.action} completed.`,
      }],
    },
    async execute(args: ComputerToolArgs, exec) {
      validateComputerArgs(args)
      const session = exec.agent?.session
      const policy = sandboxPolicy?.resolve(session === undefined ? {} : { session })
      const sandboxMode = policy?.mode ?? deploymentDefault
      await authorizeComputerAction(ctx, exec, args.action, sandboxMode)

      if (args.action !== 'screenshot') {
        await runWindowsComputerAction(args, exec.signal)
        return { action: args.action, status: 'ok' as const }
      }

      if (exec.agent === undefined) throw new Error('Computer screenshot requires an owning agent session')
      const [output, observation] = await Promise.all([
        runWindowsComputerAction(args, exec.signal),
        screenshotObservation(exec.signal),
      ])
      if (output.length === 0) throw new Error('Computer screenshot driver returned no image bytes')
      const bytes = Buffer.from(output, 'base64')
      if (bytes.length === 0) throw new Error('Computer screenshot decoded to an empty image')

      const attachments = attachmentWriter(ctx)
      const attachment = attachments === undefined
        ? undefined
        : await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'phoenix-desktop.png' })
      const supportsImage = attachment !== undefined && await currentModelSupportsImageInput(ctx, exec)

      if (attachment !== undefined && supportsImage) {
        const imageBlock = { type: 'image', attachment } as unknown as ContentBlock
        exec.deferContext(createUserMessage({
          content: [
            { type: 'text', text: `PHOENIX desktop screenshot (${attachment.width}x${attachment.height}). ${observation}` },
            imageBlock,
          ],
          source: { kind: 'plugin', plugin: 'computer-use' },
        }))
      }

      return {
        action: args.action,
        status: 'ok' as const,
        observation,
        imageContext: attachment === undefined ? 'unavailable' as const : supportsImage ? 'attached' as const : 'stored' as const,
      }
    },
  }))
}
