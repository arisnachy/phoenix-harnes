import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { admitVisualChart } from './visual-chart-contract.ts'

const VISUAL_TYPES = ['chart', 'table', 'metrics', 'timeline', 'cards', 'progress', 'sports', 'scoreboard', 'standings', 'visual'] as const

/** The connector registry owns present-tense MCP state; a model-created card is not a live probe. */
function requestsCurrentConnectorStatus(title: string): boolean {
  const normalized = title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  return /\b(?:mcp|conectores?|connectors?)\b/u.test(normalized)
    && /\b(?:estado|status|health|salud|diagnostico|diagnostics?|actual|current|live)\b/u.test(normalized)
}

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
    description: 'Present structured information as a rich inline Phoenix visual. For a simple line chart with explicitly fictional/sample data, use one direct phoenix_visualize call: title="Tendencia de ejemplo", visual={visualType:"chart",chartType:"line",demo:true}. It generates 7 clearly labeled simulated points locally; NO hardness_run, subagents, search, file writes or extra visual review are needed. For an explicitly fictional candlestick chart use {visualType:"chart",chartType:"candlestick",demo:true}; Phoenix supplies seven valid, labeled OHLC candles. For a real candlestick chart pass {visualType:"chart",chartType:"candlestick",candles:[{time:"2026-10-08",open:100,high:104,low:98,close:102}]} with authentic prices; data/rows and nested data.candles are also normalized. Never pass fabricated prices as real. For real non-OHLC charts, supply xKey, series and populated numeric data: {visualType:"chart",chartType:"line",xKey:"mes",series:[{dataKey:"valor",label:"Valor"}],data:[{mes:"Ene",valor:10},{mes:"Feb",valor:17}]}. Invalid or empty charts are rejected before publishing. Choose the smallest useful renderer for each request: charts (bar/line/area/scatter/pie/donut/candlestick), tables, metrics, timeline, cards, progress, sports/scoreboard, standings or visual. Tables accept columns with rows as arrays or keyed objects. Never pass blank placeholder rows or headers without verified data. For current connector/MCP status, use connector_list with target=mcp instead: it emits a truthful live status visual. phoenix_visualize rejects live MCP status summaries even when they contain apparently populated rows; do not construct or duplicate these tables. Prefer this over ASCII charts or dumping visualization JSON into prose. This tool is for data/structure only: never use it to imitate a requested photo, illustration, logo, hero, banner, or generated image with shapes or SVG-like artwork; use image_generation for real raster imagery. The visual is declarative and presentation-only. Once a self-contained chart is admitted and displayed, end the turn: no Phoenix Auto team admission, no independent reviewer and no repeated verification. Set continueAfterDisplay=true only when the user explicitly requests more work after showing the visual.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short user-facing title for the visual.',
      },
      continueAfterDisplay: {
        type: 'boolean',
        description: 'Default false: end the turn after the visual is published. True only for expressly requested subsequent work.',
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
            description: 'Primary renderer: chart, table, metrics, timeline, cards, progress, sports, scoreboard, standings, or visual.',
          },
        },
        description: 'Declarative Phoenix visual specification. For explicitly fictional line OR candlestick charts use demo:true to generate labeled synthetic data without another tool. Candlesticks support candles:[{time,open,high,low,close}], data or rows; other charts use xKey/series/data. Real charts accept chartType, xKey, series, and numeric data; other kinds accept their matching arrays such as metrics, rows, timeline, cards, or progress.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          visual: { type: 'json' },
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
          data: value.visual ?? args.visual,
          executable: false,
        },
      }),
    },
    async execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new Error('title must be a non-empty string')
      if (requestsCurrentConnectorStatus(title)) {
        throw new ToolArgsError([
          'Current MCP/connector status must be sourced from the real connector_list tool '
            + '(target=mcp), which automatically renders a live inventory artifact. '
            + 'Do not use phoenix_visualize to reproduce or invent MCP status tables.',
        ])
      }
      const admitted = admitVisualChart(args.visual)
      if (admitted.spec === undefined) {
        throw new ToolArgsError([admitted.error ?? 'Especificación de gráfica inválida.'])
      }
      const spec = admitted.spec
      const table = spec.visualType === 'table' || (spec.visualType === 'visual'
        && Array.isArray(spec.columns) && (Array.isArray(spec.rows) || Array.isArray(spec.data)))
      if (table) {
        const rows = Array.isArray(spec.rows) ? spec.rows : Array.isArray(spec.data) ? spec.data : []
        const populated = rows.some((row) => {
          const values: unknown[] = Array.isArray(row) ? row
            : typeof row === 'object' && row !== null ? Object.values(row as Record<string,unknown>) : []
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
      // A valid self-contained visual is complete; do not relaunch an agent review.
      if (args.continueAfterDisplay !== true) exec.concludeTurn()
      return {
        artifactId: `phoenix-visual:${String(exec.callId)}`,
        title,
        ...(spec === args.visual ? {} : { visual: spec as JsonValue }),
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
