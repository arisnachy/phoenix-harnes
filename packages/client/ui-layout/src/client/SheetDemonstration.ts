/** Bounded explicit spreadsheet demonstrations. Store only operation names,
 * never cell values, keystrokes, screenshots or background activity. */
export type SheetStep='trim'|'append-row'|'append-column'|'remove-empty-rows'
type Sheet={columns:string[];rows:string[][]}
const allowed:readonly SheetStep[]=['trim','append-row','append-column','remove-empty-rows']
/** Validate a portable recipe before preview or execution. */
export function parseSheetRecipe(raw:unknown):SheetStep[]{
  if(!Array.isArray(raw)||raw.length<1||raw.length>16||raw.some(s=>!allowed.includes(s as SheetStep)))throw Error('Demostración inválida')
  return [...raw] as SheetStep[]
}
/** Transform an isolated draft. Never persist or mutate the original. */
export function replaySheetRecipe(input:Sheet,raw:unknown):Sheet{
  const steps=parseSheetRecipe(raw)
  if(input.columns.length<1||input.columns.length>40||input.rows.length>1000||input.rows.some(r=>r.length!==input.columns.length))throw Error('Hoja inválida')
  let sheet={columns:[...input.columns],rows:input.rows.map(r=>[...r])}
  for(const step of steps){
    if(step==='trim')sheet={columns:sheet.columns.map(v=>v.trim()),rows:sheet.rows.map(r=>r.map(v=>v.trim()))}
    else if(step==='append-row'){
      if(sheet.rows.length>=1000)throw Error('Límite de filas')
      sheet.rows.push(sheet.columns.map(()=>''))
    }else if(step==='append-column'){
      if(sheet.columns.length>=40)throw Error('Límite de columnas')
      let n=sheet.columns.length+1;while(sheet.columns.includes('Columna '+n))n++
      sheet.columns.push('Columna '+n);sheet.rows=sheet.rows.map(r=>[...r,''])
    }else if(step==='remove-empty-rows')sheet.rows=sheet.rows.filter(r=>r.some(v=>v.trim()!==''))
  }
  return sheet
}
