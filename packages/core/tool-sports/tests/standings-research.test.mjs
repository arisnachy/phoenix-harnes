import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compareStandings} from '../src/standings-research.ts'

const side=(name,summary)=>({team:{displayName:name},records:[{name:'overall',summary}]})
test('shows a favorite and why without manufacturing probability from early-season records',()=>{
  const result=compareStandings(side('Hawks','2-2'),side('Heat','0-4'))
  assert.equal(result.pick,'home')
  assert.match(result.research.favorite,/Tendencia provisional: Hawks/)
  assert.deepEqual(result.research.evidence.slice(0,2),['Hawks: 2-2 (local)','Heat: 0-4 (visitante)'])
  assert.match(result.research.method,/no es una probabilidad/)
  assert.match(result.research.evidence[2],/Muestra pequeña/)
})
test('no fake favorite for missing or tied records',()=>{
  assert.equal(compareStandings(side('Home','3-3'),side('Away','3-3')).pick,null)
  const missing=compareStandings(side('Home','4-0'),{team:{name:'Away'}})
  assert.equal(missing.pick,null)
  assert.match(missing.research.favorite,/Sin favorito fundamentado/)
})
test('supports verified soccer W-D-L records and honors preferred total record',()=>{
  const result=compareStandings(
    {team:{name:'Home'},records:[{name:'home',summary:'0-1-4'},{name:'overall',summary:'9-1-2'}]},
    side('Away','2-2-8'))
  assert.equal(result.pick,'home')
  assert.equal(result.research.evidence[0],'Home: 9-1-2 (local)')
})
