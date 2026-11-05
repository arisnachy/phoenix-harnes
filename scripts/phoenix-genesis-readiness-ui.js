"use strict";
/* Genesis executive view. Authorized read-only local API calls only. */
(()=>{
  const $=id=>document.getElementById(id);
  const make=(tag,cls,value)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(value!==undefined)node.textContent=String(value);
    return node;
  };
  let cachedOrg=null,latest=null;
  function metric(name,value){
    const card=make('div','stat');
    card.append(make('strong','',value),make('small','',name));
    return card;
  }
  async function load(){
    const org=current;
    if(!org){
      $('readiness-note').textContent='Selecciona primero una organización.';
      return;
    }
    const report=await api('/v1/readiness?organizationId='+encodeURIComponent(org));
    if(org!==current)return;
    cachedOrg=org;
    latest=report;
    $('readiness-stats').replaceChildren(
      metric('Entrevista',report.discovery.coveragePct+'%'),
      metric('Áreas evaluadas',report.census.available?
        report.census.reviewed+'/'+report.census.total:'No aplica'),
      metric('Áreas verificadas',report.census.available?
        report.census.verified:'No aplica'),
      metric('Unidades',report.inventory.units),
      metric('Evidencias',report.inventory.evidence),
      metric('Prioridades',report.priorities.length)
    );
    $('readiness-note').textContent='Diagnóstico interno · '+report.generatedAt+
      ' · Huella SHA-256: '+report.sourceSha256+
      ' · No constituye reporte oficial ni declara conexiones activas.';
    const list=$('readiness-actions');
    list.replaceChildren();
    const top=report.priorities.slice(0,25);
    if(!top.length)list.append(make('li','hint','Sin acciones registradas; no equivale a que el hospital esté listo.'));
    for(const item of top)list.append(make('li','',
      '['+item.priority+'] '+item.title+': '+item.action));
    const budget=$('readiness-budget');
    budget.replaceChildren();
    const amounts=Object.entries(report.budgetByCurrencyAndPeriod);
    if(!amounts.length)budget.append(make('li','hint','No se han registrado partidas económicas.'));
    for(const [key,amount] of amounts)budget.append(make('li','',key+' · '+amount));
  }
  async function download(type){
    const org=current;
    if(!org)throw Error('Selecciona una institución');
    const query='?organizationId='+encodeURIComponent(org);
    let content,extension,mime;
    if(type==='html'){
      const response=await fetch('/v1/readiness/html'+query,{
        headers:{authorization:'Bearer '+secret}
      });
      if(!response.ok){
        let error='No se pudo exportar';
        try{error=(await response.json()).error||error}catch{}
        throw Error(error);
      }
      content=await response.text();
      extension='html';mime='text/html;charset=utf-8';
    }else{
      const data=await api('/v1/readiness'+query);
      content=JSON.stringify(data,null,2)+'\n';
      extension='json';mime='application/json;charset=utf-8';
    }
    if(org!==current)throw Error('La institución seleccionada cambió durante la exportación');
    const blob=new Blob([content],{type:mime});
    const address=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    const safeOrg=org.replace(/[^a-z0-9_-]/gi,'_');
    anchor.download='genesis-diagnostico-'+safeOrg+'.'+extension;
    anchor.href=address;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoke after the browser has accepted the download.
    setTimeout(()=>URL.revokeObjectURL(address),60000);
    message('Diagnóstico descargado en '+extension.toUpperCase()+
      '. Revisión humana pendiente; no se ha enviado a ninguna autoridad.');
  }
  document.querySelectorAll('.nav button').forEach(button=>{
    if(button.dataset.tab==='readiness')
      button.addEventListener('click',()=>void load().catch(e=>message(e.message,true)));
  });
  $('organization').addEventListener('change',()=>{
    cachedOrg=null;latest=null;
    if(section==='readiness')void load().catch(e=>message(e.message,true));
  });
  $('readiness-refresh').addEventListener('click',()=>void load().catch(e=>message(e.message,true)));
  $('readiness-html').addEventListener('click',
    ()=>void download('html').catch(e=>message(e.message,true)));
  $('readiness-json').addEventListener('click',
    ()=>void download('json').catch(e=>message(e.message,true)));
})();
