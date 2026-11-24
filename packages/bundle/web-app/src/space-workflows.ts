
/** Parse a deliberately pasted TSV table (spreadsheet clipboard format).
 * Formula-looking cells remain inert by prefixing an apostrophe before storage. */
export function parseSpaceClipboard(text:unknown):{columns:string[];rows:string[][]} {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>500_000)throw new Error('Contenido demasiado grande')
  const records:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false
  const endCell=()=>{row.push(/^[\s]*[=+\-@]/u.test(cell)&&!/^[-+]?\d+(?:[.,]\d+)?$/u.test(cell.trim())?"'"+cell:cell);cell='';closed=false}
  const endRow=()=>{endCell();records.push(row);row=[];if(records.length>1001)throw new Error('Límite de filas')}
  for(let i=0;i<text.length;i++){
    const ch=text[i]!
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=ch;continue}
    if(ch==='"'&&!cell&&!closed){quoted=true;continue}
    if(ch==='\t'){endCell();continue}
    if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;endRow();continue}
    if(closed)throw new Error('Tabla inválida')
    cell+=ch
  }
  if(quoted)throw new Error('Tabla inválida')
  if(row.length||cell||closed)endRow()
  const columns=records.shift()
  if(!columns||columns.length<1||columns.length>40||columns.some(c=>!c.trim())||new Set(columns).size!==columns.length
    ||records.some(r=>r.length!==columns.length))throw new Error('Tabla inválida: encabezados únicos y filas rectangulares requeridos')
  return {columns,rows:records}
}

/** A deterministic fictional hospital demand fixture; never accepts real patient data. */
export function syntheticSpaceDataset(seed:unknown,count:unknown):{columns:string[];rows:string[][]} {
  if(typeof seed!=='number'||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
    typeof count!=='number'||!Number.isSafeInteger(count)||count<1||count>1000)throw new Error('Semilla o número de filas inválido')
  let state=seed>>>0
  const draw=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
  const rows=Array.from({length:count},(_,i)=>{
    const shift=['mañana','tarde','noche'][Math.floor(draw()*3)]!
    const demand=10+Math.floor(draw()*91),capacity=20+Math.floor(draw()*61)
    return ['SYNTHETIC-'+String(i+1).padStart(4,'0'),shift,String(demand),String(capacity),String(Math.max(0,demand-capacity)),'FICTICIO']
  })
  return {columns:['registro','turno','demanda_simulada','capacidad_simulada','brecha_simulada','origen'],rows}
}
