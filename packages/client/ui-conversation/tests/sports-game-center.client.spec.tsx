// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { SportsGameCenter,parseEspnGamePlays } from '../src/client/chat/SportsGameCenter.tsx'
import { espnLiveSummaryUrl } from '../src/client/chat/SportsLive.tsx'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('compact ESPN game center',()=>{
  it('validates ESPN-only game identifiers and league',()=>{
    expect(espnLiveSummaryUrl('soccer','MLS','12345')).toBe('https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=12345')
    expect(espnLiveSummaryUrl('soccer','https://evil.test','12345')).toBeNull()
    expect(espnLiveSummaryUrl('soccer','MLS','../123')).toBeNull()
  })
  it('preserves actual plays, excludes missing descriptions and deduplicates IDs',()=>{
    expect(parseEspnGamePlays({ plays:[
      { id:'1',text:'Kick off',clock:{ displayValue:'0:00' } },
      { id:'2',text:'Goal',team:{ displayName:'FC Dallas' },awayScore:1,homeScore:0 },
      { id:'2',text:'Goal' },
      { id:'3',html:'<iframe/>' },
    ] })).toMatchObject([{ id:'2',text:'Goal',score:'1 – 0' },{ id:'1',text:'Kick off' }])
  })
  it('does not fetch until opened, then renders only ESPN responses',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({ plays:[{ id:'100',text:'Two-point shot' }] }),{ status:200 }))
    vi.stubGlobal('fetch',fetcher)
    render(<SportsGameCenter sport="basketball" league="nba" eventId="40183001" phase="in"/>)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{ name:/Seguir partido/ }))
    await waitFor(()=>{expect(screen.getByText('Two-point shot')).toBeTruthy()})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts the ESPN request when the user closes the game center',async()=>{
    const signals:AbortSignal[]=[]
    vi.stubGlobal('fetch',vi.fn((_url:unknown,init:RequestInit)=>{
      if(init.signal)signals.push(init.signal)
      return new Promise<Response>(()=>{})
    }))
    render(<SportsGameCenter sport="basketball" league="nba" eventId="40183001" phase="post"/>)
    fireEvent.click(screen.getByRole('button',{ name:/Seguir partido/ }))
    await waitFor(()=>{expect(signals).toHaveLength(1)})
    fireEvent.click(screen.getByRole('button',{ name:/Cerrar seguimiento/ }))
    expect(signals[0]?.aborted).toBe(true)
  })
  it('shows a timeout error rather than leaving the ESPN loading indicator stuck',async()=>{
    vi.useFakeTimers()
    try{
      vi.stubGlobal('fetch',vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
        init.signal?.addEventListener('abort',()=>{reject(new DOMException('Aborted','AbortError'))},{ once:true })
      })))
      render(<SportsGameCenter sport="basketball" league="nba" eventId="40183001" phase="post"/>)
      fireEvent.click(screen.getByRole('button',{ name:/Seguir partido/ }))
      await act(async()=>{await vi.advanceTimersByTimeAsync(9000)})
      expect(screen.getByText(/ESPN no respondió/)).toBeTruthy()
      expect(screen.queryByText(/Consultando cronología/)).toBeNull()
      expect(screen.queryByText(/ESPN no publicó jugadas/)).toBeNull()
    }finally{vi.useRealTimers()}
  })
  it('ignores a delayed timeout rejection from a closed ESPN request',async()=>{
    vi.useFakeTimers()
    try{
      let rejectFirst:((error:Error)=>void)|undefined
      let requests=0
      vi.stubGlobal('fetch',vi.fn(()=>{
        requests++
        if(requests===1)return new Promise<Response>((_resolve,reject)=>{rejectFirst=reject})
        return Promise.resolve(new Response(JSON.stringify({ plays:[{ id:'new',text:'Latest confirmed play' }] }),{ status:200 }))
      }))
      render(<SportsGameCenter sport="basketball" league="nba" eventId="40183001" phase="post"/>)
      fireEvent.click(screen.getByRole('button',{ name:/Seguir partido/ }))
      expect(requests).toBe(1)
      fireEvent.click(screen.getByRole('button',{ name:/Cerrar seguimiento/ }))
      fireEvent.click(screen.getByRole('button',{ name:/Seguir partido/ }))
      await act(async()=>{await Promise.resolve();await Promise.resolve()})
      expect(screen.getByText('Latest confirmed play')).toBeTruthy()
      await act(async()=>{await vi.advanceTimersByTimeAsync(9000)})
      await act(async()=>{rejectFirst?.(new Error('Late abort'));await Promise.resolve()})
      expect(screen.queryByText(/ESPN no respondió/)).toBeNull()
      expect(screen.getByText('Latest confirmed play')).toBeTruthy()
    }finally{vi.useRealTimers()}
  })
  it('does not treat MLB gamePk as a confirmed ESPN event ID',()=>{
    render(<SportsGameCenter sport="baseball" league="MLB" eventId="849802" phase="in"/>)
    expect(screen.queryByRole('button',{ name:/Seguir partido/ })).toBeNull()
  })
})
