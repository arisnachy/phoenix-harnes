import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  publicOddsWebsitePages,readPublicOddsWebsitePage,researchPublicOddsWebsites,
  websiteTeamExcerpt,scoresAndOddsMoneylineHints,
} from '../src/sports-public-odds-pages.ts'

const at=Date.parse('2026-11-09T18:30:00Z')
const html=(body)=>new Response('<!doctype html><html><head><title>Odds and Betting Lines</title></head>'+
  '<body><h1>Moneyline, Spread, Total</h1>'+body+'</body></html>',
  {headers:{'content-type':'text/html'}})
test('routes actual supplied and league-specific public provider pages without arbitrary hosts',()=>{
  assert.deepEqual(publicOddsWebsitePages('basketball_nba').map(x=>x.url),
    ['https://www.espn.com/sports-betting/odds','https://www.espn.com/nba/odds',
      'https://www.scoresandodds.com/nba/odds'])
  assert.ok(publicOddsWebsitePages('soccer_spain_la_liga').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/la-liga-primera'))
  assert.ok(publicOddsWebsitePages('soccer_mexico_ligamx').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/mexican-primera-division'))
  assert.ok(publicOddsWebsitePages('soccer_epl').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/premier-league'))
  assert.ok(publicOddsWebsitePages('soccer_usa_mls').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/mls'))
  assert.ok(publicOddsWebsitePages('americanfootball_nfl').some(x=>
    x.url==='https://www.scoresandodds.com/nfl/odds'))
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
  assert.equal(requested,3)
  assert.equal(result.pages[0].status,'blocked')
  assert.equal(result.pages[1].status,'blocked')
  assert.equal(result.pages[2].status,'observed-team-mentions')
  assert.equal(result.pages[2].markets.includes('moneyline'),true)
  assert.match(result.pages[2].snippet??'',/Boston Celtics/)
  assert.match(result.pages[1].snippet??'',/Milwaukee Bucks/)
  assert.equal(result.pages[2].bookmakerVerified,false)
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
test('embedded scripts are ignored when finding public text but cannot become quotes',async()=>{
  const [page]=publicOddsWebsitePages('soccer_epl')
  const result=await readPublicOddsWebsitePage(page,'Barcelona','Real Madrid',
    async()=>html('<script>Barcelona +180 Real Madrid -115</script><div>Other matches listed, including full schedules for several unrelated clubs this evening and more information for readers.</div>'),at)
  assert.equal(result.status,'not-found')
  assert.equal(result.bookmakerVerified,false)
})

test('public ScoresAndOdds shows American moneyline hints without claiming bookmaker validity',()=>{
  const raw='<section><h2>Moneyline</h2><table>'+
    '<tr><td>Boston Celtics</td><td><a href="https://switchboard.scoresandodds.com/a">-170</a></td></tr>'+
    '<tr><td>Milwaukee Bucks</td><td><a href="https://switchboard.scoresandodds.com/b">+145</a></td></tr>'+
    '</table></section>'
  const hints=scoresAndOddsMoneylineHints(raw,'Boston Celtics','Milwaukee Bucks')
  assert.equal(hints.length,2)
  assert.equal(hints[0].american,'-170')
  assert.equal(hints[1].decimal,2.45)
  assert.ok(hints.every(x=>x.status==='reference-only'&&x.bookmaker===null
    &&x.quoteUpdatedAt===null))
})
test('numbers in unrelated articles or handicap cannot become moneyline hints',()=>{
  const raw='<h2>Moneyline</h2><div>Boston Celtics -105 Milwaukee Bucks +102</div>'+
    '<a href="https://switchboard.scoresandodds.com/s">-3.5 -105</a>'
  assert.deepEqual(scoresAndOddsMoneylineHints(raw,'Boston Celtics','Milwaukee Bucks'),[])
})
