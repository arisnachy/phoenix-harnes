import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('apps/web/dist/office-engine')
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<iframe id="office" src="/office/index.html" style="width:1100px;height:700px"></iframe><script>window.addEventListener("message",e=>{if(e.data?.type==="ready"){document.body.dataset.ready="yes";e.source.postMessage({channel:"phoenix-univer-v1",type:"load",revision:0,native:{sheetId:"s1",workbook:{id:"test-book",name:"Budget",sheetOrder:["s1"],styles:{},sheets:{s1:{id:"s1",name:"Budget",rowCount:100,columnCount:26,cellData:{0:{0:{v:"Concept"},1:{v:"Amount"}},1:{0:{v:"Food"},1:{v:900},2:{f:"=B2-7200"}}}}}}}},location.origin)}if(e.data?.type==="error")document.body.dataset.error="yes"})</script>');return}
  try{const f=resolve(root,(req.url||'').replace(/^\/office\//,''));if(!f.startsWith(root+'/'))throw Error('path');const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[extname(f)]||'application/octet-stream';res.setHeader('Content-Type',mime);res.end(await readFile(f))}catch{res.statusCode=404;res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 const errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.goto('http://127.0.0.1:'+server.address().port+'/')
 await page.waitForFunction(()=>document.body.dataset.ready==='yes')
 const frame=page.frameLocator('#office')
 await frame.locator('canvas').first().waitFor({timeout:30000})
 assert.equal(await page.locator('body').getAttribute('data-error'),null)
 assert.deepEqual(errors,[])
}finally{await browser.close();server.close()}
