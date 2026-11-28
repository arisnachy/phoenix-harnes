import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('apps/web/dist/office-engine')
const server=createServer(async(req,res)=>{
  if(req.url==='/'){
    res.setHeader('Content-Type','text/html')
    res.end('<iframe id="office" style="width:1100px;height:700px"></iframe><script>window.officeMessages=[];window.addEventListener("message",e=>{if(e.data?.channel==="phoenix-univer-v1")window.officeMessages.push(e.data)});document.getElementById("office").src="/office/index.html"</script>')
    return
  }
  try{const f=resolve(root,(req.url||'').replace(/^\/office\//,''));if(!f.startsWith(root+sep))throw Error('path');const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'}[extname(f)]||'application/octet-stream';res.setHeader('Content-Type',mime);res.end(await readFile(f))}catch{res.statusCode=404;res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 const errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.goto('http://127.0.0.1:'+server.address().port+'/')
 await page.waitForFunction(()=>window.officeMessages.some(m=>m.type==='ready'))
 const book=amount=>({sheetId:'s1',workbook:{id:'test-book',name:'Budget',sheetOrder:['s1'],styles:{},sheets:{s1:{id:'s1',name:'Budget',rowCount:100,columnCount:26,cellData:{0:{0:{v:'Concept'},1:{v:'Amount'}},1:{0:{v:'Food'},1:{v:amount,t:2},2:{f:'=B2-7200'}}}}}}})
 const send=async data=>page.evaluate(d=>document.getElementById('office').contentWindow.postMessage({channel:'phoenix-univer-v1',...d},location.origin),data)
 const load=async(revision,amount,expected)=>{
   await send({type:'load',revision,native:book(amount)})
   await page.waitForFunction(r=>window.officeMessages.some(m=>m.type==='loaded'&&m.revision===r)||window.officeMessages.some(m=>m.type==='error'),revision)
   const messages=await page.evaluate(()=>window.officeMessages)
   assert.equal(messages.some(m=>m.type==='error'),false)
   const loaded=messages.find(m=>m.type==='loaded'&&m.revision===revision)
   assert.equal(loaded.native.workbook.id,'test-book')
   assert.equal(loaded.native.workbook.sheets.s1.cellData[1][1].v,amount)
   assert.equal(loaded.computed.C2,expected)
   await send({type:'ack',revision})
 }
 await load(0,8000,800)
 await page.frameLocator('#office').locator('canvas').first().waitFor({timeout:30000})
 await load(1,900,-6300)
 assert.deepEqual(errors,[])
}finally{await browser.close();server.close()}
