/** Reusable editorial plan, progress, and portable Word/print renderers. */
import { createHash } from 'node:crypto'
const xml = value => String(value).replace(/[&<>"']/gu, v => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[v])
const required = (value, name, max=5000) => {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > max) throw new Error(`Plan editorial inválido: ${name}`)
  return value.trim()
}
const integer = (value, name, min=1, max=1000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Número de plan editorial inválido: ${name}`)
  return value
}
export function validateBlueprint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1) throw new Error('Plan editorial requiere schemaVersion: 1.')
  const premise=required(input.premise,'premise',10000), audience=required(input.audience,'audience'), genre=required(input.genre,'genre')
  const targetWords=integer(input.targetWords,'targetWords',1000,1000000)
  if (!Array.isArray(input.characters) || !input.characters.length || input.characters.length > 100) throw new Error('El plan requiere de 1 a 100 personajes.')
  const characters=input.characters.map((c,i)=>({name:required(c?.name,`characters[${i}].name`,160),role:required(c?.role,`characters[${i}].role`),motivation:required(c?.motivation,`characters[${i}].motivation`),arc:required(c?.arc,`characters[${i}].arc`)}))
  if (new Set(characters.map(c=>c.name.toLocaleLowerCase())).size !== characters.length) throw new Error('Personajes duplicados en el plan.')
  if (!Array.isArray(input.chapters) || !input.chapters.length || input.chapters.length > 500) throw new Error('El plan requiere de 1 a 500 capítulos.')
  const chapters=input.chapters.map((c,i)=>{
    if (!Array.isArray(c?.beats) || !c.beats.length || c.beats.length > 50) throw new Error(`Escenas faltantes en capítulo ${i+1}.`)
    return {number:integer(c.number,`chapter[${i}].number`,1,500),title:required(c.title,`chapter[${i}].title`,160),purpose:required(c.purpose,`chapter[${i}].purpose`),targetWords:integer(c.targetWords,`chapter[${i}].targetWords`,100,100000),beats:c.beats.map((b,j)=>required(b,`chapter[${i}].beats[${j}]`)),...(c.pov === undefined ? {} : {pov:required(c.pov,`chapter[${i}].pov`,160)}),...(c.kind === undefined ? {} : {kind:['chapter','interlude','prologue','epilogue'].includes(c.kind) ? c.kind : (() => {throw new Error('Tipo de capítulo no válido.')})()})}
  }).sort((a,b)=>a.number-b.number)
  if (!chapters.every((c,i)=>c.number===i+1)) throw new Error('Los capítulos deben ser consecutivos y únicos.')
  if (Math.abs(chapters.reduce((s,c)=>s+c.targetWords,0)-targetWords)>targetWords*.15) throw new Error('El objetivo de palabras no coincide con los capítulos (tolerancia 15 %).')
  const worldRules=input.worldRules ?? []
  if (!Array.isArray(worldRules) || worldRules.length>100) throw new Error('worldRules debe ser una lista.')
  const series=input.series
  let parsedSeries
  if(series !== undefined) {
    parsedSeries={title:required(series?.title,'series.title',160),volume:integer(series?.volume,'series.volume',1,100),plannedVolumes:integer(series?.plannedVolumes,'series.plannedVolumes',1,100)}
    if(parsedSeries.volume>parsedSeries.plannedVolumes) throw new Error('Volumen de serie fuera de rango.')
  }
  const timeline=input.timeline ?? []
  if (!Array.isArray(timeline) || timeline.length>500) throw new Error('timeline debe ser una lista.')
  const parsedTimeline=timeline.map((event,i)=>({order:integer(event?.order,`timeline[${i}].order`),event:required(event?.event,`timeline[${i}].event`)})).sort((a,b)=>a.order-b.order)
  if(new Set(parsedTimeline.map(e=>e.order)).size!==parsedTimeline.length) throw new Error('Cronología con orden duplicado.')
  const editorial = input.editorial === undefined ? undefined : (input.editorial && typeof input.editorial === 'object' && !Array.isArray(input.editorial) && ['novel','novella','nonfiction','children'].includes(input.editorial.format) ? {format:input.editorial.format} : (() => {throw new Error('Formato editorial inválido.')})())
  return {schemaVersion:1,premise,audience,genre,targetWords,characters,chapters,worldRules:worldRules.map((s,i)=>required(s,`worldRules[${i}]`)),timeline:parsedTimeline,...(parsedSeries ? {series:parsedSeries}: {}),...(editorial ? {editorial} : {})}
}
export function sourceFingerprint(chapters) {
  const manifest=chapters.map(({number,sha256,words})=>({number,sha256,words})).sort((a,b)=>a.number-b.number)
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}
export function buildFingerprint(product) {
  return createHash('sha256').update(JSON.stringify({chapters:sourceFingerprint(product.chapters),blueprint:product.blueprint??null})).digest('hex')
}
export function progress(product,blueprint) {
  const existing=new Map(product.chapters.map(c=>[c.number,c]))
  const plan=blueprint?.chapters ?? []
  const chapters=plan.map(c=>{const written=existing.get(c.number)?.words??0;return {number:c.number,title:c.title,targetWords:c.targetWords,writtenWords:written,status:!written?'missing':written<Math.ceil(c.targetWords*.85)?'short':'drafted'}})
  const wordCount=product.chapters.reduce((s,c)=>s+c.words,0)
  return {id:product.id,title:product.title,type:product.type,hasBlueprint:!!blueprint,writtenWords:wordCount,targetWords:blueprint?.targetWords??null,writtenChapters:product.chapters.length,plannedChapters:plan.length,completionPercent:blueprint?Math.min(100,Math.round(wordCount/blueprint.targetWords*100)):null,chapters,buildStatus:!product.build?'not-built':product.build.fingerprint===buildFingerprint(product)?'current':'stale',humanEditorialReviewVerified:false,originalityVerified:false,printPageCountVerified:false}
}
const paragraph=(text,style='',pageBreak=false)=>`<w:p>${style||pageBreak?`<w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${pageBreak?'<w:pageBreakBefore/>':''}</w:pPr>`:''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
export function docxEntries(title,author,chapters) {
  const parts=[paragraph(title,'Title'),paragraph(author,'Subtitle')]
  for(const c of chapters) {
    parts.push(paragraph(c.title||`Capítulo ${c.number}`,'Heading1',true))
    for(const p of c.text.trim().split(/\n\s*\n/u)){const line=p.replace(/^#{1,6}\s*/u,'').replace(/\s*\n\s*/gu,' ').trim();if(line)parts.push(paragraph(line))}
  }
  const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="8640" w:h="12960"/><w:pgMar w:top="864" w:right="864" w:bottom="864" w:left="864"/></w:sectPr></w:body></w:document>`
  const styles=`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style></w:styles>`
  const contentTypes=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  return [{name:'[Content_Types].xml',bytes:contentTypes},{name:'_rels/.rels',bytes:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},{name:'word/_rels/document.xml.rels',bytes:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},{name:'word/styles.xml',bytes:styles},{name:'word/document.xml',bytes:doc},{name:'docProps/core.xml',bytes:`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator></cp:coreProperties>`}]
}
export function printHtml(title,author,chapters,lang='es') {
  const section=chapters.map(c=>`<section class="chapter"><h1>${xml(c.title||`Capítulo ${c.number}`)}</h1>${c.text.trim().split(/\n\s*\n/u).filter(Boolean).map(p=>`<p>${xml(p.replace(/^#{1,6}\s*/u,'').replace(/\s*\n\s*/gu,' '))}</p>`).join('')}</section>`).join('')
  return `<!doctype html><html lang="${xml(lang)}"><head><meta charset="utf-8"><title>${xml(title)} - impresión</title><style>@page{size:6in 9in;margin:.7in .65in .75in}body{font:11pt/1.4 Georgia,'Times New Roman',serif;color:#161616}.title{break-after:page;text-align:center;padding-top:32%}.title h1{font-size:24pt}.chapter{break-before:page}.chapter h1{text-align:center;font-size:16pt;margin:1.5em 0 2.5em;break-after:avoid}.chapter p{text-align:justify;text-indent:1.2em;margin:0 0 .2em;orphans:2;widows:2}</style></head><body><section class="title"><h1>${xml(title)}</h1><p>${xml(author)}</p></section>${section}</body></html>`
}