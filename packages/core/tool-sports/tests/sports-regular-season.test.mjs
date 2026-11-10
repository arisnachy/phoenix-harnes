import {test} from 'node:test'
import assert from 'node:assert/strict'
import {classifyEspnSeason,isVerifiedRegularSeason} from '../src/sports-regular-season.ts'
test('ESPN regular season is the only qualified NBA and NFL form',()=>{
  assert.equal(classifyEspnSeason({season:{type:2}}),'regular')
  assert.equal(classifyEspnSeason({season:{type:1}}),'preseason')
  assert.equal(classifyEspnSeason({season:{type:3}}),'postseason')
  assert.equal(isVerifiedRegularSeason({season:{type:2}}),true)
  assert.equal(isVerifiedRegularSeason({season:{type:1}}),false)
})
test('unknown, contradictory and untagged historical events cannot be treated as regular',()=>{
  assert.equal(isVerifiedRegularSeason({date:'2026-11-01T00:00:00Z'}),false)
  assert.equal(classifyEspnSeason({season:{type:1},seasonType:2}),'unknown')
  assert.equal(classifyEspnSeason({seasonType:{name:'regular season'}}),'regular')
  assert.equal(classifyEspnSeason({competitions:[{seasonType:{abbreviation:'REG'}}]}),'regular')
})
