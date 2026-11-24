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
      'space TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY(item_id,revision));'+
      'CREATE TABLE IF NOT EXISTS space_forks(child_id TEXT PRIMARY KEY,parent_id TEXT NOT NULL,base_revision INTEGER NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS space_fork_parent ON space_forks(parent_id);'+
      'CREATE TABLE IF NOT EXISTS space_dependencies(target_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,PRIMARY KEY(target_id,source_id));'+
      'CREATE INDEX IF NOT EXISTS space_dependency_source ON space_dependencies(source_id);'
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
    return this.updateInternal(id,expected,change,true)
  }
  private updateInternal(id:string,expected:number,change:{title?:unknown;content?:unknown;space?:unknown;deleted?:unknown},transaction:boolean):SpaceItem {
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
    if(title===current.title&&space===current.space&&content===current.content&&deleted===current.deleted)return current
    const now=new Date().toISOString()
    if(transaction)this.db.exec('BEGIN IMMEDIATE')
    try{
      this.db.prepare('INSERT INTO space_history(item_id,revision,title,content,space,changed_at) VALUES (?,?,?,?,?,?)')
        .run(id,current.revision,current.title,current.content,current.space,current.updatedAt)
      const written=this.db.prepare('UPDATE space_items SET title=?,content=?,space=?,deleted=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
        .run(title,content,space,deleted?1:0,now,id,expected)
      if(written.changes!==1)throw new Error('CONFLICT')
      this.db.prepare('DELETE FROM space_history WHERE item_id=? AND revision NOT IN (SELECT revision FROM space_history WHERE item_id=? ORDER BY revision DESC LIMIT 30)').run(id,id)
      if(transaction)this.db.exec('COMMIT')
    }catch(error){if(transaction)this.db.exec('ROLLBACK');throw error}
    return this.get(id)!
  }

  /** Return a prior version without changing the active item. */
  version(id:string,revision:number):{title:string;content:string;space:string}|null {
    const current=this.get(id)
    if(!current||current.deleted)return null
    if(current.revision===revision)return {title:current.title,content:current.content,space:current.space}
    return (this.db.prepare('SELECT title,content,space FROM space_history WHERE item_id=? AND revision=?')
      .get(id,revision) as {title:string;content:string;space:string}|undefined)??null
  }
  /** Explicitly create one editable alternate; binary uploads are not duplicated. */
  fork(id:string,expected:number,title:unknown):SpaceItem {
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const base=this.get(id)
      if(!base||base.deleted||base.bytes>0)throw new Error('Elemento no encontrado o formato inválido')
      if(base.revision!==expected)throw new Error('CONFLICT')
      const count=this.db.prepare('SELECT count(*) AS n FROM space_forks f JOIN space_items i ON i.id=f.child_id WHERE f.parent_id=? AND i.deleted=0').get(id) as {n:number}
      if(count.n>=8)throw new Error('Límite de alternativas')
      const child=this.create({kind:base.kind,space:base.space,title,mime:base.mime,content:base.content})
      this.db.prepare('INSERT INTO space_forks(child_id,parent_id,base_revision) VALUES (?,?,?)').run(child.id,id,expected)
      this.db.exec('COMMIT')
      return child
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  forkOrigin(id:string):{parentId:string;baseRevision:number}|null {
    const row=this.db.prepare('SELECT parent_id,base_revision FROM space_forks WHERE child_id=?').get(id) as {parent_id:string;base_revision:number}|undefined
    return row?{parentId:row.parent_id,baseRevision:row.base_revision}:null
  }
  /** Fast-forward only. Concurrent parent changes require human reconciliation. */
  mergeFork(id:string,expectedChild:number,expectedParent:number):SpaceItem {
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const origin=this.forkOrigin(id),child=this.get(id)
      if(!origin||!child||child.deleted||child.bytes>0)throw new Error('Alternativa no encontrada')
      const parent=this.get(origin.parentId)
      if(!parent||parent.deleted||parent.space!==child.space||parent.kind!==child.kind||parent.bytes>0)throw new Error('Origen inválido')
      if(child.revision!==expectedChild||parent.revision!==expectedParent||origin.baseRevision!==expectedParent)throw new Error('CONFLICT')
      // Preserve the original title and identity; only the explicit alternate content is adopted.
      const updated=this.updateInternal(parent.id,expectedParent,{content:child.content},false)
      this.db.prepare('UPDATE space_forks SET base_revision=? WHERE child_id=?').run(updated.revision,id)
      this.db.exec('COMMIT')
      return updated
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  /** Replace dependency declarations using observed source revisions; never move data. */
  setDependencies(id:string,expected:number,raw:unknown):void {
    if(!Array.isArray(raw)||raw.length>16)throw new Error('Límite de dependencias')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const target=this.get(id)
      if(!target||target.deleted)throw new Error('Elemento no encontrado')
      if(target.revision!==expected)throw new Error('CONFLICT')
      const seen=new Set<string>()
      for(const entry of raw){
        if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||!Number.isSafeInteger(entry.revision))throw new Error('Dependencia inválida')
        const source=this.get(entry.id)
        if(!source||source.deleted||source.space!==target.space||source.id===id||seen.has(source.id))throw new Error('Dependencia inválida')
        if(source.revision!==entry.revision)throw new Error('CONFLICT')
        const cycle=this.db.prepare('WITH RECURSIVE reach(id) AS (SELECT ? UNION SELECT d.source_id FROM space_dependencies d JOIN reach r ON d.target_id=r.id) SELECT id FROM reach WHERE id=?').get(source.id,id)
        if(cycle)throw new Error('Dependencia cíclica inválida')
        seen.add(source.id)
      }
      this.db.prepare('DELETE FROM space_dependencies WHERE target_id=?').run(id)
      for(const entry of raw)this.db.prepare('INSERT INTO space_dependencies(target_id,source_id,source_revision) VALUES (?,?,?)').run(id,entry.id,entry.revision)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  /** Derive staleness transitively from live source revisions; no extra snapshots. */
  dependencies(id:string):{sources:Array<{id:string;revision:number;currentRevision:number|null;stale:boolean}>;stale:boolean;truncated:boolean} {
    const target=this.get(id)
    if(!target||target.deleted)throw new Error('Elemento no encontrado')
    const seen=new Set<string>(), queue=[id]
    let stale=false,truncated=false
    const sources:Array<{id:string;revision:number;currentRevision:number|null;stale:boolean}>=[]
    while(queue.length){
      const current=queue.shift()!
      if(seen.has(current))continue
      if(seen.size>=128){truncated=true;break}
      seen.add(current)
      const rows=this.db.prepare('SELECT source_id,source_revision FROM space_dependencies WHERE target_id=? ORDER BY source_id').all(current) as Array<{source_id:string;source_revision:number}>
      for(const row of rows){
        const source=this.get(row.source_id)
        const valid=source&&!source.deleted&&source.space===target.space
        const revision=valid?source.revision:null
        const changed=revision!==row.source_revision
        if(changed)stale=true
        if(current===id)sources.push({id:row.source_id,revision:row.source_revision,currentRevision:revision,stale:changed})
        if(valid&&!seen.has(row.source_id))queue.push(row.source_id)
      }
    }
    return {sources,stale:stale||truncated,truncated}
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
