/**
 * PHOENIX Health: local encrypted record service (clinical pilot).
 * All clinical payloads encrypted with AES-256-GCM, bound to record identity/version.
 * Authenticated roles and audited transactions; no model-facing service.
 */
import type { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, chmodSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Role = 'admin'|'clinician'|'psychologist'|'nurse'|'reception'|'lab'|'radiology'|'pharmacy'|'billing'
type Kind = 'patients'|'encounters'|'appointments'|'orders'|'prescriptions'|'inventory'|'invoices'|'followups'
type Actor = { username:string; role:Role; org:string }
export type ClinicActor = Readonly<Actor>
type RecordData = Record<string,unknown>
type Row = { id:string; org:string; kind:Kind; version:number; iv:string; tag:string; payload:string; created_at:string; updated_at:string }
type Staff = { username:string; org:string; role:Role; salt:string; digest:string }
type Session = { actor:Actor; expires:number; csrf:string }
const TYPES = new Set<Kind>(['patients','encounters','appointments','orders','prescriptions','inventory','invoices','followups'])
const ROLES = new Set<Role>(['admin','clinician','psychologist','nurse','reception','lab','radiology','pharmacy','billing'])
const READ:Record<Kind,readonly Role[]> = {
  patients:['admin','clinician','psychologist','nurse','reception'],
  encounters:['admin','clinician','psychologist','nurse'],
  appointments:['admin','clinician','psychologist','nurse','reception'],
  orders:['admin','clinician','psychologist','nurse','lab','radiology'],
  prescriptions:['admin','clinician','pharmacy'],
  inventory:['admin','pharmacy'],
  invoices:['admin','billing'],
  followups:['admin','clinician','psychologist','nurse','reception'],
}
const WRITE:Record<Kind,readonly Role[]> = {
  patients:['admin','clinician','reception'],
  encounters:['clinician','psychologist'],
  appointments:['admin','reception','clinician','psychologist'],
  orders:['clinician','psychologist'],
  prescriptions:['clinician'],
  inventory:['admin','pharmacy'],
  invoices:['admin','billing'],
  followups:['admin','clinician','psychologist','nurse','reception'],
}
const MAX=200_000
function fail(message:string):never { throw new Error(message) }
function str(x:unknown,label:string,max=512):string {
  if(typeof x!=='string'||x.trim().length<1||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(x))fail(label+' inválido')
  return x.trim()
}
function text(x:unknown,label:string,max=4000):string {return str(x,label,max)}
function obj(x:unknown):RecordData {
  if(!x||typeof x!=='object'||Array.isArray(x))fail('Datos inválidos')
  return x as RecordData
}
function safePassword(p:unknown):string {
  if(typeof p!=='string'||p.length<16||p.length>256)fail('La contraseña requiere al menos 16 caracteres')
  return p
}
function hash(password:string,salt:string):string {return scryptSync(password,Buffer.from(salt,'hex'),32).toString('hex')}
function eq(a:string,b:string):boolean {
  const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length===y.length&&timingSafeEqual(x,y)
}
function date(x:unknown):string {const s=str(x,'Fecha',48);if(!/^\d{4}-\d\d-\d\dT/u.test(s)||!Number.isFinite(Date.parse(s)))fail('Fecha ISO requerida');return new Date(s).toISOString()}
function withLimit(value:unknown):RecordData {const x=obj(value);if(JSON.stringify(x).length>MAX)fail('Registro excede el límite');return x}
export class HealthClinicStore {
  private readonly db:DatabaseSync
  private readonly dbPath:string
  private key:Buffer|undefined
  private readonly sessions=new Map<string,Session>()
  constructor(dbPath:string) {
    if(typeof dbPath!=='string'||dbPath===':memory:')fail('La clínica requiere una ruta persistente privada')
    this.dbPath=dbPath
    mkdirSync(dirname(dbPath),{recursive:true,mode:0o700})
    // Load experimental SQLite only when an operator actually enables the clinical module.
    // A static import emitted SQLite warnings in every ordinary PHOENIX CLI session on Node 22.
    const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    this.db=new sqlite.DatabaseSync(dbPath,{timeout:5000})
    try {chmodSync(dbPath,0o600)}catch {/* Windows uses directory ACLs */ }
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;")
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS health_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS health_staff (username TEXT PRIMARY KEY, org TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, digest TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS health_records (id TEXT PRIMARY KEY, org TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"+
      "CREATE INDEX IF NOT EXISTS health_records_org_kind ON health_records(org,kind);"+
      "CREATE TABLE IF NOT EXISTS health_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL, happened TEXT NOT NULL, prior_hash TEXT NOT NULL, hash TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS health_reminders (appointment_id TEXT PRIMARY KEY, org TEXT NOT NULL, status TEXT NOT NULL, sender TEXT NOT NULL, provider_id TEXT, started TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS health_patient_access (org TEXT NOT NULL, patient_id TEXT NOT NULL, staff_id TEXT NOT NULL, purpose TEXT NOT NULL, granted_by TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(org,patient_id,staff_id));"
    )
  }
  close():void {this.sessions.clear();this.key?.fill(0);this.key=undefined;this.db.close()}
  private meta(name:string):string|undefined {
    return (this.db.prepare('SELECT value FROM health_meta WHERE name=?').get(name) as {value:string}|undefined)?.value
  }
  initialized():boolean {return this.meta('salt')!==undefined}
  /** Bootstrap must be accepted only from a loopback peer on a loopback-bound Host. */
  initialize(username:unknown,password:unknown,organization:unknown):void {
    if(this.initialized())fail('La clínica ya fue configurada')
    const user=str(username,'Usuario',80);if(!/^[a-zA-Z][a-zA-Z0-9._-]{2,79}$/u.test(user))fail('Usuario inválido')
    const pass=safePassword(password),org=str(organization,'Institución',100)
    const salt=randomBytes(16).toString('hex'), staffSalt=randomBytes(16).toString('hex')
    const key=scryptSync(pass,Buffer.from(salt,'hex'),32)
    const verify=createHmac('sha256',key).update('PHOENIX-HEALTH-v1').digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if(this.initialized())fail('La clínica ya fue configurada')
      this.db.prepare('INSERT INTO health_meta VALUES (?,?)').run('salt',salt)
      this.db.prepare('INSERT INTO health_meta VALUES (?,?)').run('verify',verify)
      this.db.prepare('INSERT INTO health_staff VALUES (?,?,?,?,?)').run(user,org,'admin',staffSalt,hash(pass,staffSalt))
      this.db.exec('COMMIT');this.key=key
    }catch(e){this.db.exec('ROLLBACK');key.fill(0);throw e}
  }
  login(username:unknown,password:unknown):{cookie:string;csrf:string;actor:Actor} {
    const user=str(username,'Usuario',80),pass=str(password,'Contraseña',256)
    const s=this.db.prepare('SELECT * FROM health_staff WHERE username=?').get(user) as Staff|undefined
    // Same KDF work on bad usernames to avoid trivial timing enumeration.
    const salt=s?.salt??'00000000000000000000000000000000'
    const expected=s?.digest??'0'.repeat(64)
    if(!eq(hash(pass,salt),expected)||!s)fail('Credenciales incorrectas')
    if(this.key===undefined){
      if(s.role!=='admin')fail('El administrador debe desbloquear la clínica tras reiniciar el Host')
      const derived=scryptSync(pass,Buffer.from(this.meta('salt')??'','hex'),32)
      const proof=createHmac('sha256',derived).update('PHOENIX-HEALTH-v1').digest('hex')
      if(!eq(proof,this.meta('verify')??'')){derived.fill(0);fail('No se pudo desbloquear el expediente cifrado')}
      this.key=derived
    }
    this.verifyAudit()
    const cookie=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex')
    for(const [id,entry] of this.sessions){if(entry.expires<Date.now())this.sessions.delete(id)}
    if(this.sessions.size>=128)fail('Demasiadas sesiones clínicas activas')
    this.sessions.set(cookie,{actor:{username:s.username,org:s.org,role:s.role},csrf,expires:Date.now()+8*3600_000})
    return {cookie,csrf,actor:{username:s.username,org:s.org,role:s.role}}
  }
  session(cookie:string|undefined,csrf?:string,mutation=false):{actor:Actor;csrf:string} {
    const s=cookie?this.sessions.get(cookie):undefined
    if(!s||Date.now()>s.expires||!this.key)fail('Sesión clínica caducada')
    if(mutation&&(!csrf||csrf!==s.csrf))fail('Protección CSRF: solicitud rechazada')
    return {actor:{...s.actor},csrf:s.csrf}
  }
  logout(cookie:string|undefined):void {if(cookie)this.sessions.delete(cookie)}
  staff(actor:Actor):readonly {username:string;role:Role;org:string}[]{
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    return (this.db.prepare('SELECT username,role,org FROM health_staff WHERE org=? ORDER BY username').all(actor.org) as Staff[])
      .map(x=>({username:x.username,role:x.role,org:x.org}))
  }
  createStaff(actor:Actor,value:unknown):void {
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    const x=obj(value),username=str(x.username,'Usuario',80),pass=safePassword(x.password),role=str(x.role,'Rol',40) as Role
    if(!ROLES.has(role)||role==='admin'||!(/^[a-zA-Z][a-zA-Z0-9._-]{2,79}$/u.test(username)))
      fail('Usuario o rol inválido: nuevas cuentas administradoras requieren gestión de claves')
    const salt=randomBytes(16).toString('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO health_staff VALUES (?,?,?,?,?)').run(username,actor.org,role,salt,hash(pass,salt))
      this.audit(actor,'staff.create',username)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  private encryptionKey():Buffer {if(!this.key)fail('Expediente clínico bloqueado');return this.key}
  private seal(id:string,org:string,kind:Kind,version:number,data:RecordData):{iv:string;tag:string;payload:string} {
    const iv=randomBytes(12),key=this.encryptionKey(),cipher=createCipheriv('aes-256-gcm',key,iv)
    cipher.setAAD(Buffer.from([id,org,kind,String(version)].join(':')))
    const raw=Buffer.from(JSON.stringify(data),'utf8')
    const encrypted=Buffer.concat([cipher.update(raw),cipher.final()])
    return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),payload:encrypted.toString('base64')}
  }
  private open(row:Row):RecordData {
    const decipher=createDecipheriv('aes-256-gcm',this.encryptionKey(),Buffer.from(row.iv,'hex'))
    decipher.setAAD(Buffer.from([row.id,row.org,row.kind,String(row.version)].join(':')))
    decipher.setAuthTag(Buffer.from(row.tag,'hex'))
    const payload=Buffer.concat([decipher.update(Buffer.from(row.payload,'base64')),decipher.final()]).toString('utf8')
    return obj(JSON.parse(payload) as unknown)
  }
  /** Consistent, locally encrypted recovery point generated by SQLite's online backup API. */
  async backup(actor:Actor):Promise<{name:string;records:number}> {
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    this.encryptionKey()
    const directory=join(dirname(this.dbPath),'backups')
    mkdirSync(directory,{recursive:true,mode:0o700})
    const name='clinic-'+Date.now().toString(36)+'-'+randomBytes(6).toString('hex')+'.sqlite'
    const path=join(directory,name)
    const sqlite=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    await sqlite.backup(this.db,path)
    chmodSync(path,0o600)
    const check=new sqlite.DatabaseSync(path,{readOnly:true})
    let records=0
    try{
      const status=check.prepare('PRAGMA integrity_check').get() as {integrity_check:string}
      if(status.integrity_check!=='ok')fail('Integridad de la copia no confirmada')
      const count=check.prepare('SELECT COUNT(*) AS records FROM health_records').get() as {records:number}
      records=count.records
    }finally{check.close()}
    this.audit(actor,'backup.create',name)
    return {name,records}
  }
  backups(actor:Actor):readonly string[] {
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    try {return readdirSync(join(dirname(this.dbPath),'backups')).filter(x=>/^clinic-[0-9a-z]+-[0-9a-f]{12}\.sqlite$/u.test(x))}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
  }
  /** Staff-patient care links are mandatory for clinical roles; membership alone never grants access. */
  private hasPatient(actor:Actor,patientId:string):boolean {
    if(!['clinician','psychologist','nurse'].includes(actor.role))return true
    return this.db.prepare('SELECT 1 FROM health_patient_access WHERE org=? AND patient_id=? AND staff_id=?')
      .get(actor.org,patientId,actor.username)!==undefined
  }
  private requirePatient(actor:Actor,patientId:string):void {
    if(!this.hasPatient(actor,patientId))fail('Paciente no asignado a este profesional')
  }
  /** An authorized reception/admin explicitly assigns an existing patient to a professional. */
  assignPatient(actor:Actor,patientId:string,username:string,purpose:string):void {
    if(actor.role!=='admin'&&actor.role!=='reception')fail('Solo admisión o administración puede asignar pacientes')
    const patient=this.db.prepare("SELECT id FROM health_records WHERE id=? AND org=? AND kind='patients'").get(patientId,actor.org)
    if(!patient)fail('Paciente inexistente en esta institución')
    const staff=this.db.prepare('SELECT org,role FROM health_staff WHERE username=?').get(username) as {org:string;role:Role}|undefined
    if(!staff||staff.org!==actor.org||!['clinician','psychologist','nurse'].includes(staff.role))fail('Profesional no autorizado en la institución')
    const reason=str(purpose,'Motivo asistencial',160)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR REPLACE INTO health_patient_access VALUES (?,?,?,?,?,?)')
        .run(actor.org,patientId,username,reason,actor.username,new Date().toISOString())
      this.audit(actor,'patient.assign',patientId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  revokePatient(actor:Actor,patientId:string,username:string):void {
    if(actor.role!=='admin'&&actor.role!=='reception')fail('Acceso denegado')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result=this.db.prepare('DELETE FROM health_patient_access WHERE org=? AND patient_id=? AND staff_id=?')
        .run(actor.org,patientId,username)
      if(Number(result.changes)!==1)fail('Asignación inexistente')
      this.audit(actor,'patient.revoke',patientId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  assignments(actor:Actor):readonly RecordData[] {
    if(actor.role!=='admin'&&actor.role!=='reception')fail('Acceso denegado')
    return this.db.prepare('SELECT patient_id AS patientId,staff_id AS staffId,purpose,granted_by AS grantedBy,granted_at AS grantedAt FROM health_patient_access WHERE org=? ORDER BY granted_at DESC LIMIT 500').all(actor.org) as RecordData[]
  }
  private access(actor:Actor,kind:Kind,write=false):void {
    if(!TYPES.has(kind)||(write?WRITE:READ)[kind].includes(actor.role)===false)fail('Permiso clínico insuficiente')
  }
  /** Psychotherapy disclosures require exact note authorship even for administrators and nurses. */
  private mayReadEncounter(actor:Actor,data:RecordData):boolean {
    const restricted=data.confidentialPsychotherapy===true ||
      /(?:psic[oó]log|psycholog|psicoterapi|psychiatr|psiquiatr)/iu.test(String(data.specialty??''))
    if(restricted)return (actor.role==='psychologist'||actor.role==='clinician')&&data.practitioner===actor.username
    return actor.role==='admin'||actor.role==='nurse'||data.practitioner===actor.username
  }
  private find(actor:Actor,kind:Kind,id:string):{row:Row;data:RecordData} {
    const row=this.db.prepare('SELECT * FROM health_records WHERE id=? AND org=? AND kind=?').get(id,actor.org,kind) as Row|undefined
    if(!row)fail('Registro inexistente o fuera de institución')
    const data=this.open(row)
    if(kind==='patients')this.requirePatient(actor,id)
    else if(typeof data.patientId==='string')this.requirePatient(actor,data.patientId)
    if(kind==='encounters'&&!this.mayReadEncounter(actor,data))fail('Acceso al episodio no autorizado')
    if(kind==='orders'&&actor.role==='lab'&&data.modality!=='laboratory')fail('Orden no autorizada')
    if(kind==='orders'&&actor.role==='radiology'&&data.modality!=='imaging')fail('Orden no autorizada')
    return {row,data}
  }
  /** Billing may locate a patient for an invoice but never receives demographics or clinical notes. */
  patientOptions(actor:Actor):readonly {id:string;name:string}[] {
    if(!['billing','admin','reception'].includes(actor.role))fail('Acceso al directorio restringido')
    const rows=this.db.prepare("SELECT * FROM health_records WHERE org=? AND kind='patients' ORDER BY created_at DESC LIMIT 500")
      .all(actor.org) as Row[]
    return rows.map(row=>({id:row.id,name:str(this.open(row).name,'Nombre',160)}))
  }
  list(actor:Actor,kind:Kind):readonly RecordData[] {
    this.access(actor,kind)
    const rows=this.db.prepare('SELECT * FROM health_records WHERE org=? AND kind=? ORDER BY created_at DESC LIMIT 500').all(actor.org,kind) as Row[]
    return rows.map((row):RecordData=>({id:row.id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,...this.open(row)}))
      .filter(item=>this.hasPatient(actor,kind==='patients'?String(item.id):String(item.patientId??'')))
      .filter(item=>kind!=='orders'||actor.role!=='lab'&&actor.role!=='radiology'||
        item.modality===(actor.role==='lab'?'laboratory':'imaging'))
      .filter(item=>kind!=='encounters'||this.mayReadEncounter(actor,item))
  }
  /** Fail closed if the HMAC-linked clinical audit journal has been altered. */
  private verifyAudit():void {
    const history=this.db.prepare('SELECT org,actor,action,record_id,happened,prior_hash,hash FROM health_audit ORDER BY id ASC').all() as
      {org:string;actor:string;action:string;record_id:string;happened:string;prior_hash:string;hash:string}[]
    const previous=new Map<string,string>()
    for(const event of history){
      const expectedPrior=previous.get(event.org)??'genesis'
      if(event.prior_hash!==expectedPrior)fail('Integridad del historial de auditoría comprometida')
      const message=JSON.stringify([event.org,event.actor,event.action,event.record_id,event.happened,event.prior_hash])
      const digest=createHmac('sha256',this.encryptionKey()).update(message).digest('hex')
      if(!eq(event.hash,digest))fail('Integridad del historial de auditoría comprometida')
      previous.set(event.org,event.hash)
    }
  }

  private audit(actor:Actor,action:string,id:string):void {
    const prev=(this.db.prepare('SELECT hash FROM health_audit WHERE org=? ORDER BY id DESC LIMIT 1').get(actor.org) as {hash:string}|undefined)?.hash??'genesis'
    const happened=new Date().toISOString()
    const content=JSON.stringify([actor.org,actor.username,action,id,happened,prev])
    const digest=createHmac('sha256',this.encryptionKey()).update(content).digest('hex')
    this.db.prepare('INSERT INTO health_audit(org,actor,action,record_id,happened,prior_hash,hash) VALUES (?,?,?,?,?,?,?)').run(actor.org,actor.username,action,id,happened,prev,digest)
  }
  audits(actor:Actor):readonly RecordData[] {
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    this.verifyAudit()
    return this.db.prepare('SELECT id,org,actor,action,record_id AS recordId,happened FROM health_audit WHERE org=? ORDER BY id DESC LIMIT 500').all(actor.org) as RecordData[]
  }
  private insert(actor:Actor,kind:Kind,data:RecordData):RecordData {
    const id=randomUUID(),now=new Date().toISOString(),sealed=this.seal(id,actor.org,kind,1,data)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO health_records VALUES (?,?,?,?,?,?,?,?,?)').run(id,actor.org,kind,1,sealed.iv,sealed.tag,sealed.payload,now,now)
      this.audit(actor,kind+'.create',id);this.db.exec('COMMIT')
    }catch(e){this.db.exec('ROLLBACK');throw e}
    return {id,version:1,createdAt:now,updatedAt:now,...data}
  }
  private modify(actor:Actor,kind:Kind,id:string,expectedVersion:number,apply:(data:RecordData)=>RecordData):RecordData {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const {row,data}=this.find(actor,kind,id)
      if(row.version!==expectedVersion)fail('Conflicto de edición: recarga el registro')
      const next=withLimit(apply(data))
      const version=row.version+1,now=new Date().toISOString(),sealed=this.seal(id,actor.org,kind,version,next)
      const result=this.db.prepare('UPDATE health_records SET version=?, iv=?,tag=?,payload=?,updated_at=? WHERE id=? AND org=? AND kind=? AND version=?')
        .run(version,sealed.iv,sealed.tag,sealed.payload,now,id,actor.org,kind,expectedVersion)
      if(Number(result.changes)!==1)fail('Conflicto de concurrencia')
      this.audit(actor,kind+'.update',id);this.db.exec('COMMIT')
      return {id,version,createdAt:row.created_at,updatedAt:now,...next}
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  create(actor:Actor,kind:Kind,value:unknown):RecordData {
    this.access(actor,kind,true)
    const x=withLimit(value)
    if(kind==='patients'){
      const dob=str(x.dateOfBirth,'Nacimiento',24)
      if(!/^\d{4}-\d{2}-\d{2}$/u.test(dob)||!Number.isFinite(Date.parse(dob))||Date.parse(dob)>Date.now())fail('Fecha de nacimiento inválida')
      const email=typeof x.email==='string'?x.email.trim():''
      if(email&&!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u.test(email))fail('Correo de paciente inválido')
      const patient=this.insert(actor,kind,{name:str(x.name,'Nombre',160),dateOfBirth:dob,
      email:email.slice(0,254),phone:typeof x.phone==='string'?x.phone.trim().slice(0,35):'',
      notes:typeof x.notes==='string'?x.notes.slice(0,4000):'',emailConsent:false,
      emailVerified:false,contactEvidence:null,allergyReview:null})
      if(actor.role==='clinician'){
        // Registering a patient is an explicit treatment relationship for this clinician.
        const newPatientId=str(patient.id,'Paciente creado',80)
        this.db.exec('BEGIN IMMEDIATE')
        try {
          this.db.prepare('INSERT INTO health_patient_access VALUES (?,?,?,?,?,?)')
            .run(actor.org,newPatientId,actor.username,'initial-registration',actor.username,new Date().toISOString())
          this.audit(actor,'patient.self-assign',newPatientId)
          this.db.exec('COMMIT')
        }catch(error){this.db.exec('ROLLBACK');throw error}
      }
      return patient
    }
    if(kind==='encounters'){
      const patientId=str(x.patientId,'Paciente',80);this.find(actor,'patients',patientId)
      return this.insert(actor,kind,{patientId,practitioner:actor.username,specialty:str(x.specialty,'Especialidad',120),
        complaint:text(x.complaint,'Motivo de consulta',2000),mode:['kira','manual','mixed'].includes(String(x.mode))?x.mode:'mixed',
        confidentialPsychotherapy:actor.role==='psychologist'||/(?:psic[oó]log|psycholog|psicoterapi|psychiatr|psiquiatr)/iu.test(String(x.specialty)),
        history:'',exam:'',assessment:'',plan:'',status:'draft',reviewedVersion:null,signedBy:null,signedAt:null})
    }
    if(kind==='appointments') {
      const patientId=str(x.patientId,'Paciente',80),startsAt=date(x.startsAt),practitioner=str(x.practitioner,'Profesional',80)
      this.find(actor,'patients',patientId)
      const clash=this.list(actor,'appointments').some(a=>a.startsAt===startsAt&&a.practitioner===practitioner&&a.status==='scheduled')
      if(clash)fail('El profesional ya tiene una cita en ese horario')
      return this.insert(actor,kind,{patientId,practitioner,startsAt,status:'scheduled',reason:str(x.reason,'Motivo',300)})
    }
    if(kind==='orders'||kind==='prescriptions'){
      if(actor.role!=='clinician')fail('Órdenes y recetas requieren profesional prescriptor')
      const encounterId=str(x.encounterId,'Consulta',80),enc=this.find(actor,'encounters',encounterId).data
      if(enc.status!=='signed'||enc.practitioner!==actor.username)fail('Debe firmar una consulta propia antes de emitir la orden')
      if(kind==='orders'){
        const modality=str(x.modality,'Tipo',20);if(!['laboratory','imaging'].includes(modality))fail('Tipo de orden no permitido')
        return this.insert(actor,kind,{encounterId,patientId:enc.patientId,modality,description:text(x.description,'Estudio',600),
          status:'ordered',result:'',reviewedBy:null})
      }
      const patient=this.find(actor,'patients',str(enc.patientId,'Paciente',80)).data
      const allergy=patient.allergyReview
      if(!allergy||typeof allergy!=='object'||Array.isArray(allergy))fail('Falta revisión de alergias del paciente')
      const reviewed=allergy as RecordData
      if(reviewed.reviewedBy!==actor.username||!['none-known','documented'].includes(String(reviewed.status)))
        fail('El prescriptor debe verificar y documentar alergias antes de recetar')
      if(x.safetyAcknowledged!==true)fail('Debe confirmar revisión de alergias, interacciones y dosis')
      return this.insert(actor,kind,{encounterId,patientId:enc.patientId,medication:text(x.medication,'Medicamento',240),
        directions:text(x.directions,'Indicaciones',1400),signedBy:actor.username,status:'prescribed',
        safetyReview:{attestedBy:actor.username,at:new Date().toISOString(),allergyStatus:reviewed.status,
          allergyReviewAt:reviewed.reviewedAt,drugInteractionCatalogChecked:false}})
    }
    if(kind==='inventory')return this.insert(actor,kind,{item:str(x.item,'Producto',200),units:0})
    if(kind==='invoices') {
      const patientId=str(x.patientId,'Paciente',80);this.find(actor,'patients',patientId)
      const cents=Number(x.amountCents);if(!Number.isSafeInteger(cents)||cents<1)fail('Monto en centavos inválido')
      return this.insert(actor,kind,{patientId,concept:str(x.concept,'Concepto',300),amountCents:cents,paidCents:0})
    }
    if(kind==='followups') {
      const patientId=str(x.patientId,'Paciente',80);this.find(actor,'patients',patientId)
      return this.insert(actor,kind,{patientId,assignedTo:str(x.assignedTo,'Responsable',80),dueAt:date(x.dueAt),
        description:text(x.description,'Tarea',500),status:'pending'})
    }
    return fail('Operación no admitida')
  }


  /** Atomic pharmacy dispense: only one signed prescription, matching available stock. */
  dispense(actor:Actor,prescriptionId:string,inventoryId:string):{prescription:RecordData;inventory:RecordData}{
    if(actor.role!=='pharmacy')fail('Solo personal farmacéutico autorizado puede dispensar')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const prescription=this.find(actor,'prescriptions',str(prescriptionId,'Receta',80))
      const inventory=this.find(actor,'inventory',str(inventoryId,'Existencia',80))
      if(prescription.data.status!=='prescribed')fail('La receta ya fue dispensada')
      if(prescription.data.medication!==inventory.data.item)fail('El producto no corresponde a la receta firmada')
      if(Number(inventory.data.units)<1)fail('Existencias insuficientes')
      const now=new Date().toISOString()
      const update=(kind:Kind,row:Row,data:RecordData)=>{
        const nextVersion=row.version+1,sealed=this.seal(row.id,actor.org,kind,nextVersion,data)
        const result=this.db.prepare('UPDATE health_records SET version=?,iv=?,tag=?,payload=?,updated_at=? WHERE id=? AND org=? AND kind=? AND version=?')
          .run(nextVersion,sealed.iv,sealed.tag,sealed.payload,now,row.id,actor.org,kind,row.version)
        if(Number(result.changes)!==1)fail('Conflicto de concurrencia de dispensación')
        return {...data,id:row.id,version:nextVersion,createdAt:row.created_at,updatedAt:now}
      }
      const changedRx=update('prescriptions',prescription.row,{...prescription.data,status:'dispensed',dispensedBy:actor.username,dispensedAt:now})
      const changedStock=update('inventory',inventory.row,{...inventory.data,units:Number(inventory.data.units)-1})
      this.audit(actor,'prescription.dispense',prescription.row.id)
      this.db.exec('COMMIT');return {prescription:changedRx,inventory:changedStock}
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }

  /** Reserve exactly one verified, clinician-authorized reminder. Never expose clinical details. */
  beginReminder(actor:Actor,appointmentId:string,sender:string):{recipient:string;subject:string;body:string;appointmentId:string}{
    if(actor.role!=='clinician')fail('El recordatorio requiere confirmación de profesional clínico')
    const appointment=this.find(actor,'appointments',str(appointmentId,'Cita',80)).data
    if(appointment.practitioner!==actor.username||appointment.status!=='scheduled')
      fail('Esta cita no corresponde al profesional o ya no está programada')
    const patient=this.find(actor,'patients',str(appointment.patientId,'Paciente',80)).data
    const proof=patient.contactEvidence
    if(!proof||typeof proof!=='object'||Array.isArray(proof))
      fail('Falta registro verificable de consentimiento')
    const evidence=proof as RecordData
    if(evidence.consent!=='granted'||evidence.verified!==true||evidence.recipient!==patient.email||
      typeof evidence.recordedBy!=='string'||typeof evidence.evidenceRef!=='string')
      fail('Correo no verificado o consentimiento no registrado de forma auditable')
    const recipient=str(patient.email,'Correo electrónico',254)
    if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u.test(recipient))fail('Correo electrónico inválido')
    const now=new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO health_reminders VALUES (?,?,?,?,?,?)').run(appointmentId,actor.org,'pending',sender,null,now)
      this.audit(actor,'reminder.queued',appointmentId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw new Error('Este recordatorio ya fue reservado; no se reenviará automáticamente')}
    return {recipient,appointmentId,subject:'Recordatorio de cita',body:
      'Este es un recordatorio de su cita programada. Para cualquier cambio, contacte directamente al consultorio. No responda con información clínica por correo.\n\nPHOENIX Health'}
  }
  /** Record Gmail provider confirmation, or uncertainty without an automatic duplicate retry. */
  finishReminder(actor:Actor,appointmentId:string,providerId:string|undefined):void {
    if(actor.role!=='clinician')fail('Personal no autorizado')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result=this.db.prepare("UPDATE health_reminders SET status=?,provider_id=? WHERE appointment_id=? AND org=? AND status='pending'")
        .run(providerId?'sent':'uncertain',providerId??null,appointmentId,actor.org)
      if(Number(result.changes)!==1)fail('Recordatorio desconocido o ya completado')
      this.audit(actor,providerId?'reminder.sent':'reminder.uncertain',appointmentId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  /** Disclose delivery states to admin only, never recipient addresses. */
  reminders(actor:Actor):readonly RecordData[] {
    if(actor.role!=='admin')fail('Acceso administrativo requerido')
    return this.db.prepare('SELECT appointment_id AS appointmentId,status,sender,started FROM health_reminders WHERE org=? ORDER BY started DESC LIMIT 300').all(actor.org) as RecordData[]
  }

  update(actor:Actor,kind:Kind,id:string,version:number,value:unknown):RecordData {
    if(kind==='orders') this.access(actor,kind)
    else this.access(actor,kind,true)
    if(!Number.isSafeInteger(version)||version<1)fail('Versión inválida')
    const x=withLimit(value)
    if(kind==='patients'){
      if(x.action==='allergy-review'){
        if(actor.role!=='clinician')fail('Solo el médico responsable puede verificar alergias')
        return this.modify(actor,kind,id,version,current=>{
          const status=str(x.status,'Estado de alergias',24)
          if(!['none-known','documented'].includes(status))fail('Estado de alergias no confirmado')
          const details=typeof x.details==='string'?x.details.trim():''
          if(status==='documented'&&(!details||details.length>2500))fail('Documente los alérgenos y reacciones')
          return {...current,allergyReview:{status,details:status==='documented'?details:'',
            reviewedBy:actor.username,reviewedAt:new Date().toISOString()}}
        })
      }
      if(x.action!=='contact')fail('Acción de contacto inválida')
      return this.modify(actor,kind,id,version,current=>{
        if(!['reception','clinician','admin'].includes(actor.role))fail('Acceso denegado')
        const method=str(x.method,'Método',30)
        if(!['in-person','signed-document','verified-call'].includes(method))fail('Método de verificación inválido')
        const evidenceRef=str(x.evidenceRef,'Referencia de evidencia',160)
        if(!/^[A-Za-z0-9._:/ -]{4,160}$/u.test(evidenceRef))fail('Referencia documental inválida')
        if(x.consent!=='granted'&&x.consent!=='revoked')fail('Consentimiento inválido')
        const consent=x.consent==='granted',verified=consent&&x.emailVerified===true
        const recipient=typeof current.email==='string'?current.email:''
        if(consent&&(!verified||!recipient))fail('Debe verificarse el correo antes de autorizar comunicaciones')
        const contactEvidence={consent:x.consent,method,evidenceRef,recipient,
          verified,recordedBy:actor.username,recordedAt:new Date().toISOString()}
        return {...current,emailConsent:consent,emailVerified:verified,contactEvidence}
      })
    }
    if(kind==='encounters'){
      const data=this.find(actor,kind,id).data
      if(data.practitioner!==actor.username)fail('Consulta de otro profesional')
      const action=str(x.action,'Acción',30)
      if(action==='document')return this.modify(actor,kind,id,version,current=>{
        if(current.status==='signed')fail('Historia firmada: requiere adenda independiente')
        return {...current,history:text(x.history,'Historia'),exam:typeof x.exam==='string'?x.exam.slice(0,4000):'',
          assessment:typeof x.assessment==='string'?x.assessment.slice(0,4000):'',
          plan:typeof x.plan==='string'?x.plan.slice(0,4000):'',status:'draft',reviewedVersion:null}
      })
      if(action==='review')return this.modify(actor,kind,id,version,current=>{
        if(current.status!=='draft'||!current.history)fail('Se requiere historia en borrador')
        return {...current,status:'reviewed',reviewedVersion:version+1}
      })
      if(action==='sign')return this.modify(actor,kind,id,version,current=>{
        if(current.status!=='reviewed'||current.reviewedVersion!==version)fail('La versión revisada debe coincidir para firmar')
        return {...current,status:'signed',signedBy:actor.username,signedAt:new Date().toISOString()}
      })
      fail('Acción clínica no permitida')
    }
    if(kind==='orders')return this.modify(actor,kind,id,version,current=>{
      const action=str(x.action,'Acción',40)
      if(action==='result'){
        if(current.status!=='ordered'||!(current.modality==='laboratory'&&actor.role==='lab'||current.modality==='imaging'&&actor.role==='radiology'))
          fail('Solo personal autorizado puede registrar el resultado')
        return {...current,result:text(x.result,'Resultado',5000),status:'resulted'}
      }
      if(action==='review'&&actor.role==='clinician'&&current.status==='resulted')
        return {...current,status:'reviewed',reviewedBy:actor.username}
      fail('Transición de orden no permitida')
    })
    if(kind==='inventory')return this.modify(actor,kind,id,version,current=>{
      if(actor.role!=='pharmacy'&&actor.role!=='admin')fail('Acceso a farmacia requerido')
      const delta=Number(x.delta);if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>100000)fail('Movimiento inválido')
      const total=Number(current.units)+delta;if(total<0)fail('Inventario insuficiente')
      return {...current,units:total}
    })
    if(kind==='invoices')return this.modify(actor,kind,id,version,current=>{
      const payment=Number(x.paymentCents)
      if(!Number.isSafeInteger(payment)||payment<=0||Number(current.paidCents)+payment>Number(current.amountCents))fail('Pago fuera de saldo')
      return {...current,paidCents:Number(current.paidCents)+payment}
    })
    if(kind==='appointments'||kind==='followups')return this.modify(actor,kind,id,version,current=>{
      const status=str(x.status,'Estado',24)
      if(kind==='appointments'&&!['scheduled','completed','cancelled'].includes(status))fail('Estado inválido')
      if(kind==='followups'&&!['pending','done','cancelled'].includes(status))fail('Estado inválido')
      return {...current,status}
    })
    fail('Actualización no habilitada')
  }
}
export const healthKinds=[...TYPES]
