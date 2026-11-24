import { describe, expect, it } from 'vitest'
import { parseSheetRecipe, replaySheetRecipe } from '../src/client/SheetDemonstration.ts'
describe('explicit spreadsheet demonstrations',()=>{
  it('replays structural actions on another sheet without retaining values or mutating input',()=>{
    const sheet={columns:[' A '],rows:[[' sample '],[' ']]}
    const steps=parseSheetRecipe(['trim','remove-empty-rows','append-column','append-row'])
    expect(replaySheetRecipe(sheet,steps)).toEqual({columns:['A','Columna 2'],rows:[['sample',''],['','']]})
    expect(sheet.rows).toEqual([[' sample '],[' ']])
    expect(JSON.stringify(steps)).not.toContain('sample')
  })
  it('rejects unknown actions and capacity overflow',()=>{
    expect(()=>parseSheetRecipe(['run-code'])).toThrow()
    expect(()=>parseSheetRecipe(Array(17).fill('trim'))).toThrow()
    expect(()=>replaySheetRecipe({columns:['a'],rows:Array(1000).fill([''])},['append-row'])).toThrow()
  })
})
