import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  publicOddsWebsitePages,readPublicOddsWebsitePage,researchPublicOddsWebsites,
  websiteTeamExcerpt,
} from '../src/sports-public-odds-pages.ts'

const at=Date.parse('2026-11-09T18:30:00Z')
const html=(body)=>new Response('<!doctype html><html><head><title>Odds and Betting Lines</title></head>'+
  '<body><h1>Moneyline, Spread, Total</h1>'+body+'</body></html>',
  {headers:{'content-type':'text/html'}})
test('routes actual supplied and league-specific public provider pages without arbitrary hosts',()=>{
  assert.deepEqual(publicOddsWebsitePages('basketball_nba').map(x=>x.url),
    ['https://www.espn.com/sports-betting/odds','https://www.scoresandodds.com/nba'])
  assert.ok(publicOddsWebsitePages('soccer_spain_la_liga').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/la-liga-primera'))
  assert.ok(publicOddsWebsitePages('soccer_epl').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/premier-league'))
  assert.ok(publicOddsWebsitePages('soccer_usa_mls').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/mls'))
  assert.ok(publicOddsWebsitePages('americanfootball_nfl').some(x=>
    x.url==='https://www.scoresandodds.com/nfl'))
  assert.throws(()=>publicOddsWebsitePages('https://evil.test/'),/Liga no válida/)
})
test('ESPN bot/JavaScript challenge is reported, never bypassed',async()=>{
  const pages=publicOddsWebsitePages('basketball_nba')
  const result=await readPublicOddsWebsitePage(pages[0],null,null,
    async()=>html('JavaScript is disabled. Verify that you are not a robot.'),at)
  assert.equal(result.status,'blocked')
  assert.equal(result.quoteUpdatedAt,null)
  assert.equal(result.bookmakerVerified,false)
  assert.equal(result.snippet,null)
})
test('ESPN and ScoresAndOdds can be inspected without promoting a raw price',async()=>{
  let requested=0
  const result=await researchPublicOddsWebsites({
    sportKey:'basketball_nba',date:'2026-11-09',home:'Boston Celtics',
    away:'Milwaukee Bucks',
  },async url=>{
    requested++
    if(String(url).includes('espn.com'))return html('Enable JavaScript and then reload the page. Verify that you are not a robot.')
    return html('<section>Boston Celtics -120 Milwaukee Bucks +110 Moneyline</section>')
  },at)
  assert.equal(requested,2)
  assert.equal(result.pages[0].status,'blocked')
  assert.equal(result.pages[1].status,'observed-team-mentions')
  assert.equal(result.pages[1].markets.includes('moneyline'),true)
  assert.match(result.pages[1].snippet??'',/Boston Celtics/)
  assert.match(result.pages[1].snippet??'',/Milwaukee Bucks/)
  assert.equal(result.pages[1].bookmakerVerified,false)
  assert.equal(result.bookmakerQuotes,0)
  assert.match(result.warning,/NO cotizaciones elegibles/)
})
test('one team mention or page boilerplate is not a verified match',async()=>{
  const [page]=publicOddsWebsitePages('soccer_epl')
  const response=await readPublicOddsWebsitePage(page,'Arsenal','Chelsea',
    async()=>html('Arsenal with markets for many matches. Tottenham vs Fulham are elsewhere.'),at)
  assert.equal(response.status,'not-found')
  assert.equal(response.eventVerified,false)
})
test('rejected redirections, missing data and malformed content are not legitimate quotes',async()=>{
  const [page]=publicOddsWebsitePages('basketball_nba')
  await assert.rejects(()=>readPublicOddsWebsitePage(
    {...page,url:'https://www.espn.com.evil.test/sports-betting/odds'},
    null,null,async()=>html(''),at),/no autorizada/)
  const result=await readPublicOddsWebsitePage(page,null,null,async()=>
    new Response('Redirect',{status:302,headers:{location:'https://example.com'}}),at)
  assert.equal(result.status,'unavailable')
  assert.equal(result.bookmakerVerified,false)
})
test('no cross-site scraping or invalid date passes the fixed provider allowlist',async()=>{
  let count=0
  await assert.rejects(()=>researchPublicOddsWebsites({
    sportKey:'basketball_nba',date:'2026-11-31',
  },async()=>{count++;return html('x')},at),/Fecha inválida/)
  await assert.rejects(()=>researchPublicOddsWebsites({
    sportKey:'basketball_nba',date:'2026-11-09',home:'Boston Celtics',
  },async()=>{count++;return html('x')},at),/ambos equipos/)
  assert.equal(count,0)
})
test('human-visible text is not executable markup or a stored bookmaker price',()=>{
  const snippet=websiteTeamExcerpt(
    '<script>alert(1)</script> Barcelona +180 Real Madrid -115','Barcelona','Real Madrid')
  assert.ok(snippet)
  assert.equal(snippet?.includes('alert(1)'),true) // parser itself does not execute HTML
})
