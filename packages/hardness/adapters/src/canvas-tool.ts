import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Dedicated MIME used to route Phoenix canvases into the chat conversation. */
export const PHOENIX_CANVAS_MIME = 'application/vnd.phoenix.canvas+html'

/**
 * Create Phoenix's model-facing interactive canvas artifact.
 *
 * A Phoenix canvas is an HTML mini-app or visual composition that must be
 * presented inside Phoenix itself. It is deliberately distinct from editor-
 * specific ".canvas.tsx" files or Cursor/Codex canvas folders.
 * @returns Tool definition for self-contained, in-chat HTML experiences.
 */
export function createPhoenixCanvasTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_canvas',
    description: 'Create an inline HTML mini-app only when the user explicitly requests an HTML experience, an interactive app, web page, canvas application or mockup. NEVER use phoenix_canvas for an ordinary chart (line, bar, pie, time series) or data dashboard: prefer phoenix_visualize for structured charts, because external JS/CSS CDNs are blocked by the iframe security policy and may show an empty screen. A simple fictional chart is one phoenix_visualize call with chartType:line and demo:true. The canvas renders directly inside Phoenix, inside the chat conversation with automatic height; do not open a side workspace or editor file and do not create a Cursor/Codex .canvas.tsx file.',
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
          title: String(value.title),
          data: args.html,
          executable: args.interactive !== false,
        },
      }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new Error('title must be a non-empty string')
      if (args.html.trim().length === 0) throw new Error('html must be a non-empty string')
      return Promise.resolve({
        artifactId: `phoenix-canvas:${String(exec.callId)}`,
        title,
      })
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Canvas · ${args.title}`,
        kind: 'read',
        rawInput: 'Phoenix inline chat canvas',
      }
    },
  })
}
