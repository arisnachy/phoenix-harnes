// @vitest-environment jsdom
import { describe,it,expect,beforeEach } from 'vitest'
import { NATIVE_MENU_KEY, readNativeMenu, nativeMenuOperation, parseNativeMenuCommand } from '../src/client/NativeSelfMenu.ts'
const cmd=(menuAction:string,extra:Record<string,unknown>={})=>({appId:'general',operation:'native-menu',menuAction,...extra})
beforeEach(()=>localStorage.removeItem(NATIVE_MENU_KEY))
describe('native self navigation',()=>{
  it('inspects actual default entries without writing',()=>{
    expect(nativeMenuOperation(localStorage,cmd('inspect')).state.entries.map(e=>e.id)).toEqual(['home','tasks','connectors','team','library'])
    expect(localStorage.getItem(NATIVE_MENU_KEY)).toBeNull()
  })
  it('previews, applies, persists, reorders and restores a shortcut with revision checks',()=>{
    const add=cmd('add',{sectionId:'shortcut-clinic',target:'healthia',label:'Clínica',expectedRevision:0})
    expect(nativeMenuOperation(localStorage,add).state.revision).toBe(0)
    expect(localStorage.getItem(NATIVE_MENU_KEY)).toBeNull()
    expect(nativeMenuOperation(localStorage,add,true).state.revision).toBe(1)
    expect(readNativeMenu(localStorage).entries.at(-1)?.target).toBe('healthia')
    expect(()=>nativeMenuOperation(localStorage,add,true)).toThrow('STALE')
    nativeMenuOperation(localStorage,cmd('move',{sectionId:'shortcut-clinic',direction:'up',expectedRevision:1}),true)
    expect(readNativeMenu(localStorage).entries[4]?.id).toBe('shortcut-clinic')
    nativeMenuOperation(localStorage,cmd('restore',{expectedRevision:2}),true)
    expect(readNativeMenu(localStorage).entries.at(-1)?.id).toBe('shortcut-clinic')
    expect(nativeMenuOperation(localStorage,cmd('open',{sectionId:'shortcut-clinic'})).opened).toBe('healthia')
  })
  it('rejects protected removal, arbitrary destinations and injected fields',()=>{
    expect(()=>nativeMenuOperation(localStorage,cmd('remove',{sectionId:'home',expectedRevision:0}),true)).toThrow('PROTECTED')
    expect(parseNativeMenuCommand(cmd('add',{sectionId:'shortcut-evil',label:'Test',target:'https://example.com',expectedRevision:0}))).toBeNull()
    expect(parseNativeMenuCommand(cmd('inspect',{script:'evil'}))).toBeNull()
    localStorage.setItem(NATIVE_MENU_KEY,'{invalid')
    expect(readNativeMenu(localStorage).entries).toHaveLength(5)
    expect(()=>nativeMenuOperation(localStorage,cmd('inspect'))).toThrow()
  })
})
