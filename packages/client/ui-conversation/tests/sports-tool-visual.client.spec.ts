import {describe,it,expect} from 'vitest'
import {sportsCardsFromToolResult,unrenderedSportsCards} from '../src/client/chat/sports-tool-cards.ts'
import {parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'

const sportsGame={
  component:'sports_game_card',version:1,
  props:{title:'Rays vs Brewers',status:'Programado',when:'24 oct · 8:00 p. m.',venue:'Estadio verificado',
    home:{label:'Brewers'},away:{label:'Rays'},source:'ESPN pública · 2026-10-24',
    highlights:[{label:'Abridor',value:'Por confirmar'}]},
}
const mlbComparison={component:'comparison',version:1,props:{title:'Bullpen',subtitle:'Verificado',
  columns:['IP','K','BB'],rows:[{label:'Milwaukee',values:['4','6','1']},{label:'Tampa Bay',values:['3','0','4']}]}}
const ticket={component:'sports_ticket_card',version:1,props:{title:'Ticket visual',source:'ESPN',
  legs:[{event:'Rays vs Brewers',selection:'Brewers',price:'1.90',bookmaker:'Fuente verificable'}],
  combinedOdds:'1.90',note:'Simulación sin apuesta real.'}}
function tool(name:string,result:unknown,{failed=false}:{failed?:boolean}={}){
  return {kind:'tool-result',call:{name,argsRaw:'{}'},content:[{type:'text',text:JSON.stringify(result)}],
    isError:failed,subCalls:[]}
}
describe('native sports chat presentation fallback',()=>{
  it('renders a game from a real structured sports tool without assistant UI fences',()=>{
    expect(sportsCardsFromToolResult(tool('sports_chat_games',{uiBlocks:[sportsGame],count:1}))).toEqual([sportsGame])
  })
  it('renders a compact multi-game slate while keeping single game cards',()=>{
    const schedule={component:'sports_schedule_card',version:1,props:{
      title:'Cartelera deportiva',date:'2026-10-28',source:'ESPN Site API',total:2,
      events:[
        {when:'7:00 p. m.',away:{label:'Heat'},home:{label:'Hawks'}},
        {when:'8:00 p. m.',away:{label:'Rockets'},home:{label:'Lakers'}},
      ],
    }}
    expect(sportsCardsFromToolResult(tool('sports_chat_games',{uiBlocks:[schedule]}))).toEqual([schedule])
    expect(sportsCardsFromToolResult(tool('sports_chat_games',{uiBlocks:[sportsGame]}))).toEqual([sportsGame])
  })
  it('keeps bullpen and ticket inside the chat',()=>{
    expect(sportsCardsFromToolResult(tool('sports_chat_mlb_pitchers',{uiBlock:mlbComparison}))).toEqual([mlbComparison])
    expect(sportsCardsFromToolResult(tool('sports_chat_ticket',{uiBlock:ticket}))).toEqual([ticket])
  })
  it('handles Code Mode nested sports calls (not arbitrary source text)',()=>{
    const code={kind:'tool-result',call:{name:'Code'},isError:false,content:[],subCalls:[
      tool('sports_chat_games',{uiBlocks:[sportsGame]}),
      tool('sports_chat_mlb_pitchers',{uiBlock:mlbComparison}),
    ]}
    expect(sportsCardsFromToolResult(code).map(x=>x.component)).toEqual(['sports_game_card','comparison'])
  })
  it('does not generate misleading NO BET cards when no market price is returned',()=>{
    const empty=tool('sports_chat_odds',{total:0,outcomes:[],source:'ESPN'})
    expect(sportsCardsFromToolResult(empty)).toEqual([])
    expect(sportsCardsFromToolResult(tool('sports_chat_odds',{}, {failed:true}))).toEqual([])
  })
  it('renders an unpriced research ticket without a bookmaker or odds',()=>{
    const researched={component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de pronósticos',source:'ESPN Site API',combinedOdds:'No disponible',
      legs:[{event:'Puebla vs Atlas',selection:'Atlas',price:'Por verificar',bookmaker:'Sin casa confirmada',
        league:'Liga MX',sport:'Fútbol',rationale:'Hipótesis pendiente de contrastar'}],
      note:'SIN APUESTA REAL. Pronóstico pendiente de cotización.',
    }}
    expect(parseGenerativeUiBlock(researched)).not.toBeNull()
    expect(sportsCardsFromToolResult(tool('sports_chat_ticket_research',{uiBlock:researched}))).toEqual([researched])
  })
  it('never invents or reconstructs cards from shell tools or arbitrary prose',()=>{
    expect(sportsCardsFromToolResult(tool('bash',{uiBlocks:[sportsGame]}))).toEqual([])
    expect(sportsCardsFromToolResult(tool('sports_chat_games',{uiBlocks:[{component:'sports_game_card',version:1,props:{
      ...sportsGame.props,source:'x',onclick:'evil()'}}]}))).toEqual([])
    const huge='x'.repeat(125_010)
    expect(sportsCardsFromToolResult({kind:'tool-result',call:{name:'sports_chat_games'},isError:false,
      content:[{type:'text',text:huge}]})).toEqual([])
    expect(sportsCardsFromToolResult({kind:'tool-result',call:{name:'sports_chat_games'},isError:true,
      content:[{type:'text',text:JSON.stringify({uiBlocks:[sportsGame]})}]})).toEqual([])
  })
  it('deduplicates validated assistant-rendered cards and repeated tool results',()=>{
    const fence=String.fromCharCode(96).repeat(3)
    const answer=fence+'generative-ui\n'+JSON.stringify(sportsGame)+'\n'+fence
    const game=parseGenerativeUiBlock(sportsGame)
    const table=parseGenerativeUiBlock(mlbComparison)
    expect(game).not.toBeNull()
    expect(table).not.toBeNull()
    if(game===null||table===null)throw Error('Fixture schemas invalid')
    expect(unrenderedSportsCards([game,game,table],[answer])).toEqual([table])
    expect(unrenderedSportsCards([game,game],['Respuesta textual solamente.'])).toEqual([game])
  })
})
