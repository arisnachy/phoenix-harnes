/**
 * Render the local clinical workspace without exposing clinical data to Kira's prompt.
 * @param nonce - Fresh per-response CSP nonce injected into the inline script.
 * @returns HTML for the authenticated local workspace.
 */
export function renderHealthPage(nonce:string):string {
  const html=String.raw`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PHOENIX Health · Clínica</title>
<style>
:root{color-scheme:light;font:14px/1.45 "Segoe UI",system-ui,sans-serif;background:#f6f9fc;color:#263a53}*{box-sizing:border-box}
body{margin:0}button,input,select,textarea{font:inherit}button{cursor:pointer}header{background:#fff;border-bottom:1px solid #e2e8f0;padding:17px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px}
h1{font-size:20px;margin:0}h2{font-size:17px;margin:0 0 15px}p{margin:9px 0}small,.muted{color:#728399;font-size:12px}
main{display:grid;grid-template-columns:200px minmax(0,1fr);min-height:calc(100vh - 74px)}
aside{background:#fff;border-right:1px solid #e2e8f0;padding:15px}aside button{display:block;width:100%;margin:3px 0;text-align:left;padding:12px;border-radius:9px;border:0;background:transparent;color:#35516c}
aside button.active{background:#e9f3ff;color:#155b9d;font-weight:700}section{padding:20px;max-width:1150px;width:100%;margin:auto}
.card{background:#fff;border:1px solid #e1e8f0;border-radius:14px;padding:20px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wide{grid-column:1/-1}
label{display:block;color:#52657a;font-weight:650;font-size:12px;margin:10px 0 5px}
input,select,textarea{display:block;width:100%;border:1px solid #cad6e1;border-radius:9px;padding:11px;color:#1c3148;background:white}
textarea{min-height:140px}.primary,.secondary{padding:10px 15px;border-radius:10px;border:0;margin:9px 7px 5px 0;background:#2271bd;color:white}
.secondary{color:#155a99;background:#e9f3fc}.danger{color:#9e3131;background:#fff0f0}
.notice{padding:14px;border-radius:12px;background:#eff7ff;color:#315a7c;margin:10px 0}.warning{background:#fff7e8;color:#815e20}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #eef1f4;padding:10px;text-align:left;vertical-align:top}th{color:#51687b}
.tag{font-size:11px;border-radius:12px;background:#eef4f8;padding:4px 8px;color:#3e5971}
#flash{display:none;position:fixed;bottom:16px;right:16px;max-width:90vw;background:#1d557e;color:#fff;border-radius:10px;padding:14px;z-index:20}

.kira-panel{background:linear-gradient(130deg,#f1f7ff,#ffffff 56%);border:1px solid #d9e5f3;border-radius:16px;padding:18px;margin-bottom:14px}
.kira-title{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}
.kira-title h3{font-size:16px;margin:0;color:#25486a}
.kira-command{display:flex;align-items:stretch;gap:9px;margin-top:12px}
.kira-command input{flex:1;min-width:80px;margin:0}
.kira-command button{margin:0;white-space:nowrap}
.kira-chips{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0}
.kira-chips button{border-radius:20px;padding:8px 11px;margin:2px;font-size:12px}
.kira-output{margin-top:8px;padding:11px 13px;background:#fff;border-radius:11px;border:1px solid #d9e6f2;min-height:44px}
.kira-tool-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.kira-tool-result{border-left:3px solid #2b8d75;padding:13px;background:#eff9f4;border-radius:9px;margin-top:10px}
@media(max-width:700px){.kira-command{flex-direction:column}.kira-tool-fields{grid-template-columns:1fr}}
.ws-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
.ws-heading h2{margin:0 0 3px}.ws-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.ws-summary{font-size:15px;font-weight:700;cursor:pointer;color:#155b9d}
.ws-meta{font-size:12px;color:#657b91;margin-bottom:12px}
.ws-alert{padding:12px;background:#f1f7ff;border-left:3px solid #3785cb;border-radius:8px;margin:12px 0}
.ws-note{background:#f8fafc;padding:12px;border-radius:10px;margin:11px 0}
.ws-list{margin-top:12px}.ws-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #e9eff6}
.ws-timeline{padding:12px 12px 12px 16px;margin:10px 0;border-left:3px solid #b7d6ec;background:#f8fbff;border-radius:8px}
.ws-timeline>div{display:flex;justify-content:space-between;align-items:center;gap:8px}
.ws-timeline p{white-space:pre-wrap;overflow-wrap:anywhere}
.ws-preview-image{max-width:100%;max-height:620px;object-fit:contain;border:1px solid #dae4ef;border-radius:10px;margin-top:16px}
@media(max-width:700px){.ws-grid{grid-template-columns:1fr}.ws-heading,.ws-item{align-items:flex-start;flex-direction:column}}
.ws-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.ws-metrics>div{background:#fff;border:1px solid #e0e9f1;border-radius:12px;padding:12px}
.ws-metrics strong{display:block;font-size:24px;color:#205079}.ws-metrics small{display:block}
@media(max-width:700px){.ws-metrics{grid-template-columns:1fr}}
@media(max-width:700px){main{grid-template-columns:1fr}aside{display:flex;overflow:auto;gap:5px}aside button{white-space:nowrap;width:auto}header{padding:12px}section{padding:11px}.grid{grid-template-columns:1fr}}
</style><script type="importmap" nonce="__NONCE__">{"imports":{"three":"/health/vendor/build/three.module.js"}}</script></head><body>
<header><div><h1>♡ PHOENIX Health</h1><div class="muted">Sistema clínico local · Expediente cifrado · Kira Clinical Flow</div></div><div id="account"></div></header>
<div id="app"></div><div id="flash" role="alert"></div>
<script nonce="__NONCE__">
"use strict";
const root=document.getElementById("app"),account=document.getElementById("account"),flash=document.getElementById("flash");
let actor=null,csrf="",tab="workspace",data={},current=null,selectedPatientId="",previewUrl=null;
let patientForm={version:1,revision:0,fields:[]},patientDraft=null;
let clinicalTools=[],selectedClinicalTool=null,anatomyViewerCleanup=null;
let viewDrafts=Object.create(null),draftTimer=null,loadSequence=0,draftSaveQueue=Promise.resolve();
const modules=[["workspace","Mi consulta"],["anatomy","Anatomía 3D"],["patients","Pacientes"],["encounters","Consultas"],["appointments","Agenda"],["orders","Laboratorio e imágenes"],["prescriptions","Recetas"],["inventory","Farmacia"],["invoices","Administración"],["followups","Seguimiento"],["staff","Personal"],["assignments","Equipo asistencial"],["backups","Respaldos"],["audit","Auditoría"]];
const safe=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=id=>document.getElementById(id)?.value??"";
const box=(title,content)=>'<article class="card"><h2>'+safe(title)+'</h2>'+content+'</article>';
const field=(id,label,type="text",required=true,place="")=>'<label for="'+id+'">'+safe(label)+'</label><input id="'+id+'" type="'+type+'" placeholder="'+safe(place)+'" '+(required?'required':'')+'>';
const area=(id,label)=>'<label for="'+id+'">'+safe(label)+'</label><textarea id="'+id+'"></textarea>';
const pick=(id,label,items,selector)=>'<label for="'+id+'">'+safe(label)+'</label><select id="'+id+'">'+items.map(x=>'<option value="'+safe(x.id)+'">'+safe(selector(x))+'</option>').join('')+'</select>';
const patientField=(f,prefix)=>{
 const id=prefix+f.id;
 return f.kind==="select"?
  '<label for="'+id+'">'+safe(f.label)+'</label><select id="'+id+'">'+
   (f.choices||[]).map(x=>'<option value="'+safe(x)+'">'+safe(x)+'</option>').join("")+'</select>':
  field(id,f.label,f.kind,f.required);
};
const button=(action,title,cls="primary")=>'<button type="button" class="'+cls+'" data-act="'+action+'">'+safe(title)+'</button>';
const rows=(items,cols)=>items.length?'<div style="overflow:auto"><table><thead><tr>'+cols.map(c=>'<th>'+safe(c[0])+'</th>').join('')+'<th>Acciones</th></tr></thead><tbody>'+items.map(o=>'<tr>'+cols.map(c=>'<td>'+safe(o[c[1]])+'</td>').join('')+'<td>'+actionFor(o)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">No hay registros.</p>';
let columnAction=null;
function notice(msg){flash.textContent=msg;flash.style.display="block";setTimeout(()=>flash.style.display="none",5200)}
// Working drafts remain in RAM and the separately encrypted clinic database,
// never in browser storage or the general Kira conversation.
function snapshotView(){
 const view=document.getElementById("view");if(!view)return null;
 const values={};
 for(const el of view.querySelectorAll("input[id],select[id],textarea[id]")){
  if(el.type==="password"||el.type==="file"||el.id.startsWith("kira-")||
     el.id==="ask-instructions"||el.id.length>70)continue;
  const value=el.type==="checkbox"?el.checked:el.value;
  if(typeof value==="boolean"||typeof value==="string"&&value.length<=4000)values[el.id]=value;
 }
 if(tab==="workspace"||tab==="anatomy")values["draft-patient-id"]=selectedPatientId;
 return {values,expanded:[...view.querySelectorAll("details[id]")].filter(el=>el.open).map(el=>el.id)};
}
function rememberView(){
 const draft=snapshotView();if(draft&&actor)viewDrafts[tab]=draft;
 return draft;
}
function restoreView(){
 const draft=viewDrafts[tab];if(!draft)return;
 const isSamePatient=!["workspace","anatomy"].includes(tab)||draft.values?.["draft-patient-id"]===selectedPatientId;
 for(const [id,value] of Object.entries(draft.values||{})){
  // Never restore clinical input from another patient's workspace.
  if(!isSamePatient&&!/^(ws-(name|dob|phone|email|doc-type|document|complaint-new|distinct|new-|extra-))/.test(id))continue;
  const el=document.getElementById(id);if(!el||el.type==="file"||el.type==="password")continue;
  if(el.type==="checkbox"&&typeof value==="boolean")el.checked=value;
  else if(typeof value==="string")el.value=value;
 }
 for(const id of draft.expanded||[]){
  const el=document.getElementById(id);if(el&&el.tagName==="DETAILS")el.open=true;
 }
}
async function persistView(scope=tab){
 const draft=rememberView();if(!draft||!actor)return;
 draftSaveQueue=draftSaveQueue.catch(()=>{}).then(()=>api("clinical-draft/"+scope,"PATCH",draft));
 return draftSaveQueue;
}
function queueDraftSave(){
 if(!actor)return;
 clearTimeout(draftTimer);
 const scope=tab;
 draftTimer=setTimeout(()=>{
  if(scope!==tab)return;
  persistView(scope).catch(error=>notice("No se pudo conservar el borrador: "+error.message));
 },1000);
}
async function forgetDraft(scope){
 clearTimeout(draftTimer);
 await draftSaveQueue.catch(()=>{});
 viewDrafts[scope]={values:{},expanded:[]};
 await api("clinical-draft/"+scope,"POST",{action:"clear"});
}

function rememberPatientDraft(){
 if(tab!=="workspace")return;
 const ids=["ws-name","ws-dob","ws-phone","ws-email","ws-doc-type","ws-document",
   "ws-complaint-new","ws-distinct-reason",...patientForm.fields.map(f=>"ws-extra-"+f.id)];
 rememberView();
 patientDraft={values:Object.fromEntries(ids.map(id=>[id,val(id)])),
   distinct:document.getElementById("ws-distinct")?.checked===true};
}
function restorePatientDraft(){
 if(!patientDraft)return;
 for(const [id,value] of Object.entries(patientDraft.values)){
  const el=document.getElementById(id);if(el&&typeof value==="string")el.value=value;
 }
 const toggle=document.getElementById("ws-distinct");if(toggle)toggle.checked=patientDraft.distinct;
}
async function api(path,method="GET",body){
 const r=await fetch("/health/api/"+path,{method,credentials:"same-origin",cache:"no-store",headers:{
  "content-type":"application/json","x-phoenix-health":"1",...(csrf?{"x-phoenix-csrf":csrf}:{}),
 },...(body?{body:JSON.stringify(body)}:{})});
 const x=await r.json();if(!r.ok)throw Error(x.error||"Solicitud rechazada");return x;
}
async function refresh(){
 try{const x=await api("session");actor=x.actor;csrf=x.csrf;data={};await load()}catch{actor=null;csrf="";viewDrafts=Object.create(null);await splash()}
}
async function splash(){
 patientDraft=null;
 let status=await api("status");
 account.textContent="Clínica protegida";
 root.innerHTML='<section style="max-width:570px">'+box(status.initialized?"Acceso profesional":"Configurar clínica",
 '<p class="notice warning">Servicio local con base de datos cifrada. No acceda desde un equipo compartido. El administrador debe conservar una copia segura de la contraseña maestra: sin ella no podrán recuperarse los expedientes.</p>'+
 (status.initialized?'':field("org","Centro / Institución"))+
 field("user","Usuario")+field("pass","Contraseña (16 caracteres o más)","password")+
 button(status.initialized?"login":"setup",status.initialized?"Iniciar sesión":"Crear clínica y administrador"))+'</section>';
}
async function load(){
 if(anatomyViewerCleanup){anatomyViewerCleanup();anatomyViewerCleanup=null}
 const sequence=++loadSequence;
 account.innerHTML='<span class="tag">'+safe(actor.username)+" · "+safe(actor.role)+'</span> '+button("logout","Salir","secondary");
 const menu={admin:["patients","appointments","inventory","invoices","followups","assignments","staff","backups","audit"],
 clinician:["workspace","anatomy","patients","encounters","appointments","orders","prescriptions","followups"],
 psychologist:["patients","encounters","appointments","followups"],
 nurse:["patients","encounters","appointments","orders","followups"],
 reception:["patients","appointments","followups","assignments"],lab:["orders"],radiology:["orders"],
 pharmacy:["prescriptions","inventory"],billing:["invoices"]};
 const resources=modules.filter(m=>(menu[actor.role]||[]).includes(m[0]));
 if(!resources.some(x=>x[0]===tab))tab=resources[0]?.[0]||"patients";
 const activeTab=tab;
 if(!document.getElementById("view")){
  root.innerHTML='<main><aside>'+resources.map(x=>'<button data-tab="'+x[0]+'">'+x[1]+'</button>').join('')+
  '</aside><section><div id="view"><div class="card">Abriendo consulta…</div></div></section></main>';
 }
 for(const btn of root.querySelectorAll("[data-tab]"))btn.classList.toggle("active",btn.dataset.tab===tab);
 const ids=tab==="anatomy"?["patients"]:tab==="workspace"?["patients"]:tab==="assignments"?["assignments","patients"]:tab==="orders"?["orders","encounters"]:tab==="prescriptions"?["prescriptions","encounters","inventory"]:tab==="encounters"?["encounters","patients"]:tab==="appointments"?["appointments","patients"]:tab==="invoices"?["invoices","patient-options"]:tab==="followups"?["followups","patients"]:["patients",tab];
 if((actor.role==="clinician"||actor.role==="admin")&&!ids.includes("followups")&&tab!=="workspace")ids.push("followups");
 const kinds=[...new Set(ids)],needsTemplate=tab==="workspace"||tab==="patients"&&["admin","clinician","reception"].includes(actor.role);
 const [records,templateResult,draftResult]=await Promise.all([
  Promise.all(kinds.map(id=>api(id).then(x=>x.items).catch(error=>{
   if(id==="patients")throw error;
   return [];
  }))),
  needsTemplate?api("patient-intake-template"):Promise.resolve(null),
  viewDrafts[tab]?Promise.resolve(null):api("clinical-draft/"+tab),
 ]);
 if(sequence!==loadSequence||activeTab!==tab)return;
 for(let i=0;i<kinds.length;i++)data[kinds[i]]=records[i];
 if(templateResult)patientForm=templateResult.template;
 if(draftResult?.draft)viewDrafts[tab]=draftResult.draft;
 if(tab==="workspace"){
  if(!data.patients.some(x=>x.id===selectedPatientId))selectedPatientId=data.patients[0]?.id||"";
  data.patientContext=selectedPatientId?(await api("patient-context/"+selectedPatientId)).context:null;
  if(sequence!==loadSequence||activeTab!==tab)return;
  for(const kind of ["encounters","orders","prescriptions","followups","appointments","observations","attachments"])
   data[kind]=data.patientContext?.[kind]||[];
 }
 if(tab==="anatomy"){
  if(!(data.patients||[]).some(p=>p.id===selectedPatientId))selectedPatientId=data.patients?.[0]?.id||""
  data.anatomyAttachments=selectedPatientId?(await api("attachments/"+encodeURIComponent(selectedPatientId))).items:[]
  if(sequence!==loadSequence||activeTab!==tab)return
 }
 render();
 if(tab==="workspace")restorePatientDraft();
 restoreView();
}
function actionFor(o){
 let actions=[];
 if(tab==="assignments")actions=[["revokePatient","Revocar acceso"]];
 if(tab==="patients"&&["admin","clinician","reception"].includes(actor.role))actions=[["contactEvidence","Consentimiento"],
   ...(actor.role==="clinician"?[["allergyReview","Revisar alergias"],["openMedicalHistory","Historia longitudinal"]]:[])];
 if(tab==="encounters"&&o.status!=="signed"&&o.practitioner===actor.username)
   actions=[["interview","Entrevista Kira"],["draftInterview","Preparar SOAP desde entrevista"],
     ["document","Documentar"],["review","Revisar"],["sign","Firmar"]];
 if(tab==="prescriptions"&&actor.role==="pharmacy"&&o.status==="prescribed")actions=[["dispense","Dispensar"]];
 if(tab==="orders")actions=o.status==="ordered"&&((actor.role==="lab"&&o.modality==="laboratory")||(actor.role==="radiology"&&o.modality==="imaging"))?[["result","Resultado"]]:
 (o.status==="resulted"||o.status==="critical-pending-review")&&actor.role==="clinician"?
 [["reviewOrder",o.status==="critical-pending-review"?"Reconocer resultado crítico":"Revisar"]]:[];
 if(tab==="inventory")actions=[["receive","Movimiento"]];
 if(tab==="invoices")actions=[["pay","Cobrar"]];
 if(tab==="appointments"&&o.status==="scheduled")actions=[["completeAppointment","Completar"],...(actor.role==="clinician"&&o.practitioner===actor.username?[["sendReminder","Kira: enviar recordatorio"]]:[])];
 if(tab==="followups"&&o.status==="pending"){
  if(o.origin!=="critical-result")actions=[["finishFollowup","Completar"]];
  else if(actor.role==="clinician"&&o.assignedTo===actor.username)
    actions=[["finishFollowup","Cerrar gestión crítica"]];
 }
 return actions.map(a=>'<button class="secondary" data-act="'+a[0]+'" data-id="'+safe(tab==="assignments"?o.patientId+"|"+o.staffId:o.id)+'">'+a[1]+'</button>').join("");
}


// Protected local clinical command surface. No user input is sent to an LLM, a connector or a log.
function kiraNotice(message){
 const output=document.getElementById("kira-output");
 if(!output)return;
 output.replaceChildren(document.createTextNode(message));
}
function kiraScroll(id){
 const element=document.getElementById(id);
 if(!element){kiraNotice("No hay una sección disponible para esta tarea.");return}
 if(element.tagName==="DETAILS")element.open=true;
 element.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderClinicalToolMenu(){
 const target=document.getElementById("kira-output");if(!target)return;
 target.innerHTML='<strong>Herramientas clínicas disponibles</strong>'+
  '<p class="muted">Motor determinista versionado. No emite diagnóstico ni receta, no guarda en el expediente y no envía datos al modelo.</p>'+
  clinicalTools.map(t=>'<div class="ws-item"><div><strong>'+safe(t.title)+'</strong>'+
    '<p class="muted">'+safe(t.description)+'</p></div>'+
    '<button class="secondary" data-act="kiraSelectTool" data-id="'+safe(t.id)+'">Abrir</button></div>').join("");
}
function renderClinicalToolForm(tool){
 const output=document.getElementById("kira-output");if(!output)return;
 selectedClinicalTool=tool.id;
 output.innerHTML='<strong>'+safe(tool.title)+'</strong>'+
  '<p class="muted">'+safe(tool.description)+'</p>'+
  '<div class="kira-tool-fields">'+tool.fields.map(f=>
    '<div>'+field("kira-field-"+f.id,f.label+(f.unit?" ("+f.unit+")":""),f.kind)+'</div>').join("")+'</div>'+
  '<p>'+button("kiraCalculate","Calcular · para revisión")+'</p>'+
  '<p class="muted">No se guarda en el expediente ni se convierte en indicación automáticamente.</p>';
}
async function clinicalIntent(input){
 const normalized=String(input||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .toLowerCase().trim().slice(0,160);
 if(!normalized){kiraNotice("Elige una acción rápida o escribe una tarea como «nuevo paciente», «antecedentes», «IMC» o «receta».");return}
 if(/(calcul|imc|masa corporal|presion media|gestaci|fum|fpp)/.test(normalized)){
  if(!clinicalTools.length){clinicalTools=(await api("clinical-tool-catalog")).tools}
  const kind=/imc|masa corporal/.test(normalized)?"bmi_adult":
    /presion media|arterial media/.test(normalized)?"mean_arterial_pressure":
    /gestaci|fum|fpp/.test(normalized)?"lmp_estimate":null;
  if(kind){const tool=clinicalTools.find(item=>item.id===kind);if(tool)renderClinicalToolForm(tool);
    else kiraNotice("Esta calculadora no está disponible en la versión autorizada.")}
  else renderClinicalToolMenu();
  return;
 }
 if(/(nuevo paciente|crear paciente|registrar paciente|alta de paciente|registro)/.test(normalized)){
  kiraNotice("Abre el registro protegido. Antes de guardar, comprueba coincidencias para evitar duplicados.");
  kiraScroll("ws-registration");return;
 }
 if(/(anteced|historia familiar|patolog|habitos)/.test(normalized)){
  if(!selectedPatientId){kiraNotice("Selecciona o registra primero al paciente.");return}
  await execute("openMedicalHistory",selectedPatientId);return;
 }
 if(/(vital|laborator|analitica|imagen|estudio|prueba|resultado)/.test(normalized)){
  kiraNotice("Aquí puedes archivar documentos y registrar cifras transcritas como pendientes de verificación.");
  kiraScroll("ws-clinical-results");return;
 }
 if(/(recet|prescrip|medicament|farmacia)/.test(normalized)){
  kiraNotice("Abriendo el módulo de prescripción profesional; requiere revisión y firma.");
  await persistView();tab="prescriptions";return load();
 }
 if(/(seguim|pendiente|proxima|cita|agenda)/.test(normalized)){
  kiraNotice("Consulta los seguimientos pendientes; para citas abre la agenda.");
  await persistView();tab=/cita|agenda/.test(normalized)?"appointments":"followups";return load();
 }
 if(/(document|archivo|foto|subir|pdf|biblioteca)/.test(normalized)){
  kiraNotice("Los informes y fotos se conservan cifrados en el expediente seleccionado. No se envían por correo ni al modelo.");
  kiraScroll("ws-clinical-files");return;
 }
 if(/(consult|soap|evolucion|exploracion)/.test(normalized)){
  const draft=(data.encounters||[]).find(item=>item.status!=="signed"&&item.practitioner===actor.username);
  if(draft){await execute("document",draft.id);return}
  kiraNotice("No hay una consulta activa. Abre una desde la tarjeta «Atender en consulta».");
  kiraScroll("ws-current-visit");return;
 }
 if(/(certific|imprimir|auditori|seguro|ars|uci|hospitaliza|cirugia)/.test(normalized)){
  kiraNotice("Esta operación todavía no cuenta con un módulo clínico validado. Su diseño figura en el roadmap, pero no se generará un documento ni un envío ficticio.");
  return;
 }
 kiraNotice("Puedo abrir registro, antecedentes, consulta, estudios, archivos, recetas, citas y calculadoras clínicas. Para texto libre de un paciente, utiliza la nota clínica protegida, no este campo de órdenes.");
}

function renderWorkspace(){
 const patients=data.patients||[],patient=data.patientContext?.patient,id=patient?.id||"";
 const visits=(data.encounters||[]).filter(x=>x.patientId===id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const previous=visits.find(x=>x.status==="signed"),draft=visits.find(x=>x.status!=="signed"&&x.practitioner===actor.username);
 const orders=(data.orders||[]).filter(x=>x.patientId===id),prescriptions=(data.prescriptions||[]).filter(x=>x.patientId===id);
 const followups=(data.followups||[]).filter(x=>x.patientId===id),attachments=data.attachments||[];
 const observations=(data.observations||[]).filter(x=>x.patientId===id);
 const pending=data.patientContext?.pending||{orders:0,followups:0,attachments:0};
 const timeline=[
  ...visits.map(x=>({date:x.createdAt,title:"Consulta · "+x.complaint,detail:x.status==="signed"?"Plan indicado: "+(x.plan||"No documentado"):"Borrador pendiente de firma",status:x.status})),
  ...orders.map(x=>({date:x.createdAt,title:"Estudio · "+x.description,detail:x.result||"Resultado pendiente",status:x.status})),
  ...prescriptions.map(x=>({date:x.createdAt,title:"Receta · "+x.medication,detail:x.directions||"Sin indicaciones documentadas",status:x.status})),
  ...followups.map(x=>({date:x.createdAt,title:"Seguimiento · "+x.description,detail:"Próxima fecha: "+(x.dueAt||"No registrada"),status:x.status})),
  ...attachments.map(x=>({date:x.createdAt,title:"Archivo recibido · "+x.name,detail:x.note||"Aportado por el paciente",status:x.reviewStatus==="reviewed"?"Revisado":"Pendiente de revisión"})),
  ...observations.map(x=>({date:x.effectiveAt||x.createdAt,title:"Medición · "+x.display,detail:String(x.value)+" "+x.unit+" · "+x.source,status:x.status==="verified"?"Verificado":"Sin verificar"}))
 ].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
 const lookup=patients.length?'<label for="ws-patient">Paciente activo</label><select id="ws-patient">'+
  patients.map(x=>'<option value="'+safe(x.id)+'" '+(x.id===id?"selected":"")+'>'+safe(x.name)+' · '+safe(x.dateOfBirth||"Fecha desconocida")+'</option>').join("")+'</select>':
  '<p class="muted">No hay pacientes asignados. Puedes registrar al primero aquí.</p>';
 const inputs=(patientForm.fields||[]).map(f=>{
  const id="ws-extra-"+f.id;
  return '<div>'+patientField(f,"ws-extra-")+'</div>';
 }).join("");
 const editor='<details id="ws-template-editor"><summary class="ws-summary">Personalizar formulario · agregar o quitar campos</summary>'+
  '<p class="muted">Campos del consultorio, no códigos ejecutables. No envía datos del paciente a Kira. Los registros anteriores no se borran.</p>'+
  field("ws-new-label","Nuevo campo","text",false,"Ej.: ARS / Seguro")+
  '<label for="ws-new-type">Tipo</label><select id="ws-new-type">'+
  ["text","number","date","email","tel"].map(x=>'<option>'+x+'</option>').join("")+'</select>'+
  '<label><input id="ws-new-required" type="checkbox" style="width:auto;display:inline"> Obligatorio</label>'+
  button("workspaceAddField","Agregar campo","secondary")+
  (patientForm.fields||[]).map(f=>'<div class="ws-item">'+safe(f.label)+
    ' <button class="secondary" data-act="workspaceRemoveField" data-id="'+safe(f.id)+'">Quitar</button></div>').join("")+
  '<p class="muted">En una siguiente integración podrás configurar estas reglas conversando con Kira; '+
  'el guardado de datos personales permanece en el expediente protegido.</p></details>';
 const registration='<details class="card" id="ws-registration"><summary class="ws-summary">+ Paciente nuevo sin cuenta ni página web</summary>'+
  '<div class="ws-grid"><div>'+field("ws-name","Nombre completo")+'</div><div>'+field("ws-dob","Nacimiento","date")+'</div>'+
  '<div>'+field("ws-phone","Teléfono (opcional)","tel",false)+'</div><div>'+field("ws-email","Correo (opcional)","email",false)+'</div>'+
  '<div><label for="ws-doc-type">Identificación</label><select id="ws-doc-type">'+
  '<option value="cedula">Cédula</option><option value="passport">Pasaporte</option>'+
  '<option value="other">Otro</option></select></div><div>'+
  field("ws-document","Número de documento (opcional)","text",false)+'</div>'+inputs+'</div>'+
  '<p class="muted">El número de cédula se valida solo por formato; no confirma identidad con la JCE.</p>'+
  '<div id="ws-matches" aria-live="polite"></div>'+
  button("workspaceCheckIdentity","Buscar posibles duplicados","secondary")+
  '<label><input id="ws-distinct" type="checkbox" style="width:auto;display:inline"> '+
  'Confirmo que se trata de una persona distinta aunque haya coincidencias</label>'+
  field("ws-distinct-reason","Motivo comprobado de identidad distinta","text",false)+
  field("ws-complaint-new","Motivo de la consulta","text",true,"Consulta presencial")+
  button("workspaceCreate","Registrar y abrir consulta")+editor+'</details>';
 let panel="";
 if(patient){
  panel+=box("Expediente · "+safe(patient.name),
   '<div class="ws-meta">Nacimiento: '+safe(patient.dateOfBirth)+' · Teléfono: '+safe(patient.phone||"No indicado")+'</div>'+
   '<div class="ws-alert"><strong>Alergias:</strong> '+safe(patient.allergyReview?.details||patient.allergyReview?.status||"Sin revisión documentada")+'</div>'+
   '<p><strong>Medicamentos:</strong> '+safe(patient.medicalHistory?.currentMedications||"Pendientes de conciliación")+'</p>'+
   '<p><strong>Problemas:</strong> '+safe(patient.medicalHistory?.problems||"No documentados")+'</p>'+
   '<button class="secondary" data-act="openMedicalHistory" data-id="'+safe(id)+'">Revisar antecedentes</button> '+
   '<button class="secondary" data-act="allergyReview" data-id="'+safe(id)+'">Verificar alergias</button>');
  panel+='<div id="ws-current-visit">';
  panel+=box("Atender en consulta",
   '<div class="ws-grid"><div>'+field("ws-specialty","Especialidad","text",true,"Medicina familiar")+
   '</div><div>'+field("ws-complaint","Motivo actual")+'</div></div>'+
   button("workspaceVisit","Abrir consulta")+
   (draft?'<div class="ws-alert"><strong>Consulta en curso:</strong> '+safe(draft.complaint)+
    '<p><button class="secondary" data-act="document" data-id="'+safe(draft.id)+'">Continuar SOAP</button> '+
    '<button class="secondary" data-act="interview" data-id="'+safe(draft.id)+'">Entrevista Kira</button></p></div>':"")+
   '<div class="ws-note"><strong>Última consulta firmada:</strong> '+(previous?
    safe(previous.complaint)+'<p><strong>Plan anterior:</strong> '+safe(previous.plan||"No documentado")+'</p>':
    'Aún no se registra una consulta firmada.')+'</div>'+
   '<div class="ws-note"><strong>Qué sigue:</strong> '+(followups.some(x=>x.status==="pending")?
    followups.filter(x=>x.status==="pending").map(x=>'<p>'+safe(x.description)+' · '+safe(x.dueAt||"Sin fecha")+'</p>').join(""):
    "No existen tareas de seguimiento registradas")+'</div>');
  panel+='</div><div id="ws-clinical-files">';
  panel+=box("Analíticas, imágenes y documentos aportados",
   '<p class="muted">Selecciona una foto o PDF del equipo del médico. Se archiva cifrado; no se envía por correo y no se interpreta automáticamente.</p>'+
   '<label for="ws-file">Archivo · PDF, JPG, PNG o WebP (máximo 5 MB)</label>'+
   '<input type="file" id="ws-file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp">'+
   field("ws-note","Descripción o fecha del estudio (opcional)","text",false)+
   button("workspaceUpload","Archivar documento")+
   '<div class="ws-list">'+(attachments.length?attachments.map(x=>
    '<div class="ws-item"><div><strong>'+safe(x.name)+'</strong><div class="muted">'+safe(x.note||"Aportado en consulta")+
    ' · '+(x.reviewStatus==="reviewed"?"Revisado por el profesional":"Pendiente de revisión")+
    '</div></div><button class="secondary" data-act="workspaceViewFile" data-id="'+safe(x.id)+'">Ver</button>'+
    (x.reviewStatus==="pending"?'<button class="secondary" data-act="workspaceReviewFile" data-id="'+safe(x.id)+'">Marcar revisado</button>':"")+'</div>'
   ).join(""):'<p class="muted">Aún no hay archivos adjuntos.</p>')+'</div><div id="ws-preview" aria-live="polite"></div>');
  panel+='</div><div id="ws-clinical-results">';
  panel+=box("Analíticas y signos vitales",
    '<p class="muted">Captura datos numéricos con su fuente, unidad y fecha. No aparecen como verificados hasta que el médico los confirme.</p>'+
    '<details><summary class="ws-summary">+ Registrar resultado numérico</summary>'+
    '<div class="ws-grid"><div>'+field("ws-observation-name","Prueba o signo vital")+'</div>'+
    '<div>'+field("ws-observation-value","Valor numérico","number")+'</div>'+
    '<div>'+field("ws-observation-unit","Unidad")+'</div>'+
    '<div>'+field("ws-observation-date","Fecha de medición","datetime-local")+'</div>'+
    '<div>'+field("ws-reference-low","Referencia inferior (opcional)","number",false)+'</div>'+
    '<div>'+field("ws-reference-high","Referencia superior (opcional)","number",false)+'</div></div>'+
    '<label for="ws-observation-source">Origen de los datos</label><select id="ws-observation-source">'+
    '<option value="patient-provided">Referido por el paciente</option>'+
    '<option value="clinician-measured">Medido por el profesional</option>'+
    '<option value="document-transcribed">Transcrito de documento</option></select>'+
    '<label for="ws-source-attachment">Documento de origen (si se transcribió)</label>'+
    '<select id="ws-source-attachment"><option value="">Seleccionar informe</option>'+
    attachments.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join("")+'</select>'+
    '<p>'+button("workspaceAddObservation","Guardar cifra sin verificar")+'</p></details>'+
    (observations.length?observations.slice().sort((a,b)=>String(b.effectiveAt).localeCompare(String(a.effectiveAt)))
      .slice(0,30).map(x=>'<div class="ws-item"><div><strong>'+safe(x.display)+'</strong> · '+
        safe(x.value)+' '+safe(x.unit)+'<div class="muted">'+safe(String(x.effectiveAt).slice(0,10))+
        ' · '+safe(x.source)+' · '+(x.status==="verified"?"Verificado":"Pendiente de revisión")+'</div></div>'+
        (x.status==="unverified"?
          '<button class="secondary" data-act="workspaceVerifyObservation" data-id="'+safe(x.id)+'">Verificar</button>':"")+
        '</div>').join(""):'<p class="muted">Aún no hay cifras registradas.</p>')+
    (observations.some(x=>x.status==="verified")?
      '<div class="ws-note"><strong>Tendencias verificadas, por variable y unidad</strong>'+
      [...new Set(observations.filter(x=>x.status==="verified").map(x=>x.display+"|"+x.unit))]
        .slice(0,12).map(key=>{
          const series=observations.filter(x=>x.status==="verified"&&x.display+"|"+x.unit===key)
            .sort((a,b)=>String(a.effectiveAt).localeCompare(String(b.effectiveAt)));
          return '<p>'+safe(series[0].display)+' · '+safe(series[0].unit)+': '+
            series.slice(-5).map(x=>safe(x.value)+' ('+safe(String(x.effectiveAt).slice(0,10))+')').join(' → ')+'</p>';
        }).join("")+'</div>':""));
  panel+="</div>";
  panel+=box("Línea de tiempo longitudinal",
   timeline.length?timeline.slice(0,80).map(x=>
    '<div class="ws-timeline"><div><strong>'+safe(x.title)+'</strong><span class="tag">'+safe(x.status||"Registrado")+'</span></div>'+
    '<p>'+safe(x.detail)+'</p><small>'+safe(x.date?new Date(x.date).toLocaleDateString("es-DO"):"Sin fecha")+'</small></div>'
   ).join(""):'<p class="muted">Aquí aparecerán consultas, indicaciones, resultados y documentos previos.</p>');
 }
 const kiraCard='<article class="kira-panel" aria-label="Kira clínica local">'+
  '<div class="kira-title"><h3>✧ Kira · Asistente de consulta</h3>'+
  '<span class="tag">Privado · Sin envío a IA externa</span></div>'+
  '<p class="muted">Dime la tarea: abriré el formulario o herramienta adecuada. Los datos clínicos permanecen en esta sesión protegida.</p>'+
  '<div class="kira-command"><input id="kira-command" type="text" maxlength="160" autocomplete="off" '+
  'placeholder="Ej.: nuevo paciente, antecedentes, calcular IMC…" aria-label="Instrucción clínica local">'+
  button("kiraTalk","Abrir herramienta")+'</div>'+
  '<div class="kira-chips">'+[
    ["nuevo paciente","Nuevo paciente"],["antecedentes","Antecedentes"],
    ["consulta","Consulta"],["analíticas","Estudios"],["receta","Receta"],
    ["calculadoras","Calculadoras"],["archivos","Archivos"]
  ].map(item=>'<button class="secondary" data-act="kiraQuick" data-id="'+safe(item[0])+'">'+safe(item[1])+'</button>').join("")+'</div>'+
  '<div class="kira-output" id="kira-output" aria-live="polite">Estoy lista para abrir el siguiente paso del trabajo clínico. Selecciona una acción.</div>'+
  '</article>';

 document.getElementById("view").innerHTML=
  '<div class="ws-heading"><div><h2>Mi consulta</h2><p class="muted">El paciente está contigo · Consulta y expediente sin salir de esta pantalla</p></div>'+
  '<span class="tag">Local · Cifrado</span></div>'+
  (patient?'<div class="ws-metrics"><div><strong>'+pending.orders+'</strong><small>Órdenes por revisar</small></div>'+
    '<div><strong>'+pending.followups+'</strong><small>Seguimientos pendientes</small></div>'+
    '<div><strong>'+pending.attachments+'</strong><small>Archivos por revisar</small></div></div>':"")+
  kiraCard+'<div class="card">'+lookup+'</div>'+registration+panel;
}
function renderAnatomy(){
 const patients=data.patients||[];
 const options=patients.map(p=>'<option value="'+safe(p.id)+'"'+(p.id===selectedPatientId?' selected':'')+'>'+safe(p.name)+'</option>').join('');
 const models=(data.anatomyAttachments||[]).filter(f=>f.mime==="model/gltf-binary");
 document.getElementById("view").innerHTML=
  '<div class="ws-heading"><div><h2>Gemelo anatómico · 3D</h2><p class="muted">Modelo GLB clínico experimental y protegido. No equivale a diagnóstico.</p></div><span class="tag">Local · Cifrado</span></div>'+
  '<article class="card"><h2>Paciente autorizado</h2><label for="anatomy-patient">Paciente</label><select id="anatomy-patient">'+options+'</select>'+
  '<p class="notice warning">Los modelos deben derivarse de estudios volumétricos y revisarse sobre las imágenes originales. Un ECG o una radiografía no determinan la anatomía 3D individual.</p>'+
  '<label for="anatomy-file">Modelo GLB v2 autocontenido (máximo 5 MB)</label>'+
  '<input type="file" id="anatomy-file" accept=".glb,model/gltf-binary">'+
  field("anatomy-note","Procedencia del estudio, fecha o referencia", "text",false)+
  button("anatomyUpload","Archivar modelo cifrado")+'</article>'+
  '<article class="card"><h2>Modelos registrados</h2>'+
   (models.length?models.map(x=>'<div class="ws-item"><div><strong>'+safe(x.name)+'</strong><div class="muted">'+safe(x.note||"Sin referencia")+
    ' · '+safe(x.anatomicalModel?.meshes??"—")+' mallas · '+(x.reviewStatus==="reviewed"?"Revisado por médico (no validado)":"Pendiente de revisión")+
    ' · Anatomía no validada</div></div>'+
    button("anatomyView","Explorar 3D","secondary").replace('data-act="anatomyView"','data-act="anatomyView" data-id="'+safe(x.id)+'"')+
    (x.reviewStatus==="pending"?button("anatomyReview","Revisión médica","secondary").replace('data-act="anatomyReview"','data-act="anatomyReview" data-id="'+safe(x.id)+'"'):"")+'</div>').join(""):
    '<p class="muted">No hay modelos 3D archivados para este paciente.</p>')+
   '<div id="anatomy-viewport" style="position:relative;min-height:390px;overflow:hidden;border-radius:12px;background:#eaf2fa;margin-top:14px" aria-label="Visor anatómico 3D">'+
   '<p class="muted" style="padding:20px">Seleccione un modelo para abrirlo.</p></div>'+
   '<div id="anatomy-structure-list" class="ws-list" aria-label="Estructuras segmentadas"></div></article>';
}
function render(){
 if(tab==="anatomy")return renderAnatomy();
 if(tab==="workspace")return renderWorkspace();
 const d=tab==="backups"?(data.backups||[]).map(fileName=>({fileName})):data[tab]||[],patients=tab==="invoices"&&actor.role==="billing"?(data["patient-options"]||[]):data.patients||data["patient-options"]||[];
 const p=pick("patientId","Paciente",patients,x=>x.name+(x.dateOfBirth?" · "+x.dateOfBirth:""));
 let form="";
 if(tab==="patients"&&["admin","clinician","reception"].includes(actor.role)){
  form='<div class="ws-grid"><div>'+field("name","Nombre completo")+'</div>'+
   '<div>'+field("dateOfBirth","Fecha de nacimiento","date")+'</div>'+
   '<div>'+field("phone","Teléfono","tel",false)+'</div>'+
   '<div>'+field("email","Correo electrónico","email",false)+'</div>'+
   '<div><label for="documentType">Tipo de documento</label><select id="documentType">'+
    '<option value="cedula">Cédula</option><option value="passport">Pasaporte</option>'+
    '<option value="other">Otro</option></select></div>'+
   '<div>'+field("documentNumber","Número de documento","text",false)+'</div></div>'+
   '<h3>Información complementaria y administrativa</h3>'+
   '<p class="muted">La plantilla se conserva para futuras altas. Los campos se guardan cifrados junto al expediente, no en el chat.</p>'+
   '<div class="ws-grid">'+patientForm.fields.map(f=>'<div>'+patientField(f,"patient-extra-")+'</div>').join("")+'</div>'+
   '<div id="patient-matches" aria-live="polite"></div>'+
   '<p>'+button("patientCheckIdentity","Comprobar si ya existe","secondary")+'</p>'+
   '<label><input id="patient-distinct" type="checkbox" style="width:auto;display:inline"> He confirmado que es otra persona pese a una coincidencia</label>'+
   field("patient-distinct-reason","Justificación documentada","text",false)+
   '<p class="muted">Guardar crea un expediente persistente identificado por ID y versión. Los datos no se envían a Kira.</p>'+
   button("create","Guardar paciente en el expediente");
 }
 if(tab==="encounters"&&["clinician","psychologist"].includes(actor.role))form=p+field("specialty","Especialidad", "text", true,"Medicina familiar")+
 field("complaint","Motivo de consulta")+
 '<label>Modalidad Kira</label><select id="mode"><option value="kira">Kira interroga</option><option value="mixed">Mixto</option><option value="manual">Profesional</option></select>'+button("create","Abrir consulta")+
 button("openAskCopilot","Kira · ASK clínico","secondary")+
 '<p class="notice">El profesional decide y firma. Kira puede guiar preguntas desde el chat, pero el contenido identificable del expediente no se envía al modelo.</p>';
 if(tab==="appointments")form=p+field("practitioner","Profesional")+field("startsAt","Fecha y hora","datetime-local")+field("reason","Motivo")+button("create","Programar cita");
 if(tab==="orders"&&actor.role==="clinician")form=pick("encounterId","Consulta firmada",data.encounters.filter(x=>x.status==="signed"),x=>x.complaint+" · "+x.practitioner)+
 '<label>Tipo</label><select id="modality"><option value="laboratory">Laboratorio</option><option value="imaging">Imagen</option></select>'+area("description","Descripción y estudio indicado")+button("create","Emitir orden");
 if(tab==="prescriptions"&&actor.role==="clinician")form=pick("encounterId","Consulta firmada",data.encounters.filter(x=>x.status==="signed"),x=>x.complaint)+field("medication","Medicamento")+area("directions","Indicaciones autorizadas")+
 '<label><input type="checkbox" id="safety" style="width:auto;display:inline"> Como prescriptor confirmo revisión de alergias registradas, interacciones y dosis. PHOENIX aún no dispone de catálogo farmacológico validado.</label>'+button("create","Registrar prescripción");
 if(tab==="inventory")form=field("item","Producto")+button("create","Agregar producto");
 if(tab==="invoices")form=p+field("concept","Concepto")+field("amountCents","Monto en centavos","number")+button("create","Emitir factura");
 if(tab==="followups")form=p+field("assignedTo","Asignado a")+field("dueAt","Fecha y hora","datetime-local")+area("description","Tarea de seguimiento")+button("create","Crear seguimiento");
 if(tab==="backups")form='<p class="notice warning">Copia SQLite consistente y verificada. Resguárdela mediante un procedimiento institucional y pruebe restauración fuera del Host.</p>'+button("backup","Crear respaldo verificado");
 if(tab==="assignments")form=pick("patientId","Paciente",patients,x=>x.name)+field("staffId","Usuario profesional")+field("purpose","Motivo de atención")+button("grantPatient","Autorizar atención");
 if(tab==="staff")form=field("username","Usuario")+field("password","Contraseña inicial (16+)","password")+
 '<label>Rol</label><select id="role">'+["clinician","psychologist","nurse","reception","lab","radiology","pharmacy","billing"].map(x=>'<option>'+x+'</option>').join('')+'</select>'+button("create","Crear personal");
 const titles=Object.fromEntries(modules.map(x=>[x[0],x[1]]));
 const genericRows=(d,columns)=>rows(d,columns);
 let cols=[["ID","id"],["Estado","status"]];
 if(tab==="patients")cols=[["Nombre","name"],["Nacimiento","dateOfBirth"],["Email","email"],["Consentimiento","emailConsent"]];
 if(tab==="encounters")cols=[["Motivo","complaint"],["Especialidad","specialty"],["Profesional","practitioner"],["Estado","status"]];
 if(tab==="appointments")cols=[["Profesional","practitioner"],["Inicio","startsAt"],["Estado","status"]];
 if(tab==="orders")cols=[["Tipo","modality"],["Estudio","description"],["Estado","status"],
   ["Crítico indicado por laboratorio","critical"]];
 if(tab==="prescriptions")cols=[["Medicamento","medication"],["Firmado por","signedBy"],["Estado","status"]];
 if(tab==="inventory")cols=[["Producto","item"],["Unidades","units"]];
 if(tab==="invoices")cols=[["Concepto","concept"],["Total (centavos)","amountCents"],["Pagado","paidCents"]];
 if(tab==="followups")cols=[["Tarea","description"],["Prioridad","priority"],
   ["Asignado a","assignedTo"],["Vence","dueAt"],["Estado","status"]];
 if(tab==="backups")cols=[["Archivo verificado","fileName"]];
 if(tab==="assignments")cols=[["Paciente","patientId"],["Profesional","staffId"],["Finalidad","purpose"],["Autorizó","grantedBy"]];
 if(tab==="staff")cols=[["Usuario","username"],["Rol","role"],["Centro","org"]];
 if(tab==="audit")cols=[["Acción","action"],["Actor","actor"],["Registro","recordId"],["Hora","happened"]];
 const criticalFollowupCount=(data.followups||[]).filter(x=>
  x.status==="pending"&&x.priority==="urgent"&&
  (actor.role==="admin"||x.assignedTo===actor.username)).length;
 const criticalBanner=criticalFollowupCount?
  '<div role="alert" class="notice warning"><strong>Atención clínica urgente: '+
  criticalFollowupCount+' seguimiento(s) pendientes.</strong> '+
  'Contacte directamente al equipo responsable según el protocolo institucional. '+
  'PHOENIX no envía avisos externos automáticos. '+
  button("openCriticalFollowups","Abrir seguimiento urgente","secondary")+'</div>':'';
 document.getElementById("view").innerHTML=criticalBanner+
 box(titles[tab],'<div class="muted">Datos de la institución autenticada · Registro persistente cifrado</div>'+form)+
 box("Registros",genericRows(d,cols))+(tab==="prescriptions"?'<p class="notice warning">Las recetas no se envían por correo desde esta versión. La firma clínica exige revisión profesional.</p>':'');
}
async function execute(action,id){
 if(action==="kiraTalk"){
  // This input accepts only task commands. No raw note is logged, sent to models or saved.
  const command=val("kira-command");return clinicalIntent(command);
 }
 if(action==="kiraQuick"){return clinicalIntent(id)}
 if(action==="kiraSelectTool"){
  const tool=clinicalTools.find(item=>item.id===id);
  if(!tool)throw Error("Herramienta no autorizada");
  renderClinicalToolForm(tool);return;
 }
 if(action==="kiraCalculate"){
  const tool=clinicalTools.find(item=>item.id===selectedClinicalTool);
  if(!tool)throw Error("Seleccione primero una herramienta");
  const values=Object.fromEntries(tool.fields.map(f=>{
   const raw=val("kira-field-"+f.id);
   if(!raw.trim())throw Error("Falta el dato: "+f.label);
   return [f.id,f.kind==="number"?Number(raw):raw];
  }));
  const result=(await api("clinical-tool-run","POST",{toolId:tool.id,values})).result;
  const output=document.getElementById("kira-output");if(!output)return;
  const rows=Object.entries(result.output||{}).map(([key,value])=>
    '<div class="ws-item"><strong>'+safe(key)+'</strong><strong>'+safe(value)+'</strong></div>').join("");
  output.innerHTML='<div class="kira-tool-result"><strong>'+safe(tool.title)+'</strong>'+
    '<p class="muted">Versión '+safe(result.version)+' · '+safe(result.reference)+'</p>'+
    rows+'<p>'+safe(result.notice)+'</p>'+
    '<p class="muted">Cálculo pendiente de revisión médica. No se ha guardado en la historia ni generado receta.</p>'+
    button("kiraToolList","Ver otras herramientas","secondary")+'</div>';
  return;
 }
 if(action==="kiraToolList"){renderClinicalToolMenu();return}



 if(action==="workspaceAddObservation"){
  if(!selectedPatientId)throw Error("Seleccione paciente");
  const display=val("ws-observation-name").trim(),unit=val("ws-observation-unit").trim(),
    raw=val("ws-observation-value"),value=Number(raw),effectiveAt=val("ws-observation-date"),
    source=val("ws-observation-source"),sourceAttachmentId=val("ws-source-attachment");
  if(!display||!unit||!raw.trim()||!Number.isFinite(value)||!effectiveAt)
    throw Error("Complete parámetro, valor, unidad y fecha");
  if(source==="document-transcribed"&&!sourceAttachmentId)throw Error("Elija el documento de origen");
  const lo=val("ws-reference-low"),hi=val("ws-reference-high");
  await api("observations","POST",{patientId:selectedPatientId,display,value,unit,effectiveAt,
    source,sourceAttachmentId,referenceLow:lo?Number(lo):null,referenceHigh:hi?Number(hi):null});
  notice("Resultado guardado sin verificar; revise su fuente.");return load();
 }
 if(action==="workspaceVerifyObservation"){
  const item=data.observations?.find(x=>x.id===id);if(!item)throw Error("Valor no encontrado");
  if(!confirm("¿Comparaste el valor, la unidad, la fecha y el origen con su fuente?"))return;
  await api("observations/"+id,"PATCH",{version:item.version,action:"verify"});
  notice("Resultado verificado por el médico.");return load();
 }
 if(action==="workspaceReviewFile"){
  const item=data.attachments?.find(x=>x.id===id);if(!item)throw Error("Documento no encontrado");
  if(!confirm("¿Revisaste el archivo? Esta acción confirma su lectura, no valida las conclusiones del documento."))return;
  await api("attachment-review/"+id,"PATCH",{version:item.version});
  notice("Revisión del archivo registrada.");return load();
 }
 if(action==="workspaceAddField"){
  const label=val("ws-new-label").trim();
  if(!label||label.length>80||patientForm.fields.length>=64)throw Error("Etiqueta inválida o límite de campos alcanzado");
  let slug=label.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"").slice(0,22);
  if(!/^[a-z]/.test(slug))slug="dato_"+slug.slice(0,15);
  const prefix="custom_"+slug;let key=prefix,n=2;
  while(patientForm.fields.some(f=>f.id===key)){key=prefix.slice(0,27)+"_"+n++;if(n>100)throw Error("Cambie la etiqueta")}
  const fields=[...patientForm.fields,{id:key,label,kind:val("ws-new-type"),
    required:document.getElementById("ws-new-required")?.checked===true}];
  rememberPatientDraft();
  await persistView();
  patientForm=(await api("patient-intake-template","PATCH",
    {version:1,expectedRevision:patientForm.revision,fields})).template;
  notice("Campo agregado a la plantilla.");return load();
 }
 if(action==="workspaceRemoveField"){
  const fields=patientForm.fields.filter(f=>f.id!==id);
  if(fields.length===patientForm.fields.length)throw Error("Campo inexistente");
  if(!confirm("¿Retirar este campo de futuros registros? Los datos antiguos se conservan."))return;
  rememberPatientDraft();
  await persistView();
  patientForm=(await api("patient-intake-template","PATCH",
    {version:1,expectedRevision:patientForm.revision,fields})).template;
  notice("Campo retirado.");return load();
 }
 if(action==="workspaceChooseExisting"){
  if(!data.patients.some(p=>p.id===id))throw Error("Paciente no asignado");
  selectedPatientId=id;patientDraft=null;await forgetDraft("workspace");notice("Ficha existente seleccionada: no se creó un duplicado.");return load();
 }
 if(action==="workspaceCheckIdentity"){
  const input={name:val("ws-name").trim(),dateOfBirth:val("ws-dob"),
    documentType:val("ws-doc-type"),documentNumber:val("ws-document"),
    phone:val("ws-phone"),email:val("ws-email")};
  const result=(await api("patient-identity-match","POST",input)).result;
  const view=document.getElementById("ws-matches");
  if(view)view.innerHTML=result.matches.length||result.restrictedCount
    ?'<p class="notice warning">Coincidencias posibles: revise antes de registrar.</p>'+
      result.matches.map(p=>'<div class="ws-item">'+safe(p.name)+' · '+safe(p.dateOfBirth)+
        ' · '+safe(p.reason)+' <button class="secondary" data-act="workspaceChooseExisting" data-id="'+safe(p.id)+'">Abrir ficha</button></div>').join("")+
      (result.restrictedCount?'<p class="muted">Hay coincidencias restringidas. Consulte a recepción o administración.</p>':'')
    :'<p class="notice">Sin coincidencias detectadas entre las fichas del consultorio.</p>';
  return result;
 }
 if(action==="workspaceCreate"){
  const name=val("ws-name").trim(),dateOfBirth=val("ws-dob"),complaint=val("ws-complaint-new").trim();
  if(!name||!dateOfBirth||!complaint)throw Error("Completa nombre, nacimiento y motivo");
  const duplicates=await execute("workspaceCheckIdentity");
  if(duplicates.matches.some(p=>p.reason==="document"))throw Error("Documento ya registrado: abra la ficha existente");
  if(duplicates.restrictedCount)throw Error("Posible ficha de otro profesional: confirme con administración");
  const distinct=document.getElementById("ws-distinct")?.checked===true;
  if(duplicates.matches.length&&!distinct)throw Error("Seleccione el paciente existente o confirme que es otra persona");
  if(!confirm("¿Comprobaste identidad y exactitud de los datos?"))return;
  const customFields=Object.fromEntries(patientForm.fields.map(f=>[f.id,val("ws-extra-"+f.id)]));
  const created=await api("patients","POST",{name,dateOfBirth,phone:val("ws-phone"),
    email:val("ws-email"),documentType:val("ws-doc-type"),
    documentNumber:val("ws-document"),customFields,
    confirmDistinct:distinct,distinctReason:val("ws-distinct-reason")});
  selectedPatientId=created.record.id;patientDraft=null;
  if(!(await api("patients")).items.some(p=>p.id===selectedPatientId))
   throw Error("No se ha confirmado la recuperación del paciente creado");
  await forgetDraft("workspace");
  try{
   await api("encounters","POST",{patientId:selectedPatientId,specialty:"Medicina general",complaint,mode:"mixed"});
   notice("Paciente y consulta guardados.");
  }catch(error){notice("Paciente creado, pero no se abrió la consulta: "+error.message)}
  return load();
 }
 if(action==="patientCheckIdentity"){
  const result=(await api("patient-identity-match","POST",{
   name:val("name").trim(),dateOfBirth:val("dateOfBirth"),documentType:val("documentType"),
   documentNumber:val("documentNumber"),phone:val("phone"),email:val("email"),
  })).result;
  const target=document.getElementById("patient-matches");
  if(target)target.innerHTML=result.matches.length||result.restrictedCount?
   '<p class="notice warning">Posibles coincidencias: revise la identidad antes de guardar.</p>'+
   result.matches.map(p=>'<div class="ws-item">'+safe(p.name)+' · '+safe(p.dateOfBirth)+' · '+safe(p.reason)+'</div>').join("")+
   (result.restrictedCount?'<p>Existen fichas restringidas; consulte a admisión.</p>':''):
   '<p class="notice">No se encontraron coincidencias en el directorio.</p>';
  return;
 }
 if(action==="workspaceVisit"){
  if(!selectedPatientId)throw Error("Selecciona un paciente");
  const specialty=val("ws-specialty").trim(),complaint=val("ws-complaint").trim();
  if(!specialty||!complaint)throw Error("Indica especialidad y motivo");
  await api("encounters","POST",{patientId:selectedPatientId,specialty,complaint,mode:"mixed"});
  notice("Consulta creada.");return load();
 }
 if(action==="anatomyUpload"){
  if(!selectedPatientId||!(data.patients||[]).some(p=>p.id===selectedPatientId))
   throw Error("Paciente no autorizado")
  const file=document.getElementById("anatomy-file")?.files?.[0]
  if(!file||!file.size||file.size>5*1024*1024||!/\.glb$/i.test(file.name))
   throw Error("Seleccione un GLB autocontenido de hasta 5 MB")
  const bytes=new Uint8Array(await file.arrayBuffer())
  const parts=[]
  for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)))
  await api("attachments","POST",{patientId:selectedPatientId,name:file.name,
    mime:"model/gltf-binary",base64:btoa(parts.join("")),note:val("anatomy-note")})
  notice("Modelo cifrado en HealthIA. Aún no está validado clínicamente.");return load()
 }
 if(action==="anatomyReview"){
  const record=(data.anatomyAttachments||[]).find(f=>f.id===id)
  if(!record||record.mime!=="model/gltf-binary")throw Error("Modelo no disponible")
  const sourceReference=prompt("Referencia del estudio original comparado (obligatoria):")
  if(sourceReference===null)return
  const assessment=prompt("Concordancia: consistent, uncertain o discordant","uncertain")
  if(assessment===null)return
  const limitations=prompt("Limitaciones o diferencias observadas (obligatorio):")
  if(limitations===null)return
  if(!confirm("¿Revisó personalmente las imágenes originales y el modelo 3D? Esta revisión NO certifica validez diagnóstica."))return
  await api("anatomy-review/"+encodeURIComponent(id),"PATCH",{
    version:record.version,sourceReference,assessment,limitations,comparedWithSource:true})
  notice("Revisión anatómica de investigación registrada y auditada; sin certificación.");return load()
 }
 if(action==="anatomyView"){
  const record=(data.anatomyAttachments||[]).find(f=>f.id===id)
  if(!record||record.mime!=="model/gltf-binary")throw Error("No existe modelo autorizado")
  if(anatomyViewerCleanup){anatomyViewerCleanup();anatomyViewerCleanup=null}
  const response=await fetch("/health/api/attachment/"+encodeURIComponent(id),
    {credentials:"same-origin",cache:"no-store"})
  if(!response.ok)throw Error("Modelo inaccesible para el profesional")
  const bytes=await response.arrayBuffer()
  const THREE=await import("/health/vendor/build/three.module.js")
  const [{GLTFLoader},{OrbitControls}]=await Promise.all([
    import("/health/vendor/examples/jsm/loaders/GLTFLoader.js"),
    import("/health/vendor/examples/jsm/controls/OrbitControls.js"),
  ])
  const gltf=await new Promise((yes,no)=>new GLTFLoader().parse(bytes,"",yes,no))
  const target=document.getElementById("anatomy-viewport")
  if(!target||tab!=="anatomy")return
  target.replaceChildren()
  const scene=new THREE.Scene();scene.background=new THREE.Color("#edf4fa")
  const root=gltf.scene;root.rotation.x=-Math.PI/2;root.updateMatrixWorld(true);scene.add(root)
  scene.add(new THREE.HemisphereLight(0xffffff,0x9db5cc,2.5))
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(2,3,4);scene.add(sun)
  const box=new THREE.Box3().setFromObject(root)
  if(box.isEmpty())throw Error("Archivo sin geometría visible")
  const mid=box.getCenter(new THREE.Vector3()),size=Math.max(1,box.getSize(new THREE.Vector3()).length())
  const camera=new THREE.PerspectiveCamera(46,1,.001,size*100)
  camera.position.copy(mid).add(new THREE.Vector3(size*.8,size*.65,size*1.3))
  const renderer=new THREE.WebGLRenderer({antialias:true})
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))
  renderer.domElement.style.width="100%";renderer.domElement.style.height="390px"
  renderer.domElement.style.display="block";target.append(renderer.domElement)
  const controls=new OrbitControls(camera,renderer.domElement)
  controls.target.copy(mid);controls.enableDamping=true;controls.update()
  const resize=()=>{const width=Math.max(1,target.clientWidth)
    renderer.setSize(width,390,false);camera.aspect=width/390;camera.updateProjectionMatrix()}
  const observer=new ResizeObserver(resize);observer.observe(target);resize()
  const list=document.getElementById("anatomy-structure-list");list.replaceChildren()
  const meshes=[];root.traverse(x=>{if(x.isMesh)meshes.push(x)})
  for(const mesh of meshes){
    const label=document.createElement("label");label.style.display="flex";label.style.gap="8px"
    const toggle=document.createElement("input");toggle.type="checkbox";toggle.checked=true
    toggle.style.width="auto";toggle.onchange=()=>{mesh.visible=toggle.checked}
    label.append(toggle,document.createTextNode(mesh.name||"Estructura "+(meshes.indexOf(mesh)+1)))
    list.append(label)
  }
  let active=true,frameId=0
  const frame=()=>{if(!active)return;controls.update();renderer.render(scene,camera);frameId=requestAnimationFrame(frame)}
  frame()
  anatomyViewerCleanup=()=>{active=false;cancelAnimationFrame(frameId);observer.disconnect()
    controls.dispose();renderer.dispose();root.traverse(x=>{
      if(x.isMesh){x.geometry?.dispose?.();const mats=Array.isArray(x.material)?x.material:[x.material]
        mats.forEach(m=>m?.dispose?.())}
    });target.replaceChildren();list.replaceChildren()}
  notice("Visor del expediente abierto. Segmentación sin certificación clínica.");return
 }
 if(action==="workspaceUpload"){
  if(!selectedPatientId)throw Error("Selecciona un paciente");
  const file=document.getElementById("ws-file")?.files?.[0];
  if(!file)throw Error("Selecciona una foto o PDF");
  if(!file.size||file.size>5*1024*1024)throw Error("El archivo debe tener como máximo 5 MB");
  if(!["image/png","image/jpeg","image/webp","application/pdf"].includes(file.type))
   throw Error("Solo JPG, PNG, WebP o PDF");
  const bytes=new Uint8Array(await file.arrayBuffer()),parts=[];
  for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  const base64=btoa(parts.join(""));
  await api("attachments","POST",{patientId:selectedPatientId,name:file.name,mime:file.type,
    base64,note:val("ws-note")});
  notice("Archivo cifrado y archivado, pendiente de revisión médica.");return load();
 }
 if(action==="workspaceViewFile"){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
  const r=await fetch("/health/api/attachment/"+encodeURIComponent(id),{
   credentials:"same-origin",cache:"no-store",headers:{"x-phoenix-health":"1"}});
  if(!r.ok)throw Error("No autorizado para abrir el documento");
  const blob=await r.blob(),place=document.getElementById("ws-preview");
  previewUrl=URL.createObjectURL(blob);
  if(blob.type.startsWith("image/")){
   const img=document.createElement("img");img.src=previewUrl;img.alt="Imagen clínica aportada";
   img.className="ws-preview-image";place.replaceChildren(img);
  }else{
   const link=document.createElement("a");link.href=previewUrl;link.download="documento-clinico.pdf";
   link.textContent="Descargar PDF para revisión";place.replaceChildren(link);
  }
  return;
 }

 if(action==="openCriticalFollowups"){tab="followups";return load()}
 if(action==="logout"){clearTimeout(draftTimer);await api("logout","POST",{});actor=null;csrf="";data={};viewDrafts=Object.create(null);patientDraft=null;clinicalTools=[];selectedClinicalTool=null;tab="patients";return splash()}
 if(action==="setup"){await api("setup","POST",{username:val("user"),password:val("pass"),organization:val("org")});notice("Clínica configurada. Inicia sesión.");return splash()}
 if(action==="login"){const x=await api("login","POST",{username:val("user"),password:val("pass")});csrf=x.csrf;actor=x.actor;data={};viewDrafts=Object.create(null);tab="workspace";return load()}
 if(action==="openAskCopilot"){
  // The chat's genuine ASK provider belongs to PHOENIX, not the clinical HTTP session.
  // Never transfer an encounter ID, a patient name or the protected encounter contents.
  const promptText="Kira, usa health_copilot_ask con action=choose_mode para guiar una consulta desidentificada. Después realiza screen_urgency y next_question. Registraré las respuestas clínicas únicamente dentro de PHOENIX Health.";
  const opened=window.open("/","_blank","noopener,noreferrer");
  document.getElementById("view").insertAdjacentHTML("beforeend",
    box("Kira Clínica · ASK de PHOENIX",
      '<p class="notice">Se abrió el chat general de PHOENIX. ASK puede coordinar el interrogatorio, pero no lee ni escribe este expediente. No copies identificadores, nombres, imágenes, resultados o historia clínica a esa conversación.</p>'+
      '<label>Petición genérica para Kira</label><textarea readonly id="ask-instructions">'+safe(promptText)+'</textarea>'+
      '<p> '+button("copyAskInstructions","Copiar instrucciones sin datos personales","secondary")+'</p>'));
  if(!opened)notice("Si el navegador bloqueó la nueva pestaña, abre el chat PHOENIX manualmente.");
  return;
 }
 if(action==="copyAskInstructions"){
  const content=val("ask-instructions");
  if(!content)throw Error("No hay instrucciones");
  await navigator.clipboard.writeText(content);
  notice("Instrucciones genéricas copiadas; no incluyen datos de paciente.");
  return;
 }
 if(action==="interview"){
  const encounter=data.encounters?.find(x=>x.id===id);if(!encounter)throw Error("Consulta no disponible");
  const reply=await api("interview/"+id);
  const guide=reply.guide;
  current={encounterId:id,field:guide.nextQuestions[0]?.key||null};
  const questions=guide.nextQuestions.map(q=>'<li>'+safe(q.question)+'</li>').join('');
  const controls=current.field?
    '<label for="interview-answer">Respuesta a la primera pregunta pendiente</label>'+
    '<textarea id="interview-answer" placeholder="Registrar respuesta obtenida por el profesional; no asumir respuestas negativas"></textarea>'+
    '<p>'+button("saveInterview","Guardar respuesta y continuar")+'</p>':
    '<p class="notice">Todas las preguntas de esta guía fueron registradas. El profesional debe completar la valoración clínica.</p>';
  document.getElementById("view").insertAdjacentHTML("beforeend",
    box("Kira · Interrogatorio dirigido",'<p class="notice">Guía determinista local. No es diagnóstico, ni se envía el expediente al modelo. Los signos de alarma requieren valoración inmediata.</p>'+
    '<p class="muted">Ruta: '+safe(guide.pathway)+' · Modalidad: '+safe(guide.mode)+'</p><ol>'+questions+'</ol>'+controls));
  return;
 }
 if(action==="saveInterview"){
  if(!current?.encounterId||!current.field)throw Error("No hay pregunta activa");
  const answer=val("interview-answer").trim();
  if(!answer)throw Error("Registre la respuesta real antes de avanzar");
  const encounter=data.encounters?.find(x=>x.id===current.encounterId);
  if(!encounter)throw Error("Consulta no disponible");
  const encounterId=current.encounterId,field=current.field;
  await api("encounters/"+encounterId,"PATCH",{version:encounter.version,action:"answer",field,answer});
  current=null;
  await load();
  await execute("interview",encounterId);
  notice("Respuesta guardada en el expediente cifrado");
  return;
 }
 if(action==="backup"){
  if(!confirm("¿Crear una copia consistente del expediente cifrado?"))return;
  const result=await api("backups","POST",{});
  notice("Respaldo verificado: "+result.backup.name+" · "+result.backup.records+" registros");return load();
 }
 if(action==="openMedicalHistory"){
  const patient=data.patients?.find(x=>x.id===id);
  if(!patient||actor.role!=="clinician")throw Error("Historia longitudinal no autorizada");
  current={kind:"medicalHistory",patientId:id};
  const sections=[
    ["pastMedical","Antecedentes personales patológicos"],
    ["pastSurgical","Antecedentes quirúrgicos"],
    ["hospitalizations","Hospitalizaciones previas"],
    ["transfusions","Transfusiones y reacciones"],
    ["trauma","Traumatismos relevantes"],
    ["familyHistory","Antecedentes familiares, genéticos y hereditarios"],
    ["currentMedications","Medicación habitual, dosis y conciliación"],
    ["vaccinations","Vacunación documentada"],
    ["habits","Hábitos y contexto social"],
    ["tobacco","Tabaco y exposiciones"],
    ["alcohol","Alcohol y otras sustancias"],
    ["sleep","Sueño y descanso"],
    ["nutrition","Alimentación y nutrición"],
    ["physicalActivity","Actividad física"],
    ["occupation","Ocupación y situación laboral"],
    ["exposures","Exposiciones laborales, ambientales y viajes"],
    ["housing","Vivienda, saneamiento y red de apoyo"],
    ["gynecologicObstetric","Antecedentes ginecológicos y obstétricos, si aplican"],
    ["pediatricDevelopment","Desarrollo, crecimiento y educación, si aplican"],
    ["geriatricFunction","Funcionalidad, caídas y cognición, si aplican"],
    ["mentalHealthHistory","Antecedentes de salud mental, si proceden"],
    ["reviewOfSystems","Revisión de sistemas: positivos, negativos expresos y no evaluados"],
    ["problems","Problemas activos confirmados"],
  ];
  const fields=sections.map(([key,label])=>
    '<label for="history-'+key+'">'+label+'</label>'+
    '<textarea id="history-'+key+'">'+safe(patient.medicalHistory?.[key]||"")+'</textarea>').join("");
  document.getElementById("view").insertAdjacentHTML("beforeend",
    box("Historia longitudinal · "+safe(patient.name),
      '<p class="notice">Solo el médico asignado puede revisar y actualizar estos antecedentes. Un campo vacío significa no documentado, nunca ausencia de patología.</p>'+
      fields+button("saveMedicalHistory","Guardar antecedentes revisados")));
  restoreView();return;
 }
 if(action==="saveMedicalHistory"){
  if(actor.role!=="clinician"||current?.kind!=="medicalHistory")throw Error("Editor no autorizado");
  const patient=data.patients?.find(x=>x.id===current.patientId);
  if(!patient)throw Error("Paciente no disponible");
  const keys=["pastMedical","pastSurgical","familyHistory","currentMedications","vaccinations","habits","problems",
   "hospitalizations","transfusions","trauma","tobacco","alcohol","sleep","nutrition","physicalActivity",
   "occupation","exposures","housing","gynecologicObstetric","pediatricDevelopment",
   "geriatricFunction","mentalHealthHistory","reviewOfSystems"];
  const record=Object.fromEntries(keys.map(key=>[key,val("history-"+key)]));
  if(!confirm("¿Confirma que verificó estos antecedentes con las fuentes disponibles?"))return;
  await api("patients/"+patient.id,"PATCH",{version:patient.version,action:"history",record});
  current=null;notice("Historia longitudinal cifrada y auditada.");return load();
 }
 if(action==="draftInterview"){
  const encounter=data.encounters?.find(x=>x.id===id);
  if(!encounter||encounter.practitioner!==actor.username)throw Error("Consulta ajena o inexistente");
  if(!confirm("¿Preparar un borrador subjetivo solo con respuestas documentadas, sin diagnóstico inferido?"))return;
  await api("encounters/"+id,"PATCH",{version:encounter.version,action:"draft-from-interview"});
  await load();await execute("document",id);
  notice("Borrador preparado. Complete y valide el SOAP antes de revisarlo o firmarlo.");
  return;
 }
 if(action==="allergyReview"){
  const patient=data.patients?.find(x=>x.id===id);if(!patient)throw Error("Paciente no encontrado");
  const choice=prompt("Alergias: none-known (sin alergias conocidas) o documented (alergias reportadas)","documented");
  if(choice===null)return;
  const details=choice==="documented"?prompt("Documente alérgenos y reacciones, tal como fueron confirmados en la consulta:"): "";
  if(details===null)return;
  if(!confirm("¿Confirma como profesional que revisó alergias y consignó el estado real del paciente?"))return;
  await api("patients/"+id,"PATCH",{version:patient.version,action:"allergy-review",status:choice,details});
  notice("Revisión de alergias documentada y auditada.");return load();
 }
 if(action==="contactEvidence"){
  const patient=data.patients?.find(x=>x.id===id);if(!patient)throw Error("Paciente no encontrado");
  const choice=prompt("¿Autoriza o revoca correo? Escriba GRANTED o REVOKED","REVOKED");if(choice===null)return;
  const consent=choice.toUpperCase()==="GRANTED"?"granted":choice.toUpperCase()==="REVOKED"?"revoked":null;
  if(!consent)throw Error("Indique GRANTED o REVOKED");
  const method=prompt("Método: in-person, signed-document o verified-call","in-person");if(method===null)return;
  const evidenceRef=prompt("Referencia de evidencia verificable:");if(evidenceRef===null)return;
  if(!confirm("¿Certifica que verificó el contacto y documentó el consentimiento o su revocación?"))return;
  await api("patients/"+id,"PATCH",{version:patient.version,action:"contact",consent,method,
    evidenceRef,emailVerified:consent==="granted"});
  notice("Consentimiento y responsable auditados.");return load();
 }
 if(action==="grantPatient"){
  await api("assignments","POST",{action:"grant",patientId:val("patientId"),staffId:val("staffId"),purpose:val("purpose")});
  notice("Relación asistencial autorizada y auditada.");return load();
 }
 if(action==="revokePatient"){
  const row=data.assignments?.find(x=>x.patientId+"|"+x.staffId===id);
  if(!row)throw Error("Asignación no encontrada");
  if(!confirm("¿Revocar acceso asistencial de este profesional al paciente?"))return;
  await api("assignments","POST",{action:"revoke",patientId:row.patientId,staffId:row.staffId});return load();
 }
 if(action==="create"){
  const v={
   patients:{name:val("name"),dateOfBirth:val("dateOfBirth"),email:val("email"),phone:val("phone"),
    documentType:val("documentType"),documentNumber:val("documentNumber"),
    customFields:Object.fromEntries(patientForm.fields.map(f=>[f.id,val("patient-extra-"+f.id)])),
    confirmDistinct:document.getElementById("patient-distinct")?.checked===true,
    distinctReason:val("patient-distinct-reason")},
   encounters:{patientId:val("patientId"),specialty:val("specialty"),complaint:val("complaint"),mode:val("mode")},
   appointments:{patientId:val("patientId"),practitioner:val("practitioner"),startsAt:val("startsAt"),reason:val("reason")},
   orders:{encounterId:val("encounterId"),modality:val("modality"),description:val("description")},
   prescriptions:{encounterId:val("encounterId"),medication:val("medication"),directions:val("directions"),safetyAcknowledged:!!document.getElementById("safety")?.checked},
   inventory:{item:val("item")},invoices:{patientId:val("patientId"),concept:val("concept"),amountCents:Number(val("amountCents"))},
   followups:{patientId:val("patientId"),assignedTo:val("assignedTo"),dueAt:val("dueAt"),description:val("description")},
   staff:{username:val("username"),password:val("password"),role:val("role")},
  };
  const result=await api(tab,"POST",v[tab]);
  if(tab==="patients"){
   const records=(await api("patients")).items;
   if(!records.some(x=>x.id===result.record?.id))
    throw Error("El servidor no confirmó la recuperación del paciente creado");
   await forgetDraft("patients");
   notice("Paciente guardado y recuperado del expediente · versión "+result.record.version);
  }else notice("Operación guardada en el expediente cifrado.");
  return load()
 }
 if(action==="dispense"){
  const rx=data.prescriptions?.find(x=>x.id===id);
  const stock=(data.inventory||[]).find(x=>x.item===rx?.medication&&x.units>0);
  if(!rx||!stock)throw Error("No existe un producto correspondiente con existencias.");
  if(!confirm("¿Confirma la dispensación farmacéutica de esta receta firmada? Se descontará una unidad del inventario."))return;
  await api("dispense/"+rx.id,"POST",{inventoryId:stock.id});notice("Dispensación registrada y existencias actualizadas.");return load();
 }
 if(action==="sendReminder"){
  if(!confirm("¿Confirma el profesional el recordatorio de cita al correo verificado, con consentimiento registrado? Se enviará realmente desde la cuenta institucional de Kira si está conectada."))return;
  const result=await api("reminders/"+id,"POST",{});
  if(result.status==="sent")notice("Kira confirmó el envío del recordatorio con Gmail.");
  return;
 }
 if(action==="document"){
  const encounter=data.encounters?.find(x=>x.id===id);
  if(!encounter||encounter.practitioner!==actor.username||encounter.status==="signed")
    throw Error("Consulta no disponible para edición");
  current={kind:"soap",encounterId:id};
  const section=(key,label,value)=>'<label for="soap-'+key+'">'+label+'</label><textarea id="soap-'+key+'">'+safe(value||"")+'</textarea>';
  document.getElementById("view").insertAdjacentHTML("beforeend",box("Historia clínica estructurada · SOAP",
    '<p class="notice">Borrador del profesional. Verifique cada hallazgo antes de revisar y firmar; los campos vacíos no significan hallazgos negativos.</p>'+
    section("history","S · Anamnesis y relato",encounter.history)+
    section("exam","O · Exploración y datos objetivos",encounter.exam)+
    section("assessment","A · Evaluación y razonamiento clínico",encounter.assessment)+
    section("plan","P · Plan diagnóstico y terapéutico",encounter.plan)+
    '<button class="primary" data-act="saveDocument" data-id="'+safe(id)+'">Guardar borrador cifrado</button>'));
  restoreView();return;
 }
 if(action==="saveDocument"){
  const encounter=data.encounters?.find(x=>x.id===id);
  if(!encounter||current?.kind!=="soap"||current.encounterId!==id)
    throw Error("Editor clínico no autorizado");
  const history=val("soap-history").trim();
  if(!history)throw Error("La anamnesis requiere información documentada");
  await api("encounters/"+id,"PATCH",{version:encounter.version,action:"document",history,
    exam:val("soap-exam"),assessment:val("soap-assessment"),plan:val("soap-plan")});
  current=null;
  notice("Historia clínica cifrada guardada como borrador");
  return load();
 }
 const resource=data[tab]?.find(x=>x.id===id);if(!resource)throw Error("Registro no encontrado");
 let patch={version:resource.version};
 if(action==="review"){if(!confirm("¿Revisaste íntegramente la historia?"))return;patch.action="review"}
 if(action==="sign"){if(!confirm("¿Confirmas tu firma profesional sobre la versión revisada?"))return;patch.action="sign"}
 if(action==="result"){
  patch.action="result";patch.result=prompt("Informe verificado del estudio:");if(patch.result===null)return;
  patch.critical=confirm("¿El laboratorio o imagenología clasificó el resultado como CRÍTICO? Aceptar = sí; Cancelar = no.");
  if(patch.critical)alert("RESULTADO CRÍTICO: es necesaria una comunicación asistencial directa urgente. Este registro no envía avisos automáticos.");
 }
 if(action==="reviewOrder"){
  patch.action="review";
  if(resource.critical===true){
   if(!confirm("Resultado crítico: ¿revisó el informe y realizó la gestión asistencial urgente correspondiente?"))return;
   patch.criticalAcknowledged=true;
  }
 }
 if(action==="receive"){patch.delta=Number(prompt("Movimiento de existencias (+/-):"));if(!patch.delta)return}
 if(action==="pay"){patch.paymentCents=Number(prompt("Pago recibido (centavos):"));if(!patch.paymentCents)return}
 if(action==="completeAppointment"){patch.status="completed"}
 if(action==="finishFollowup"){patch.status="done"}
 await api(tab+"/"+id,"PATCH",patch);notice("Registro actualizado; cambio auditado.");return load()
}
document.addEventListener("input",e=>{
 if(e.target.closest("#view")){rememberView();queueDraftSave()}
});
document.addEventListener("change",async e=>{
 if(e.target.closest("#view")){rememberView();queueDraftSave()}

 if(e.target.id==="anatomy-patient"){
  clearTimeout(draftTimer);await persistView()
  selectedPatientId=e.target.value
  try{await load()}catch(error){notice(error.message)}
 }
 if(e.target.id==="ws-patient"){
  clearTimeout(draftTimer);await persistView();
  selectedPatientId=e.target.value;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
  try{await load()}catch(error){notice(error.message)}
 }
});
document.addEventListener("click",async e=>{
 const tabButton=e.target.closest("[data-tab]");if(tabButton){try{clearTimeout(draftTimer);await persistView();tab=tabButton.dataset.tab;await load()}catch(err){notice(err.message)}return}
 const action=e.target.closest("[data-act]");if(action){
  action.disabled=true;try{await execute(action.dataset.act,action.dataset.id)}catch(err){notice(err.message)}finally{action.disabled=false}
 }
});
refresh();
</script></body></html>`
  return html.replaceAll('__NONCE__',nonce)
}
