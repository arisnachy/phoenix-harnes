/** Pure, deterministic comic-page compositor. Coordinates are thousandths of the live page area. */
const SHAPES = Object.freeze({
  rectangle: 'inset(0)',
  'slant-left': 'polygon(8% 0,100% 0,100% 100%,0 100%)',
  'slant-right': 'polygon(0 0,100% 0,92% 100%,0 100%)',
  trapezoid: 'polygon(9% 0,91% 0,100% 100%,0 100%)',
  'angled-top': 'polygon(0 10%,100% 0,100% 100%,0 100%)',
  'angled-bottom': 'polygon(0 0,100% 0,100% 89%,0 100%)',
  circle: 'ellipse(49% 49% at 50% 50%)',
  hexagon: 'polygon(16% 0,84% 0,100% 50%,84% 100%,16% 100%,0 50%)',
  burst: 'polygon(50% 0,61% 17%,82% 4%,78% 30%,100% 35%,84% 53%,98% 78%,72% 77%,60% 100%,46% 81%,20% 97%,24% 70%,0 61%,17% 42%,3% 20%,34% 24%)',
})
const VALID = Object.keys(SHAPES)
function fail(message) { throw Error(`Composición de cómic: ${message}`) }
function box(id, x, y, width, height, shape='rectangle', overlay=false) {
  return {id,x,y,width,height,shape,overlay}
}
/** A compact set of editorially authored nonuniform page compositions; never equal strips by default. */
function sampleLayout(ids) {
  const n=ids.length
  const b=[]
  const gap=14
  const row=(start,count,y,height,shapes)=>{
    const width=(1000-gap*(count-1))/count
    for(let j=0;j<count;j++) b.push(box(ids[start+j],Math.round(j*(width+gap)),y,
      j===count-1?1000-Math.round(j*(width+gap)):Math.round(width),height,shapes?.[j]??'rectangle'))
  }
  if(n===1){b.push(box(ids[0],0,0,1000,1000));return b}
  if(n===2){b.push(box(ids[0],0,0,1000,535,'angled-bottom'));b.push(box(ids[1],0,550,1000,450,'angled-top'));return b}
  if(n===3){b.push(box(ids[0],0,0,1000,435,'slant-right'));row(1,2,450,550,['slant-left','rectangle']);return b}
  if(n===4){b.push(box(ids[0],0,0,1000,370,'angled-bottom'));b.push(box(ids[1],0,385,463,615,'slant-right'));b.push(box(ids[2],477,385,523,292,'angled-top'));b.push(box(ids[3],477,691,523,309,'trapezoid'));return b}
  if(n===5){b.push(box(ids[0],0,0,1000,310,'angled-bottom'));b.push(box(ids[1],0,324,425,676,'slant-right'));b.push(box(ids[2],439,324,561,215,'angled-top'));b.push(box(ids[3],439,553,561,214,'slant-left'));b.push(box(ids[4],439,781,561,219,'rectangle'));return b}
  if(n===6){row(0,2,0,334,['trapezoid','slant-left']);b.push(box(ids[2],0,348,1000,315,'angled-bottom'));row(3,3,677,323,['rectangle','slant-left','slant-right']);return b}
  if(n===7){b.push(box(ids[0],0,0,1000,302,'angled-bottom'));row(1,3,316,318,['slant-left','rectangle','slant-right']);row(4,3,648,352,['rectangle','trapezoid','rectangle']);return b}
  if(n===8){row(0,2,0,282,['slant-right','angled-top']);row(2,3,296,338,['rectangle','trapezoid','slant-left']);row(5,3,648,352,['slant-right','rectangle','angled-top']);return b}
  if(n===9){row(0,3,0,310,['trapezoid','slant-left','rectangle']);row(3,3,324,330,['slant-right','rectangle','angled-top']);row(6,3,668,332,['rectangle','slant-left','trapezoid']);return b}
  // Larger pages remain varied and readable; never exceed four panels in any row.
  const rows=Math.ceil(n/3),baseH=(1000-gap*(rows-1))/rows
  let pos=0
  for(let i=0;i<rows;i++){
    const remaining=n-pos,rowsLeft=rows-i,count=Math.min(4,Math.ceil(remaining/rowsLeft))
    row(pos,count,Math.round(i*(baseH+gap)),i===rows-1?1000-Math.round(i*(baseH+gap)):Math.round(baseH),VALID.slice(i%4,i%4+count))
    pos+=count
  }
  return b
}
function strictlyValidSlot(v, index) {
  if(!v || typeof v!=='object' || Array.isArray(v))fail(`posición inválida ${index+1}`)
  if(typeof v.id!=='string' || !/^[a-z][a-z0-9-]{1,63}$/u.test(v.id))fail('ID de viñeta no válido')
  for(const k of ['x','y','width','height']) if(!Number.isSafeInteger(v[k]))fail(`coordenada ${k} inválida`)
  if(v.width<100 || v.height<90 || v.x<0 || v.y<0 || v.x+v.width>1000 || v.y+v.height>1000) fail(`viñeta ${v.id} fuera de página o demasiado pequeña`)
  const shape=v.shape??'rectangle'
  if(!Object.hasOwn(SHAPES,shape))fail(`silueta ${shape} no admitida; usa ${VALID.join(', ')}`)
  if(v.overlay!==undefined && typeof v.overlay!=='boolean')fail('overlay debe ser verdadero o falso')
  return box(v.id,v.x,v.y,v.width,v.height,shape,v.overlay??false)
}
/** Validate a freeform storyboard or choose varied, reproducible editorial layouts. */
export function resolvePageLayout(page) {
  const ids=page.panels.map(p=>p.id)
  if(!ids.length || ids.length>20 || new Set(ids).size!==ids.length)fail('página sin viñetas o con IDs repetidos')
  if(page.layout==null || page.layout.mode==='auto')return sampleLayout(ids)
  if(page.layout.mode!=='freeform' || !Array.isArray(page.layout.slots) || page.layout.slots.length!==ids.length)fail('layout freeform requiere un slot por viñeta')
  const slots=page.layout.slots.map(strictlyValidSlot)
  if(new Set(slots.map(s=>s.id)).size!==slots.length || slots.some(s=>!ids.includes(s.id)))fail('layout no corresponde a las viñetas de la página')
  // Non-overlay panels must not obscure one another. Diagonal masks leave intentional visual gutters.
  for(let i=0;i<slots.length;i++)for(let j=0;j<i;j++){
    const a=slots[i],b=slots[j]
    if(a.overlay || b.overlay)continue
    const dx=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))
    const dy=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
    if(dx*dy>300)fail(`viñetas ${a.id} y ${b.id} se superponen; declarar overlay en un inserto intencional`)
  }
  const coverage=slots.filter(s=>!s.overlay).reduce((sum,s)=>sum+s.width*s.height,0)
  if(coverage<500000)fail('la maquetación deja más de la mitad de la página vacía')
  return slots
}
/** CSS variables/geometry are generated only from validated numeric values and enumerated shapes. */
export function panelGeometry(slot,index) {
  const safe=strictlyValidSlot(slot,index)
  return `left:${safe.x/10}%;top:${safe.y/10}%;width:${safe.width/10}%;height:${safe.height/10}%;clip-path:${SHAPES[safe.shape]};z-index:${safe.overlay?index+10:1}`
}
/** True if a page contains at least one distinct non-rectangular shape (not merely a grid). */
export function hasDynamicPanels(page) { return resolvePageLayout(page).some(slot=>slot.shape!=='rectangle') }
/** Static supplementary CSS layered over the core Comic Studio stylesheet. */
export const EDITORIAL_CSS = `
.comic-page{display:block!important;padding:32px 32px 48px!important}
.panel-stage{position:relative;width:100%;height:100%;overflow:hidden;background:#fff}
.panel-stage>.panel{position:absolute;min-height:0;border:5px solid #141414;box-shadow:0 1px 3px #1119;overflow:hidden}
.panel[data-panel-shape="circle"],.panel[data-panel-shape="burst"]{filter:drop-shadow(2px 3px 1px #0009)}
.panel .art{width:100%;height:100%;object-fit:cover}
.panel .bubble{max-width:90%;font-size:clamp(10px,1.2vw,19px);padding:6px 9px;background:#fffffff2}
.panel .dialogues{inset:8px;gap:4px}
.panel .sfx{position:absolute;right:7%;bottom:8%;font:bold italic clamp(14px,3vw,46px) Impact,Arial Black,sans-serif;
color:#ffe80a;-webkit-text-stroke:2px #111;filter:drop-shadow(3px 3px 0 #a72616);transform:rotate(-12deg);pointer-events:none;z-index:4}
.comic-cover-page{position:relative;width:1200px;height:1800px;overflow:hidden;background:#080d19;color:white;
page-break-after:always;break-after:page;box-shadow:0 15px 60px #0005}
.comic-cover-page img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.comic-cover-page .cover-gradient{position:absolute;inset:0;background:linear-gradient(180deg,#000b 0%,transparent 27%,transparent 52%,#010711e8 96%)}
.comic-cover-page .cover-meta{position:absolute;inset:0;padding:5% 6%;display:flex;flex-direction:column;justify-content:space-between;z-index:1}
.comic-cover-page .masthead{margin:0;max-width:96%;text-transform:uppercase;font:900 100px/0.97 Impact,Arial Black,sans-serif;
letter-spacing:-2px;color:#fff;overflow-wrap:anywhere;text-shadow:6px 7px 0 #090909,-2px -2px 0 #090909,0 0 30px #101010}
.comic-cover-page .cover-topline{display:flex;justify-content:space-between;align-items:center;font:700 21px Arial,sans-serif;
text-shadow:1px 2px 2px black;margin:0 0 12px}
.comic-cover-page .issue-badge{display:inline-block;color:#171717;background:#f5c94b;border:5px solid #141414;border-radius:50%;
padding:15px;font:900 33px Impact,Arial,sans-serif}
.comic-cover-page .cover-bottom{padding:22px;background:#050b18dc;border-left:10px solid #f5c94b;max-width:89%}
.comic-cover-page .cover-title{font:900 61px/1.02 Impact,Arial Black,sans-serif;text-transform:uppercase;overflow-wrap:anywhere;margin:6px 0}
.comic-cover-page .cover-tagline{font:bold 28px/1.3 Arial,sans-serif;margin:8px 0}
.comic-cover-page .back-top{background:#080f22db;padding:25px;border-top:8px solid #f5c94b;max-width:75%;margin:0}
.comic-cover-page .back-heading{font:900 52px Impact,Arial,sans-serif;color:#ffe36a;margin:0 0 18px;text-transform:uppercase}
.comic-cover-page .back-text{font:27px/1.35 Arial,sans-serif;margin:0;white-space:pre-wrap;overflow-wrap:break-word}
.comic-cover-page .cover-foot{background:#080c19de;border-top:2px solid #f5c94b;padding:24px 26px;font:22px/1.4 Arial,sans-serif}
.comic-cover-page .cover-foot small{display:block;margin-top:8px;font-size:16px}
@page{size:12.5in 18.75in;margin:0}
@media print{.comic-cover-page{box-shadow:none}.comic-page{box-shadow:none}}
@media screen and (max-width:1240px){.comic-cover-page{width:100%;height:auto;aspect-ratio:2/3}.comic-cover-page .masthead{font-size:clamp(22px,7vw,100px)}
.comic-cover-page .cover-title{font-size:clamp(20px,4.7vw,61px)}.comic-cover-page .cover-tagline{font-size:clamp(11px,2.2vw,28px)}
.comic-cover-page .back-heading{font-size:clamp(15px,4vw,52px)}.comic-cover-page .back-text{font-size:clamp(9px,2.1vw,27px)}
.comic-cover-page .cover-foot{font-size:clamp(9px,1.7vw,22px)}.comic-cover-page .cover-foot small{font-size:clamp(7px,1.25vw,16px)}
.comic-cover-page .cover-topline{font-size:clamp(9px,1.6vw,21px)}.comic-cover-page .issue-badge{font-size:clamp(15px,2.7vw,33px);padding:1.2vw}}
`