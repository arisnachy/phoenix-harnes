"use strict";
/* Browser UI: untrusted institutional data is rendered with textContent. */
let secret="",current="",snapshot=null,section="overview";
const el=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
};
const val=id=>document.getElementById(id)?.value?.trim()??"";
const api=async(path,method="GET",body)=>{
  const response=await fetch(path,{method,headers:{
    authorization:"Bearer "+secret,
    ...(body===undefined?{}:{"content-type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;
  try{result=await response.json()}catch{throw Error("Respuesta del servidor no válida")}
  if(!response.ok)throw Error(result.error||"HTTP "+response.status);
  return result;
};
function message(text,error=false){
  const area=document.getElementById(document.getElementById("workspace").hidden?"notice":"message");
  if(area){area.textContent=text;area.className=error?"message error":"message";}
}
function lines(node,items,formatter){
  node.replaceChildren();
  if(items.length===0){node.append(el("li","muted","Sin registros todavía"));return;}
  for(const item of items.slice(0,100))node.append(el("li","",formatter(item)));
}
function show(tab){
  section=tab;
  document.querySelectorAll(".panel").forEach(n=>{n.hidden=n.dataset.panel!==tab});
  document.querySelectorAll(".nav button").forEach(n=>
    n.classList.toggle("active",n.dataset.tab===tab));
}
function bindForms(){
  const config={
    "form-create":["/v1/organizations",d=>({
      organizationId:d.organizationId,name:d.name,industry:d.industry,
      adoptionMode:d.adoptionMode,network:{mode:d.network},
      sites:[{siteId:d.siteId,name:d.siteName,
        workstations:Number(d.workstations),reusableWorkstations:Number(d.reusable),
        roles:[],software:[]}]
    })],
    "form-answer":["/v1/answers",d=>{
      const [category,key]=d.question.split(":");
      return {organizationId:current,category,key,value:d.answer,status:d.status,
        evidenceRefs:d.evidenceRefs.split(",").map(x=>x.trim()).filter(Boolean)};
    }],
    "form-site":["/v1/sites",d=>({organizationId:current,siteId:d.siteId,
      name:d.name,workstations:Number(d.workstations),
      reusableWorkstations:Number(d.reusableWorkstations),
      expectedRevision:snapshot?.configurationRevision})],
    "form-unit":["/v1/units",d=>({organizationId:current,unitId:d.unitId,
      siteId:d.siteId,name:d.name,parentId:d.parentId||null,
      staffCount:Number(d.staffCount),workstations:Number(d.workstations),role:d.role})],
    "form-system":["/v1/systems",d=>({organizationId:current,systemId:d.systemId,
      name:d.name,method:d.method,ownerUnit:d.ownerUnit||null})],
    "form-provider":["/v1/providers",d=>({organizationId:current,
      providerId:d.providerId,modelName:d.modelName,execution:d.execution,
      accountMode:d.accountMode,monthlyBudgetUsd:Number(d.monthlyBudgetUsd)})],
    "form-cost":["/v1/costs",d=>({organizationId:current,itemId:d.itemId,
      label:d.label,category:d.category,quantity:Number(d.quantity),
      unitPrice:Number(d.unitPrice),currency:d.currency,recurrence:d.recurrence,
      evidenceRefs:d.evidenceRefs.split(",").map(x=>x.trim()).filter(Boolean)})],
    "form-goal":["/v1/goals",d=>({organizationId:current,goalId:d.goalId,
      title:d.title,metricId:d.metricId,period:d.period,target:Number(d.target),
      ownerUnit:d.ownerUnit||null})],
    "form-indicator":["/v1/indicators",d=>({organizationId:current,
      metricId:d.metricId,period:d.period,numerator:Number(d.numerator),
      denominator:d.denominator===""?null:Number(d.denominator),unit:d.unit,
      evidenceRefs:d.evidenceRefs.split(",").map(x=>x.trim()).filter(Boolean)})],
    "form-obligation":["/v1/obligations",d=>({organizationId:current,
      obligationId:d.obligationId,recipient:d.recipient,title:d.title,
      periodicity:d.periodicity,templateVersion:d.templateVersion||null})],
    "form-import":["/v1/import",d=>{
      const parsed=JSON.parse(d.manifest);
      if(parsed.organizationId!==current)throw Error("La importación debe corresponder a la institución activa");
      return parsed;
    }],
    "form-evidence":["/v1/evidence",d=>({organizationId:current,
      filePath:d.filePath,kind:d.kind,classification:d.classification,
      validated:d.validated==="on"})]
  };
  for(const [id,[path,convert]] of Object.entries(config)){
    const form=document.getElementById(id);
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      try{
        if(!current&&id!=="form-create")throw Error("Selecciona una organización primero");
        const d=Object.fromEntries(new FormData(form));
        const result=await api(path,"POST",convert(d));
        if(id==="form-create")current=result.result.organization.organizationId;
        message("Registro guardado correctamente.");
        await listOrgs();
        if(current)await refresh();
      }catch(error){message(error.message,true);}
    });
  }
}
async function listOrgs(){
  const response=await api("/v1/organizations");
  const select=document.getElementById("organization");
  select.replaceChildren();
  if(response.organizations.length===0){
    select.append(el("option","","No hay instituciones"));
    current="";return;
  }
  if(!current||!response.organizations.includes(current))
    current=response.organizations[0];
  for(const id of response.organizations){
    const option=el("option","",id);
    option.value=id;
    select.append(option);
  }
  select.value=current;
}
function stat(label,value){
  const n=el("div","stat");
  n.append(el("strong","",value),el("small","",label));
  return n;
}
async function refresh(){
  if(!current)return;
  try{
    const d=await api("/v1/dashboard?organizationId="+encodeURIComponent(current));
    snapshot=d;
    let onlineNodes=0;
    try{
      const remote=await api("/v1/fabric/status?organizationId="+encodeURIComponent(current));
      onlineNodes=(remote.nodes||[]).filter(n=>n.connected===true).length;
    }catch{onlineNodes=0;}
    document.getElementById("stats").replaceChildren(
      stat("Descubrimiento",d.readiness.discoveryCoveragePct+"%"),
      stat("Unidades",d.units.length),stat("Evidencias",d.evidence.length),
      stat("Nodos con heartbeat",onlineNodes)
    );
    document.getElementById("org-summary").textContent=d.organization.name+
      " · Sector: "+d.organization.industry+" · Modo: "+d.organization.adoptionMode+
      " · Conexiones en vivo: NO verificadas";
    lines(document.getElementById("missing-summary"),d.missingQuestions.slice(0,5),
      x=>x.question);
    lines(document.getElementById("unit-list"),d.units,
      x=>x.name+" · "+x.siteId+" · "+x.staffCount+" trabajadores · "+x.workstations+" PC");
    lines(document.getElementById("units-list"),d.units,
      x=>x.unitId+" — "+x.name+(x.parentId?" (superior: "+x.parentId+")":"")+
        " · Función "+x.role);
    lines(document.getElementById("audit-list"),d.audit.slice(0,10),
      x=>x.created_at+" · "+x.action+" · "+x.object_id);
    const q=document.getElementById("question");q.replaceChildren();
    for(const x of d.missingQuestions){
      const option=el("option","",x.question);
      option.value=x.category+":"+x.key;
      q.append(option);
    }
    lines(document.getElementById("questions-list"),d.missingQuestions,
      x=>x.question);
    lines(document.getElementById("facts-list"),d.facts,
      x=>x.category+"."+x.key+" = "+String(x.value)+" ["+x.status+"]");
    lines(document.getElementById("systems-list"),d.systems,
      x=>x.name+" · "+x.method+" · "+x.state);
    lines(document.getElementById("models-list"),d.providers,
      x=>x.providerId+" · "+x.modelName+" · "+x.execution+" · "+x.accountMode+
        " · presupuesto mensual USD "+x.monthlyBudgetUsd+" · "+x.status);
    lines(document.getElementById("costs-list"),d.costs,
      x=>x.label+" · "+x.quantity+" × "+x.unitPrice+" = "+x.total+" "+x.currency+
        " ["+x.recurrence+"]");
    lines(document.getElementById("budget-list"),
      Object.entries(d.budgetByCurrencyAndPeriod),([key,value])=>key+": "+value);
    lines(document.getElementById("obligations-list"),d.obligations,
      x=>x.recipient+" · "+x.title+" · "+x.state);
    lines(document.getElementById("evidence-list"),d.evidence,
      x=>x.evidence_id+" · "+x.file_name+" · "+x.state);
  }catch(error){message(error.message,true);}
}
document.getElementById("login").addEventListener("click",async()=>{
  try{
    secret=document.getElementById("token").value;
    if(secret.length<32)throw Error("La clave debe tener al menos 32 caracteres");
    await api("/v1/organizations");
    document.getElementById("token").value="";
    document.getElementById("login-screen").hidden=true;
    document.getElementById("workspace").hidden=false;
    await listOrgs();
    if(current){await refresh();show("overview");}
    else show("create");
  }catch(error){secret="";message(error.message,true);}
});
document.querySelectorAll(".nav button").forEach(b=>
  b.addEventListener("click",()=>{
    show(b.dataset.tab);
    if(b.dataset.tab==="catalog")void loadCatalogSummary().catch(e=>message(e.message,true));
  }));
document.getElementById("organization").addEventListener("change",async e=>{
  current=e.target.value;
  if(current)await refresh();
});
document.getElementById("reload").addEventListener("click",refresh);
document.getElementById("get-fabric").addEventListener("click",async()=>{
  try{
    if(!current)throw Error("Selecciona una organización");
    const result=await api("/v1/fabric/status?organizationId="+encodeURIComponent(current));
    document.getElementById("fabric-status").textContent=JSON.stringify(result,null,2);
    message(result.connected?"Broker Fabric verificado.":"Fabric no conectado o no configurado.");
  }catch(error){message(error.message,true);}
});
document.getElementById("form-enroll").addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    if(!current)throw Error("Selecciona una organización");
    const data=Object.fromEntries(new FormData(event.target));
    if(data.approved!=="on")throw Error("Se requiere autorización explícita");
    const result=await api("/v1/fabric/enroll","POST",{
      organizationId:current,nodeId:data.nodeId,siteId:data.siteId,unitId:data.unitId,
      capabilities:data.capabilities.split(",").map(x=>x.trim()).filter(Boolean),
      receivesFrom:data.receivesFrom.split(",").map(x=>x.trim()).filter(Boolean),
      approved:true
    });
    document.getElementById("enroll-result").textContent=JSON.stringify(result,null,2);
    message("Nodo registrado en el broker. El token se muestra una sola vez; guárdalo de forma segura.");
  }catch(error){message(error.message,true);}
});

async function loadCatalogSummary(){
  const pick=document.getElementById("catalog-category");
  const note=document.getElementById("catalog-note");
  if(!current){note.textContent="Selecciona una organización.";return}
  const result=await api("/v1/catalog/summary?organizationId="+encodeURIComponent(current));
  pick.replaceChildren();
  if(!result.available){
    note.textContent=result.note;
    document.getElementById("catalog-results").replaceChildren();
    return;
  }
  for(const c of result.catalogs){
    const option=el("option","",c.label+" ("+c.count+")");
    option.value=c.id;pick.append(option);
  }
  note.textContent="Referencia hospitalaria: "+result.catalogs.map(c=>c.count).reduce((a,b)=>a+b,0)+
    " plantillas. Deben verificarse localmente.";
  await loadCatalog();
}
async function loadCatalog(){
  if(!current)return;
  const pick=document.getElementById("catalog-category");
  if(!pick.value)return;
  const qs=new URLSearchParams({organizationId:current,
    category:pick.value,query:val("catalog-search"),limit:"40",offset:"0"});
  const result=await api("/v1/catalog?"+qs);
  const box=document.getElementById("catalog-results");
  box.replaceChildren();
  if(!result.available){
    document.getElementById("catalog-note").textContent=result.note;
    return;
  }
  document.getElementById("catalog-note").textContent=
    result.label+": "+result.total+" coincidencias (máximo 40 visibles). Datos de referencia sin verificar.";
  const table=el("table");
  const thead=el("thead"),header=el("tr");
  for(const label of result.fields)header.append(el("th","",label));
  thead.append(header);table.append(thead);
  const tbody=el("tbody");
  for(const row of result.rows){
    const tr=el("tr");
    for(const item of row)tr.append(el("td","",item));
    tbody.append(tr);
  }
  table.append(tbody);box.append(table);
}

document.getElementById('get-catalog').addEventListener('click',()=>{void loadCatalog().catch(e=>message(e.message,true));});
document.getElementById("get-poa").addEventListener("click",async()=>{
  try{
    const query=new URLSearchParams({organizationId:current,period:val("poa-period")});
    const output=await api("/v1/poa?"+query);
    document.getElementById("poa-output").textContent=JSON.stringify(output,null,2);
    message("Borrador POA generado; no se ha remitido a ninguna autoridad.");
  }catch(e){message(e.message,true);}
});
document.getElementById("get-suggestions").addEventListener("click",async()=>{
  try{
    const result=await api("/v1/recommendations?organizationId="+encodeURIComponent(current));
    lines(document.getElementById("suggestions-list"),result.units,
      x=>x.name+" ("+x.role+") · pendiente de aceptación");
    message("Sugerencias generadas; no se ha creado ningún departamento.");
  }catch(e){message(e.message,true);}
});
document.getElementById("get-deployment").addEventListener("click",async()=>{
  try{
    const output=await api("/v1/deployment?organizationId="+encodeURIComponent(current));
    document.getElementById("deployment-output").textContent=JSON.stringify(output,null,2);
    message("Propuesta calculada; ninguna instancia ha sido instalada.");
  }catch(e){message(e.message,true);}
});
const legacyFields={
  units:{unitId:"id",siteId:"sede",name:"area",parentId:"superior",staffCount:"personal",workstations:"pc",role:"funcion"},
  systems:{systemId:"id",name:"nombre",method:"metodo",ownerUnit:"unidad"},
  costs:{itemId:"id",label:"concepto",category:"categoria",quantity:"cantidad",unitPrice:"precio",currency:"moneda",recurrence:"periodicidad"},
  facts:{category:"categoria",key:"clave",value:"valor",status:"estado"},
  goals:{goalId:"id",title:"objetivo",metricId:"indicador",period:"periodo",target:"meta",ownerUnit:"responsable"},
  obligations:{obligationId:"id",recipient:"destinatario",title:"informe",periodicity:"periodicidad",templateVersion:"plantilla"}
};
document.getElementById("legacy-kind").addEventListener("change",event=>{
  document.getElementById("legacy-mapping").value=JSON.stringify(legacyFields[event.target.value]||{},null,2);
  document.getElementById("legacy-result").textContent="Mapeo actualizado; revise los nombres de columnas reales.";
});
function legacyPayload(){
  if(!current)throw Error("Selecciona una institución activa");
  const mapping=JSON.parse(val("legacy-mapping"));
  if(!mapping||typeof mapping!=="object"||Array.isArray(mapping))
    throw Error("El mapeo debe ser un objeto JSON");
  return {organizationId:current,batchId:val("legacy-batch"),
    filePath:val("legacy-path"),kind:val("legacy-kind"),
    evidenceId:val("legacy-evidence"),mapping};
}
document.getElementById("preview-legacy").addEventListener("click",async()=>{
  try{
    const result=await api("/v1/legacy-csv/preview","POST",legacyPayload());
    document.getElementById("legacy-result").textContent=JSON.stringify(result.result,null,2);
    message("Origen y columnas verificados; aún no se han modificado registros.");
  }catch(error){message(error.message,true);}
});
document.getElementById("apply-legacy").addEventListener("click",async()=>{
  try{
    if(!document.getElementById("approve-legacy").checked)
      throw Error("Confirma que la importación está autorizada");
    const result=await api("/v1/legacy-csv/import","POST",
      {...legacyPayload(),approved:true});
    document.getElementById("legacy-result").textContent=JSON.stringify(result.result,null,2);
    message("Importación guardada y auditada; pendiente de revisión institucional.");
    await refresh();
  }catch(error){message(error.message,true);}
});


function docInput(){
  if(!current)throw Error("Selecciona una organización");
  return {organizationId:current,documentId:val("doc-id"),
    evidenceId:val("doc-evidence"),filePath:val("doc-path"),
    documentKind:val("doc-kind")};
}
async function loadDocumentFindings(){
  const qs=new URLSearchParams({organizationId:current,documentId:val("doc-id")});
  const data=await api("/v1/documents/findings?"+qs);
  const pick=document.getElementById("doc-find-id");
  pick.replaceChildren();
  for(const item of data.findings){
    if(item.status!=="proposed-unverified")continue;
    const option=el("option","",item.findingId+" · "+item.category+" · "+item.value);
    option.value=item.findingId;pick.append(option);
  }
  return data;
}
document.getElementById("doc-preview").addEventListener("click",async()=>{
  try{
    const result=await api("/v1/documents/preview","POST",docInput());
    document.getElementById("doc-results").textContent=JSON.stringify(result.result,null,2);
    message("Extracción revisable: no se ha escrito ningún registro.");
  }catch(error){message(error.message,true);}
});
document.getElementById("doc-index").addEventListener("click",async()=>{
  try{
    if(!document.getElementById("doc-approve").checked)
      throw Error("Confirma la autorización y la ausencia de datos personales");
    const result=await api("/v1/documents/inspect","POST",{...docInput(),approved:true});
    document.getElementById("doc-results").textContent=JSON.stringify(result.result,null,2);
    await loadDocumentFindings();
    message("Propuestas guardadas con evidencia. Aún no se han creado unidades o sistemas.");
  }catch(error){message(error.message,true);}
});
document.getElementById("doc-decide").addEventListener("click",async()=>{
  try{
    if(!current)throw Error("Selecciona una organización");
    const payload={organizationId:current,documentId:val("doc-id"),
      findingId:val("doc-find-id"),decision:val("doc-decision")};
    if(payload.decision==="accept"){
      if(val("doc-record-id"))payload.recordId=val("doc-record-id");
      if(val("doc-site-id"))payload.siteId=val("doc-site-id");
      if(val("doc-role"))payload.role=val("doc-role");
    }
    const result=await api("/v1/documents/decide","POST",payload);
    document.getElementById("doc-decision-result").textContent=JSON.stringify(result.result,null,2);
    await loadDocumentFindings();
    await refresh();
    message(result.result.status.startsWith("registered-")?
      "Registro institucional creado con autorización; verificar sus datos antes del uso.":"Decisión registrada, sin acciones operativas.");
  }catch(error){message(error.message,true);}
});

bindForms();
show("overview");
