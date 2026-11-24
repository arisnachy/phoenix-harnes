// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { SpreadsheetSurface,SpreadsheetPatch,type SpreadsheetSpec,type SpreadsheetPatchSpec } from '../src/client/chat/SpreadsheetSurface.tsx'
const spec:SpreadsheetSpec={component:'spreadsheet',version:1,props:{id:'studio-budget',title:'Budget',columns:['Concept','Budget','Spent','Remaining'],rows:[['Food','8000','7200','=B2-C2']]}}
const patch:SpreadsheetPatchSpec={component:'spreadsheet_patch',version:1,props:{id:'studio-budget',edits:[{cell:'B2',before:'8000',after:'900'}]}}
beforeEach(()=>localStorage.clear())
afterEach(()=>cleanup())
describe('Live Studio',()=>{
 it('opens the existing sheet in the upper host, keeps the composer and returns after verified edits',()=>{
  render(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/><SpreadsheetPatch spec={patch} conversationId="session-a"/><div data-composer-seat=""><textarea aria-label="Chat"/></div></div>)
  const composer=screen.getByRole('textbox',{name:'Chat'})
  fireEvent.click(screen.getByRole('button',{name:'Abrir editor'}))
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).not.toBeNull()
  expect(screen.getByRole('textbox',{name:'Chat'})).toBe(composer)
  expect(screen.getByRole('textbox',{name:'Barra de fórmulas'})).toBeDefined()
  fireEvent.click(screen.getByRole('button',{name:'Aplicar a la hoja actual'}))
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).toBeNull()
  expect(screen.getByRole('textbox',{name:'Chat'})).toBe(composer)
  expect((screen.getByRole('textbox',{name:'B2'}) as HTMLInputElement).value).toBe('900')
  expect((screen.getByRole('textbox',{name:'D2'}) as HTMLInputElement).value).toBe('-6300')
 })
 it('keeps a pinned sheet open and pastes a range without creating another workbook',()=>{
  render(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/><SpreadsheetPatch spec={patch} conversationId="session-a"/></div>)
  fireEvent.click(screen.getByRole('button',{name:'Abrir editor'}))
  fireEvent.click(screen.getByRole('checkbox',{name:'Mantener abierto'}))
  fireEvent.click(screen.getByRole('button',{name:'Aplicar a la hoja actual'}))
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).not.toBeNull()
  fireEvent.paste(screen.getByRole('textbox',{name:'B2'}),{clipboardData:{getData:()=> '1000\t8000'}})
  expect((screen.getByRole('textbox',{name:'D2'}) as HTMLInputElement).value).toBe('-7000')
 })
})
