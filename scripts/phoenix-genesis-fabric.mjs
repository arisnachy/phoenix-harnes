/**
 * PHOENIX Genesis / Fabric: offline organization and trusted-network planner.
 * No network connection, credential discovery, patient access or deployment is
 * performed by this module. Outputs are proposals pending human acceptance.
 */
const ADOPTION_MODES = new Set(['existing-overlay','hybrid','phoenix-native','progressive-migration'])
const NETWORK_MODES = new Set(['isolated','lan','overlay','relay'])
const ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/

function record(value,label) {
  if(value===null||typeof value!=='object'||Array.isArray(value)) throw new Error(label+' debe ser un objeto')
  return value
}
function id(value,label) {
  if(typeof value!=='string'||!ID_PATTERN.test(value)) throw new Error(label+' inválido')
  return value
}
function name(value,label) {
  if(typeof value!=='string'||!value.trim()||value.length>180||/[\u0000-\u001f]/u.test(value)) throw new Error(label+' inválido')
  return value.trim()
}
function items(value,label,max=128) {
  if(!Array.isArray(value)||value.length>max) throw new Error(label+' debe ser una lista válida')
  return value
}
function integer(value,label,max=100000) {
  if(!Number.isSafeInteger(value)||value<0||value>max) throw new Error(label+' inválido')
  return value
}
function amount(value,label) {
  if(value==null) return null
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000000)throw new Error(label+' inválido')
  return value
}
function unique(values,label) {
  if(new Set(values).size!==values.length) throw new Error(label+' duplicado')
}
function mode(value,allowed,label) {
  if(!allowed.has(value)) throw new Error(label+' desconocido')
  return value
}
function capabilities(value,label) {
  const vals=items(value??[],label,256).map(v=>id(v,label+' capacidad'))
  unique(vals,label+' capacidad')
  return vals
}
/**
 * Produce a reusable, domain-independent deployment plan with no invented
 * provider prices. A workstation is not an independent model or agent.
 */
export function planGenesisFabric(raw) {
  const spec=record(raw,'Organización')
  const organization=id(spec.organizationId,'organizationId')
  const organizationName=name(spec.name,'Nombre')
  const industry=name(spec.industry,'Sector')
  const adoptionMode=mode(spec.adoptionMode,ADOPTION_MODES,'Modo de adopción')
  const network=record(spec.network,'Red')
  const networkMode=mode(network.mode,NETWORK_MODES,'Modo de red')
  const sites=items(spec.sites,'Sedes',64)
  if(sites.length===0)throw new Error('Debe existir al menos una sede')
  const siteIds=sites.map(s=>id(record(s,'Sede').siteId,'siteId'))
  unique(siteIds,'Sede')
  const workstations=[]
  const instances=[]
  const software=[]
  for(const site of sites) {
    name(site.name,'Nombre de sede')
    const total=integer(site.workstations,'Estaciones')
    const reusable=integer(site.reusableWorkstations,'Estaciones reutilizables')
    if(reusable>total)throw new Error('No se pueden reutilizar más estaciones que las existentes')
    workstations.push({siteId:site.siteId,required:total,reusable,toAcquire:total-reusable,client:'web-first'})
    const roles=items(site.roles,'Funciones',100)
    const roleIds=roles.map(role=>id(record(role,'Función').roleId,'roleId'))
    unique(roleIds,'Función')
    for(const role of roles) {
      name(role.name,'Función')
      const count=integer(role.instances??1,'Instancias de la función',1000)
      if(count<1)throw new Error('Una función activa requiere al menos una instancia')
      if(instances.length+count>10000)throw new Error('El plan excede 10 000 instancias; divida por organización o fase')
      const scopes=capabilities(role.capabilities,'Función')
      for(let index=1;index<=count;index++)instances.push({
        instanceId:organization+'.'+site.siteId+'.'+role.roleId+'.'+index,
        siteId:site.siteId,roleId:role.roleId,roleName:role.name,
        capabilities:scopes,activation:'on-demand',state:'proposed',
        runtime:'shared-fabric-node'
      })
    }
    for(const app of items(site.software??[],'Sistemas',100)) {
      record(app,'Sistema')
      software.push({siteId:site.siteId,systemId:id(app.systemId,'Sistema'),
        name:name(app.name,'Sistema'),integration:'pending-authorization-and-test',
        authority:'source-system-until-explicit-cutover'})
    }
  }
  unique(instances.map(x=>x.instanceId),'Instancia')
  const peers=items(network.peers??[],'Enlaces',500).map(link=>{
    record(link,'Enlace')
    const from=id(link.from,'Emisor'),to=id(link.to,'Destino')
    if(!siteIds.includes(from)||!siteIds.includes(to)||from===to)throw new Error('Enlace entre sedes inválido')
    if(networkMode==='isolated'||networkMode==='lan')throw new Error('Las conexiones entre sedes exigen overlay o relay')
    if(link.approved!==true)throw new Error('Conexión externa requiere aprobación explícita')
    if(typeof link.peerFingerprint!=='string'||!/^[a-f0-9]{64}$/i.test(link.peerFingerprint))
      throw new Error('Conexión externa requiere huella SHA-256 del par')
    return {from,to,peerFingerprint:link.peerFingerprint.toLowerCase(),
      connectionState:'not-connected',enrollment:'pending-mutual-authentication'}
  })
  unique(peers.map(x=>x.from+'>'+x.to),'Enlace')
  const cost=record(spec.costs??{},'Costos')
  const unitPrice=amount(cost.workstationUsd,'Precio de estación')
  const workstationTotal=workstations.reduce((sum,x)=>sum+x.toAcquire,0)
  const estimatedWorkstationCapexUsd=unitPrice===null?null:Math.round(workstationTotal*unitPrice*100)/100
  const inference=record(spec.inference??{},'Inferencia')
  const strategies=items(inference.strategies??[],'Proveedores de modelos',30).map(s=>{
    record(s,'Proveedor')
    const providerId=id(s.providerId,'Proveedor')
    const execution=mode(s.execution,new Set(['local','external']),'Ejecución de modelo')
    return {providerId,execution,monthlyBudgetUsd:amount(s.monthlyBudgetUsd,'Presupuesto de modelos'),
      credentials:'not-in-plan',assignment:'pending-approval'}
  })
  unique(strategies.map(x=>x.providerId),'Proveedor')
  return {
    schemaVersion:'1.0',
    organization:{organizationId:organization,name:organizationName,industry,adoptionMode},
    workstations,instances,existingSoftware:software,
    summary:{sites:sites.length,logicalInstances:instances.length,
      workstations:workstations.reduce((sum,x)=>sum+x.required,0),
      workstationsToAcquire:workstationTotal,estimatedWorkstationCapexUsd},
    network:{mode:networkMode,connectionState:'not-connected',peers,
      transport:networkMode==='isolated'?'none':networkMode==='lan'?'private-lan-mtls':networkMode==='overlay'?'private-overlay-mtls':'outbound-relay-mtls',
      publicIngressAllowed:false,autoScanAllowed:false,
      certificateAndIdentityVerificationRequired:true},
    inference:{strategies,pricingStatus:'external-provider-prices-not-assumed'},
    governance:{status:'proposal-only',deploymentApproved:false,
      accessControl:'tenant-site-purpose-scoped',humanReviewRequired:true},
    nextSteps:['verify-assets-and-documents','approve-identity-and-permissions',
      'select-authorized-integrations','validate-budget','enroll-peers-and-test-connectivity',
      'run-workflow-simulation','obtain-deployment-approval']
  }
}
/**
 * Define a narrow, auditable request; never transport raw records/PHI on the
 * discovery bus. Network adapter and authorization enforcement remain separate.
 */
export function makeFabricTask(raw) {
  const input=record(raw,'Tarea')
  const refs=items(input.references??[],'Referencias',32).map(v=>id(v,'Referencia'))
  unique(refs,'Referencia')
  const requestedAt=name(input.requestedAt,'Fecha')
  if(!Number.isFinite(Date.parse(requestedAt)))throw new Error('Fecha de tarea inválida')
  if(input.payload!==undefined||input.patient!==undefined||input.credentials!==undefined)
    throw new Error('No enviar datos sensibles o credenciales en el bus')
  if(typeof input.requiresApproval!=='boolean')throw new Error('Se requiere política de aprobación explícita')
  return {
    schemaVersion:'1.0',taskId:id(input.taskId,'taskId'),
    organizationId:id(input.organizationId,'organizationId'),
    sourceInstanceId:id(input.sourceInstanceId,'Origen'),
    targetCapability:id(input.targetCapability,'Capacidad'),
    idempotencyKey:id(input.idempotencyKey,'Idempotencia'),
    purpose:name(input.purpose,'Propósito'),
    requestedAt:new Date(requestedAt).toISOString(),references:refs,
    requiresApproval:input.requiresApproval,
    state:input.requiresApproval?'pending-approval':'pending-authorization',
    transportStatus:'not-sent'
  }
}
