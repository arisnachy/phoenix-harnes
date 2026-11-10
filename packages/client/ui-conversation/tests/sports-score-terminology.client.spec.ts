import {describe,expect,it} from 'vitest'
import {evaluateSportsPick,sportScoreUnit} from '../src/client/chat/SportsBetProgress.tsx'
import type {PhoenixLiveGame} from '../src/client/chat/SportsLive.tsx'

const game=(awayScore:string,homeScore:string)=>({
  home:'Charlotte Hornets',away:'Cleveland Cavaliers',
  homeScore,awayScore,phase:'in',periods:[],
}) as unknown as PhoenixLiveGame

describe('score deficits use the units of the sport',()=>{
  it('uses points, not baskets, for NBA winning margins',()=>{
    const result=evaluateSportsPick({receipt:'forecast',market:'moneyline',side:'away'},
      game('67','91'),'basketball')
    expect(result.state).toBe('trailing')
    expect(result.target).toContain('necesita 25 puntos (canastas o tiros libres) para pasar al frente')
    expect(result.target).not.toMatch(/gol\(es\)|25 canastas/)
  })
  it('uses carreras for baseball and goles for hockey and soccer',()=>{
    const pick={receipt:'forecast',market:'moneyline' as const,side:'away' as const}
    expect(evaluateSportsPick(pick,game('3','5'),'baseball').target)
      .toContain('necesita 3 carreras para pasar al frente')
    expect(evaluateSportsPick(pick,game('1','3'),'hockey').target)
      .toContain('necesita 3 goles para pasar al frente')
    expect(sportScoreUnit('soccer')).toBe('goles')
    expect(sportScoreUnit('football')).toBe('puntos')
  })
  it('labels a spread gap in the correct units',()=>{
    const grade=evaluateSportsPick({receipt:'forecast',market:'spread',
      side:'away',line:1.5},game('67','91'),'basketball')
    expect(grade.target).toContain('puntos (canastas o tiros libres) de margen adicional')
  })
})
