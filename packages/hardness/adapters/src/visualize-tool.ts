import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

const VISUAL_TYPES = ['chart', 'table', 'metrics', 'timeline', 'cards', 'progress', 'visual'] as const

/**
 * Create Phoenix's model-facing rich visual presentation tool.
 *
 * The tool does not execute arbitrary code or grant permissions. It only
 * persists a declarative artifact payload that the conversation renderer owns.
 * @returns A model-facing tool definition that emits a replayable visual artifact.
 */
export function createPhoenixVisualizerTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_visualize',
    description: 'Present structured information as a rich inline Phoenix visual only from real populated data. Tables accept columns with rows as arrays or keyed objects. Never pass blank placeholder rows or headers without verified data. For current connector/MCP status FIRST run connector_list: its receipt already includes a live status visualization, so do not invent or duplicate an empty table. Prefer this over ASCII charts or dumping visualization JSON into prose. This tool is for data/structure only: never use it to imitate a requested photo, illustration, logo, hero, banner, or generated image with shapes or SVG-like artwork; use image_generation for real raster imagery. The visual is declarative and presentation-only.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short user-facing title for the visual.',
      },
      visual: {
        type: 'object',
        required: true,
        additionalProperties: true,
        properties: {
          visualType: {
            type: 'string',
            required: true,
            enum: VISUAL_TYPES,
            description: 'Primary renderer: chart, table, metrics, timeline, cards, progress, or visual.',
          },
        },
        description: 'Declarative Phoenix visual specification. Charts accept chartType, xKey, series, and data; other kinds accept their matching arrays such as metrics, rows, timeline, cards, or progress.',
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
        text: `Rich visual ready: ${String(value.title)}`,
      }],
      presentationMeta: (args, value) => ({
        artifact: {
          id: String(value.artifactId),
          mime: 'application/vnd.phoenix.visual+json',
          title: String(value.title),
          data: args.visual,
          executable: false,
        },
      }),
    },
    async execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new Error('title must be a non-empty string')
      const spec = args.visual
      const table = spec.visualType === 'table' || (spec.visualType === 'visual'
        && Array.isArray(spec.columns) && (Array.isArray(spec.rows) || Array.isArray(spec.data)))
      if (table) {
        const rows = Array.isArray(spec.rows) ? spec.rows : Array.isArray(spec.data) ? spec.data : []
        const populated = rows.some(row => {
          const values: unknown[] = Array.isArray(row) ? row
            : typeof row === 'object' && row !== null ? Object.values(row) : []
          return values.some(cell => cell !== null && cell !== undefined
            && (typeof cell !== 'string' || cell.trim().length > 0))
        })
        if (!populated) {
          throw new ToolArgsError([
            'The visual table has no populated rows. Query the real source first (connector_list for MCP), '
              + 'then submit a table with actual values. Never invent counts or placeholder rows.',
          ])
        }
      }
      return {
        artifactId: `phoenix-visual:${String(exec.callId)}`,
        title,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Visualize · ${args.title}`,
        kind: 'read',
        rawInput: args.visual.visualType,
      }
    },
  })
}
