// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { capturePresenceFrame } from '../src/client/presence-capture.ts'
const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices')
afterEach(()=>{
  if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor)
  else Reflect.deleteProperty(navigator,'mediaDevices')
})
function media(getDisplayMedia:unknown){Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia}})}
describe('user-selected presence frame',()=>{
  it('does not request screen access for a cancelled action',async()=>{
    const chooser=vi.fn()
    media(chooser)
    const controller=new AbortController();controller.abort()
    await expect(capturePresenceFrame(controller.signal)).rejects.toThrow('CAPTURE_CANCELLED')
    expect(chooser).not.toHaveBeenCalled()
  })
  it('stops every acquired track if the user cancels while the native chooser is open',async()=>{
    const stop=vi.fn()
    let release:(value:unknown)=>void=()=>undefined
    const chooser=vi.fn(()=>new Promise(resolve=>{release=resolve}))
    media(chooser)
    const controller=new AbortController()
    const capture=capturePresenceFrame(controller.signal)
    controller.abort()
    release({getTracks:()=>[{readyState:'live',stop}]})
    await expect(capture).rejects.toThrow('CAPTURE_CANCELLED')
    expect(chooser).toHaveBeenCalledWith({video:true,audio:false})
    expect(stop).toHaveBeenCalledOnce()
  })
  it('does not bypass the browser permission denial',async()=>{
    const chooser=vi.fn(async()=>{throw new DOMException('Denied','NotAllowedError')})
    media(chooser)
    await expect(capturePresenceFrame(new AbortController().signal)).rejects.toThrow('Denied')
    expect(chooser).toHaveBeenCalledOnce()
  })
})
