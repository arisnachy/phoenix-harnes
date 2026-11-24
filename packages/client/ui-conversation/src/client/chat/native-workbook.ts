/** Serializable Univer workbook bridge. No code, DOM or external I/O. */
type Obj=Record<string,unknown>
const rec=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const safeKey=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(v)&&!['__proto__','constructor','prototype'].includes(v)
export type NativeWorkbook={workbook:Obj;sheetId:string}
export type SheetProjection={columns:string[];rows:string[][]}
export function validNativeWorkbook(value:unknown):value is NativeWorkbook{
  if(!rec(value)||!rec(value.workbook)||!safeKey(value.sheetId))return false
  const w=value.workbook
  if(!safeKey(w.id)||!rec(w.sheets)||!Array.isArray(w.sheetOrder)||w.sheetOrder.length<1||w.sheetOrder.length>50||new Set(w.sheetOrder).size!==w.sheetOrder.length||!w.sheetOrder.every(safeKey)||!w.sheetOrder.includes(value.sheetId))return false
  if(Object.keys(w.sheets).length!==w.sheetOrder.length)return false
  for(const id of w.sheetOrder){
    const s=w.sheets[id as string]
    if(!rec(s)||s.id!==id||typeof s.name!=='string'||!rec(s.cellData)||!Number.isSafeInteger(s.rowCount)||Number(s.rowCount)<1||Number(s.rowCount)>1048576||!Number.isSafeInteger(s.columnCount)||Number(s.columnCount)<1||Number(s.columnCount)>16384)return false
  }
  try{return JSON.stringify(value).length<=1400000}catch{return false}
}
function cellRaw(cell:unknown):string|null{
  if(cell===null||cell===undefined)return ''
  if(!rec(cell))return null
  if(typeof cell.f==='string')return cell.f
  if(cell.p!==undefined&&cell.p!==null)return null
  if(cell.v===null||cell.v===undefined)return ''
  if(typeof cell.v==='string'||typeof cell.v==='number'||typeof cell.v==='boolean')return String(cell.v)
  return null
}
export function projectNativeWorkbook(native:NativeWorkbook):SheetProjection|null{
  if(!validNativeWorkbook(native))return null
  const s=(native.workbook.sheets as Obj)[native.sheetId] as Obj
  const data=s.cellData as Obj
  const cells=new Map<string,string>();let height=2,width=1
  for(const [r,cols] of Object.entries(data)){
    if(!/^\d+$/u.test(r)||!rec(cols))return null
    for(const [c,cell] of Object.entries(cols)){
      if(!/^\d+$/u.test(c))return null
      const v=cellRaw(cell)
      if(v===null)return null
      if(v==='')continue
      if(Number(r)>200||Number(c)>15||v.length>(Number(r)===0?60:300))return null
      height=Math.max(height,Number(r)+1);width=Math.max(width,Number(c)+1)
      cells.set(r+':'+c,v)
    }
  }
  const columns=Array.from({length:width},(_,c)=>cells.get('0:'+c)?.trim()||String.fromCharCode(65+c))
  const rows=Array.from({length:height-1},(_,r)=>Array.from({length:width},(_,c)=>cells.get((r+1)+':'+c)??''))
  return {columns,rows}
}
function encodeCell(raw:string,prior:unknown):Obj{
  const cell:Obj=rec(prior)?{...prior}:{}
  // A value or formula replacement must not retain stale rich text or cached results.
  for(const k of ['v','f','p','t','si','ref'])delete cell[k]
  if(raw.startsWith('='))cell.f=raw
  else if(raw!==''&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(raw)&&Number.isFinite(Number(raw))){cell.v=Number(raw);cell.t=2}
  else if(raw!==''){cell.v=raw;cell.t=1}
  return cell
}
export function createNativeWorkbook(id:string,title:string,columns:readonly string[],rows:readonly(readonly string[])[]):NativeWorkbook{
  const sheetId='sheet-1',cellData:Obj={}
  ;[columns,...rows].forEach((row,r)=>{const values:Obj={};row.forEach((v,c)=>{if(v!=='')values[c]=encodeCell(v,null)});if(Object.keys(values).length)cellData[r]=values})
  return {sheetId,workbook:{id:'phoenix-'+id,name:title,locale:'enUS',sheetOrder:[sheetId],styles:{},sheets:{[sheetId]:{id:sheetId,name:'Hoja 1',rowCount:Math.max(1000,rows.length+1),columnCount:Math.max(26,columns.length),cellData}}}}
}
/** Apply to the selected worksheet only; preserve the rest of the workbook and styles. */
export function patchNativeWorkbook(native:NativeWorkbook,columns:string[],rows:string[][],replaceLayout:boolean):NativeWorkbook{
  const before=projectNativeWorkbook(native)
  if(!before)throw Error('NATIVE_RANGE_UNSUPPORTED')
  const next=JSON.parse(JSON.stringify(native)) as NativeWorkbook
  const s=(next.workbook.sheets as Obj)[next.sheetId] as Obj
  const data=s.cellData as Obj
  if(replaceLayout&&Array.isArray(s.mergeData)&&s.mergeData.length)throw Error('NATIVE_MERGED_LAYOUT_REQUIRES_MANUAL_EDIT')
  if(replaceLayout){
    // The user explicitly requested a structural replacement of this worksheet only.
    for(const k of Object.keys(data))delete data[k]
  }
  const grid=[columns,...rows]
  grid.forEach((row,r)=>row.forEach((raw,c)=>{
    if(!replaceLayout&&(r===0?before.columns[c]:before.rows[r-1]?.[c])===raw)return
    const rowData=rec(data[r])?data[r] as Obj:{}
    rowData[c]=encodeCell(raw,rowData[c])
    data[r]=rowData
  }))
  if(!validNativeWorkbook(next))throw Error('NATIVE_SNAPSHOT_INVALID')
  return next
}
