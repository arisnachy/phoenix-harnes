import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  secondaryMarketSourceCatalog,isKnownSecondaryMarketPage,
} from '../src/sports-secondary-sources.ts'

test('Kira knows four secondary market portals but never pretends to have retrieved odds',()=>{
  const directory=secondaryMarketSourceCatalog()
  assert.deepEqual(directory.sources.map(x=>x.id),
    ['scoresandodds','covers','vegasinsider','oddsportal'])
  assert.equal(directory.policy.registryStatus,'reference_only')
  assert.equal(directory.policy.retrievalStatus,'not_attempted')
  assert.equal(directory.policy.automaticAdapters,false)
  assert.equal(directory.policy.sportsbookExecution,false)
  assert.match(directory.instruction,/no feeds API activados/)
  assert.match(directory.policy.timestampRule,/DIFERENTES/)
  assert.match(directory.policy.favoriteRule,/≠/)
  assert.ok(directory.workflow.some(step=>step.includes('liga')&&step.includes('ESPN')))
  assert.ok(directory.workflow.some(step=>step.includes('vigencia no verificada')))
})
test('SportIntel MIT implementation is not misrepresented as a free live-odds provider',()=>{
  const intel=secondaryMarketSourceCatalog().sportIntelMcp
  assert.equal(intel.codeLicense,'MIT')
  assert.equal(intel.provider,'The Odds API v4')
  assert.equal(intel.requiresApiKey,true)
  assert.equal(intel.environmentVariable,'ODDS_API_KEY')
  assert.equal(intel.independentFreeFeed,false)
  assert.equal(intel.sportsbookExecution,false)
  assert.match(intel.risk,/gameTime/u)
})
test('no-cost sports source matrix distinguishes licensed snapshots from limited/unlicensed feeds',()=>{
  const rows=secondaryMarketSourceCatalog().freeMarketSourceAssessment
  const licensed=rows.find(x=>x.id==='sharpapi-open-sample')
  assert.match(licensed.cost,/CC BY 4.0/u)
  assert.match(licensed.history,/9.805/u)
  assert.equal(licensed.automatedImport,false)
  assert.match(rows.find(x=>x.id==='parlayapi-demo').cost,/60 consultas/u)
  assert.match(rows.find(x=>x.id==='odds-gap-sample').history,/suscripción/u)
  assert.match(rows.find(x=>x.id==='football-tennis-data').restriction,/sin autorización/u)
  assert.equal(rows.every(x=>x.automatedImport===false),true)
})
test('link provenance admits only the exact official HTTPS host without credentials or port',()=>{
  assert.equal(isKnownSecondaryMarketPage('covers','https://www.covers.com/sport/odds'),true)
  assert.equal(isKnownSecondaryMarketPage('scoresandodds','https://scoresandodds.com/las-vegas-odds'),true)
  assert.equal(isKnownSecondaryMarketPage('vegasinsider','https://www.vegasinsider.com/nba/odds/las-vegas/'),true)
  assert.equal(isKnownSecondaryMarketPage('oddsportal','https://www.oddsportal.com/'),true)
  assert.equal(isKnownSecondaryMarketPage('covers','http://www.covers.com/sport/odds'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','https://www.covers.com.evil.test/'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','https://www.covers.com@evil.test/'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','https://user:pass@www.covers.com/'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','https://www.covers.com:8443/'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','https://www.vegasinsider.com/'),false)
  assert.equal(isKnownSecondaryMarketPage('unknown','https://www.covers.com/'),false)
  assert.equal(isKnownSecondaryMarketPage('covers','this is not a URL'),false)
})

test('Kira exposes the catalog natively and knows when not to invent live website data',()=>{
  const registered=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8')
  assert.match(registered,/name:'sports_chat_market_source_catalog'/u)
  assert.match(registered,/secondaryMarketSourceCatalog\(\)/u)
  assert.match(registered,/PORTALES EXTERNOS DE CONTRASTE/u)
  assert.match(registered,/pageObservedAt/u)
  assert.match(registered,/quoteUpdatedAt/u)
  assert.match(registered,/jamás afirmes que obtuviste sus cuotas/u)
})
