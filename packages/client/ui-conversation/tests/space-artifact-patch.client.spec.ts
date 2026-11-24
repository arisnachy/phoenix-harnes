import { describe,it,expect } from 'vitest'
import { parseSpacePatch,patchSpaceContent } from '../src/client/chat/SpaceArtifactPatch.tsx'
describe('edit existing Space content',()=>{
  it('edits unique text only',()=>{
    expect(patchSpaceContent('hello world',{kind:'document',before:'world',after:'PHOENIX'})).toBe('hello PHOENIX')
    expect(()=>patchSpaceContent('world world',{kind:'document',before:'world',after:'x'})).toThrow('SPACE_TEXT_NOT_UNIQUE')
  })
  it('changes one slide and preserves unknown metadata',()=>{
    const content=JSON.stringify({slides:[{title:'A',body:'x',style:'blue'},{title:'B',body:'y'}],theme:'pearl'})
    const result=JSON.parse(patchSpaceContent(content,{kind:'slides',slide:0,field:'title',before:'A',after:'C'}))
    expect(result).toEqual({slides:[{title:'C',body:'x',style:'blue'},{title:'B',body:'y'}],theme:'pearl'})
  })
  it('changes only one spreadsheet cell and preserves formulas',()=>{
    const content=JSON.stringify({columns:['A','B'],rows:[['8000','=A2-7200']]})
    expect(JSON.parse(patchSpaceContent(content,{kind:'sheet',row:0,column:0,before:'8000',after:'900'})).rows).toEqual([['900','=A2-7200']])
    expect(()=>patchSpaceContent(content,{kind:'sheet',row:0,column:0,before:'1',after:'900'})).toThrow('SPACE_CONFLICT')
  })
  it('rejects unknown operations or non-file IDs',()=>{
    expect(parseSpacePatch({component:'space_patch',version:1,props:{id:'../x',revision:1,edit:{kind:'document',before:'x',after:'y'}}})).toBeNull()
  })
})
