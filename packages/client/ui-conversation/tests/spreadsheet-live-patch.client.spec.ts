// @vitest-environment jsdom
import {describe,it,expect,beforeEach} from 'vitest'
import {applySpreadsheetPatch,parseSpreadsheetPatch,readSheetDraft,evaluateSheetCell} from '../src/client/chat/SpreadsheetSurface.tsx'
import {parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
const key='phoenix:sheet:v2:session-a:budget'
const patch={component:'spreadsheet_patch',version:1,props:{id:'budget',edits:[{cell:'B2',before:'8000',after:'900'}]}}
beforeEach(()=>{localStorage.clear();localStorage.setItem(key,JSON.stringify({columns:['Concept','Budget','Spent','Remaining'],rows:[['Food','8000','7200','=B2-C2'],['Transport','3000','3400','=B3-C3']],revision:0}))})
describe('in-place spreadsheet edits',()=>{
  it('patches the original draft and recalculates without changing unrelated rows',()=>{
    const spec=parseSpreadsheetPatch(patch)!
    expect(parseGenerativeUiBlock(patch)).toEqual(spec)
    const result=applySpreadsheetPatch(localStorage,key,spec)
    expect(result.draft.rows[0]).toEqual(['Food','900','7200','=B2-C2'])
    expect(result.draft.rows[1]).toEqual(['Transport','3000','3400','=B3-C3'])
    expect(result.recalculated).toContainEqual({cell:'D2',value:'-6300'})
    expect(readSheetDraft(localStorage,key)?.revision).toBe(1)
    expect(evaluateSheetCell(result.draft.rows,0,3)).toBe(-6300)
    expect(()=>applySpreadsheetPatch(localStorage,key,spec)).toThrow('SHEET_CONFLICT')
  })
  it('does not overwrite a manual edit or another conversation',()=>{
    const draft=readSheetDraft(localStorage,key)!
    draft.rows[0]![1]='1200'
    localStorage.setItem(key,JSON.stringify(draft))
    const raw=localStorage.getItem(key)
    expect(()=>applySpreadsheetPatch(localStorage,key,parseSpreadsheetPatch(patch)!)).toThrow('SHEET_CONFLICT')
    expect(localStorage.getItem(key)).toBe(raw)
    expect(()=>applySpreadsheetPatch(localStorage,'another-session',parseSpreadsheetPatch(patch)!)).toThrow('SHEET_NOT_FOUND')
  })
  it('rejects duplicate addresses, injected props and new invalid formulas',()=>{
    expect(parseSpreadsheetPatch({...patch,props:{...patch.props,edits:[patch.props.edits[0],patch.props.edits[0]]}})).toBeNull()
    expect(parseSpreadsheetPatch({...patch,props:{...patch.props,script:'bad'}})).toBeNull()
    const bad=parseSpreadsheetPatch({...patch,props:{...patch.props,edits:[{cell:'B2',before:'8000',after:'=1/0'}]}})!
    expect(()=>applySpreadsheetPatch(localStorage,key,bad)).toThrow('SHEET_FORMULA_ERROR')
    expect(readSheetDraft(localStorage,key)?.rows[0]?.[1]).toBe('8000')
  })
})

describe('structural edit of the existing workbook',()=>{
  it('builds a family budget from the single blank row shown in Studio and persists same identity',()=>{
    localStorage.setItem(key,JSON.stringify({columns:['Fecha','Concepto','Categoría','Monto','Notas'],rows:[['','','','','']],revision:0}))
    const layout={columns:['Concepto','Ingreso','Gasto','Balance'],rows:[['Salario','','','=B2-C2'],['Comida','','','=B3-C3'],['Transporte','','','=B4-C4'],['Total','=SUM(B2:B4)','=SUM(C2:C4)','=B5-C5']]}
    const spec=parseSpreadsheetPatch({component:'spreadsheet_patch',version:1,props:{id:'budget',expectedRevision:0,layout,edits:[]}})!
    expect(spec).not.toBeNull()
    const result=applySpreadsheetPatch(localStorage,key,spec)
    expect(result.draft.columns).toEqual(layout.columns)
    expect(result.draft.rows).toEqual(layout.rows)
    expect(result.draft.previousColumns).toEqual(['Fecha','Concepto','Categoría','Monto','Notas'])
    expect(result.draft.previous).toEqual([['','','','','']])
    expect(readSheetDraft(localStorage,key)?.revision).toBe(1)
    expect(evaluateSheetCell(result.draft.rows,3,3)).toBe(0)
    expect(()=>applySpreadsheetPatch(localStorage,key,spec)).toThrow('STALE')
  })
  it('appends rows only for empty expected values and rejects bad layouts atomically',()=>{
    const grow=parseSpreadsheetPatch({component:'spreadsheet_patch',version:1,props:{id:'budget',expectedRevision:0,edits:[{cell:'A4',before:'',after:'Savings'}]}})!
    expect(applySpreadsheetPatch(localStorage,key,grow).draft.rows[2]?.[0]).toBe('Savings')
    const raw=localStorage.getItem(key)
    const invalid=parseSpreadsheetPatch({component:'spreadsheet_patch',version:1,props:{id:'budget',expectedRevision:1,layout:{columns:['A'],rows:[['=1/0']]},edits:[]}})!
    expect(()=>applySpreadsheetPatch(localStorage,key,invalid)).toThrow('SHEET_FORMULA_ERROR')
    expect(localStorage.getItem(key)).toBe(raw)
  })
})
