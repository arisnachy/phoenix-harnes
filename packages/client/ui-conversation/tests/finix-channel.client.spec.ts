import { describe, expect, it } from 'vitest'
import { finixInstruction, parseFinixOutput } from '../src/client/input/finix-channel.ts'
describe('Finix shared composer', () => {
  it('recognizes exact leading addresses and custom names, not file mentions', () => {
    expect(finixInstruction('@finix revisa esto', 'Finix')).toBe('revisa esto')
    expect(finixInstruction('@FÉNIX hola', 'Finix')).toBe('hola')
    expect(finixInstruction('@phoenix hola', 'Finix')).toBe('hola')
    expect(finixInstruction('@"Mi ave" hola', 'Mi ave')).toBe('hola')
    expect(finixInstruction('@mi-ave hola', 'Mi ave')).toBe('hola')
    expect(finixInstruction('@kira hola', 'Kira')).toBeUndefined()
    expect(finixInstruction('@finix.ts hola', 'Finix')).toBeUndefined()
    expect(finixInstruction('Lee @finix', 'Finix')).toBeUndefined()
  })
  it('isolates actual companion outputs', () => {
    const entry = {id:'1',title:'Prueba',status:'completed',recentHistory:[{status:'completed',summary:'Resultado real'}]}
    expect(parseFinixOutput([entry,{...entry,executionPolicy:'companion-local'}])).toEqual([entry])
  })
})

it('surfaces a verified resident observation without exposing raw JSON or unrelated tasks', () => {
  const summary = JSON.stringify({identity:'finix',tools:5,capabilities:10,degraded:1,failed:2,repeated:1,due:0,running:0,memory:'normal',next:'diagnose'})
  const result = parseFinixOutput([{id:'r',title:'Supervisión',status:'scheduled',executionPolicy:'companion-resident',recentHistory:[{status:'completed',summary}]}])
  expect(result[0]?.resident).toBe(true)
  expect(result[0]?.recentHistory[0]?.summary).toContain('Investigar tareas fallidas')
  expect(result[0]?.recentHistory[0]?.summary).not.toContain('{"identity"')
})
