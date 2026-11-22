/**
 * Minimal self-contained OOXML exports for native PHOENIX Space presentations
 * and workbooks. ZIP store mode, no external network, macros or dependencies.
 * Imported Office files remain preserved as original binary attachments.
 */
const xml=(value:string):string=>value.replace(/&/gu,'&amp;').replace(/</gu,'&lt;')
  .replace(/>/gu,'&gt;').replace(/"/gu,'&quot;').replace(/'/gu,'&apos;')
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const PR='http://schemas.openxmlformats.org/package/2006/relationships'
const OD='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const P='http://schemas.openxmlformats.org/presentationml/2006/main'
const A='http://schemas.openxmlformats.org/drawingml/2006/main'
const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const CT='http://schemas.openxmlformats.org/package/2006/content-types'
const toBytes=(data:string):Buffer=>Buffer.from(data,'utf8')
function crc32(bytes:Buffer):number {
  let n=0xffffffff
  for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0)}
  return (n^0xffffffff)>>>0
}
export function zipOffice(entries:readonly {name:string;data:string}[]):Buffer {
  const local:Buffer[]=[];const central:Buffer[]=[];let offset=0
  for(const item of entries){
    const name=toBytes(item.name);const data=toBytes(item.data)
    if(name.length>65535||data.length>20_000_000)throw new Error('Archivo Office demasiado grande')
    const crc=crc32(data)
    const header=Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4)
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22)
    header.writeUInt16LE(name.length,26)
    local.push(header,name,data)
    const record=Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6)
    record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24)
    record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42)
    central.push(record,name)
    offset+=header.length+name.length+data.length
  }
  const centralSize=central.reduce((a,b)=>a+b.length,0)
  const end=Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50,0)
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10)
  end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...local,...central,end])
}
function docRel(id:string,type:string,target:string):string {
  return '<Relationship Id="'+id+'" Type="'+OD+'/'+type+'" Target="'+target+'"/>'
}
function packageRel(type:string,target:string):string {
  return XML+'<Relationships xmlns="'+PR+'"><Relationship Id="rId1" Type="'+OD+'/'+type+'" Target="'+target+'"/></Relationships>'
}
function shape(id:number,title:string,x:number,y:number,w:number,h:number,size:number,bold=false):string {
  const lines=title.split(/\r?\n/u).slice(0,16).map(line=>
    '<a:p><a:pPr/><a:r><a:rPr lang="es-DO" sz="'+size+'"'+(bold?' b="1"':'')+'/>'+
    '<a:t>'+xml(line.slice(0,500))+'</a:t></a:r><a:endParaRPr lang="es-DO"/></a:p>').join('')
  return '<p:sp><p:nvSpPr><p:cNvPr id="'+id+'" name="Text '+id+'"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'+
    '<p:spPr><a:xfrm><a:off x="'+x+'" y="'+y+'"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm>'+
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>'+
    '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>'+lines+'</p:txBody></p:sp>'
}
const spTree='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'+
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
export function exportPptx(content:string):Buffer {
  let decoded:unknown
  try{decoded=JSON.parse(content)}catch{throw new Error('Presentación inválida')}
  const obj=decoded as {slides?:unknown}
  if(!obj||!Array.isArray(obj.slides)||obj.slides.length<1||obj.slides.length>100)throw new Error('Diapositivas inválidas')
  const slides=obj.slides.map((value:unknown)=>{
    const s=value as {title?:unknown;body?:unknown}
    if(!s||typeof s.title!=='string'||typeof s.body!=='string'||s.title.length>240||s.body.length>6000)
      throw new Error('Contenido de diapositiva inválido')
    return {title:s.title,body:s.body}
  })
  const entries:{name:string;data:string}[]=[]
  entries.push({name:'[Content_Types].xml',data:XML+'<Types xmlns="'+CT+'">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'+
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'+
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'+
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'+
    slides.map((_,i)=>'<Override PartName="/ppt/slides/slide'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('')+
    '</Types>'})
  entries.push({name:'_rels/.rels',data:packageRel('officeDocument','ppt/presentation.xml')})
  entries.push({name:'ppt/presentation.xml',data:XML+'<p:presentation xmlns:p="'+P+'" xmlns:a="'+A+'" xmlns:r="'+OD+'">'+
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'+
    '<p:sldIdLst>'+slides.map((_,i)=>'<p:sldId id="'+(256+i)+'" r:id="rId'+(i+2)+'"/>').join('')+'</p:sldIdLst>'+
    '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'})
  entries.push({name:'ppt/_rels/presentation.xml.rels',data:XML+'<Relationships xmlns="'+PR+'">'+
    docRel('rId1','slideMaster','slideMasters/slideMaster1.xml')+
    slides.map((_,i)=>docRel('rId'+(i+2),'slide','slides/slide'+(i+1)+'.xml')).join('')+'</Relationships>'})
  entries.push({name:'ppt/slideMasters/slideMaster1.xml',data:XML+'<p:sldMaster xmlns:p="'+P+'" xmlns:a="'+A+'" xmlns:r="'+OD+'">'+
    '<p:cSld name="PHOENIX"><p:spTree>'+spTree+'</p:spTree></p:cSld>'+
    '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/>'+
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'+
    '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'})
  entries.push({name:'ppt/slideMasters/_rels/slideMaster1.xml.rels',data:XML+'<Relationships xmlns="'+PR+'">'+
    docRel('rId1','slideLayout','../slideLayouts/slideLayout1.xml')+
    docRel('rId2','theme','../theme/theme1.xml')+'</Relationships>'})
  entries.push({name:'ppt/slideLayouts/slideLayout1.xml',data:XML+'<p:sldLayout xmlns:p="'+P+'" xmlns:a="'+A+'" xmlns:r="'+OD+'" type="blank" preserve="1">'+
    '<p:cSld name="En blanco"><p:spTree>'+spTree+'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'})
  entries.push({name:'ppt/slideLayouts/_rels/slideLayout1.xml.rels',data:packageRel('slideMaster','../slideMasters/slideMaster1.xml')})
  const colors=['000000','FFFFFF','272727','F8F8F8','EC6B42','4B77B6','58A780','9568A6','E7B75C','3CA3A6','166EB3','8B468D']
  const names=['dk1','lt1','dk2','lt2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink']
  entries.push({name:'ppt/theme/theme1.xml',data:XML+'<a:theme xmlns:a="'+A+'" name="PHOENIX"><a:themeElements>'+
    '<a:clrScheme name="PHOENIX">'+names.map((n,i)=>'<a:'+n+'><a:srgbClr val="'+colors[i]+'"/></a:'+n+'>').join('')+'</a:clrScheme>'+
    '<a:fontScheme name="PHOENIX"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>'+
    '<a:fmtScheme name="PHOENIX"><a:fillStyleLst><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fillStyleLst>'+
    '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></a:lnStyleLst>'+
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'+
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'+
    '</a:themeElements></a:theme>'})
  slides.forEach((s,i)=>{
    entries.push({name:'ppt/slides/slide'+(i+1)+'.xml',data:XML+'<p:sld xmlns:p="'+P+'" xmlns:a="'+A+'" xmlns:r="'+OD+'">'+
      '<p:cSld><p:spTree>'+spTree+
      shape(2,s.title,640000,600000,10900000,1100000,3400,true)+
      shape(3,s.body,720000,1950000,10500000,4500000,2300)+
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'})
    entries.push({name:'ppt/slides/_rels/slide'+(i+1)+'.xml.rels',data:packageRel('slideLayout','../slideLayouts/slideLayout1.xml')})
  })
  return zipOffice(entries)
}
function column(index:number):string {
  let n=index+1;let result=''
  while(n>0){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26)}
  return result
}
function cellXml(value:string,r:number,c:number):string {
  const addr=column(c)+r
  if(value.startsWith('=')&&/^=[A-Z0-9()+*\/,:\s.-]{1,150}$/iu.test(value)
    && !/\b(?:EXEC|CMD|WEBSERVICE|HYPERLINK|DDE)\b/iu.test(value)) {
    return '<c r="'+addr+'"><f>'+xml(value.slice(1))+'</f><v>0</v></c>'
  }
  if(value!==''&&/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)&&Number.isFinite(Number(value)))
    return '<c r="'+addr+'"><v>'+xml(value)+'</v></c>'
  return '<c r="'+addr+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'
}
export function exportXlsx(content:string):Buffer {
  let decoded:unknown
  try{decoded=JSON.parse(content)}catch{throw new Error('Hoja inválida')}
  const obj=decoded as {columns?:unknown;rows?:unknown}
  if(!obj)throw new Error('Tabla inválida')
  const columns=obj.columns
  const dataRows=obj.rows
  if(!Array.isArray(columns)||!Array.isArray(dataRows)||
    columns.length<1||columns.length>40||dataRows.length>1000 ||
    !columns.every(x=>typeof x==='string'&&x.length<=120)||
    !dataRows.every(row=>Array.isArray(row)&&row.length===columns.length&&
      row.every(x=>typeof x==='string'&&x.length<=1000)))throw new Error('Tabla inválida')
  const rows=[columns,...dataRows] as string[][]
  const body=rows.map((cells,i)=>'<row r="'+(i+1)+'">'+cells.map((value,c)=>cellXml(value,i+1,c)).join('')+'</row>').join('')
  return zipOffice([
    {name:'[Content_Types].xml',data:XML+'<Types xmlns="'+CT+'"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:'_rels/.rels',data:packageRel('officeDocument','xl/workbook.xml')},
    {name:'xl/workbook.xml',data:XML+'<workbook xmlns="'+S+'" xmlns:r="'+OD+'"><sheets><sheet name="PHOENIX" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',data:XML+'<Relationships xmlns="'+PR+'">'+docRel('rId1','worksheet','worksheets/sheet1.xml')+docRel('rId2','styles','styles.xml')+'</Relationships>'},
    {name:'xl/styles.xml',data:XML+'<styleSheet xmlns="'+S+'"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>'+
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
    {name:'xl/worksheets/sheet1.xml',data:XML+'<worksheet xmlns="'+S+'"><sheetData>'+body+'</sheetData></worksheet>'},
  ])
}
