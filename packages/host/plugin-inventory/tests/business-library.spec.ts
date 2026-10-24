import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readBusinessLibrarySnapshot } from '../src/business-library.ts'
const paths:string[]=[]
async function workspace() { const path=await mkdtemp(join(tmpdir(),'phoenix-business-'));paths.push(path);return path }
async function put(path:string,products:unknown[]){await writeFile(join(path,'library.json'),JSON.stringify({ version:1,products }))}
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
afterEach(async()=>{await Promise.all(paths.splice(0).map(path=>rm(path,{ recursive:true,force:true })))})
describe('Business Library Host projection',()=>{
  it('shows empty library on first run',async()=>{
    expect(await readBusinessLibrarySnapshot(await workspace())).toEqual({ totalCount:0,truncated:false,products:[] })
  })
  it('orders records, identifies build freshness, and never exposes user content',async()=>{
    const home=await workspace()
    const chapter={ number:1,sha256:'abcdef',words:120,path:'sensitive-path',text:'do not send' }
    const fingerprint=sha({ chapters:sha([{ number:1,sha256:'abcdef',words:120 }]),blueprint:null,covers:[] })
    await put(home,[
      { id:'novel-1',title:'Historia <nueva>',type:'book',updatedAt:'2026-10-17T12:00:00Z',chapters:[chapter],files:[{ name:'private.pdf',token:'secret' }],listings:[{ stage:'review-required',buyer:'sensitive@example.com' }],sales:[{ source:'order-secret' }],build:{ fingerprint } },
      { id:'software-2',title:'Sistema',type:'software',updatedAt:'2026-10-17T13:00:00Z',chapters:[],files:[],listings:[],build:{ fingerprint:'invalid' } },
    ])
    const snapshot=await readBusinessLibrarySnapshot(home)
    expect(snapshot.products.map(p=>p.id)).toEqual(['software-2','novel-1'])
    expect(snapshot.products[1]).toMatchObject({ title:'Historia <nueva>',buildStatus:'current',chapterCount:1,fileCount:1,listingStage:'review-required',writtenWords:120 })
    expect(snapshot.products[0]?.buildStatus).toBe('stale')
    for(const secret of ['private.pdf','sensitive-path','do not send','order-secret','sensitive@example.com','secret'])expect(JSON.stringify(snapshot)).not.toContain(secret)
  })
  it('rejects unsupported indexes and symlinked files',async()=>{
    const home=await workspace()
    await writeFile(join(home,'library.json'),'{"version":5,"products":[]}')
    await expect(readBusinessLibrarySnapshot(home)).rejects.toThrow(/Versión/)
    await rm(join(home,'library.json'))
    const outside=join(await workspace(),'other.json');await writeFile(outside,'{}')
    await symlink(outside,join(home,'library.json'))
    await expect(readBusinessLibrarySnapshot(home)).rejects.toThrow(/inválido/)
  })
  it('includes services and normalizes unsupported commercial stages', async () => {
    const home = await workspace()
    await put(home, [
      { id:'consulting-service', title:'Servicio de consultoría', type:'service', updatedAt:'2026-10-17', files:[], chapters:[], listings:[{ stage:'made-up-status' }] },
    ])
    const snapshot = await readBusinessLibrarySnapshot(home)
    expect(snapshot.products).toHaveLength(1)
    expect(snapshot.products[0]?.type).toBe('service')
    expect(snapshot.products[0]?.listingStage).toBe('not-prepared')
  })
  it('caps response to 300 entries',async()=>{
    const home=await workspace()
    await put(home,Array.from({ length:301 },(_,i)=>({ id:`product-${i}`,title:`Item ${i}`,type:'other',updatedAt:'2026-10-17' })))
    const snapshot=await readBusinessLibrarySnapshot(home)
    expect(snapshot.totalCount).toBe(301)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.products).toHaveLength(300)
  })
  it('reads actual CLI creations and invalidates the shelf when a chapter changes', async () => {
    const home = await workspace()
    const cli = fileURLToPath(new URL('../../../../scripts/phoenix-business.mjs', import.meta.url))
    const invoke = (...args: string[]): Record<string, unknown> => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        env: { ...process.env, PHOENIX_BUSINESS_HOME: home },
      })
      expect(result.status).toBe(0)
      return (JSON.parse(result.stdout) as { result: Record<string, unknown> }).result
    }
    const id = invoke('init', 'book', 'Libro de prueba editorial').id as string
    const chapter = join(home, 'capitulo.md')
    await writeFile(chapter, 'Escena escrita con continuidad y personajes. '.repeat(110))
    invoke('chapter', id, '1', chapter)
    expect((await readBusinessLibrarySnapshot(home)).products[0]?.buildStatus).toBe('not-built')
    invoke('compile', id, '--author', 'Prueba Editorial', '--chapters', '1', '--words', '100')
    const compiled = (await readBusinessLibrarySnapshot(home)).products[0]
    expect(compiled).toMatchObject({ chapterCount: 1, fileCount: 4, buildStatus: 'current' })
    await writeFile(chapter, 'Una versión distinta de la historia. '.repeat(110))
    invoke('chapter', id, '1', chapter)
    expect((await readBusinessLibrarySnapshot(home)).products[0]?.buildStatus).toBe('stale')
  })

})
