// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { SportsNewsPanel } from '../src/client/chat/SportsNewsPanel.tsx'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const first={
  label:'Transfer rumors: Manchester United news',value:'2026-11-01T13:41:41Z',
  detail:'Several players are linked with a move to Old Trafford.',
  image:'https://a.espncdn.com/club-photo.png',
  href:'https://www.espn.com/soccer/story/_/id/12/example',
}
const second={
  label:'Liverpool host Arsenal in title race',value:'2026-11-01T11:16:49Z',
  detail:'Liverpool and Arsenal seek an important win.',
}
describe('Phoenix sports newsroom',()=>{
  it('renders compact image-first articles with readable local dates and neutral links',()=>{
    vi.stubGlobal('Translator',undefined)
    const {container}=render(<SportsNewsPanel title="Premier League · Inglaterra"
      articles={[first,second]}/>)
    expect(screen.getByRole('region',{name:'Noticias deportivas'})).toBeTruthy()
    expect(screen.getByText('Premier League · Inglaterra')).toBeTruthy()
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(first.image)
    expect(screen.getByRole('link',{name:'Leer noticia'}).getAttribute('href')).toBe(first.href)
    expect(screen.getAllByText(/nov/u).length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('2026-11-01T13:41:41Z')
    expect(container.textContent).not.toContain('Leer noticia en ESPN')
  })
  it('translates verified article text locally without sending it to a remote service',async()=>{
    const translator=vi.fn(async(text:string)=>
      text==='Transfer rumors: Manchester United news'
        ?'Rumores de fichajes: noticias del Manchester United'
        :text==='Several players are linked with a move to Old Trafford.'
          ?'Varios jugadores están vinculados con un posible fichaje por Old Trafford.'
          :text)
    vi.stubGlobal('Translator',{availability:vi.fn(async()=> 'available'),
      create:vi.fn(async()=>({translate:translator,destroy:vi.fn()}))})
    render(<SportsNewsPanel title="Premier League · Inglaterra" articles={[first]}/>)
    await waitFor(()=>expect(screen.getByText('Rumores de fichajes: noticias del Manchester United')).toBeTruthy())
    expect(screen.getByText('Varios jugadores están vinculados con un posible fichaje por Old Trafford.')).toBeTruthy()
    expect(translator).toHaveBeenCalledWith(first.label)
    expect(screen.queryByRole('button',{name:'Traducir titulares con Kira'})).toBeNull()
  })
  it('offers an explicit Kira translation action when no on-device model exists',()=>{
    vi.stubGlobal('Translator',undefined)
    const actions:string[]=[]
    render(<SportsNewsPanel title="Noticias" articles={[second]}
      onAction={(prompt,mode)=>{actions.push(prompt+'|'+mode)}}/>)
    fireEvent.click(screen.getByRole('button',{name:'Traducir titulares con Kira'}))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toContain(second.label)
    expect(actions[0]).toContain('draft')
    expect(screen.getByText(second.label)).toBeTruthy()
  })
})
