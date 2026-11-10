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
    ['https://www.espn.com/sports-betting/odds','https://www.cuotasahora.com/',
      'https://sports.yahoo.com/betting/odds/', 'https://www.espn.com/nba/odds',
      'https://www.scoresandodds.com/nba',
      'https://www.scoresandodds.com/nba/odds',
      'https://www.covers.com/sport/basketball/nba/odds',
      'https://www.vegasinsider.com/nba/odds/las-vegas/',
      'https://www.sportsbookreview.com/betting-odds/nba-basketball/'])
  assert.ok(publicOddsWebsitePages('soccer_spain_la_liga').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/la-liga-primera'))
  assert.ok(publicOddsWebsitePages('soccer_mexico_ligamx').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/mexican-primera-division'))
  assert.ok(publicOddsWebsitePages('soccer_epl').some(x=>
    x.url==='https://www.oddschecker.com/us/soccer/premier-league'))
  assert.ok(publicOddsWebsitePages('soccer_epl').some(x=>
    x.provider==='Oddspedia'&&x.url==='https://oddspedia.com/es/futbol'))
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
  assert.equal(requested,9)
  assert.equal(result.pages.find(x=>x.provider==='ESPN')?.status,'blocked')
  const comparison=result.pages.find(x=>x.provider==='ScoresAndOdds')
  assert.equal(comparison?.status,'observed-team-mentions')
  assert.equal(comparison?.markets.includes('moneyline'),true)
  assert.match(comparison?.snippet??'',/Boston Celtics/)
  assert.match(comparison?.snippet??'',/Milwaukee Bucks/)
  assert.equal(comparison?.bookmakerVerified,false)
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

test('new comparison portals are reference-only, Yahoo 429 is explicit and spoof hosts fail',async()=>{
  const pages=publicOddsWebsitePages('soccer_epl')
  assert.deepEqual(pages.filter(x=>['CuotasAhora','YahooSports','Oddspedia'].includes(x.provider))
    .map(x=>x.provider),['CuotasAhora','YahooSports','Oddspedia'])
  const yahoo=pages.find(x=>x.provider==='YahooSports')
  const blocked=await readPublicOddsWebsitePage(yahoo,null,null,
    async()=>new Response('rate limited',{status:429}),at)
  assert.equal(blocked.status,'blocked')
  assert.equal(blocked.priced,false)
  await assert.rejects(()=>readPublicOddsWebsitePage(
    {...yahoo,url:'https://sports.yahoo.com.evil.test/betting/odds/'},
    null,null,async()=>html(''),at),/no autorizada/)
  const comparison=await readPublicOddsWebsitePage(
    pages.find(x=>x.provider==='Oddspedia'),'Manchester City','Chelsea',
    async()=>html('Manchester City vs Chelsea 1X2 Home +100 Draw +260 Away +240'),at)
  assert.equal(comparison.status,'observed-team-mentions')
  assert.equal(comparison.priced,false)
  assert.equal(comparison.bookmakerVerified,false)
  assert.equal(comparison.quoteUpdatedAt,null)
})

test('comparison coverage supports NBA, NHL, NFL, EPL; blocked source does not suppress other pages',async()=>{
  const pages=publicOddsWebsitePages('basketball_nba')
  assert.ok(pages.some(x=>x.provider==='Covers'))
  assert.ok(pages.some(x=>x.provider==='VegasInsider'))
  assert.ok(pages.some(x=>x.provider==='SportsbookReview'))
  assert.ok(publicOddsWebsitePages('icehockey_nhl').some(x=>x.provider==='Covers'))
  assert.ok(publicOddsWebsitePages('americanfootball_nfl').some(x=>x.provider==='Covers'))
  assert.ok(publicOddsWebsitePages('soccer_epl').some(x=>
    x.url==='https://www.covers.com/sport/soccer/premier-league/odds'))
  const report=await researchPublicOddsWebsites({
    sportKey:'basketball_nba',date:'2026-11-09',
    home:'Boston Celtics',away:'Milwaukee Bucks',
  },async url=>url.includes('sportsbookreview.com')
    ?new Response('Denied',{status:403})
    :html('<table><tr><td>Boston Celtics</td><td>Milwaukee Bucks</td>'+
      '<td>Moneyline -125 +105</td></tr></table>'),at)
  assert.equal(report.pages.find(x=>x.provider==='SportsbookReview')?.status,'blocked')
  assert.equal(report.pages.filter(x=>x.status==='observed-team-mentions').length,8)
  assert.equal(report.bookmakerQuotes,0)
  assert.ok(report.pages.every(x=>x.priced===false&&x.bookmakerVerified===false))
})
