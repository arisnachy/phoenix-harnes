// Screenshot and interaction QA against the original React GeoMap, not a mock UI.
import { createRequire } from 'node:module'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
const require=createRequire(new URL('../package.json',import.meta.url))
const { chromium }=require('playwright')
const output=resolve(process.env.GEO_VISUAL_ARTIFACTS??'artifacts/geo-visual')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try {
  for (const [name,width,height] of [['desktop',1280,900],['tablet',768,960],['mobile',390,844],['small-mobile',320,700]]) {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,acceptDownloads:true})
    const errors=[]
    page.on('pageerror',error=>errors.push(error.stack??error.message))
    // Deterministic raster fallback: never hammer public OSM tile servers in QA.
    await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({
      status:200,contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ee"/></svg>',
    }))
    let loaded=false
    for(let attempt=0;attempt<30&&!loaded;attempt++){
      try{const r=await page.goto('http://127.0.0.1:5187/geo-visual-qa.html',{waitUntil:'domcontentloaded',timeout:5000});loaded=Boolean(r?.ok())}
      catch{await new Promise(r=>setTimeout(r,1000))}
    }
    if(!loaded)throw Error('Vite QA server not running')
    await page.locator('[data-phoenix-geo-map="calidad-visual"]').waitFor({timeout:15000})
    await page.locator('button:has-text("Ver todo")').click()
    await page.screenshot({path:output+'/'+name+'-2d.png',fullPage:true})
    const layout=await page.evaluate(()=>{
      const root=document.querySelector('[data-phoenix-geo-map]')
      const bounds=root?.getBoundingClientRect()
      const itemList=[...document.querySelectorAll('button, [class*="summary"], [class*="legend"]')]
      const violations=itemList.filter(element=>{
        const e=element.getBoundingClientRect()
        return e.width>0&&(e.right>innerWidth+2||e.left<-2)
      }).slice(0,3).map(el=>el.textContent?.slice(0,50))
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
        cardWidth:bounds?.width,violations}
    })
    if(layout.documentWidth>width+1||layout.violations.length)throw Error(name+' horizontal overflow: '+JSON.stringify(layout))
    if(!(await page.getByRole('button',{name:'PDF · Informe'}).isVisible()))throw Error('Missing PDF action: '+name)
    if(!(await page.locator('[aria-label="Leyenda cartográfica"]').isVisible()))throw Error('Missing map legend')
    await page.getByRole('button',{name:'Vista 3D'}).click()
    await page.locator('[data-phoenix-geo-3d="true"]').waitFor()
    await page.waitForTimeout(220) // stable CSS transition for deterministic screenshot and contrast
    const contrast=await page.getByRole('button',{name:'Volver a 2D'}).evaluate(el=>{
      const style=getComputedStyle(el)
      const components = (value) => (value.match(/[0-9.]+/g)??[]).slice(0,3).map(Number)
      const luminance=(value) => {
        const channels=components(value).map(v=>{
          const n=v/255
          return n<=.04045?n/12.92:((n+.055)/1.055)**2.4
        })
        return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]
      }
      const bg=luminance(style.backgroundColor),fg=luminance(style.color)
      return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)
    })
    if(contrast<4.5)throw Error(name+' active 3D button lacks WCAG AA text contrast: '+contrast.toFixed(2))
    await page.screenshot({path:output+'/'+name+'-3d.png',fullPage:true})
    await page.getByRole('button',{name:'Volver a 2D'}).click()
    if(name==='desktop'){
      await page.getByRole('button',{name:'Seleccionar Centro'}).click()
      if(!(await page.getByText('Ventas mensuales (RD$): ' + (120000).toLocaleString('es-DO')).isVisible()))throw Error('Lost map selection')
      const promise=page.waitForEvent('download',{timeout:15000})
      await page.getByRole('button',{name:'PDF · Informe'}).click()
      const download=await promise
      const filename=output+'/export-check.pdf'
      await download.saveAs(filename)
      const buffer=await readFile(filename)
      if(!buffer.subarray(0,8).toString().startsWith('%PDF-1.4') || !buffer.toString('latin1').includes('/Count 2') || buffer.length<1600)
        throw Error('PDF export invalid')
      const meta=await stat(filename)
      process.stdout.write('PDF checked: '+meta.size+' bytes\n')
    }
    if(errors.length)throw Error(name+' page errors: '+errors.join(' | '))
    process.stdout.write(name+' checked: no horizontal overflow, real UI, 2D/3D\n')
    await page.close()
  }
}finally{await browser.close()}
