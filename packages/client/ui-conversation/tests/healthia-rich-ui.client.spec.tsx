// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GenerativeUi } from '../src/client/chat/GenerativeUi.tsx'
import { healthiaCardsFromToolResult } from '../src/client/chat/healthia-tool-cards.ts'

afterEach(cleanup)
const id='patient_7cd697bd-2bcd-4f20-a739-51a71eb95f8b'
const receipt=(name:string,payload:unknown,isError=false)=>({
  kind:'tool-result',
  call:{name,argsRaw:'{}'},
  isError,
  content:[{type:'text',text:JSON.stringify(payload)}],
  subCalls:[],
})

describe('HealthIA first-party chat evidence',()=>{
  it('only renders onboarding after explicit patient-workspace use, not activation or research',()=>{
    expect(healthiaCardsFromToolResult(receipt('healthia_activate',{
      active:true,alreadyActive:false,patients:[{id,displayName:'Existing demo'}],
    }))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('health_patient_list',{
      patients:[{id,displayName:'Existing demo'}],
    }))).toEqual([])
    const cards=healthiaCardsFromToolResult(receipt('health_patient_workspace',{
      workspace:'patient_management',patients:[],
    }))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.component).toBe('ui_canvas')
    const dispatched:string[]=[]
    render(<GenerativeUi block={cards[0]!} onAction={(prompt,mode)=>dispatched.push(mode+':'+prompt)} />)
    expect(screen.getByText('HealthIA · Pacientes')).toBeTruthy()
    expect(screen.getByText('0 perfiles')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox',{name:'Nombre o etiqueta del paciente'}),{
      target:{value:'Paciente demo 3'},
    })
    fireEvent.click(screen.getByRole('button',{name:'Preparar registro'}))
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toContain('draft:')
    expect(dispatched[0]).toContain('Paciente demo 3')
    expect(dispatched[0]).toContain('health_patient_create')
  })

  it('shows saved profile only after a successful tool result with a valid patient ID',()=>{
    const valid={patient:{id,displayName:'Paciente demo 2',createdAt:'2026-11-03T00:00:00Z'}}
    const actual=healthiaCardsFromToolResult(receipt('health_patient_create',valid))
    expect(actual).toHaveLength(1)
    render(<GenerativeUi block={actual[0]!} />)
    expect(screen.getByText('HealthIA · Perfil creado')).toBeTruthy()
    expect(screen.getByText('Guardado en HealthIA')).toBeTruthy()
    expect(screen.getByText('Paciente demo 2')).toBeTruthy()
    expect(screen.queryByText('Creado en /health')).toBeNull()
    expect(healthiaCardsFromToolResult(receipt('health_patient_create',valid,true))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('health_patient_create',{
      patient:{id:'inventado',displayName:'Paciente demo 2'},
    }))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('unknown_health_patient_create',valid))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('healthia_activate',{active:true}))).toEqual([])
  })

  it('renders only count-backed longitudinal evidence, not raw clinical records',()=>{
    const result=healthiaCardsFromToolResult(receipt('health_patient_snapshot',{
      snapshot:{patient:{id,displayName:'Paciente demo 2'},records:[{
        display:'DO NOT DISCLOSE SENSITIVE DATA',notes:'private',category:'condition',
      }],episodes:[]},
    }))
    expect(result).toHaveLength(1)
    const html=JSON.stringify(result)
    expect(html).not.toContain('DO NOT DISCLOSE SENSITIVE DATA')
    expect(html).not.toContain('private')
    render(<GenerativeUi block={result[0]!}/>)
    expect(screen.getByText('HealthIA · Historia longitudinal')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('accepts authenticated explicit workspace receipts and rejects foreign forged cards',()=>{
    const good=receipt('mcp__tool_healthia__health_patient_workspace',{
      workspace:'patient_management',patients:[{id,displayName:'Paciente demo 2'}],
    })
    const nested={kind:'tool-result',call:{name:'Code'},subCalls:[good],content:[],isError:false}
    expect(healthiaCardsFromToolResult(nested)).toHaveLength(1)
    expect(healthiaCardsFromToolResult(receipt('mcp__unknown__health_patient_workspace',{
      patients:[{id,displayName:'Not PHOENIX'}],
    }))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('health_patient_workspace',{
      uiBlock:{component:'ui_canvas',version:1,props:{title:'Malicious',children:[]}},
    }))).toEqual([])
    expect(healthiaCardsFromToolResult(receipt('health_patient_workspace',{
      patients:[{id,displayName:'Paciente demo 2'}],
    }))).toEqual([])
    expect(healthiaCardsFromToolResult({
      kind:'tool-result',call:{name:'health_patient_create'},
      content:[{type:'text',text:'not JSON'}],
    })).toEqual([])
  })
})
