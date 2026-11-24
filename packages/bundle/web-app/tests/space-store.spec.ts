import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PhoenixSpaceStore, phoenixSpaceRoot, validateSpacePayload } from '../src/space-store.ts'
import { exportPptx, exportXlsx, zipOffice } from '../src/space-office.ts'

const roots:string[]=[]
const stores:PhoenixSpaceStore[]=[]
function store():PhoenixSpaceStore {
  const root=mkdtempSync(join(tmpdir(),'phoenix-space-test-'))
  roots.push(root)
  const instance=new PhoenixSpaceStore(root)
  stores.push(instance)
  return instance
}
afterEach(()=>{
  stores.splice(0).forEach(s=>s.close())
  roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}))
})
function payload(content='Hola Phoenix'){
  return {kind:'document',space:'docencia',title:'Informe',mime:'text/markdown',content}
}
function parts(buffer:Buffer):Record<string,string> {
  const out:Record<string,string>={}
  let offset=0
  while(offset+30<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){
    const size=buffer.readUInt32LE(offset+18)
    const nameLength=buffer.readUInt16LE(offset+26)
    const extraLength=buffer.readUInt16LE(offset+28)
    const name=buffer.subarray(offset+30,offset+30+nameLength).toString('utf8')
    const start=offset+30+nameLength+extraLength
    out[name]=buffer.subarray(start,start+size).toString('utf8')
    offset=start+size
  }
  return out
}

describe('PHOENIX Space local persistence',()=>{
  it('keeps library data out of the repository and accepts explicit isolated root',()=>{
    const root=phoenixSpaceRoot({LOCALAPPDATA:'C:\\Users\\Local',PHOENIX_SPACE_HOME:'/tmp/phoenix-data'})
    expect(root).toContain('phoenix-data')
  })
  it('validates IDs, MIME, kind, payload size and prototype-shaped unexpected data',()=>{
    expect(()=>validateSpacePayload({...payload(),kind:'clinical'})).toThrow()
    expect(()=>validateSpacePayload({...payload(),space:'../secrets'})).toThrow()
    expect(()=>validateSpacePayload({...payload(),mime:'text/html\nx'})).toThrow()
    expect(()=>validateSpacePayload({...payload(),unexpected:'field'})).toThrow()
    expect(()=>validateSpacePayload({...payload(),content:'x'.repeat(750001)})).toThrow()
  })
  it('indexes by title, content, type and space with durable reopen',()=>{
    const db=store()
    const one=db.create({...payload(),sourceKey:'artifact:abc'})
    const duplicate=db.create({...payload('Other revision'),sourceKey:'artifact:abc'})
    expect(one.id).toBe(duplicate.id)
    expect(duplicate.content).toBe('Hola Phoenix')
    expect(db.list({q:'phoenix'})).toHaveLength(1)
    expect(db.list({q:'informe',kind:'document',space:'docencia'})).toHaveLength(1)
    expect(db.list({kind:'sheet'})).toHaveLength(0)
    db.close()
    stores.pop()
    const reopened=new PhoenixSpaceStore(db.root)
    stores.push(reopened)
    expect(reopened.get(one.id)?.content).toBe('Hola Phoenix')
  })
  it('rejects stale edits and supports recovery and soft-delete',()=>{
    const db=store()
    const item=db.create(payload())
    const edited=db.update(item.id,1,{title:'Informe final',content:'Revisión dos'})
    expect(edited.revision).toBe(2)
    expect(()=>db.update(item.id,1,{content:'Cambio perdido'})).toThrow('CONFLICT')
    expect(db.history(item.id)).toMatchObject([{revision:1,title:'Informe'}])
    const restored=db.restore(item.id,1,2)
    expect(restored.content).toBe('Hola Phoenix')
    const deleted=db.update(item.id,3,{deleted:true})
    expect(deleted.deleted).toBe(true)
    expect(db.list()).toHaveLength(0)
    expect(db.list({deleted:true})).toHaveLength(1)
    expect(db.update(item.id,4,{deleted:false}).deleted).toBe(false)
  })
  it('preserves user files without exposing arbitrary filesystem paths',()=>{
    const db=store()
    const data=Buffer.from('Portable content')
    const imported=db.importFile('note.txt','text/plain',data,'personal')
    expect(imported.kind).toBe('file')
    expect(imported.bytes).toBe(data.length)
    expect(db.importedBytes(imported.id)).toEqual(data)
    expect(db.importedBytes('../file')).toBeNull()
    db.update(imported.id,1,{deleted:true})
    expect(db.importedBytes(imported.id)).toBeNull()
  })
})

describe('native PowerPoint and Excel exports',()=>{
  it('makes a conventional ZIP archive with local and central directory',()=>{
    const zip=zipOffice([{name:'hello.txt',data:'PHOENIX'}])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.readUInt32LE(zip.length-22)).toBe(0x06054b50)
    expect(parts(zip)['hello.txt']).toBe('PHOENIX')
  })
  it('emits slides and Office relationships with XML-escaped user text',()=>{
    const bytes=exportPptx(JSON.stringify({slides:[{title:'Salud & Ciencia',body:'Una <idea>'},
      {title:'Investigación',body:'Resultados medidos'}]}))
    const files=parts(bytes)
    expect(Object.keys(files)).toContain('ppt/slides/slide2.xml')
    expect(files['ppt/presentation.xml']).toContain('rId3')
    expect(files['ppt/slides/slide1.xml']).toContain('Salud &amp; Ciencia')
    expect(files['ppt/slides/slide1.xml']).toContain('&lt;idea&gt;')
    expect(()=>exportPptx(JSON.stringify({slides:[]}))).toThrow()
  })
  it('exports multirow worksheets and rejects suspicious executable formula prefixes',()=>{
    const bytes=exportXlsx(JSON.stringify({
      columns:['Importe','Observación'],rows:[['12','Ingresos'],['=SUM(A2:A2)','Total'],['=WEBSERVICE("https://example.com")','No ejecutar']],
    }))
    const files=parts(bytes)
    expect(files['xl/worksheets/sheet1.xml']).toContain('<f>SUM(A2:A2)</f>')
    expect(files['xl/worksheets/sheet1.xml']).toContain('WEBSERVICE')
    expect(files['xl/worksheets/sheet1.xml']).not.toContain('<f>WEBSERVICE')
    expect(files['xl/workbook.xml']).toContain('fullCalcOnLoad')
    expect(()=>exportXlsx(JSON.stringify({columns:[],rows:[]}))).toThrow()
  })
})
describe('connected workspace revisions and provenance',()=>{
  it('does not create revisions for unchanged writes and previews history without mutation',()=>{
    const db=store(), item=db.create(payload('original'))
    expect(db.update(item.id,1,{content:'original'}).revision).toBe(1)
    expect(db.history(item.id)).toHaveLength(0)
    db.update(item.id,1,{content:'new'})
    expect(db.version(item.id,1)?.content).toBe('original')
    expect(db.get(item.id)?.content).toBe('new')
  })
  it('forks and merges only explicit unchanged-parent alternatives',()=>{
    const db=store(), parent=db.create(payload('base'))
    const a=db.fork(parent.id,1,'Variant A'), b=db.fork(parent.id,1,'Variant B')
    db.update(a.id,1,{content:'approved'})
    db.update(b.id,1,{content:'other'})
    expect(db.get(parent.id)?.content).toBe('base')
    expect(db.mergeFork(a.id,2,1).content).toBe('approved')
    expect(()=>db.mergeFork(b.id,2,2)).toThrow('CONFLICT')
    expect(db.get(parent.id)?.title).toBe(parent.title)
    expect(db.version(parent.id,1)?.content).toBe('base')
  })
  it('detects transitive staleness, rejects cycles and isolates spaces',()=>{
    const db=store(), a=db.create(payload('source')), b=db.create(payload('report')), c=db.create(payload('slides'))
    const other=db.create({...payload(),space:'other'})
    db.setDependencies(b.id,1,[{id:a.id,revision:1}])
    db.setDependencies(c.id,1,[{id:b.id,revision:1}])
    expect(db.dependencies(c.id).stale).toBe(false)
    expect(()=>db.setDependencies(a.id,1,[{id:c.id,revision:1}])).toThrow(/cíclica/)
    expect(()=>db.setDependencies(a.id,1,[{id:other.id,revision:1}])).toThrow(/inválida/)
    db.update(a.id,1,{content:'changed'})
    expect(db.dependencies(c.id).stale).toBe(true)
    expect(()=>db.setDependencies(b.id,1,[{id:a.id,revision:1}])).toThrow('CONFLICT')
    db.setDependencies(b.id,1,[{id:a.id,revision:2}])
    expect(db.dependencies(c.id).stale).toBe(false)
    db.update(a.id,2,{deleted:true})
    expect(db.dependencies(c.id).stale).toBe(true)
  })
  it('bounds active alternatives and rejects binary forks',()=>{
    const db=store(), parent=db.create(payload())
    for(let i=0;i<8;i++)db.fork(parent.id,1,'Alternative '+i)
    expect(()=>db.fork(parent.id,1,'Overflow')).toThrow(/Límite/)
    const imported=db.importFile('file.txt','text/plain',Buffer.from('x'))
    expect(()=>db.fork(imported.id,1,'Copy')).toThrow()
  })
})
