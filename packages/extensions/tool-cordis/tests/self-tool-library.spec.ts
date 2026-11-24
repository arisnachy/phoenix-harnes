import { mkdtemp,rm,readdir,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe,it,expect } from 'vitest'
import { SelfToolLibrary,parseSelfRecipe,runSelfRecipe } from '../src/self-tool-library.ts'
const recipe={id:'scale-number',name:'Scale number',inputs:['amount'],steps:[{id:'scaled',op:'multiply',args:['amount',2]}],output:'scaled'}
const fixtures=[{values:{amount:2},expected:4},{values:{amount:3},expected:6}]
describe('persistent self tool library',()=>{
  it('tests, persists and reuses exact immutable versions after reopening; never saves run inputs',async()=>{
    const root=await mkdtemp(join(tmpdir(),'phoenix-self-tool-'))
    try{
      const lib=new SelfToolLibrary(root)
      expect((await lib.save(recipe,fixtures,0)).revision).toBe(1)
      const reopened=new SelfToolLibrary(root)
      expect(await reopened.execute(recipe.id,{amount:123456})).toMatchObject({revision:1,result:246912})
      expect((await reopened.list()).tools[0]?.id).toBe(recipe.id)
      await expect(reopened.save(recipe,fixtures,0)).rejects.toThrow('STALE_REVISION')
      const updated={...recipe,steps:[{id:'scaled',op:'multiply',args:['amount',3]}]}
      await reopened.save(updated,[{values:{amount:2},expected:6},{values:{amount:3},expected:9}],1)
      expect((await reopened.execute(recipe.id,{amount:4})).result).toBe(12)
      expect((await reopened.execute(recipe.id,{amount:4},1)).result).toBe(8)
      const stored=await Promise.all((await readdir(root)).map(name=>readFile(join(root,name),'utf8')))
      expect(stored.join('')).not.toContain('123456')
      expect(stored.join('')).not.toContain('fixtures')
    }finally{await rm(root,{recursive:true,force:true})}
  })
  it('rejects failing fixtures, arbitrary code, traversal and nonfinite results',async()=>{
    const root=await mkdtemp(join(tmpdir(),'phoenix-self-tool-'))
    try{
      const lib=new SelfToolLibrary(root)
      await expect(lib.save(recipe,[{values:{amount:2},expected:99},fixtures[1]],0)).rejects.toThrow('FIXTURE_FAILED')
      expect(()=>parseSelfRecipe({...recipe,id:'../escape'})).toThrow()
      expect(()=>parseSelfRecipe({...recipe,steps:[{id:'scaled',op:'eval',args:['amount',2]}]})).toThrow()
      const divide=parseSelfRecipe({...recipe,steps:[{id:'scaled',op:'divide',args:['amount',0]}]})
      expect(()=>runSelfRecipe(divide,{amount:2})).toThrow('DIVISION_BY_ZERO')
      expect((await lib.list()).tools).toEqual([])
    }finally{await rm(root,{recursive:true,force:true})}
  })
})
