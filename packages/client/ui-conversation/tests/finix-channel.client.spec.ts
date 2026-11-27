import { describe, expect, it } from 'vitest'
import { finixInstruction, parseFinixOutput } from '../src/client/input/finix-channel.ts'
describe('Finix shared composer', () => {
  it('recognizes exact leading addresses and custom names, not file mentions', () => {
    expect(finixInstruction('@finix revisa esto', 'Finix')).toBe('revisa esto')
    expect(finixInstruction('@FÉNIX hola', 'Finix')).toBe('hola')
    expect(finixInstruction('@phoenix hola', 'Finix')).toBe('hola')
    expect(finixInstruction('@"Mi ave" hola', 'Mi ave')).toBe('hola')
    expect(finixInstruction('@kira hola', 'Kira')).toBeUndefined()
    expect(finixInstruction('@finix.ts hola', 'Finix')).toBeUndefined()
    expect(finixInstruction('Lee @finix', 'Finix')).toBeUndefined()
  })
  it('isolates actual companion outputs', () => {
    const entry = {id:'1',title:'Prueba',status:'completed',recentHistory:[{status:'completed',summary:'Resultado real'}]}
    expect(parseFinixOutput([entry,{...entry,executionPolicy:'companion-local'}])).toEqual([entry])
  })
})
