// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {SpreadsheetSurface,SpreadsheetPatch,type SpreadsheetSpec,type SpreadsheetPatchSpec} from '../src/client/chat/SpreadsheetSurface.tsx'
const spec:SpreadsheetSpec={component:'spreadsheet',version:1,props:{id:'monthly-budget',title:'Budget',columns:['Concept','Budget','Spent','Remaining'],rows:[['Food','8000','7200','=B2-C2']]}}
const patch:SpreadsheetPatchSpec={component:'spreadsheet_patch',version:1,props:{id:'monthly-budget',edits:[{cell:'B2',before:'8000',after:'900'}]}}
beforeEach(()=>localStorage.clear())
afterEach(()=>cleanup())
describe('live sheet editor',()=>{
  it('updates the already mounted sheet from a patch in another message and keeps the same grid',()=>{
    render(<><SpreadsheetSurface spec={spec} conversationId="session-a"/><SpreadsheetPatch spec={patch} conversationId="session-a"/></>)
    const original=screen.getByRole('textbox',{name:'B2'}) as HTMLInputElement
    expect(original.value).toBe('8000')
    fireEvent.click(screen.getByRole('button',{name:'Aplicar a la hoja actual'}))
    expect(screen.getByRole('textbox',{name:'B2'})).toBe(original)
    expect(original.value).toBe('900')
    expect((screen.getByRole('textbox',{name:'D2'}) as HTMLInputElement).value).toBe('-6300')
    expect(screen.getByRole('status').textContent).toContain('D2 = -6300')
    fireEvent.click(screen.getByRole('button',{name:'Deshacer'}))
    expect(original.value).toBe('8000')
  })
})
