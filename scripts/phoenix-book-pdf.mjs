/** Isolated Python compositor: returns a verifiable on-disk PDF receipt, no paid/public actions. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./phoenix-book-publisher.py', import.meta.url))
export async function renderBookPdf(payload, { python=process.env.PHOENIX_PYTHON || (process.platform==='win32'?'py':'python3'), timeoutMs=240000 } = {}) {
  if (!payload || typeof payload!=='object' || !Array.isArray(payload.chapters) ||
      typeof payload.output!=='string') throw Error('Entrada PDF editorial inválida.')
  return new Promise((resolve,reject)=>{
    let finished=false,output='',failure=''
    const child=spawn(python,[script],{stdio:['pipe','pipe','pipe'],windowsHide:true})
    const done=(error,result)=>{
      if(finished)return
      finished=true
      clearTimeout(timer)
      if(error)reject(error)
      else resolve(result)
    }
    const timer=setTimeout(()=>{child.kill();done(Error('Tiempo límite del PDF editorial: no se ha declarado generado.'))},timeoutMs)
    child.on('error',error=>done(Error('No se puede iniciar el renderizador PDF: '+error.message)))
    child.stdin.on('error',()=>{})
    child.stdout.on('data',bytes=>{
      output+=bytes.toString('utf8')
      if(output.length>128*1024){child.kill();done(Error('Respuesta del renderizador PDF excesiva.'))}
    })
    child.stderr.on('data',bytes=>{failure=(failure+bytes.toString('utf8')).slice(-2000)})
    child.on('close',code=>{
      if(code!==0){done(Error('Falló el renderizador PDF: '+(failure||'exit '+code)));return}
      try {
        const parsed=JSON.parse(output)
        if(parsed?.ok!==true || !Number.isSafeInteger(parsed?.result?.pdf_pages) ||
            parsed.result.pdf_pages<3 || parsed.result.text_extraction_verified!==true ||
            parsed.result.print_release_approved!==false) throw Error('Recibo PDF incompleto.')
        done(null,parsed.result)
      } catch(error){done(Error('PDF sin comprobante verificable: '+error.message))}
    })
    child.stdin.end(JSON.stringify(payload))
  })
}
