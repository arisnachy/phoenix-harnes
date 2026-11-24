import {describe,it,expect} from 'vitest'
import {createNativeWorkbook,projectNativeWorkbook,patchNativeWorkbook,validNativeWorkbook} from '../src/client/chat/native-workbook.ts'
describe('native Office workbook bridge',()=>{
 it('preserves other worksheets and raw formulas while editing the same workbook',()=>{
  const n=createNativeWorkbook('budget','Budget',['Concept','Budget','Spent','Rest'],[['Food','8000','7200','=B2-C2']])
  const sheets=n.workbook.sheets as Record<string,unknown>
  sheets.other={id:'other',name:'Other',rowCount:100,columnCount:26,cellData:{0:{0:{v:'Keep me'}}}}
  ;(n.workbook.sheetOrder as string[]).push('other')
  const p=patchNativeWorkbook(n,['Concept','Budget','Spent','Rest'],[['Food','900','7200','=B2-C2']],false)
  expect(p.workbook.id).toBe(n.workbook.id)
  expect((p.workbook.sheets as Record<string,unknown>).other).toEqual(sheets.other)
  expect(projectNativeWorkbook(p)?.rows[0]).toEqual(['Food','900','7200','=B2-C2'])
  expect(projectNativeWorkbook(n)?.rows[0]?.[1]).toBe('8000')
 })
 it('does not truncate unsupported worksheets or accept invalid identities',()=>{
  const n=createNativeWorkbook('budget','Budget',['A'],[['1']])
  const s=(n.workbook.sheets as Record<string,{cellData:Record<string,unknown>}>)[n.sheetId]!
  s.cellData['500']={0:{v:'valuable'}}
  expect(validNativeWorkbook(n)).toBe(true)
  expect(projectNativeWorkbook(n)).toBeNull()
  expect(()=>patchNativeWorkbook(n,['A'],[['2']],false)).toThrow('NATIVE_RANGE_UNSUPPORTED')
  expect(validNativeWorkbook({...n,sheetId:'__proto__'})).toBe(false)
 })
})
