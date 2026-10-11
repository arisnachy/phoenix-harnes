// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseScaleForm, scoreScale, ScaleForm } from '../src/client/chat/ScaleForm.tsx'
import {
  parseSpreadsheet, evaluateSheetCell, parseSheetCsv, exportSheetCsv, SpreadsheetSurface,
} from '../src/client/chat/SpreadsheetSurface.tsx'
import { parseGenerativeUiBlock, splitGenerativeUiText, GenerativeUi } from '../src/client/chat/GenerativeUi.tsx'
import { GenerativeCanvas, parseCanvasSpec } from '../src/client/chat/GenerativeCanvas.tsx'

afterEach(() => { cleanup(); localStorage.clear() })

const scale = {
  component: 'scale_form',
  version: 1,
  props: {
    title: 'Escala de práctica',
    description: 'Instrumento ficticio, no clínico.',
    items: [
      { id: 'q1', question: 'Concentración', options: [
        { label: 'Nunca', score: 0 }, { label: 'Siempre', score: 3 },
      ] },
      { id: 'q2', question: 'Organización', options: [
        { label: 'Nunca', score: 0 }, { label: 'Siempre', score: 3 },
      ] },
    ],
    bands: [
      { max: 2, label: 'Normal', tone: 'positive' },
      { max: 6, label: 'Revisar', tone: 'warning' },
    ],
  },
} as const
const workbook = {
  component: 'spreadsheet', version: 1, props: {
    id: 'inventario_demo', title: 'Inventario',
    columns: ['Producto', 'Cantidad', 'Precio', 'Total'],
    rows: [
      ['Guantes', '2', '150', '=B2*C2'],
      ['Mascarillas', '3', '80', '=B3*C3'],
      ['Suma', '', '', '=SUM(D2:D3)'],
    ],
  },
} as const

describe('interactive scales and spreadsheet', () => {
  it('validates bounded declarative scales and rejects executable or duplicate content', () => {
    const validated = parseScaleForm(scale)
    expect(validated).not.toBeNull()
    expect(parseGenerativeUiBlock(scale)).not.toBeNull()
    expect(parseScaleForm({ ...scale, props: { ...scale.props, onSubmit: 'alert(1)' } })).toBeNull()
    expect(parseScaleForm({ ...scale, props: { ...scale.props, items: [
      scale.props.items[0], scale.props.items[0],
    ] } })).toBeNull()
    expect(parseScaleForm({ ...scale, props: { ...scale.props, items: [
      { id: 'x', question: 'X', options: [{ label: 'A', score: NaN }, { label: 'B', score: 1 }] },
    ] } })).toBeNull()
  })

  it('scores locally and only when all items have responses', () => {
    const spec = parseScaleForm(scale)!
    expect(scoreScale(spec, {}).total).toBeNull()
    expect(scoreScale(spec, { q1: 3 })).toMatchObject({ answered: 1, total: null })
    expect(scoreScale(spec, { q1: 3, q2: 3 })).toMatchObject({
      answered: 2, total: 6, band: { label: 'Revisar' },
    })
    expect(scoreScale(spec, { q1: 0, q2: 0 }).band?.label).toBe('Normal')
    expect(scoreScale(spec, { q1: 500, q2: 0 }).total).toBeNull()
  })

  it('updates form results without handing a model a new turn and resets all answers', () => {
    render(<ScaleForm spec={parseScaleForm(scale)!} />)
    expect(screen.getByText('0 de 2 respuestas')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('1. Concentración'), { target: { value: '3' } })
    expect(screen.getByText('1 de 2 respuestas')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('2. Organización'), { target: { value: '3' } })
    expect(screen.getByText('Revisar')).not.toBeNull()
    expect(screen.getByText('6')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Reiniciar/ }))
    expect(screen.getByText('0 de 2 respuestas')).not.toBeNull()
    expect(screen.queryByText('Revisar')).toBeNull()
  })

  it('validates spreadsheet bounds and rejects script props', () => {
    expect(parseSpreadsheet(workbook)).not.toBeNull()
    expect(parseGenerativeUiBlock(workbook)).not.toBeNull()
    expect(parseSpreadsheet({ ...workbook, props: { ...workbook.props, onChange: 'script' } })).toBeNull()
    expect(parseSpreadsheet({ ...workbook, props: { ...workbook.props, rows: [['bad']] } })).toBeNull()
    expect(parseSpreadsheet({ ...workbook, props: { ...workbook.props, columns: Array(17).fill('A') } })).toBeNull()
  })

  it('evaluates numeric cell formulas, ranges and cycles without eval', () => {
    const rows = workbook.props.rows
    expect(evaluateSheetCell(rows, 0, 3)).toBe(300)
    expect(evaluateSheetCell(rows, 1, 3)).toBe(240)
    expect(evaluateSheetCell(rows, 2, 3)).toBe(540)
    expect(evaluateSheetCell([['=B2', '=A2']], 0, 0)).toBe('#CYCLE!')
    expect(evaluateSheetCell([['=1/0']], 0, 0)).toBe('#DIV/0!')
    expect(evaluateSheetCell([['=window.alert(1)']], 0, 0)).toBe('#ERR!')
    expect(evaluateSheetCell([['=SUM(A3:A5000)']], 0, 0)).toBe('#LIMIT!')
  })

  it('edits cells, recalculates totals and supports undo', () => {
    render(<SpreadsheetSurface spec={parseSpreadsheet(workbook)!} />)
    expect((screen.getByRole('textbox', { name: 'D4' }) as HTMLInputElement).value).toBe('540')
    fireEvent.change(screen.getByRole('textbox', { name: 'B2' }), { target: { value: '4' } })
    expect((screen.getByRole('textbox', { name: 'D4' }) as HTMLInputElement).value).toBe('840')
    fireEvent.click(screen.getByRole('button', { name: /Deshacer/ }))
    expect((screen.getByRole('textbox', { name: 'D4' }) as HTMLInputElement).value).toBe('540')
  })

  it('imports quoted CSV and guards exported values from formula injection', () => {
    expect(parseSheetCsv('"1,2","3"\r\n"4","5"', 2)).toEqual([['1,2', '3'], ['4', '5']])
    expect(parseSheetCsv('"unclosed,2', 2)).toBeNull()
    expect(exportSheetCsv(['A'], [['=cmd|evil'], ['normal']])).toContain("'=cmd|evil")
  })

  it('renders status pills, agent avatars and icons through the assistant parser', () => {
    expect(splitGenerativeUiText(JSON.stringify(scale)).map(x => x.kind)).toEqual(['ui'])
    expect(splitGenerativeUiText(JSON.stringify(workbook)).map(x => x.kind)).toEqual(['ui'])
    expect(parseGenerativeUiBlock({ component: 'agent_line', version: 1,
      props: { name: 'Kira', role: 'Orquestación', message: 'Listo', icon: 'bot' } })).not.toBeNull()
    expect(parseGenerativeUiBlock({ component: 'status_pill', version: 1,
      props: { label: 'Normal', tone: 'positive' } })).not.toBeNull()
    const spec = parseCanvasSpec({ component: 'ui_canvas', version: 1,
      props: { title: 'Estados', children: [
        { type: 'table', columns: ['Paciente', 'Estado'], rows: [['Ejemplo', 'Normal'], ['Ejemplo 2', 'Revisar']] },
        { type: 'icon', name: 'table', label: 'Tablas' },
      ] } })
    expect(spec).not.toBeNull()
    render(<GenerativeCanvas spec={spec!} />)
    expect(screen.getByText('Normal').closest('[data-tone="positive"]')).not.toBeNull()
    expect(screen.getByText('Revisar').closest('[data-tone="warning"]')).not.toBeNull()
    expect(screen.getByText('Tablas')).not.toBeNull()
    const agent = parseGenerativeUiBlock({ component: 'agent_line', version: 1,
      props: { name: 'Sol', role: 'Planificación', message: 'Módulos preparados', icon: 'brain' } })
    if (!agent) throw new Error('Invalid agent')
    render(<GenerativeUi block={agent} />)
    expect(screen.getByText('Sol')).not.toBeNull()
  })
})
