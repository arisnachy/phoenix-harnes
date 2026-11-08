/** Small, allowlisted ESPN league emblems for native PHOENIX ticket cards.
 * Marks are shown for identification; ownership remains with the leagues.
 * If the provider image is unavailable, a legible text fallback remains.
 */
import type {ReactNode} from 'react'
import css from './SportsLeagueIdentity.module.css'

const MARKS:Record<string,{name:string;code:string;asset:string}>={
  nfl:{name:'NFL',code:'NFL',asset:'nfl'},
  nba:{name:'NBA',code:'NBA',asset:'nba'},
  mlb:{name:'MLB',code:'MLB',asset:'mlb'},
  nhl:{name:'NHL',code:'NHL',asset:'nhl'},
  wnba:{name:'WNBA',code:'WNBA',asset:'wnba'},
  mls:{name:'MLS',code:'MLS',asset:'usa.1'},
  laliga:{name:'LaLiga',code:'LAL',asset:'esp.1'},
  premier:{name:'Premier League',code:'EPL',asset:'eng.1'},
  ucl:{name:'Champions League',code:'UCL',asset:'uefa.champions'},
  ligamx:{name:'Liga MX',code:'LMX',asset:'mex.1'},
  seriea:{name:'Serie A',code:'ITA',asset:'ita.1'},
  bundesliga:{name:'Bundesliga',code:'BUN',asset:'ger.1'},
  ligue1:{name:'Ligue 1',code:'L1',asset:'fra.1'},
}
const aliases:Record<string,string>={
  'nfl':'nfl','national football league':'nfl',
  'nba':'nba','wnba':'wnba','mlb':'mlb','nhl':'nhl',
  'mls':'mls','usa.1':'mls','major league soccer':'mls',
  'laliga':'laliga','la liga':'laliga','esp.1':'laliga','primera division':'laliga',
  'premier league':'premier','eng.1':'premier','epl':'premier',
  'champions league':'ucl','uefa champions league':'ucl','uefa.champions':'ucl','ucl':'ucl',
  'liga mx':'ligamx','mex.1':'ligamx',
  'serie a':'seriea','ita.1':'seriea',
  'bundesliga':'bundesliga','ger.1':'bundesliga',
  'ligue 1':'ligue1','fra.1':'ligue1',
}
const key=(v?:string)=>v?.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim()??''
export function sportsLeagueIdentity(league?:string):{name:string;code:string;logo:string}|null{
  const id=aliases[key(league)]
  const item=id?MARKS[id]:undefined
  return item?{name:item.name,code:item.code,
    logo:'https://a.espncdn.com/i/teamlogos/leagues/500/'+item.asset+'.png'}:null
}
export function SportsLeagueBadge({league,sport,compact=false}:{
  league?:string|undefined;sport?:string|undefined;compact?:boolean
}):ReactNode{
  const identity=sportsLeagueIdentity(league)
  const fallback=identity?.code??(league?league.slice(0,3).toUpperCase():
    sport==='football'?'NFL':sport==='basketball'?'NBA':sport==='baseball'?'MLB':
    sport==='hockey'?'NHL':sport==='soccer'?'FUT':'DEP')
  const label=identity?.name??league??sport??'Deporte'
  return <span className={css.badge+(compact?' '+css.compact:'')} title={label}
    role="img" aria-label={'Liga '+label}>
    <span className={css.fallback}>{fallback}</span>
    {identity&&<img src={identity.logo} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={e=>{e.currentTarget.style.display='none'}}/>}
  </span>
}
