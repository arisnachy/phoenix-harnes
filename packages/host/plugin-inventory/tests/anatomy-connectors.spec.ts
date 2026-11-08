import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
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
 it('shows verified sequential progress without declaring clinical readiness',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phoenix-anatomy-sequential-'))
  dirs.push(dir);process.env.PHOENIX_ANATOMY_HOME=dir
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({
   schema:2,components:{monai:{status:'error',reason:'Import verification failed'}},
   bootstrap:{status:'running',component:'all',current:'monai-nnunet',completed:1,total:7}
  }))
  const snapshot=readAnatomyConnectors()
  expect(snapshot.progress).toEqual({completed:1,total:7,current:'monai-nnunet',status:'running'})
  expect(snapshot.entries.find(x=>x.id==='monai-nnunet')?.detail).toMatch(/Python/)
  expect(snapshot.readyCount).toBe(0)
  expect(snapshot.clinicalValidation).toBe('not-validated')
 })
 it('blocks external engines and rejects non-allowlisted host commands',()=>{
  expect(installAnatomyConnector('opencarp').status).toBe('blocked')
  expect(installAnatomyConnector('simvascular').status).toBe('blocked')
  expect(()=>installAnatomyConnector('cmd /c del' as never)).toThrow(/Unsupported/)
 })
})
