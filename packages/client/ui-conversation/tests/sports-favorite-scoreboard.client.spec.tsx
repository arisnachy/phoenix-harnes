// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,waitFor} from '@testing-library/react'
import {GenerativeUi,parseGenerativeUiBlock,sportsFavoriteSide} from '../src/client/chat/GenerativeUi.tsx'
import {importSportsReceipt} from '../src/client/chat/SportsTicketAutoLink.ts'
const game=(props:Record<string,unknown>={})=>({component:'sports_game_card',version:1,props:{
  title:'Buffalo Bills at Minnesota Vikings',when:'9 nov 2026',source:'ESPN Site API',
  sport:'football',league:'NFL',providerLeague:'nfl',eventDate:'2026-11-09',
  eventId:'401777123',phase:'post',
  away:{label:'Buffalo Bills',score:'28'},home:{label:'Minnesota Vikings',score:'14'},...props,
}})
const show=(input:unknown)=>{
  const parsed=parseGenerativeUiBlock(input)
  if(!parsed)throw Error('Card rejected')
  return render(<GenerativeUi block={parsed}/>)
}
beforeEach(()=>{localStorage.clear()
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({events:[]}),{status:200})))
})
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})
describe('favorite visible on live scoreboard',()=>{
  it('matches a single team and rejects ambiguous favorites and totals',()=>{
    expect(sportsFavoriteSide('Minnesota Vikings (58%)','Buffalo Bills','Minnesota Vikings')).toBe('home')
    expect(sportsFavoriteSide('Bills','Buffalo Bills','Minnesota Vikings')).toBe('away')
    expect(sportsFavoriteSide('Buffalo Bills vs Minnesota Vikings','Buffalo Bills','Minnesota Vikings')).toBeUndefined()
    expect(sportsFavoriteSide('Más de 45.5','Buffalo Bills','Minnesota Vikings')).toBeUndefined()
  })
  it('keeps the analytical favorite visible even when trailing',()=>{
    const {container}=show(game({research:{favorite:'Minnesota Vikings',
      method:'Forma reciente',source:'PHOENIX',evidence:['Investigación']}}))
    const marked=container.querySelectorAll('[data-selected-favorite="true"]')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain('Minnesota Vikings')
    expect(marked[0]?.textContent).toContain('★ Favorito PHOENIX')
    expect(marked[0]?.textContent).toContain('14')
  })
  it('shows the linked winner ticket and analytic favorite independently',async()=>{
    const {container}=show(game({favorite:'Buffalo Bills'}))
    expect(importSportsReceipt([{sport:'football',providerLeague:'nfl',eventDate:'2026-11-09',
      eventId:'401777123',homeTeam:'Minnesota Vikings',awayTeam:'Buffalo Bills',
      trackedBet:{receipt:'12140939',market:'moneyline',side:'home'}}])).toBe(1)
    await waitFor(()=>{
      const marked=container.querySelectorAll('[data-selected-favorite="true"]')
      expect(marked).toHaveLength(1)
      expect(marked[0]?.textContent).toContain('Minnesota Vikings')
      expect(marked[0]?.textContent).toContain('✓ Tu selección · boleto')
      expect(container.querySelector('[data-analytical-favorite="true"]')?.textContent).toContain('Buffalo Bills')
    })
  })
  it('marks only the chosen game in a multiple-game slate',()=>{
    const {container}=show({component:'sports_schedule_card',version:1,props:{
      title:'NFL',date:'2026-11-09',sport:'football',league:'NFL',providerLeague:'nfl',
      source:'ESPN Site API',total:2,events:[
        {eventId:'401777123',when:'8:00 PM',phase:'in',favorite:'Buffalo Bills',
          away:{label:'Buffalo Bills',score:'10'},home:{label:'Minnesota Vikings',score:'7'}},
        {eventId:'401777124',when:'9:00 PM',phase:'pre',
          away:{label:'New York Giants'},home:{label:'Philadelphia Eagles'}},
      ],
    }})
    const marked=container.querySelectorAll('[data-selected-favorite="true"]')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain('Buffalo Bills')
  })
})
