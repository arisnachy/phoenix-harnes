// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { prepareSheetPrompt } from '../src/client/chat/active-sheet-context.ts'
import { SpreadsheetSurface,SpreadsheetPatch,evaluateSheetCell,type SpreadsheetSpec,type SpreadsheetPatchSpec } from '../src/client/chat/SpreadsheetSurface.tsx'
const spec:SpreadsheetSpec={component:'spreadsheet',version:1,props:{id:'studio-budget',title:'Budget',columns:['Concept','Budget','Spent','Remaining'],rows:[['Food','8000','7200','=B2-C2']]}}
const patch:SpreadsheetPatchSpec={component:'spreadsheet_patch',version:1,props:{id:'studio-budget',edits:[{cell:'B2',before:'8000',after:'900'}]}}
beforeEach(()=>localStorage.clear())
afterEach(()=>cleanup())
describe('Live Studio',()=>{
 it('opens the original sheet automatically, keeps composer anchored, and auto applies a later assistant edit',()=>{
  const {rerender}=render(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/><div data-composer-seat=""><textarea aria-label="Chat"/></div></div>)
  const composer=screen.getByRole('textbox',{name:'Chat'})
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).not.toBeNull()
  expect(screen.queryByRole('button',{name:'Abrir editor'})).toBeNull()
  expect(screen.getByRole('textbox',{name:'Barra de fórmulas'})).toBeDefined()
  const grant=prepareSheetPrompt('session-a','Cambia B2 a 900')!
  expect(grant.text).toContain('"revision":0')
  const livePatch={...patch,props:{...patch.props,expectedRevision:0,editToken:grant.token}}
  rerender(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/><SpreadsheetPatch spec={livePatch} conversationId="session-a" allowAuto/><div data-composer-seat=""><textarea aria-label="Chat"/></div></div>)
  expect(screen.getByRole('textbox',{name:'Chat'})).toBe(composer)
  expect((screen.getByRole('textbox',{name:'B2'}) as HTMLInputElement).value).toBe('900')
  expect((screen.getByRole('textbox',{name:'D2'}) as HTMLInputElement).value).toBe('-6300')
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).toBeNull()
 })
 it('keeps a pinned sheet open and pastes a range without creating another workbook',()=>{
  const {rerender}=render(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/></div>)
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).not.toBeNull()
  fireEvent.click(screen.getByRole('checkbox',{name:'Fijar editor'}))
  const grant=prepareSheetPrompt('session-a','Cambia B2 a 900')!
  expect(grant.text).toContain('"revision":0')
  const livePatch={...patch,props:{...patch.props,expectedRevision:0,editToken:grant.token}}
  rerender(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="session-a"/><SpreadsheetPatch spec={livePatch} conversationId="session-a" allowAuto/></div>)
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).not.toBeNull()
  fireEvent.paste(screen.getByRole('textbox',{name:'B2'}),{clipboardData:{getData:()=> '1000\t8000'}})
  expect((screen.getByRole('textbox',{name:'D2'}) as HTMLInputElement).value).toBe('-7000')
 })
 it('renders a historical sheet inline without automatically taking over the workspace or sending its contents',()=>{
  render(<div data-conversation-scroll=""><div data-live-studio-host=""/><SpreadsheetSurface spec={spec} conversationId="history" autoOpen={false}/></div>)
  expect(document.querySelector('[data-live-studio-host] > [data-live-studio]')).toBeNull()
  expect(screen.getByRole('textbox',{name:'B2'})).toBeDefined()
  expect(prepareSheetPrompt('history','Hello')).toBeUndefined()
 })
 it('recalculates numeric aggregates without counting blank and text cells',()=>{
  const rows=[['10',''],['',''],['text',''],['20','=AVERAGE(A2:A5)'],['','=COUNT(A2:A5)'],['','=ROUND(-12.345,2)'],['','=POWER(2,3)']]
  expect(evaluateSheetCell(rows,3,1)).toBe(15)
  expect(evaluateSheetCell(rows,4,1)).toBe(2)
  expect(evaluateSheetCell(rows,5,1)).toBe(-12.35)
  expect(evaluateSheetCell(rows,6,1)).toBe(8)
 })
})
