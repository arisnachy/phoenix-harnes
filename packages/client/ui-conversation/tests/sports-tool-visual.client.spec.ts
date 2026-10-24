import {describe,it,expect} from 'vitest'
import {sportsCardsFromToolResult,unrenderedSportsCards} from '../src/client/chat/sports-tool-cards.ts'

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
  it('shows an honest NO BET card for missing or failed odds queries',()=>{
    const empty=tool('sports_chat_odds',{total:0,outcomes:[],source:'ESPN'})
    const card=sportsCardsFromToolResult(empty)[0]
    expect(card?.component).toBe('smart_card')
    expect(JSON.stringify(card)).toContain('NO BET')
    expect(JSON.stringify(card)).toContain('No se inventaron')
    expect(sportsCardsFromToolResult(tool('sports_chat_odds',{}, {failed:true}))[0]?.component).toBe('smart_card')
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
    expect(unrenderedSportsCards([sportsGame,sportsGame,mlbComparison],[answer])).toEqual([mlbComparison])
    expect(unrenderedSportsCards([sportsGame,sportsGame],['Respuesta textual solamente.'])).toEqual([sportsGame])
  })
})
