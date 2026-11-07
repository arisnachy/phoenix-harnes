import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,describe,expect,it} from 'vitest'
import {installAnatomyConnector,readAnatomyConnectors} from '../src/anatomy-connectors.ts'
const original=process.env.PHOENIX_ANATOMY_HOME
const dirs:string[]=[]
afterEach(()=>{
 if(original===undefined)delete process.env.PHOENIX_ANATOMY_HOME
 else process.env.PHOENIX_ANATOMY_HOME=original
 for(const dir of dirs.splice(0))rmSync(dir,{force:true,recursive:true})
})
describe('Anatomy connector inventory',()=>{
 it('never marks an empty installation as ready',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phoenix-anatomy-test-'))
  dirs.push(dir);process.env.PHOENIX_ANATOMY_HOME=dir
  const result=readAnatomyConnectors()
  expect(result.entries).toHaveLength(7)
  expect(result.readyCount).toBe(0)
  expect(result.entries.every(entry=>!entry.installed)).toBe(true)
  expect(result.clinicalValidation).toBe('not-validated')
 })
 it('blocks external engines and rejects non-allowlisted host commands',()=>{
  expect(installAnatomyConnector('opencarp').status).toBe('blocked')
  expect(installAnatomyConnector('simvascular').status).toBe('blocked')
  expect(()=>installAnatomyConnector('cmd /c del' as never)).toThrow(/Unsupported/)
 })
})
