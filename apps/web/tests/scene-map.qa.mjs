import { createRequire } from 'node:module'
import {mkdir,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const require=createRequire(new URL('../package.json',import.meta.url))
const {chromium}=require('playwright')
const output=resolve('artifacts/scene-map')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try{
 for(const [label,width,height] of [['desktop',1280,900],['tablet',768,960],['mobile',390,844],['small-mobile',320,700]]){
  const page=await browser.newPage({viewport:{width,height},acceptDownloads:true})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  let opened=false
  for(let i=0;i<25&&!opened;i++){
   try{const res=await page.goto('http://127.0.0.1:5198/scene-map-qa.html',{waitUntil:'domcontentloaded',timeout:5000});opened=Boolean(res?.ok())}
   catch{await new Promise(r=>setTimeout(r,1000))}
  }
  if(!opened)throw Error('Production preview server unavailable')
  await page.locator('[data-phoenix-scene-map="isla-bruma"]').waitFor({timeout:15000})
  await page.getByRole('button',{name:'Explorar Torre del Viento'}).click()
  if(!(await page.getByText(/La torre en las montañas guarda/).isVisible()))throw Error(label+': selection does not update description')
  await page.screenshot({path:output+'/'+label+'.png',fullPage:true})
  const over=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,
    root:document.querySelector('[data-phoenix-scene-map]')?.getBoundingClientRect().width}))
  if(over.page>width+2)throw Error(label+': horizontal overflow '+JSON.stringify(over))
  await page.getByRole('button',{name:'Ver mapa completo'}).click()
  if(!(await page.getByText(/Puerto antiguo al oeste/).isVisible()))throw Error(label+': reset is broken')
  if(label==='desktop'){
   const promise=page.waitForEvent('download',{timeout:12000})
   await page.getByRole('button',{name:'Exportar SVG'}).click()
   const result=await promise
   await result.saveAs(output+'/isla-bruma.svg')
   const svg=(await readFile(output+'/isla-bruma.svg','utf8'))
   if(!svg.startsWith('<svg')||!svg.includes('Isla Bruma')||!svg.includes('Torre del Viento'))throw Error('Vector atlas export invalid')
  }
  if(errors.length)throw Error(label+': browser runtime errors '+errors.join(' | '))
  process.stdout.write(label+': interactive and rendered\n')
  await page.close()
 }
}finally{await browser.close()}
