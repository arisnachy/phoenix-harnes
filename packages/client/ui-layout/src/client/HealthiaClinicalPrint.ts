/** Print only server-authorized, escaped data in a transient same-origin window.
 * No external assets, network request, localStorage, chat bridge or signature invention.
 */
export interface ProtectedPrintDocument {
  title:string
  institution:string
  patientName:string
  patientBirth?:string
  patientId:string
  practitioner:string
  date:string
  status:string
  sections:readonly {heading:string;body:string}[]
  disclaimer?:string
}
const escapeHtml=(text:string):string=>text.replace(/[&<>"']/gu,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[c]??c))
const clean=(value:unknown):string=>typeof value==='string'?value:''
export function clinicalPrintHtml(doc:ProtectedPrintDocument):string {
  const sectionHtml=doc.sections.filter(x=>x.body.trim()).map(x=>
    '<section><h2>'+escapeHtml(x.heading)+'</h2><p>'+escapeHtml(x.body)+'</p></section>').join('')
  const draft=doc.status==='signed'?'':'<span class="draft">BORRADOR / SIN FIRMAR</span>'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(doc.title)} · Healthia</title>
<style>
@page{size:A4;margin:17mm}*{box-sizing:border-box}
body{font:12px/1.55 'Segoe UI',Arial,sans-serif;color:#27313d;background:white;margin:0;padding:30px;max-width:850px}
header{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:2px solid #e75b1f;gap:10px}
.logo{font-weight:750;letter-spacing:.04em;font-size:18px;color:#26323b}
.sub{font-size:10px;color:#63717f}
h1{font-size:22px;margin:26px 0 12px}h2{font-size:12px;margin:0 0 7px;color:#293847}
table{border-collapse:collapse;width:100%;margin:0 0 22px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #e6ebf0}
th{font-weight:650;width:28%;color:#66717b}
section{break-inside:avoid;margin:16px 0 20px;padding-top:10px;border-top:1px solid #eef1f4}
section p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 4px}
.draft{display:inline-block;color:#934718;border:1px solid #e5a179;border-radius:7px;padding:5px 9px;font-size:10px}
footer{margin-top:38px;padding-top:17px;border-top:1px solid #d6dce4;display:grid;gap:12px;font-size:10px;color:#6a7680}
@media print{body{padding:0;max-width:none}}
</style></head><body>
<header><div><div class="logo">${escapeHtml(doc.institution||'Healthia')}</div><div class="sub">PHOENIX · Registro clínico protegido</div></div>
<div>${draft}</div></header>
<h1>${escapeHtml(doc.title)}</h1>
<table>
<tr><th>Paciente</th><td>${escapeHtml(doc.patientName)}</td></tr>
<tr><th>Identificador</th><td>${escapeHtml(doc.patientId)}</td></tr>
<tr><th>Nacimiento</th><td>${escapeHtml(doc.patientBirth||'No documentado')}</td></tr>
<tr><th>Responsable</th><td>${escapeHtml(doc.practitioner)}</td></tr>
<tr><th>Fecha</th><td>${escapeHtml(doc.date)}</td></tr>
<tr><th>Estado</th><td>${escapeHtml(doc.status)}</td></tr>
</table>
${sectionHtml}
<footer><div>${escapeHtml(doc.disclaimer||'Documento emitido desde la información registrada; verifique autenticidad, firma y alcance antes de su uso.')}</div>
<div>Healthia · La impresión no modifica el expediente ni constituye una firma digital.</div></footer>
</body></html>`
}
export function printProtectedClinicalDocument(input:ProtectedPrintDocument):void {
  const popup=window.open('about:blank','_blank','width=860,height=920')
  if(!popup)throw Error('La vista de impresión fue bloqueada. Autoriza las ventanas de impresión.')
  popup.opener=null
  const html=clinicalPrintHtml({...input,sections:input.sections.map(s=>({
    heading:clean(s.heading),body:clean(s.body),
  }))})
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  popup.print()
}
