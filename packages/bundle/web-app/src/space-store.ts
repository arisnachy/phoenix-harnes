/**
 * PHOENIX Space: OS-user-scoped durable library.
 * Separate from source updates; never a clinical record or credential store.
 */
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export type SpaceKind = 'document'|'slides'|'sheet'|'image'|'game'|'app'|'code'|'file'
export interface SpaceItem {
  id: string; kind: SpaceKind; space: string; title: string; mime: string;
  content: string; sourceKey: string|null; revision: number; deleted: boolean;
  createdAt: string; updatedAt: string; bytes: number;
}
const KINDS: readonly string[] = ['document','slides','sheet','image','game','app','code','file']
const SLUG = /^[a-z][a-z0-9-]{0,39}$/u
const MAX_TEXT = 750_000
const MAX_FILE = 10_000_000
function required(value:unknown,name:string,max=180):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))throw new Error(name+' inválido')
  return value.trim()
}
function kindOf(value:unknown):SpaceKind {
  if(!KINDS.includes(value as string))throw new Error('Tipo inválido')
  return value as SpaceKind
}
function asItem(row:Record<string,unknown>):SpaceItem {
  return {id:String(row.id),kind:kindOf(row.kind),space:String(row.space),title:String(row.title),
    mime:String(row.mime),content:String(row.content),sourceKey:row.source_key===null?null:String(row.source_key),
    revision:Number(row.revision),deleted:Number(row.deleted)===1,
    createdAt:String(row.created_at),updatedAt:String(row.updated_at),bytes:Number(row.bytes)}
}
export function phoenixSpaceRoot(env:NodeJS.ProcessEnv=process.env):string {
  const base=env.LOCALAPPDATA?join(env.LOCALAPPDATA,'PHOENIX'):join(homedir(),'.phoenix')
  return resolve(env.PHOENIX_SPACE_HOME||join(base,'space'))
}
export function validateSpacePayload(raw:unknown):{
  kind:SpaceKind;space:string;title:string;mime:string;content:string;sourceKey?:string
}{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Registro inválido')
  const x=raw as Record<string,unknown>
  if(Object.keys(x).some(k=>!['kind','space','title','mime','content','sourceKey'].includes(k)))throw new Error('Campos desconocidos')
  const kind=kindOf(x.kind)
  const space=x.space===undefined?'personal':required(x.space,'Espacio',40)
  if(!SLUG.test(space))throw new Error('Espacio inválido')
  const title=required(x.title,'Título')
  const mime=required(x.mime,'MIME',120)
  if(!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu.test(mime))throw new Error('MIME inválido')
  if(typeof x.content!=='string'||Buffer.byteLength(x.content,'utf8')>MAX_TEXT)throw new Error('Contenido demasiado grande')
  const sourceKey=x.sourceKey===undefined?undefined:required(x.sourceKey,'Origen',200)
  return {kind,space,title,mime,content:x.content,...sourceKey===undefined?{}:{sourceKey}}
}
export class PhoenixSpaceStore {
  readonly root:string
  private readonly db:DatabaseSync
  constructor(root=phoenixSpaceRoot()) {
    this.root=resolve(root)
    mkdirSync(this.root,{recursive:true,mode:0o700})
    const sqlite=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const file=join(this.root,'library.sqlite')
    this.db=new sqlite.DatabaseSync(file,{timeout:5000})
    try{chmodSync(file,0o600)}catch{/*Windows uses ACLs*/}
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS space_items ('+
      'id TEXT PRIMARY KEY, kind TEXT NOT NULL, space TEXT NOT NULL, title TEXT NOT NULL, '+
      'mime TEXT NOT NULL, content TEXT NOT NULL, source_key TEXT UNIQUE, revision INTEGER NOT NULL, '+
      'deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0);'+
      'CREATE INDEX IF NOT EXISTS space_recent ON space_items(deleted,updated_at DESC);'+
      'CREATE INDEX IF NOT EXISTS space_category ON space_items(space,kind,deleted);'+
      'CREATE TABLE IF NOT EXISTS space_history ('+
      'item_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, '+
      'space TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY(item_id,revision));'
    )
  }
  close():void{this.db.close()}
  get(id:string):SpaceItem|null {
    if(!/^[a-f0-9-]{36}$/u.test(id))return null
    const row=this.db.prepare('SELECT * FROM space_items WHERE id=?').get(id) as Record<string,unknown>|undefined
    return row?asItem(row):null
  }
  bySource(key:string):SpaceItem|null {
    const row=this.db.prepare('SELECT * FROM space_items WHERE source_key=?').get(key) as Record<string,unknown>|undefined
    return row?asItem(row):null
  }
  list(filter:{q?:string;kind?:string;space?:string;deleted?:boolean}={}):SpaceItem[] {
    const q=(filter.q||'').trim().slice(0,120).toLowerCase()
    const kind=filter.kind&&filter.kind!=='all'?kindOf(filter.kind):null
    const space=filter.space&&filter.space!=='all'?required(filter.space,'Espacio',40):null
    const rows=this.db.prepare(
      'SELECT * FROM space_items WHERE deleted=? AND (? IS NULL OR kind=?) AND (? IS NULL OR space=?) '+
      'AND (? = \'\' OR instr(lower(title),?)>0 OR instr(lower(content),?)>0) ORDER BY updated_at DESC LIMIT 500'
    ).all(filter.deleted?1:0,kind,kind,space,space,q,q,q) as Record<string,unknown>[]
    return rows.map(asItem)
  }
  create(raw:unknown,id=randomUUID()):SpaceItem {
    const x=validateSpacePayload(raw)
    if(x.sourceKey) {
      const existing=this.bySource(x.sourceKey)
      if(existing)return existing // Stable origin ID; never overwrite user edits.
    }
    const now=new Date().toISOString()
    this.db.prepare('INSERT INTO space_items(id,kind,space,title,mime,content,source_key,revision,deleted,created_at,updated_at,bytes) VALUES (?,?,?,?,?,?,?,1,0,?,?,0)')
      .run(id,x.kind,x.space,x.title,x.mime,x.content,x.sourceKey??null,now,now)
    return this.get(id)!
  }
  update(id:string,expected:number,change:{title?:unknown;content?:unknown;space?:unknown;deleted?:unknown}):SpaceItem {
    const current=this.get(id)
    if(!current)throw new Error('Elemento no encontrado')
    if(!Number.isSafeInteger(expected)||expected!==current.revision)throw new Error('CONFLICT')
    if(Object.keys(change).some(k=>!['title','content','space','deleted'].includes(k)))throw new Error('Campos desconocidos')
    const title=change.title===undefined?current.title:required(change.title,'Título')
    const space=change.space===undefined?current.space:required(change.space,'Espacio',40)
    if(!SLUG.test(space))throw new Error('Espacio inválido')
    const content=change.content===undefined?current.content:change.content
    if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>MAX_TEXT)throw new Error('Contenido inválido')
    if(change.deleted!==undefined&&typeof change.deleted!=='boolean')throw new Error('Estado inválido')
    const deleted=change.deleted===undefined?current.deleted:change.deleted
    const now=new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try{
      this.db.prepare('INSERT INTO space_history(item_id,revision,title,content,space,changed_at) VALUES (?,?,?,?,?,?)')
        .run(id,current.revision,current.title,current.content,current.space,current.updatedAt)
      const written=this.db.prepare('UPDATE space_items SET title=?,content=?,space=?,deleted=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
        .run(title,content,space,deleted?1:0,now,id,expected)
      if(written.changes!==1)throw new Error('CONFLICT')
      this.db.prepare('DELETE FROM space_history WHERE item_id=? AND revision NOT IN (SELECT revision FROM space_history WHERE item_id=? ORDER BY revision DESC LIMIT 30)').run(id,id)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return this.get(id)!
  }
  history(id:string):Array<{revision:number;title:string;changedAt:string}> {
    if(!this.get(id))return []
    const rows=this.db.prepare('SELECT revision,title,changed_at FROM space_history WHERE item_id=? ORDER BY revision DESC LIMIT 30')
      .all(id) as Array<{revision:number;title:string;changed_at:string}>
    return rows.map(x=>({revision:x.revision,title:x.title,changedAt:x.changed_at}))
  }
  restore(id:string,revision:number,expected:number):SpaceItem {
    const row=this.db.prepare('SELECT title,content,space FROM space_history WHERE item_id=? AND revision=?')
      .get(id,revision) as {title:string;content:string;space:string}|undefined
    if(!row)throw new Error('Versión no encontrada')
    return this.update(id,expected,row)
  }
  importFile(title:unknown,mime:unknown,bytes:Buffer,space='personal'):SpaceItem {
    if(bytes.length<1||bytes.length>MAX_FILE)throw new Error('Archivo demasiado grande')
    const m=required(mime,'MIME',120)
    if(!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/iu.test(m))throw new Error('MIME inválido')
    const kind:SpaceKind=/^image\/(png|jpeg|webp|gif)$/iu.test(m)?'image':'file'
    const id=randomUUID()
    const dest=join(this.root,'uploads',id)
    mkdirSync(dirname(dest),{recursive:true,mode:0o700})
    writeFileSync(dest+'.tmp',bytes,{flag:'wx',mode:0o600})
    try{
      renameSync(dest+'.tmp',dest)
      const item=this.create({kind,title,mime:m,space,content:''},id)
      this.db.prepare('UPDATE space_items SET bytes=? WHERE id=?').run(bytes.length,id)
      return {...item,bytes:bytes.length}
    }catch(error){rmSync(dest,{force:true});rmSync(dest+'.tmp',{force:true});throw error}
  }
  importedBytes(id:string):Buffer|null {
    const item=this.get(id)
    if(!item||item.deleted||item.bytes<1||item.bytes>MAX_FILE)return null
    return readFileSync(join(this.root,'uploads',item.id))
  }
}
