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
