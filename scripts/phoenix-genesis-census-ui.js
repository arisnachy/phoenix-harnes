"use strict";
/**
 * 60-area institutional census — isolated console controller.
 * It reuses the authenticated local Genesis API; no external connections.
 * All institutional text is rendered as textContent, never HTML.
 */
(()=>{
  const $=id=>document.getElementById(id);
  const make=(tag,cls,value)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(value!==undefined)node.textContent=String(value);
    return node;
  };
  const norm=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  const stateLabel={
    'not-evaluated':'Sin evaluar',
    'existing':'Existente','outsourced':'Tercerizada',
    'not-applicable':'No aplica','unknown':'Por investigar'
  };
  const reviewLabel={
    'unreviewed':'Sin revisión','declared':'Declarada',
    'verified':'Con evidencia validada'
  };
  let cachedOrg=null,areas=[],sites=[],selectedId=null;
  function updateSelect(list,node,defaultValue=''){
    node.replaceChildren();
    for(const [value,label] of list){
      const item=make('option','',label);
      item.value=value;node.append(item);
    }
    node.value=defaultValue;
  }
  function metric(label,value){
    const box=make('div','stat');
    box.append(make('strong','',value),make('small','',label));
    return box;
  }
  function findArea(id){return areas.find(a=>a.areaId===id)}
  function selected(id){
    const a=findArea(id);
    if(!a)return;
    selectedId=a.areaId;
    $('census-area').value=a.areaId;
    $('census-state').value=a.state==='not-evaluated'?'unknown':a.state;
    $('census-review').value=a.reviewState==='verified'?'verified':'declared';
    $('census-reviewer').value=a.reviewerRole??'';
    $('census-site').value=a.siteId??'';
    $('census-evidence').value=a.evidenceRefs.join(', ');
    $('census-approved').checked=false;
    $('census-selected').textContent=a.name+' · '+a.domain+
      ' · Datos solicitados: '+(a.dataNeeded||'Confirmar con la jefatura')+
      ' · Informes sugeridos: '+(a.expectedReports||'Por determinar')+
      ' · Versión de evaluación '+a.revision;
  }
  function renderRows(){
    const body=$('census-rows');
    body.replaceChildren();
    const filter=$('census-filter').value;
    const query=norm($('census-query').value.trim());
    const candidates=areas.filter(a=>{
      if(filter==='not-evaluated'&&a.reviewState!=='unreviewed')return false;
      if(filter==='declared'&&a.reviewState!=='declared')return false;
      if(filter==='verified'&&a.reviewState!=='verified')return false;
      if(['existing','outsourced','not-applicable','unknown'].includes(filter)&&
        a.state!==filter)return false;
      return !query||norm([a.name,a.domain,a.dataNeeded,a.expectedReports].join(' ')).includes(query);
    });
    for(const a of candidates){
      const tr=make('tr');
      const label=make('td');
      label.append(make('strong','',a.name),make('p','hint',a.domain));
      const status=make('td');
      status.append(make('span','pill',stateLabel[a.state]??a.state));
      const evidence=make('td','',reviewLabel[a.reviewState]??a.reviewState);
      const actions=make('td');
      const b=make('button','secondary',a.areaId===selectedId?'Seleccionada':'Evaluar');
      b.type='button';
      b.addEventListener('click',()=>{selected(a.areaId);renderRows();$('census-reviewer').focus();});
      actions.append(b);
      tr.append(label,status,evidence,actions);
      body.append(tr);
    }
    if(candidates.length===0){
      const tr=make('tr'),td=make('td','hint','No hay áreas que coincidan con los filtros.');
      td.colSpan=4;tr.append(td);body.append(tr);
    }
    $('census-count').textContent=candidates.length+' de '+areas.length+
      ' áreas visibles. Los resultados del catálogo no constituyen un inventario real.';
  }
  async function loadCensus(){
    const org=current;
    if(!org){
      $('census-notice').textContent='Crea o selecciona una institución.';
      return;
    }
    const [census,profile]=await Promise.all([
      api('/v1/census?organizationId='+encodeURIComponent(org)),
      api('/v1/dashboard?organizationId='+encodeURIComponent(org))
    ]);
    if(org!==current)return;
    cachedOrg=org;
    areas=census.areas??[];
    sites=(profile.sites??[]).map(s=>({siteId:s.siteId,name:s.name??s.siteId}));
    $('census-stats').replaceChildren();
    if(!census.available){
      $('census-stats').append(metric('Áreas hospitalarias',0));
      $('census-rows').replaceChildren();
      $('census-area').replaceChildren();
      $('census-notice').textContent=census.note;
      $('census-selected').textContent='No corresponde aplicar el catálogo hospitalario a esta industria.';
      return;
    }
    const n=census.summary;
    $('census-stats').append(
      metric('Cobertura de evaluación',Math.round(n.reviewed/census.total*100)+'%'),
      metric('Con evidencia validada',n.verified),
      metric('Declaradas sin verificar',n.reviewed-n.verified),
      metric('Pendientes',n.notEvaluated)
    );
    $('census-notice').textContent='Referencia hospitalaria v4 · '+
      n.existing+' existentes · '+n.outsourced+' tercerizadas · '+
      n.notApplicable+' no aplican. No se instala ni activa ninguna instancia.';
    const options=areas.map(a=>[a.areaId,a.areaId+' · '+a.name]);
    updateSelect(options,$('census-area'),selectedId??areas[0]?.areaId??'');
    updateSelect([['','Sin sede definida'],...sites.map(s=>[s.siteId,s.name])],
      $('census-site'),'');
    const next=areas.some(a=>a.areaId===selectedId)?selectedId:areas[0]?.areaId;
    if(next)selected(next);
    renderRows();
  }
  document.querySelectorAll('.nav button').forEach(button=>{
    if(button.dataset.tab!=='census')return;
    button.addEventListener('click',()=>{void loadCensus().catch(e=>message(e.message,true));});
  });
  $('organization').addEventListener('change',()=>{
    cachedOrg=null;selectedId=null;
    if(section==='census')void loadCensus().catch(e=>message(e.message,true));
  });
  $('census-area').addEventListener('change',e=>{
    selected(e.target.value);renderRows();
  });
  $('census-filter').addEventListener('change',renderRows);
  $('census-query').addEventListener('input',renderRows);
  $('form-census').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const org=current;
      const item=findArea($('census-area').value);
      if(!item||!org||cachedOrg!==org)throw Error('Recarga el censo antes de evaluar');
      if(!$('census-approved').checked)throw Error('Confirma la autorización institucional');
      const evidence=$('census-evidence').value.split(',').map(x=>x.trim()).filter(Boolean);
      const review=$('census-review').value;
      if(review==='verified'&&evidence.length===0)
        throw Error('Para verificar el área necesitas una evidencia institucional validada');
      const response=await api('/v1/census/assess','POST',{
        organizationId:org,areaId:item.areaId,
        state:$('census-state').value,
        reviewState:review,reviewerRole:$('census-reviewer').value.trim(),
        siteId:$('census-site').value||null,evidenceRefs:evidence,
        expectedRevision:item.revision
      });
      if(org!==current)return;
      selectedId=response.result.areaId;
      await loadCensus();
      message('Evaluación registrada · versión '+response.result.revision+
        '. No se ha creado ni instalado un departamento.');
    }catch(e){
      if(String(e.message).includes('Conflicto')){
        await loadCensus().catch(()=>{});
        message('Otro cambio actualizó esta área. Se recargaron los datos; revisa antes de guardar.',true);
      }else message(e.message,true);
    }
  });
})();
