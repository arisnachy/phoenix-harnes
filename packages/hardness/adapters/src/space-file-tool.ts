import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type Item={id:string;kind:string;title:string;mime:string;content:string;revision:number;bytes:number;deleted:boolean}
const kinds=['document','sheet','slides','game','app','code','file'] as const
const mimes:Record<string,string>={document:'text/markdown',sheet:'application/vnd.phoenix.sheet+json',slides:'application/vnd.phoenix.slides+json',game:'text/html',app:'text/html',code:'text/plain',file:'text/plain'}
const uuid=/^[a-f0-9-]{36}$/u
function checkedContent(kind:string,raw:unknown):string{
  if(kind==='sheet'||kind==='slides'){
    const data:unknown=typeof raw==='string'?JSON.parse(raw):raw
    if(!data||typeof data!=='object'||Array.isArray(data))throw new ToolArgsError(['Expected structured document content.'])
    const v=data as Record<string,unknown>
    if(kind==='sheet'){
      if(!Array.isArray(v.columns)||v.columns.length<1||v.columns.length>40||!v.columns.every(c=>typeof c==='string')||!Array.isArray(v.rows)||v.rows.length>1000)throw new ToolArgsError(['Sheet needs columns and rows (max 40 columns, 1000 rows).'])
      const columns=v.columns as string[]
      const rows=v.rows.map(row=>{
        if(!Array.isArray(row)||row.length!==columns.length||!row.every(c=>c===null||['string','number','boolean'].includes(typeof c)))throw new ToolArgsError(['Each sheet row must match the columns and contain scalar cells.'])
        return row.map(c=>c===null?'':String(c))
      })
      return JSON.stringify({columns,rows})
    }
    if(!Array.isArray(v.slides)||v.slides.length<1||v.slides.length>100||!v.slides.every(s=>s&&typeof s==='object'&&typeof s.title==='string'&&typeof s.body==='string'))throw new ToolArgsError(['Slides need {slides:[{title,body}]}.'])
    return JSON.stringify({slides:v.slides})
  }
  if(typeof raw!=='string')throw new ToolArgsError(['Text content must be a string.'])
  return raw
}
export function createSpaceFileTool(resolvePort:()=>number|undefined):ToolDefinition{
  return defineTool({
    name:'phoenix_file',
    description:'Create, open, read, update and derive real shared PHOENIX Space files in chat. Use this instead of hand-authored generative-ui JSON when a user requests an editable sheet, document, presentation, HTML or code artifact. Create: kind sheet with content {columns:["Item","Price"],rows:[["Example",2]]}; slides with {slides:[{title,body}]}; document markdown string; app/game HTML string; code text. Read the exact item id and latest revision before updating; update requires expected revision, never silently overwrite user edits. Derive creates a new file from explicitly selected source revision, preserving the original. Open emits a live chat workbench. Read/list only when user requests or authorizes that file. List searches titles/content in the local library. Imported binary files can be opened but not edited by this tool; do not claim binary content was read. No arbitrary filesystem paths or network destinations.',
    parameters:{
      action:{type:'string',required:true,enum:['list','create','open','read','update','derive']},
      id:{type:'string',description:'Existing Space item UUID; required for open/read/update/derive.'},
      revision:{type:'number',description:'Expected exact revision for update or derive.'},
      kind:{type:'string',enum:kinds,description:'New file type (create/derive).'},
      title:{type:'string',description:'Title for create/derive or optional rename on update.'},
      content:{type:'json',description:'New structured sheet/slides content or text. Read latest before changing.'},
      query:{type:'string',description:'Search library when action=list.'},
    },
    output:{
      schema:{type:'object',additionalProperties:false,properties:{
        result:{type:'json',required:true},artifactId:{type:'string'},title:{type:'string'},itemId:{type:'string'},
      }},
      render:(_args,value)=>[{type:'text',text:JSON.stringify(value.result)}],
      presentationMeta:(_args,value)=>value.itemId?{artifact:{id:String(value.artifactId),mime:'application/vnd.phoenix.space-file+json',title:String(value.title),data:{itemId:String(value.itemId)},executable:false}}:{},
    },
    async execute(args,exec){
      const port=resolvePort()
      if(!Number.isInteger(port)||!port||port<1||port>65535)throw Error('PHOENIX Space local no disponible en esta sesión.')
      const origin='http://127.0.0.1:'+port
      const api=async(path:string,method='GET',data?:unknown)=>{
        const response=await fetch(origin+'/space-api'+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{origin,'content-type':'application/json','x-phoenix-space':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})})
        const value=await response.json() as {item?:Item;items?:unknown[];error?:string}
        if(!response.ok)throw Error(response.status===409?'CONFLICT: archivo modificado; lee la revisión actual antes de reintentar.':value.error||'Space request failed')
        return value
      }
      if(args.action==='list'){const r=await api('/items?q='+encodeURIComponent(args.query||''));return {result:(r.items||[]).slice(0,50) as never}}
      let item:Item|undefined
      if(args.action!=='create'){
        if(!args.id||!uuid.test(args.id))throw new ToolArgsError(['Provide exact Space item UUID.'])
        item=(await api('/items/'+args.id)).item
        if(!item||item.deleted)throw Error('Archivo no disponible')
      }
      if(args.action==='read')return {result:(item!.bytes?{...item,content:undefined,binary:true,note:'Binary content is not extracted by this action.'}:item) as never}
      if(args.action==='update'){
        if(item!.bytes)throw new ToolArgsError(['Imported original binary is read-only. Derive a new native document instead.'])
        if(args.revision!==item!.revision)throw Error('CONFLICT: read latest revision first')
        if(args.content===undefined&&args.title===undefined)throw new ToolArgsError(['Provide content or title.'])
        item=(await api('/items/'+item!.id,'PUT',{revision:args.revision,...args.title===undefined?{}:{title:args.title},...args.content===undefined?{}:{content:checkedContent(item!.kind,args.content)}})).item
      }
      if(args.action==='create'||args.action==='derive'){
        if(args.action==='derive'&&args.revision!==item!.revision)throw Error('CONFLICT: read source revision first')
        if(!args.kind||!args.title||args.content===undefined)throw new ToolArgsError(['Provide kind, title and content.'])
        const source=args.action==='derive'?{id:item!.id,revision:item!.revision}:undefined
        item=(await api('/items','POST',{kind:args.kind,space:args.kind==='game'?'juegos':'personal',title:args.title,mime:mimes[args.kind],content:checkedContent(args.kind,args.content),...source?{sourceKey:'derived:'+source.id+':'+source.revision+':'+String(exec.callId).slice(0,80)}:{}})).item
      }
      if(!item)throw Error('No se recibió archivo')
      return {result:{id:item.id,kind:item.kind,title:item.title,mime:item.mime,revision:item.revision,bytes:item.bytes},artifactId:'space-file:'+String(exec.callId),title:item.title,itemId:item.id}
    },
  })
}
