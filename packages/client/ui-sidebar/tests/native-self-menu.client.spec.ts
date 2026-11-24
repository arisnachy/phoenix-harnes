// @vitest-environment jsdom
import { describe,it,expect,beforeEach } from 'vitest'
import { NATIVE_MENU_KEY, NATIVE_CHECKPOINT_KEY, readNativeMenu, nativeMenuOperation, parseNativeMenuCommand, recoverNativeMenu } from '../src/client/NativeSelfMenu.ts'
const cmd=(menuAction:string,extra:Record<string,unknown>={})=>({appId:'general',operation:'native-menu',menuAction,...extra})
beforeEach(()=>{localStorage.removeItem(NATIVE_MENU_KEY);localStorage.removeItem(NATIVE_CHECKPOINT_KEY)})
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

describe('automatic native self recovery',()=>{
  it('recovers a validated checkpoint without accepting malformed storage or stale commands',()=>{
    nativeMenuOperation(localStorage,cmd('add',{sectionId:'shortcut-clinic',target:'healthia',label:'Clínica',expectedRevision:0}),true)
    localStorage.setItem(NATIVE_MENU_KEY,'{corrupt')
    const recovery=recoverNativeMenu(localStorage,100)
    expect(recovery.status).toBe('restored')
    expect(recovery.state.revision).toBe(100)
    expect(recovery.state.entries.at(-1)?.id).toBe('shortcut-clinic')
    expect(readNativeMenu(localStorage)).toEqual(recovery.state)
    expect(()=>nativeMenuOperation(localStorage,cmd('rename',{sectionId:'home',label:'Inicio',expectedRevision:1}),true)).toThrow('STALE')
    expect(recoverNativeMenu(localStorage,101).status).toBe('healthy')
  })
  it('falls back to protected defaults if every copy is corrupt',()=>{
    localStorage.setItem(NATIVE_MENU_KEY,'{broken')
    localStorage.setItem(NATIVE_CHECKPOINT_KEY,'{"entries":[]}')
    const result=recoverNativeMenu(localStorage,500)
    expect(result.status).toBe('defaulted')
    expect(result.state.entries).toHaveLength(5)
    expect(readNativeMenu(localStorage).revision).toBe(500)
  })
  it('does not claim repair when storage cannot persist',()=>{
    const store={getItem:()=>'{bad',setItem:()=>{throw Error('denied')}}
    expect(recoverNativeMenu(store,100).status).toBe('unavailable')
  })
})

describe('native menu transaction safety',()=>{
  it('refuses to modify the menu if the recovery checkpoint cannot be saved',()=>{
    const data=new Map<string,string>()
    const store={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(key===NATIVE_CHECKPOINT_KEY)throw Error('disk full');data.set(key,value)}}
    expect(()=>nativeMenuOperation(store,cmd('rename',{sectionId:'home',label:'New',expectedRevision:0}),true)).toThrow()
    expect(store.getItem(NATIVE_MENU_KEY)).toBeNull()
  })
  it('restores the old configuration after a corrupt write and invalidates the failed revision',()=>{
    const data=new Map<string,string>()
    let corrupt=true
    const store={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{
      if(key===NATIVE_MENU_KEY&&corrupt){corrupt=false;data.set(key,'{corrupt');return}
      data.set(key,value)
    }}
    expect(()=>nativeMenuOperation(store,cmd('rename',{sectionId:'home',label:'New',expectedRevision:0}),true)).toThrow('NATIVE_MENU_CHANGE_REVERTED')
    expect(readNativeMenu(store).revision).toBe(2)
    expect(readNativeMenu(store).entries[0]?.label).toBeUndefined()
  })
})
