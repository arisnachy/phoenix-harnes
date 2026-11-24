
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

/** Deterministic, bounded aggregate-only report; does not interpret formulas. */
export function summarizeSpaceSheet(content:string,kind:'document'|'slides'):string{
  const x=JSON.parse(content) as {columns?:unknown;rows?:unknown}
  if(!Array.isArray(x.columns)||x.columns.length<1||x.columns.length>40||!x.columns.every(c=>typeof c==='string')
    ||!Array.isArray(x.rows)||x.rows.length>1000||!x.rows.every(row=>Array.isArray(row)&&row.length===(x.columns as unknown[]).length&&row.every(c=>typeof c==='string')))throw Error('Hoja inválida')
  const columns=x.columns as string[],rows=x.rows as string[][]
  const numberOf=(s:string):number|null=>{
    const text=s.trim()
    if(!/^[+-]?\d+(?:\.\d+)?$/u.test(text))return null
    const v=Number(text)
    return Number.isFinite(v)&&Math.abs(v)<=1e12?v:null
  }
  const stats=columns.map((column,i)=>{
    const values=rows.map(row=>numberOf(row[i]!)).filter((v):v is number=>v!==null)
    // Omit names and cell values: only column indices and aggregates.
    return {column:i+1,n:values.length,mean:values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null}
  })
  const lines=stats.map(s=>'Columna '+s.column+': n='+s.n+', media='+ (s.mean===null?'no disponible':String(Math.round(s.mean*10000)/10000)))
  const heading='Resumen reproducible · '+rows.length+' filas · '+columns.length+' columnas'
  const caveat='Solo números literales finitos; las fórmulas y valores no numéricos no se evalúan. Sin inferencia clínica ni causal.'
  return kind==='document'?'# '+heading+'\n\n'+lines.map(s=>'- '+s).join('\n')+'\n\n'+caveat
    :JSON.stringify({slides:[{title:heading,body:caveat},...Array.from({length:Math.ceil(lines.length/6)},(_,i)=>({title:'Estadísticas · '+(i+1),body:lines.slice(i*6,i*6+6).join('\n')}))]})
}
