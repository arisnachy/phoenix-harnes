/** Clinical demo surface inside PHOENIX's existing visual workspace.
 * Entirely synthetic, ephemeral and sandboxed; never sends or stores PHI.
 */
import type { SidebarFooterActionOwnerProps } from '@phoenix-ai/dsh-client-ui-sidebar/client'

export interface HealthDemoTriggerProps extends SidebarFooterActionOwnerProps {
  readonly openHealth: () => void
}
/** Optional Health Engine access in the same visual language as the shell. */
export function HealthDemoTrigger({wide,openHealth}:HealthDemoTriggerProps) {
  return (
    <button type="button" onClick={openHealth} title="PHOENIX Health · Entorno de demostración"
      aria-label="Abrir PHOENIX Health demostración"
      style={{border:'1px solid var(--dsw-border-default, #dce4ed)', background:'var(--dsw-surface-primary,#f8fafc)',
        color:'var(--dsw-text-primary,#243247)',borderRadius:10,padding:'8px 10px',cursor:'pointer',
        display:'inline-flex',gap:8,alignItems:'center',fontSize:12,fontWeight:650,marginInline:5}}>
      <span aria-hidden="true" style={{fontSize:16,color:'#3276bb'}}>♡</span>{wide?'Health · Demo':null}
    </button>
  )
}

/** Self-contained interactive workbench in a no-network, no-storage iframe. */
export function renderHealthDemoHtml(): string {
  return String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PHOENIX Health</title>
<style>
:root{color-scheme:light;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#223046;background:#f9fbfd}
*{box-sizing:border-box}body{margin:0}.head{padding:16px;background:#fff;border-bottom:1px solid #e0e8ee}
h1{font-size:18px;margin:0 0 6px}h2{font-size:15px;margin:0 0 12px}small,.sub{color:#607387;font-size:11px}
.pill{display:inline-block;border:1px solid #f3bc72;background:#fff7eb;color:#8c5608;border-radius:12px;padding:3px 7px;font-size:10px;font-weight:700}
nav{display:flex;gap:5px;overflow:auto;background:#fff;padding:8px;border-bottom:1px solid #dbe5eb;position:sticky;top:0}
nav button{white-space:nowrap;border:0;background:#f1f5f9;color:#3e5167;border-radius:8px;padding:9px;font-size:11px}
nav button.on{color:#125ca7;background:#e3f0ff;font-weight:800}
main{padding:12px;display:grid;gap:12px}.card{border:1px solid #dce6ed;background:#fff;border-radius:13px;padding:14px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.full{grid-column:1 / -1}
label{display:block;font-size:11px;font-weight:650;color:#395068;margin:5px 0}
input,select,textarea{background:#fff;border:1px solid #cfdae5;padding:10px;border-radius:9px;width:100%;font:inherit;font-size:12px;color:#1f3045}
textarea{min-height:88px;resize:vertical}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
button{cursor:pointer}button.action{background:#216aaf;color:white;border:0;border-radius:9px;padding:10px;font-size:12px}
button.subtle{background:#eff5fa;color:#265578;border:0;border-radius:9px;padding:10px;font-size:12px}
button:disabled{cursor:not-allowed;opacity:.45}.notice{background:#edf6ff;border:1px solid #cfe5fa;color:#2d597a;border-radius:10px;padding:10px;font-size:12px}
.warning{background:#fff7e8;border-color:#f2ddb2;color:#805c18}.item{padding:10px 0;border-bottom:1px solid #edf1f4;font-size:12px}
.item:last-child{border:0}.row{display:flex;align-items:center;justify-content:space-between;gap:9px}
.kpi{padding:12px;background:#f4f8fc;border-radius:9px}.num{font-size:22px;font-weight:800;color:#1f5c9a}
#toast{position:sticky;bottom:0;background:#194a76;color:white;font-size:11px;padding:10px;border-radius:9px;display:none}
</style></head><body>
<div class="head"><div class="row"><div><h1>♡ PHOENIX Health</h1><div class="sub">Kira Clinical Flow · Escritorio integrado de demostración</div></div><span class="pill">SOLO DATOS FICTICIOS</span></div></div>
<nav id="tabs"></nav><main id="content"></main><div id="toast"></div>
<script>
"use strict";
const modules=[["inicio","Inicio"],["pacientes","Pacientes"],["consulta","Consulta"],["agenda","Agenda"],["laboratorio","Laboratorio"],["imagenes","Imágenes"],["farmacia","Farmacia"],["administracion","Administración"],["seguimiento","Seguimiento"]];
const db={tab:"inicio",patients:[{id:"P-001",name:"DEMO Paciente 001",email:"demo@example.invalid"}],
  encounters:[],appointments:[],orders:[],prescriptions:[],inventory:[],invoices:[],notices:[]};
let seq=1;
const byId=id=>document.getElementById(id);
const v=id=>byId(id)?.value?.trim()||"";
const h=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=x=>h(x||"—");
const val=(x,id)=>x===id?" selected":"";
const opts=()=>db.patients.map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join("");
const selectedPatient=()=>db.patients.find(p=>p.id===v("patient"));
const last=()=>db.encounters.at(-1);
function alertBox(t){const box=byId("toast");box.textContent=t;box.style.display="block";}
function card(body){return '<section class="card">'+body+'</section>';}
function input(id,label,placeholder="",value=""){return '<label for="'+id+'">'+label+'</label><input id="'+id+'" placeholder="'+h(placeholder)+'" value="'+h(value)+'">';}
function selectPatient(){return '<label for="patient">Paciente ficticio</label><select id="patient">'+opts()+'</select>';}
function item(title,subtitle){return '<div class="item"><b>'+h(title)+'</b><div class="sub">'+h(subtitle)+'</div></div>';}
function dashboard(){
 return '<div class="notice warning">Entorno aislado de demostración. No escribas datos de pacientes reales. Se pierde al cerrar; no envía correos, no guarda expedientes, no dispensa medicamentos.</div>'+
 '<div class="grid">'+[['Pacientes',db.patients.length],['Consultas',db.encounters.length],['Citas',db.appointments.length],['Órdenes',db.orders.length],['Recetas',db.prescriptions.length],['Facturas',db.invoices.length]].map(([a,b])=>'<div class="kpi"><div class="num">'+b+'</div><small>'+a+'</small></div>').join("")+'</div>'+
 card('<h2>Flujo asistencial</h2><p class="sub">Paciente → Interrogatorio → Historia → Revisión → Firma → Estudios y receta → Cita → Notificación de Kira.</p><div class="notice">Kira puede sugerir preguntas. Solo un profesional autenticado podrá confirmar decisiones clínicas cuando se conecte el backend seguro.</div>');
}
function patients(){return card('<h2>Registro de pacientes</h2>'+input("newpatient","Etiqueta de paciente","DEMO-0002")+input("patientemail","Correo ficticio","demo2@example.invalid")+
 '<div class="actions"><button class="action" data-action="patient">Registrar paciente DEMO</button></div>')+
 card('<h2>Directorio</h2>'+db.patients.map(x=>item(x.name,x.id+" · "+x.email)).join(""));}
function consultations(){
 const e=last();
 return card('<h2>Consulta médica · Clinical Flow</h2>'+selectPatient()+
 '<label>Especialidad</label><select id="specialty"><option>Medicina familiar</option><option>Psicología</option><option>Pediatría</option><option>Ginecología</option><option>Otra especialidad</option></select>'+
 '<label>Modalidad de interrogatorio</label><select id="mode"><option>Kira dirige</option><option>Profesional dirige</option><option>Modo mixto</option></select>'+
 input("complaint","Motivo de consulta","Ej.: cefalea (caso ficticio)")+
 '<div class="actions"><button class="subtle" data-action="questions">Kira: sugerir preguntas</button><button class="action" data-action="open">Abrir episodio</button></div>'+
 '<div id="questions" class="notice" style="margin-top:8px">Indica el motivo para generar preguntas dirigidas.</div>')+
 card('<h2>Historia clínica y cierre</h2><div class="sub">Episodio activo: '+(e?h(e.id+" · "+e.status+" · "+e.specialty):"Ninguno")+'</div>'+
 '<label>Historia clínica (solo ficticia)</label><textarea id="note" placeholder="DEMO: anamnesis, antecedentes, examen, evaluación, diagnóstico propuesto y plan"></textarea>'+
 '<div class="actions"><button class="subtle" data-action="draft">Guardar borrador</button><button class="subtle" data-action="review">Revisar</button><button class="action" data-action="sign">Firmar DEMO</button></div>'+
 (e?item("Último episodio",e.id+" · "+e.status+" · "+e.complaint+" · "+e.note):""));
}
function agenda(){
 return card('<h2>Agenda asistencial</h2>'+selectPatient()+input("date","Fecha y hora ISO","2026-10-29T09:00")+input("doctor","Profesional","DEMO-DRA-01")+
 '<div class="actions"><button class="action" data-action="appointment">Reservar cita DEMO</button></div>')+
 card('<h2>Próximas citas</h2>'+db.appointments.map(x=>item(x.patient,x.at+" · "+x.doctor+" · "+x.status)).join("")||"<small>Sin citas</small>");
}
function studies(kind){
 const orders=db.orders.filter(x=>x.kind===kind);
 return card('<h2>'+(kind==="laboratorio"?"Laboratorio clínico":"Imágenes diagnósticas")+'</h2>'+
 input("study","Estudio solicitado","DEMO "+(kind==="laboratorio"?"hemograma":"ecografía"))+
 '<div class="actions"><button class="action" data-action="'+kind+'">Crear orden firmada</button></div>'+
 '<div class="notice">Las órdenes requieren un episodio de demostración revisado y firmado.</div>')+
 card('<h2>Órdenes y resultados</h2>'+orders.map(o=>item(o.id+" · "+o.name,o.status+" · "+(o.result||"Sin resultado"))+'<div class="actions">'+
 (o.status==="Solicitado"?'<button class="subtle" data-action="result" data-id="'+h(o.id)+'">Registrar resultado ficticio</button>':'')+'</div>').join("")||"<small>Sin órdenes</small>");
}
function pharmacy(){
 return card('<h2>Farmacia y recetas</h2>'+input("med","Medicamento ficticio","DEMO-MED")+
 input("directions","Indicaciones de demostración","Sin dosis reales")+
 '<div class="actions"><button class="action" data-action="rx">Emitir receta DEMO</button><button class="subtle" data-action="stock">Añadir existencias DEMO</button></div>'+
 '<div class="notice">La dispensación real exige prescripción válida, validación farmacéutica y control de inventario.</div>')+
 card('<h2>Inventario y dispensación</h2>'+
 db.inventory.map(x=>item(x.med,x.qty+" unidades")).join("")+
 db.prescriptions.map(x=>item(x.med,x.status+" · "+x.id)+'<button class="subtle" data-action="dispense" data-id="'+h(x.id)+'">Dispensar DEMO</button>').join(""));
}
function administration(){
 return card('<h2>Caja y facturación</h2>'+selectPatient()+input("concept","Concepto","DEMO consulta")+
 input("amount","Importe RD$","1500")+'<div class="actions"><button class="action" data-action="invoice">Crear factura</button></div>')+
 card('<h2>Facturas</h2>'+db.invoices.map(x=>item(x.id+" · "+x.concept,"RD$ "+x.amount+" · "+x.status)+
 (x.status!=="Pagada"?'<button class="subtle" data-action="pay" data-id="'+h(x.id)+'">Registrar cobro DEMO</button>':'')).join("")||"<small>Sin facturas</small>");
}
function followup(){
 return card('<h2>Kira · Seguimiento y correo institucional</h2><div class="notice warning">No hay conexión de correo ni envío real en esta versión. Los siguientes controles solo prueban el flujo.</div>'+
 selectPatient()+'<label><input type="checkbox" id="consent" style="width:auto"> Consentimiento electrónico de demostración</label>'+
 '<label><input type="checkbox" id="verified" style="width:auto"> Correo ficticio verificado</label>'+
 '<div class="actions"><button class="action" data-action="mail">Simular notificación</button></div>')+
 card('<h2>Seguimiento y pendientes</h2>'+db.orders.filter(x=>x.status==="Solicitado").map(x=>item(x.name,"Pendiente de resultado")).join("")+
 db.notices.map(x=>item("Notificación simulada",x)).join("")+
 '<div class="notice">En producción Kira utilizará un remitente institucional real, portal de documentos seguro, consentimiento registrado y entrega confirmada.</div>');
}
function render(){
 byId("tabs").innerHTML=modules.map(([id,title])=>'<button data-tab="'+id+'" class="'+(id===db.tab?"on":"")+'">'+title+'</button>').join("");
 const content={inicio:dashboard,pacientes:patients,consulta:consultations,agenda:agenda,
 laboratorio:()=>studies("laboratorio"),imagenes:()=>studies("imagenes"),
 farmacia:pharmacy,administracion:administration,seguimiento:followup}[db.tab];
 byId("content").innerHTML=content();
}
function questionPlan(text){
 const questions=["¿Cuándo comenzaron los síntomas?","¿Cuál es su evolución y severidad?","¿Existen signos de alarma?","¿Qué antecedentes, alergias y medicamentos son relevantes?"];
 if(/abdomen|abdominal|barriga/i.test(text))questions.unshift("¿Dónde se localiza y hacia dónde irradia el dolor?","¿Hay vómitos, sangrado o inestabilidad?");
 if(/cefalea|cabeza|migraña/i.test(text))questions.unshift("¿Fue de inicio súbito?","¿Existen signos neurológicos de alarma?");
 if(/ansiedad|depresi[oó]n|angustia/i.test(text))questions.unshift("¿Qué impacto tiene sobre el funcionamiento?","¿Hay riesgo inmediato para su seguridad?");
 return questions.slice(0,5).map((q,i)=>String(i+1)+". "+q).join("\n");
}
function act(action,id){
 const e=last();
 switch(action){
 case "patient": {
  const name=v("newpatient"),email=v("patientemail");
  if(!/^DEMO[- ][A-Za-z0-9 -]{1,65}$/i.test(name)||!/^demo[A-Za-z0-9._+-]*@example\.invalid$/i.test(email))throw Error("Solo etiquetas DEMO y direcciones @example.invalid.");
  db.patients.push({id:"P-"+String(++seq).padStart(3,"0"),name,email});break;
 }
 case "questions":
  if(!v("complaint"))throw Error("Indica un motivo ficticio.");
  byId("questions").textContent=questionPlan(v("complaint"));return;
 case "open":
  if(!v("complaint"))throw Error("Indica el motivo de consulta.");
  db.encounters.push({id:"E-"+(++seq),patient:selectedPatient().name,specialty:v("specialty"),mode:v("mode"),complaint:v("complaint"),note:"",status:"Abierto"});break;
 case "draft":
  if(!e||e.status==="Firmado")throw Error("Abre una consulta sin firmar.");
  if(!v("note"))throw Error("Registra la historia clínica ficticia.");
  e.note=v("note");e.status="Borrador";break;
 case "review":
  if(!e||e.status!=="Borrador")throw Error("Debe existir una historia en borrador.");
  e.status="Revisado";break;
 case "sign":
  if(!e||e.status!=="Revisado")throw Error("Se requiere revisión antes de firmar.");
  e.status="Firmado";break;
 case "appointment": {
  const at=v("date"),doctor=v("doctor");
  if(!at||!doctor||!Number.isFinite(Date.parse(at)))throw Error("Fecha y profesional requeridos.");
  if(db.appointments.some(x=>x.at===at&&x.doctor===doctor))throw Error("Horario ocupado.");
  db.appointments.push({id:"A-"+(++seq),patient:selectedPatient().name,at,doctor,status:"Programada"});break;
 }
 case "laboratorio": case "imagenes":
  if(!e||e.status!=="Firmado")throw Error("Firma la consulta de demostración antes de emitir órdenes.");
  if(!v("study"))throw Error("Selecciona estudio ficticio.");
  db.orders.push({id:"O-"+(++seq),kind:action,name:v("study"),status:"Solicitado",result:""});break;
 case "result": {
  const o=db.orders.find(x=>x.id===id);if(!o||o.status!=="Solicitado")throw Error("Orden inválida.");
  o.status="Completado";o.result="Informe ficticio validado en demostración";break;
 }
 case "rx": {
  if(!e||e.status!=="Firmado")throw Error("Se requiere consulta firmada.");
  if(!v("med")?.startsWith("DEMO")||!v("directions"))throw Error("Solo medicamentos DEMO con indicaciones ficticias.");
  db.prescriptions.push({id:"R-"+(++seq),med:v("med"),status:"Pendiente"});break;
 }
 case "stock": {
  if(!v("med").startsWith("DEMO"))throw Error("Solo inventario DEMO.");
  let s=db.inventory.find(x=>x.med===v("med"));
  if(s)s.qty+=5;else db.inventory.push({med:v("med"),qty:5});break;
 }
 case "dispense": {
  const r=db.prescriptions.find(x=>x.id===id);if(!r||r.status!=="Pendiente")throw Error("Receta inválida.");
  const s=db.inventory.find(x=>x.med===r.med);if(!s||s.qty<1)throw Error("Sin inventario disponible.");
  s.qty--;r.status="Dispensado DEMO";break;
 }
 case "invoice": {
  const amount=Number(v("amount"));if(!v("concept")||!Number.isFinite(amount)||amount<=0)throw Error("Concepto e importe positivo requeridos.");
  db.invoices.push({id:"F-"+(++seq),concept:v("concept"),amount,status:"Pendiente"});break;
 }
 case "pay": {
  const x=db.invoices.find(x=>x.id===id);if(!x||x.status==="Pagada")throw Error("Factura inválida.");x.status="Pagada";break;
 }
 case "mail": {
  if(!byId("consent").checked||!byId("verified").checked)throw Error("Falta consentimiento o verificación.");
  if(!e||e.status!=="Firmado")throw Error("No hay documento firmado.");
  if(!db.appointments.length)throw Error("No hay cita programada.");
  db.notices.push("Correo de Kira simulado · "+selectedPatient().email+" · NO ENVIADO");break;
 }
 default:throw Error("Acción no admitida.");
 }
 render();alertBox("Acción DEMO completada localmente · Sin datos reales ni envíos");
}
document.addEventListener("click",event=>{
 const tab=event.target.closest("[data-tab]");
 if(tab){db.tab=tab.dataset.tab;render();return;}
 const action=event.target.closest("[data-action]");
 if(action){try{act(action.dataset.action,action.dataset.id)}catch(error){alertBox(error.message)}}
});
render();
</script></body></html>`;
}
