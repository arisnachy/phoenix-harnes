import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createPhoenixVisualizerTool } from '../src/visualize-tool.ts'

function execution(): ToolRunContext {
  const callId = CallId('visual-1')
  return {
    callId,
    rootCallId: callId,
    name: 'phoenix_visualize',
    arguments: {},
    token: Symbol('visual-tool') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

describe('phoenix_visualize tool', () => {
  it('creates a declarative visual artifact without execution authority', async () => {
    const tool = createPhoenixVisualizerTool()
    const args = {
      title: 'Service health',
      visual: {
        visualType: 'metrics',
        metrics: [{ label: 'Availability', value: '99.98%' }],
      },
    }

    const value = await tool.execute(args, execution()) as { artifactId: string; title: string }
    expect(value).toEqual({
      artifactId: 'phoenix-visual:visual-1',
      title: 'Service health',
    })

    expect(tool.output.presentationMeta?.(args, value as never)).toEqual({
      artifact: {
        id: 'phoenix-visual:visual-1',
        mime: 'application/vnd.phoenix.visual+json',
        title: 'Service health',
        data: args.visual,
        executable: false,
      },
    })
  })

  it('does not issue a successful artifact receipt for an empty MCP status table', async () => {
    const tool = createPhoenixVisualizerTool()
    await expect(tool.execute({
      title: 'Estado de conectores MCP',
      visual: { visualType: 'table', columns: ['Estado', 'Conectores', 'Cantidad'],
        rows: [{}, {}, {}] },
    }, execution())).rejects.toThrow('no populated rows')
    await expect(tool.execute({
      title: 'Estado de conectores MCP',
      visual: { visualType: 'table', columns: ['Estado', 'Conectores', 'Cantidad'], rows: [] },
    }, execution())).rejects.toThrow('no populated rows')
    await expect(tool.execute({
      title: 'Estado de conectores MCP',
      visual: { visualType: 'table', columns: ['Estado', 'Conectores', 'Cantidad'],
        rows: [{ Estado: 'Conectado', Conectores: 'GitHub', Cantidad: 1 }] },
    }, execution())).resolves.toMatchObject({ artifactId: 'phoenix-visual:visual-1' })
  })

  it('requires real connector_list state for any present-tense MCP dashboard', async () => {
    const tool = createPhoenixVisualizerTool()
    for (const title of [
      'Estado actual de conectores MCP',
      'Estado de conectores MCP',
      'MCP connection status',
      'Diagnóstico de conectores',
    ]) {
      await expect(tool.execute({
        title,
        visual: { visualType: 'table', columns: ['Estado', 'Cantidad'],
          rows: [['ready', 4]] },
      }, execution())).rejects.toThrow('must be sourced from the real connector_list tool')
    }
    await expect(tool.execute({
      title: 'Histórico mensual de adopción',
      visual: { visualType: 'table', columns: ['Mes', 'Cantidad'],
        rows: [['Septiembre', 4]] },
    }, execution())).resolves.toMatchObject({ artifactId: 'phoenix-visual:visual-1' })
  })

  it('creates a populated simulated line chart in one tool call without model repair', async () => {
    const tool = createPhoenixVisualizerTool()
    const args = {
      title: 'Tendencia ficticia',
      visual: { visualType: 'chart', chartType: 'line', demo: true },
    }
    const value = await tool.execute(args, execution()) as {
      artifactId: string
      title: string
      visual: { visualType: string; chartType: string; description: string; data: unknown[]; series: unknown[] }
    }
    expect(value.artifactId).toBe('phoenix-visual:visual-1')
    expect(value.visual.chartType).toBe('line')
    expect(value.visual.description).toContain('ficticios')
    expect(value.visual.data).toHaveLength(7)
    expect(value.visual.series).toHaveLength(1)
    expect(tool.output.presentationMeta?.(args, value as never)).toMatchObject({
      artifact: { data: { visualType: 'chart', chartType: 'line', simulated: true } },
    })
    expect(args.visual).toEqual({ visualType: 'chart', chartType: 'line', demo: true })
  })

  it('normalizes legacy chart shapes to populated, accurately typed line series', async () => {
    const tool = createPhoenixVisualizerTool()
    const list = [
      { visualType: 'chart', chartType: 'line', labels: ['Ene','Feb'], values: [10,18] },
      { visualType: 'visual', chartType: 'line', data: [['Ene',10],['Feb',18]] },
      { visualType: 'chart', chartType: 'line', data: { labels: ['Ene','Feb'],
        datasets: [{ label: 'Incidencia', data: [10,18] }] } },
      { visualType: 'chart', chartType: 'spline', xKey: 'mes',
        series: [{ dataKey: 'valor', label: 'Valor' }],
        data: [{ mes: 'Ene', valor: 10 }, { mes: 'Feb', valor: 18 }] },
    ]
    for (const visual of list) {
      const result = await tool.execute({ title: 'Serie histórica', visual }, execution()) as {
        visual: { chartType: string; visualType: string; data: Array<Record<string,unknown>> }
      }
      expect(result.visual.chartType).toBe('line')
      expect(result.visual.visualType).toBe('chart')
      expect(result.visual.data).toHaveLength(2)
    }
  })

  it('rejects empty or malformed real charts without publishing misleading artifacts', async () => {
    const tool = createPhoenixVisualizerTool()
    const list = [
      { visualType: 'chart', chartType: 'line' },
      { visualType: 'chart', chartType: 'line', data: [{ label: 'Ene', value: 5 }] },
      { visualType: 'chart', chartType: 'line', data: [{ label: 'Ene', value: 'invalid' },{ label: 'Feb', value: 20 }] },
      { visualType: 'chart', chartType: 'line', data: { labels: ['Ene'], datasets: [] } },
      { visualType: 'chart', chartType: 'unknown', demo: true },
    ]
    for (const visual of list) {
      await expect(tool.execute({ title: 'Datos reales', visual }, execution()))
        .rejects.toThrow()
    }
  })

  it('describes the visual surface clearly to the model', () => {
    const tool = createPhoenixVisualizerTool()
    expect(tool.name).toBe('phoenix_visualize')
    expect(tool.description).toContain('rich inline Phoenix visual')
    expect(tool.description).toContain('use image_generation for real raster imagery')
    expect(tool.parameters).toEqual(expect.objectContaining({
      type: 'object',
      required: ['title', 'visual'],
    }))
    expect(tool.parameters).toMatchObject({
      properties: { visual: { type: 'object', additionalProperties: true } },
    })
  })
})
