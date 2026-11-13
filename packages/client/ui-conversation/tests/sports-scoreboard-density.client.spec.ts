import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const read=(file:string)=>readFileSync(new URL('../src/client/chat/'+file,import.meta.url),'utf8')

describe('two-up PHOENIX sports scorecard layout contracts',()=>{
  it('lays out independent verified scorecards two per row without changing prose flow',()=>{
    const css=read('AssistantMarkdown.module.css')
    expect(css).toContain(':has(> [data-generative-ui="sports_game_card"])')
    expect(css).toContain('width:min(100%,850px)')
    expect(css).toContain('repeat(auto-fit,minmax(min(100%,330px),1fr))')
    expect(css).toContain(':not([data-generative-ui="sports_game_card"])')
  })
  it('does not regress from compact 420px tiles to an 830px article',()=>{
    const css=read('GenerativeUi.module.css')
    const marker='/* PHOENIX Sports scoreboard — DENSE Pearl Light 2-up tiles.'
    const specific=css.slice(css.indexOf(marker))
    expect(specific).toContain('max-width:420px')
    expect(specific).toContain('font-size:21px')
    expect(specific).toContain('width:26px;height:26px')
    expect(specific).not.toContain('max-width:830px')
  })
  it('removes duplicate headlines and keeps period information available',()=>{
    const jsx=read('GenerativeUi.tsx')
    expect(jsx).toContain('sportsGameTitleSr')
    expect(jsx).toContain('sportsGamePeriodStrip')
    expect(jsx).toContain('const periods=live?.periods?.length?live.periods:p.periods')
    expect(jsx).not.toContain('Investigar análisis y mercados</button>')
  })
  it('never reserves a large placeholder for missing NHL ESPN predictions',()=>{
    const jsx=read('SportsWinProbability.tsx')
    expect(jsx).toContain('if(!predictor&&!live)return null')
    expect(jsx).toContain('Ver evolución de probabilidad')
    expect(jsx).not.toContain('Predictor prepartido · ')
  })
})
