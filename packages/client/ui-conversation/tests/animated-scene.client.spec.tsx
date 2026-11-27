// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {parseCanvasSpec,GenerativeCanvas} from '../src/client/chat/GenerativeCanvas.tsx'
afterEach(cleanup)
const part={shape:'circle',attrs:{cx:50,cy:50,r:20,fill:'#f80'},motion:{kind:'pulse',duration:2}}
const scene={type:'animated_scene',label:'Corazón',width:120,height:120,parts:[part]}
const wrap=(node:unknown)=>({component:'ui_canvas',version:1,props:{title:'Escena',children:[node]}})
it('renders custom animated geometry and pauses locally',()=>{
 const spec=parseCanvasSpec(wrap(scene));if(!spec)throw Error('invalid scene')
 const {container}=render(<GenerativeCanvas spec={spec}/>)
 expect(screen.getByRole('img',{name:'Corazón'})).toBeTruthy()
 expect(container.querySelector('circle')?.getAttribute('r')).toBe('20')
 expect(container.querySelector('[data-motion="pulse"]')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Pausar'}))
 expect(container.querySelector('[data-paused="true"]')).toBeTruthy()
})
it('rejects executable attributes, external paints and unbounded scenes',()=>{
 for(const bad of [{...part,attrs:{...part.attrs,onClick:'alert(1)'}},{...part,attrs:{...part.attrs,fill:'url(https://evil.test)'}},{shape:'script',text:'alert(1)'},{...part,motion:{kind:'spin',duration:0}}])expect(parseCanvasSpec(wrap({...scene,parts:[bad]}))).toBeNull()
 expect(parseCanvasSpec(wrap({...scene,parts:Array(121).fill(part)}))).toBeNull()
})
