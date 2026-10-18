/** Real CLI-to-Python-to-library smoke. Requires reportlab and pymupdf installed. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'

function chunk(name, data) {
  const type=Buffer.from(name,'ascii'), len=Buffer.alloc(4), crcBuf=Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  let crc=0xffffffff
  for(const byte of Buffer.concat([type,data])) {
    crc^=byte
    for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:(crc>>>1)
  }
  crcBuf.writeUInt32BE((crc^0xffffffff)>>>0)
  return Buffer.concat([len,type,data,crcBuf])
}
function cover() {
  const w=1600,h=2560,ihdr=Buffer.alloc(13),pixels=Buffer.alloc(h*(w+1))
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=0
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}
test('Phoenix CLI realmente compone y archiva PDF paginado sin aprobar venta ni imprenta', async()=>{
  const home=await mkdtemp(join(tmpdir(),'phoenix-book-pdf-cli-'))
  const source=await mkdtemp(join(tmpdir(),'phoenix-book-pdf-input-'))
  const call=(...args)=>{
    const proc=spawnSync(process.execPath,['scripts/phoenix-business.mjs',...args],
      {cwd:process.cwd(),encoding:'utf8',timeout:90000,env:{
        ...process.env,PHOENIX_BUSINESS_HOME:home,
        PHOENIX_PYTHON:process.env.PHOENIX_PYTHON || (process.platform==='win32'?'python':'python3'),
      }})
    if(proc.error)throw proc.error
    const raw=proc.status===0?proc.stdout:proc.stderr
    let data
    try{data=JSON.parse(raw)}catch{throw Error('CLI sin JSON ('+proc.status+'): '+raw.slice(-750))}
    return {...data,code:proc.status}
  }
  try {
    const created=call('init','book','La puerta secreta')
    assert.equal(created.ok,true)
    const id=created.result.id
    const blueprint={schemaVersion:1,premise:'Una niña descubre un mapa secreto y aprende a colaborar.',
      genre:'Aventura infantil',audience:'Lectores infantiles',targetWords:2400,
      editorial:{format:'children'},
      characters:[{name:'Ada',role:'Protagonista',motivation:'Encontrar la puerta secreta',
        arc:'De desconfiada a cooperativa'}],
      chapters:[{number:1,title:'La puerta en el bosque',targetWords:2400,
        purpose:'Explorar el misterio y establecer consecuencias claras.',
        beats:['Ada encuentra un mapa y pide ayuda.']}]}
    const planPath=join(source,'blueprint.json'),chapterPath=join(source,'chapter-001.md'),coverPath=join(source,'cover.png')
    await writeFile(planPath,JSON.stringify(blueprint))
    const narrative=Array.from({length:160},(_,i)=>
      'Ada'+i+' encontró el símbolo'+i+' cerca del sendero'+i+' y siguió la pista'+i+'. '+
      'Cada descubrimiento'+i+' cambió el plan'+i+' de su amiga'+i+' mientras avanzaban'+i+' hacia el bosque'+i+'.').join('\n\n')
    await writeFile(chapterPath,narrative)
    await writeFile(coverPath,cover())
    assert.equal(call('blueprint',id,planPath).ok,true)
    assert.equal(call('chapter',id,'1',chapterPath).ok,true)
    assert.equal(call('asset',id,coverPath,'--role','cover').ok,true)
    const quality=call('book-quality',id)
    assert.equal(quality.result.structurallyReadyForReview,true,JSON.stringify(quality.result.blockers))
    const rendered=call('book-pdf',id,'--author','Editorial Phoenix','--lang','es')
    assert.equal(rendered.ok,true,JSON.stringify(rendered))
    assert(rendered.result.pages >= 3)
    assert.equal(rendered.result.proof.trim,'6x9')
    assert.equal(rendered.result.proof.text_extraction_verified,true)
    assert.equal(rendered.result.proof.visual_inspection_verified,false)
    assert.equal(rendered.result.proof.print_release_approved,false)
    assert.equal(rendered.result.publicationConfirmed,false)
    const pdfBytes=await readFile(join(home,rendered.result.file.path))
    assert.equal(pdfBytes.toString('utf8',0,5),'%PDF-')
    assert.equal(createHash('sha256').update(pdfBytes).digest('hex'),rendered.result.file.sha256)
    const details=call('show',id).result
    assert.equal(details.printProof.pdf_pages,rendered.result.pages)
    assert.equal(details.files.filter(item=>item.name==='interior-6x9.pdf').length,1)
    const audit=call('audit',id)
    assert.equal(audit.result.filesIntact,true,JSON.stringify(audit))
    assert.equal(audit.result.readyForAutomaticPublication,false)
  } finally {
    await Promise.all([rm(home,{recursive:true,force:true}),rm(source,{recursive:true,force:true})])
  }
})
