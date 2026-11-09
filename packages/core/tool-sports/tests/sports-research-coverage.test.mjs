import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchCoverage,researchCredentialRefs,coverageReport}
  from '../src/sports-research-coverage.ts'
test('six disciplines have independently documented evidence needs',()=>{
  assert.deepEqual([...new Set(researchCoverage.map(x=>x.sport))].sort(),[
    'baseball','basketball','football','hockey','soccer','tennis'])
  for(const sport of ['basketball','baseball','football','hockey','soccer','tennis']){
    const rows=researchCoverage.filter(x=>x.sport===sport)
    assert.ok(rows.length>=5,sport)
    assert.ok(rows.some(x=>x.step==='market'),sport)
    assert.ok(rows.every(x=>x.providers.length>=2))
  }
})
test('absence of all optional keys does not imply no official sources',()=>{
  const report=coverageReport(new Set())
  assert.ok(report.coverage.some(x=>x.providers.some(y=>y.usable)))
  assert.ok(report.coverage.some(x=>x.providers.some(y=>y.ref&&y.configured===false)))
  assert.ok(report.coverage.some(x=>x.providers.some(y=>y.state==='planned'&&y.usable===false)))
  assert.ok(!JSON.stringify(report).includes('private-secret'))
})
test('API key presence never marks a planned or tier-restricted route active',()=>{
  const all=new Set(researchCredentialRefs.map(x=>x.ref))
  const nhl=coverageReport(all,'hockey')
  const big=nhl.coverage.flatMap(x=>x.providers).find(x=>x.name==='Big Balls NHL')
  assert.equal(big.configured,true)
  assert.equal(big.usable,false)
  assert.ok(nhl.coverage.some(x=>x.step==='goalies'))
  assert.match(nhl.coverage.find(x=>x.step==='goalies').caveat,/not confirmed/)
})
