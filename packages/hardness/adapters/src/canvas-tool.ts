import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Dedicated MIME used to route Phoenix canvases into the visual workspace. */
export const PHOENIX_CANVAS_MIME = 'application/vnd.phoenix.canvas+html'

/**
 * Create Phoenix's model-facing interactive canvas artifact.
 *
 * A Phoenix canvas is an HTML mini-app or visual composition that must be
 * presented inside Phoenix itself. It is deliberately distinct from editor-
 * specific ".canvas.tsx" files or Cursor/Codex canvas folders.
 * @returns The interactive canvas tool definition.
 */
export function createPhoenixCanvasTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_canvas',
    description: 'Create and present an interactive canvas directly inside Phoenix when the user asks for a canvas, mini-app, interactive visual, HTML experience, mockup, or generative UI that should be visible in the app. The result opens in Phoenix\'s visual side workspace beside the chat. Do not create a Cursor/Codex .canvas.tsx file or tell the user to open an IDE unless they explicitly requested an editor file.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short user-facing canvas title.',
      },
      html: {
        type: 'string',
        required: true,
        description: 'Complete HTML or an HTML fragment for the canvas. Inline CSS and JavaScript are supported inside the sandbox.',
      },
      interactive: {
        type: 'boolean',
        description: 'Whether inline JavaScript controls should run. Defaults to true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Canvas ready in Phoenix: ${value.title}`,
      }],
      presentationMeta: (args, value) => ({
        artifact: {
          id: value.artifactId,
          mime: PHOENIX_CANVAS_MIME,
          title: value.title,
          data: args.html,
          executable: args.interactive !== false,
        },
      }),
    },
    // oxlint-disable-next-line typescript/require-await -- Tool execution requires Promise results and rejected validation errors.
    async execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new Error('title must be a non-empty string')
      if (args.html.trim().length === 0) throw new Error('html must be a non-empty string')
      return {
        artifactId: `phoenix-canvas:${String(exec.callId)}`,
        title,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Canvas · ${args.title}`,
        kind: 'read',
        rawInput: 'Phoenix visual workspace',
      }
    },
  })
}
