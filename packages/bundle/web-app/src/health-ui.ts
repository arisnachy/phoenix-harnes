/** Built-in real clinical workspace (same-origin HTTP, no PHI in Kira's prompt). */
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
@media(max-width:700px){main{grid-template-columns:1fr}aside{display:flex;overflow:auto;gap:5px}aside button{white-space:nowrap;width:auto}header{padding:12px}section{padding:11px}.grid{grid-template-columns:1fr}}
</style></head><body>
<header><div><h1>♡ PHOENIX Health</h1><div class="muted">Sistema clínico local · Expediente cifrado · Kira Clinical Flow</div></div><div id="account"></div></header>
<div id="app"></div><div id="flash" role="alert"></div>
<script nonce="__NONCE__">
"use strict";
const root=document.getElementById("app"),account=document.getElementById("account"),flash=document.getElementById("flash");
let actor=null,csrf="",tab="patients",data={},current=null;
const modules=[["patients","Pacientes"],["encounters","Consultas"],["appointments","Agenda"],["orders","Laboratorio e imágenes"],["prescriptions","Recetas"],["inventory","Farmacia"],["invoices","Administración"],["followups","Seguimiento"],["staff","Personal"],["assignments","Equipo asistencial"],["audit","Auditoría"]];
const safe=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=id=>document.getElementById(id)?.value??"";
const box=(title,content)=>'<article class="card"><h2>'+safe(title)+'</h2>'+content+'</article>';
const field=(id,label,type="text",required=true,place="")=>'<label for="'+id+'">'+safe(label)+'</label><input id="'+id+'" type="'+type+'" placeholder="'+safe(place)+'" '+(required?'required':'')+'>';
const area=(id,label)=>'<label for="'+id+'">'+safe(label)+'</label><textarea id="'+id+'></textarea>';
const pick=(id,label,items,selector)=>'<label for="'+id+'">'+safe(label)+'</label><select id="'+id+'>'+items.map(x=>'<option value="'+safe(x.id)+'">'+safe(selector(x))+'</option>').join('')+'</select>';
const button=(action,title,cls="primary")=>'<button type="button" class="'+cls+'" data-act="'+action+'">'+safe(title)+'</button>';
const rows=(items,cols)=>items.length?'<div style="overflow:auto"><table><thead><tr>'+cols.map(c=>'<th>'+safe(c[0])+'</th>').join('')+'<th>Acciones</th></tr></thead><tbody>'+items.map(o=>'<tr>'+cols.map(c=>'<td>'+safe(o[c[1]])+'</td>').join('')+'<td>'+actionFor(o)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">No hay registros.</p>';
let columnAction=null;
function notice(msg){flash.textContent=msg;flash.style.display="block";setTimeout(()=>flash.style.display="none",5200)}
async function api(path,method="GET",body){
 const r=await fetch("/health/api/"+path,{method,credentials:"same-origin",cache:"no-store",headers:{
  "content-type":"application/json","x-phoenix-health":"1",...(csrf?{"x-phoenix-csrf":csrf}:{}),
 },...(body?{body:JSON.stringify(body)}:{})});
 const x=await r.json();if(!r.ok)throw Error(x.error||"Solicitud rechazada");return x;
}
async function refresh(){
 try{const x=await api("session");actor=x.actor;csrf=x.csrf;await load()}catch{actor=null;csrf="";await splash()}
}
async function splash(){
 let status=await api("status");
 account.textContent="Clínica protegida";
 root.innerHTML='<section style="max-width:570px">'+box(status.initialized?"Acceso profesional":"Configurar clínica",
 '<p class="notice warning">Servicio local con base de datos cifrada. No acceda desde un equipo compartido. El administrador debe conservar una copia segura de la contraseña maestra: sin ella no podrán recuperarse los expedientes.</p>'+
 (status.initialized?'':field("org","Centro / Institución"))+
 field("user","Usuario")+field("pass","Contraseña (16 caracteres o más)","password")+
 button(status.initialized?"login":"setup",status.initialized?"Iniciar sesión":"Crear clínica y administrador"))+'</section>';
}
async function load(){
 account.innerHTML='<span class="tag">'+safe(actor.username)+" · "+safe(actor.role)+'</span> '+button("logout","Salir","secondary");
 const menu={admin:["patients","appointments","inventory","invoices","followups","assignments","staff","audit"],
 clinician:["patients","encounters","appointments","orders","prescriptions","followups"],
 psychologist:["patients","encounters","appointments","followups"],
 nurse:["patients","encounters","appointments","orders","followups"],
 reception:["patients","appointments","followups","assignments"],lab:["orders"],radiology:["orders"],
 pharmacy:["prescriptions","inventory"],billing:["invoices"]};
 const resources=modules.filter(m=>(menu[actor.role]||[]).includes(m[0]));
 if(!resources.some(x=>x[0]===tab))tab="patients";
 root.innerHTML='<main><aside>'+resources.map(x=>'<button data-tab="'+x[0]+'" class="'+(x[0]===tab?'active':'')+'">'+x[1]+'</button>').join('')+
 '</aside><section><div id="view"><div class="card">Cargando…</div></div></section></main>';
 const ids=tab==="assignments"?["assignments","patients"]:tab==="orders"?["orders","encounters"]:tab==="prescriptions"?["prescriptions","encounters","inventory"]:tab==="encounters"?["encounters","patients"]:tab==="appointments"?["appointments","patients"]:tab==="invoices"?["invoices","patients"]:tab==="followups"?["followups","patients"]:["patients",tab];
 for(const id of new Set(ids)){try{data[id]=(await api(id)).items}catch{data[id]=[]}}
 render()
}
function actionFor(o){
 let actions=[];
 if(tab==="assignments")actions=[["revokePatient","Revocar acceso"]];
 if(tab==="patients"&&["admin","clinician","reception"].includes(actor.role))actions=[["contactEvidence","Consentimiento"]];
 if(tab==="encounters"&&o.status!=="signed"&&o.practitioner===actor.username)actions=[["document","Documentar"],["review","Revisar"],["sign","Firmar"]];
 if(tab==="prescriptions"&&actor.role==="pharmacy"&&o.status==="prescribed")actions=[["dispense","Dispensar"]];
 if(tab==="orders")actions=o.status==="ordered"&&((actor.role==="lab"&&o.modality==="laboratory")||(actor.role==="radiology"&&o.modality==="imaging"))?[["result","Resultado"]]:
 o.status==="resulted"&&actor.role==="clinician"?[["reviewOrder","Revisar"]]:[];
 if(tab==="inventory")actions=[["receive","Movimiento"]];
 if(tab==="invoices")actions=[["pay","Cobrar"]];
 if(tab==="appointments"&&o.status==="scheduled")actions=[["completeAppointment","Completar"],...(actor.role==="clinician"&&o.practitioner===actor.username?[["sendReminder","Kira: enviar recordatorio"]]:[])];
 if(tab==="followups"&&o.status==="pending")actions=[["finishFollowup","Completar"]];
 return actions.map(a=>'<button class="secondary" data-act="'+a[0]+'" data-id="'+safe(tab==="assignments"?o.patientId+"|"+o.staffId:o.id)+'">'+a[1]+'</button>').join("");
}
function render(){
 const d=data[tab]||[],patients=data.patients||[];
 const p=pick("patientId","Paciente",patients,x=>x.name+" · "+x.dateOfBirth);
 let form="";
 if(tab==="patients"&&["admin","clinician","reception"].includes(actor.role))form=field("name","Nombre completo")+field("dateOfBirth","Nacimiento","date")+field("email","Correo","email",false)+field("phone","Teléfono","tel",false)+
 '<p class="muted">El consentimiento se registra después de verificarlo, con responsable y referencia de evidencia.</p>'+button("create","Registrar paciente");
 if(tab==="encounters"&&["clinician","psychologist"].includes(actor.role))form=p+field("specialty","Especialidad", "text", true,"Medicina familiar")+
 field("complaint","Motivo de consulta")+
 '<label>Modalidad Kira</label><select id="mode"><option value="kira">Kira interroga</option><option value="mixed">Mixto</option><option value="manual">Profesional</option></select>'+button("create","Abrir consulta")+
 '<p class="notice">El profesional decide y firma. Kira puede guiar preguntas desde el chat, pero el contenido identificable del expediente no se envía al modelo.</p>';
 if(tab==="appointments")form=p+field("practitioner","Profesional")+field("startsAt","Fecha y hora","datetime-local")+field("reason","Motivo")+button("create","Programar cita");
 if(tab==="orders"&&actor.role==="clinician")form=pick("encounterId","Consulta firmada",data.encounters.filter(x=>x.status==="signed"),x=>x.complaint+" · "+x.practitioner)+
 '<label>Tipo</label><select id="modality"><option value="laboratory">Laboratorio</option><option value="imaging">Imagen</option></select>'+area("description","Descripción y estudio indicado")+button("create","Emitir orden");
 if(tab==="prescriptions"&&actor.role==="clinician")form=pick("encounterId","Consulta firmada",data.encounters.filter(x=>x.status==="signed"),x=>x.complaint)+field("medication","Medicamento")+area("directions","Indicaciones autorizadas")+button("create","Registrar prescripción");
 if(tab==="inventory")form=field("item","Producto")+button("create","Agregar producto");
 if(tab==="invoices")form=p+field("concept","Concepto")+field("amountCents","Monto en centavos","number")+button("create","Emitir factura");
 if(tab==="followups")form=p+field("assignedTo","Asignado a")+field("dueAt","Fecha y hora","datetime-local")+area("description","Tarea de seguimiento")+button("create","Crear seguimiento");
 if(tab==="assignments")form=pick("patientId","Paciente",patients,x=>x.name)+field("staffId","Usuario profesional")+field("purpose","Motivo de atención")+button("grantPatient","Autorizar atención");
 if(tab==="staff")form=field("username","Usuario")+field("password","Contraseña inicial (16+)","password")+
 '<label>Rol</label><select id="role">'+["clinician","psychologist","nurse","reception","lab","radiology","pharmacy","billing"].map(x=>'<option>'+x+'</option>').join('')+'</select>'+button("create","Crear personal");
 const titles=Object.fromEntries(modules.map(x=>[x[0],x[1]]));
 const genericRows=(d,columns)=>rows(d,columns);
 let cols=[["ID","id"],["Estado","status"]];
 if(tab==="patients")cols=[["Nombre","name"],["Nacimiento","dateOfBirth"],["Email","email"],["Consentimiento","emailConsent"]];
 if(tab==="encounters")cols=[["Motivo","complaint"],["Especialidad","specialty"],["Profesional","practitioner"],["Estado","status"]];
 if(tab==="appointments")cols=[["Profesional","practitioner"],["Inicio","startsAt"],["Estado","status"]];
 if(tab==="orders")cols=[["Tipo","modality"],["Estudio","description"],["Estado","status"]];
 if(tab==="prescriptions")cols=[["Medicamento","medication"],["Firmado por","signedBy"],["Estado","status"]];
 if(tab==="inventory")cols=[["Producto","item"],["Unidades","units"]];
 if(tab==="invoices")cols=[["Concepto","concept"],["Total (centavos)","amountCents"],["Pagado","paidCents"]];
 if(tab==="followups")cols=[["Tarea","description"],["Vence","dueAt"],["Estado","status"]];
 if(tab==="assignments")cols=[["Paciente","patientId"],["Profesional","staffId"],["Finalidad","purpose"],["Autorizó","grantedBy"]];
 if(tab==="staff")cols=[["Usuario","username"],["Rol","role"],["Centro","org"]];
 if(tab==="audit")cols=[["Acción","action"],["Actor","actor"],["Registro","recordId"],["Hora","happened"]];
 document.getElementById("view").innerHTML=box(titles[tab],'<div class="muted">Datos de la institución autenticada · Registro persistente cifrado</div>'+form)+
 box("Registros",genericRows(d,cols))+(tab==="prescriptions"?'<p class="notice warning">Las recetas no se envían por correo desde esta versión. La firma clínica exige revisión profesional.</p>':'');
}
async function execute(action,id){
 if(action==="logout"){await api("logout","POST",{});actor=null;csrf="";return splash()}
 if(action==="setup"){await api("setup","POST",{username:val("user"),password:val("pass"),organization:val("org")});notice("Clínica configurada. Inicia sesión.");return splash()}
 if(action==="login"){const x=await api("login","POST",{username:val("user"),password:val("pass")});csrf=x.csrf;actor=x.actor;return load()}
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
   patients:{name:val("name"),dateOfBirth:val("dateOfBirth"),email:val("email"),phone:val("phone")},
   encounters:{patientId:val("patientId"),specialty:val("specialty"),complaint:val("complaint"),mode:val("mode")},
   appointments:{patientId:val("patientId"),practitioner:val("practitioner"),startsAt:val("startsAt"),reason:val("reason")},
   orders:{encounterId:val("encounterId"),modality:val("modality"),description:val("description")},
   prescriptions:{encounterId:val("encounterId"),medication:val("medication"),directions:val("directions")},
   inventory:{item:val("item")},invoices:{patientId:val("patientId"),concept:val("concept"),amountCents:Number(val("amountCents"))},
   followups:{patientId:val("patientId"),assignedTo:val("assignedTo"),dueAt:val("dueAt"),description:val("description")},
   staff:{username:val("username"),password:val("password"),role:val("role")},
  };
  await api(tab,"POST",v[tab]);notice("Operación guardada en el expediente cifrado.");return load()
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
 const resource=data[tab]?.find(x=>x.id===id);if(!resource)throw Error("Registro no encontrado");
 let patch={version:resource.version};
 if(action==="document"){
  patch.action="document";
  patch.history=prompt("Anamnesis / historia clínica:",resource.history||"");if(patch.history===null)return;
  patch.exam=prompt("Examen físico / evaluación:",resource.exam||"");if(patch.exam===null)return;
  patch.assessment=prompt("Valoración y diagnósticos clínicos:",resource.assessment||"");if(patch.assessment===null)return;
  patch.plan=prompt("Plan terapéutico y seguimiento:",resource.plan||"");if(patch.plan===null)return;
 }
 if(action==="review"){if(!confirm("¿Revisaste íntegramente la historia?"))return;patch.action="review"}
 if(action==="sign"){if(!confirm("¿Confirmas tu firma profesional sobre la versión revisada?"))return;patch.action="sign"}
 if(action==="result"){
  patch.action="result";patch.result=prompt("Informe verificado del estudio:");if(patch.result===null)return;
 }
 if(action==="reviewOrder"){patch.action="review"}
 if(action==="receive"){patch.delta=Number(prompt("Movimiento de existencias (+/-):"));if(!patch.delta)return}
 if(action==="pay"){patch.paymentCents=Number(prompt("Pago recibido (centavos):"));if(!patch.paymentCents)return}
 if(action==="completeAppointment"){patch.status="completed"}
 if(action==="finishFollowup"){patch.status="done"}
 await api(tab+"/"+id,"PATCH",patch);notice("Registro actualizado; cambio auditado.");return load()
}
document.addEventListener("click",async e=>{
 const tabButton=e.target.closest("[data-tab]");if(tabButton){tab=tabButton.dataset.tab;try{await load()}catch(err){notice(err.message)}return}
 const action=e.target.closest("[data-act]");if(action){
  action.disabled=true;try{await execute(action.dataset.act,action.dataset.id)}catch(err){notice(err.message)}finally{action.disabled=false}
 }
});
refresh();
</script></body></html>`;
  return html.replace('__NONCE__',nonce)
}
