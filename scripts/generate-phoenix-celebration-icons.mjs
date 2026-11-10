// Regenerate celebration overlays with: node scripts/generate-phoenix-celebration-icons.mjs
// Transparent SVG files are ornaments ONLY; the original phoenix-emblem.png is never modified.
import { readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
function hash(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;
  return h>>>0;
}

function discover(source){
  const rows=[];
  const fixed=/fixed\('([A-Z]+)',\s*`([\s\S]*?)`\)/g;
  for(const m of source.matchAll(fixed)){
    const code=m[1];
    const entries=m[2].trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    for(let i=0;i<entries.length;i++){
      const [mmdd,label,theme,tone]=entries[i].split("|");
      if(!/^\d\d-\d\d$/.test(mmdd))continue;
      rows.push({id:`${code.toLowerCase()}-${mmdd}-${i}`,country:code,label,theme:theme||"culture",tone:tone||"festive"});
    }
  }
  const nat=source.match(/const LATAM = \[([\s\S]*?)\] as const/);
  if(nat) {
    let i=0;for(const m of nat[1].matchAll(/\['([A-Z]{2})','(\d\d-\d\d)','([^']+)'\]/g))
      rows.push({id:`nation-${m[1]}-${i++}`,country:m[1],label:m[3],theme:"patriotic",tone:"festive"});
  }
  const mov=source.match(/const MOVABLE:[\s\S]*?= \[([\s\S]*?)\]\nfunction iso/);
  if(mov){
    const lines=mov[1].split("\n").filter(x=>x.trim().startsWith("{ country:"));
    for(let i=0;i<lines.length;i++){
      const line=lines[i],country=line.match(/country: '([^']+)'/)?.[1],label=line.match(/label: (["'])(.*?)\1/)?.[2],theme=line.match(/theme: '([^']+)'/)?.[1],tone=line.match(/tone: '([^']+)'/)?.[1],id=line.match(/id: '([^']+)'/)?.[1];
      if(country && label && theme) rows.push({id:id||`movable-${country}-${i}`,country,label,theme,tone:tone||"festive"});
    }
  }
  rows.push({id:"birthday",country:"PERSONAL",label:"Cumpleaños",theme:"birthday",tone:"festive"});
  rows.push({id:"personal-default",country:"PERSONAL",label:"Celebración personal",theme:"family",tone:"festive"});
  rows.push({id:"external-default",country:"WORLD",label:"Conmemoración nacional",theme:"culture",tone:"recognition"});
  const themes=["patriotic","family","new-year","winter","spring","culture","health","education","science","environment","equality","peace","autumn","birthday"];
  for(const theme of themes)rows.push({id:`fallback-${theme}`,country:"WORLD",label:theme,theme,tone:"recognition"});
  return [...new Map(rows.map(x=>[x.id,x])).values()].sort((a,b)=>a.id.localeCompare(b.id));
}

function palette(event){
 const country={
 DO:["#1557A0","#C83C45"],US:["#124A8C","#C5364A"],MX:["#008F65","#DA3B46"],
 HT:["#1243A0","#D53945"],CO:["#E3AD27","#1F5AA8"],VE:["#E4B62C","#C8434B"],
 AR:["#5B9BD0","#D9AB47"],BR:["#178459","#E5B939"],CL:["#2E5EAC","#D84249"],
 PE:["#CB3F45","#F1E6D0"],GT:["#65A6CC","#E2BE80"],CR:["#2159A6","#B93648"],
 SV:["#3677C6","#D3B56F"],HN:["#328BC0","#E2D1A5"],NI:["#397DBB","#E2C282"],
 PA:["#2E5EAD","#C84149"],EC:["#DDB536","#3558A0"],UY:["#5D9BC7","#E1BE7B"],
 PY:["#C83B45","#2F63AB"],CU:["#2E5C9D","#C74248"],BO:["#CB4242","#CEAE31"],
 GB:["#285F99","#C94758"],FR:["#2059A6","#CE4B50"],CA:["#B83748","#E4BC77"],
 JM:["#17735B","#D9BC4F"],BZ:["#275D9C","#CE4349"],TT:["#C33E49","#202A39"],
 GY:["#2A855F","#D9A93E"],SR:["#318557","#C13B48"]
 };
 const themes={
 "patriotic":["#C7A364","#4168A2"],"family":["#CB7893","#DEA8B6"],
 "new-year":["#D6AA57","#E2BC84"],"winter":["#1A8A72","#C84345"],
 "spring":["#B5A25E","#EDA7B7"],"culture":["#B69A75","#D7B36D"],
 "health":["#238A91","#78B4C1"],"education":["#C49A57","#D3AF6E"],
 "science":["#2879B7","#81B6DD"],"environment":["#398957","#80B67A"],
 "equality":["#9963B2","#D1A4E1"],"peace":["#668DA6","#AEC7B3"],
 "autumn":["#C47D3C","#9D5E32"],"birthday":["#D6A44C","#E2B9A5"]
 };
 return event.theme==="patriotic"?(country[event.country]||themes.patriotic):(themes[event.theme]||themes.culture);
}


/**
 * The emblem is intentionally the hero. Event motifs are paired, restrained
 * silver-line ornaments placed outside the phoenix silhouette rather than a
 * heavy sticker or a collection of circuitry beneath the tail.
 */
function glyphFor(event) {
  if (event.theme === 'science') {
    return '<ellipse rx="17" ry="7.2"/><ellipse rx="17" ry="7.2" transform="rotate(60)"/><ellipse rx="17" ry="7.2" transform="rotate(-60)"/><circle r="3.2" fill="currentColor" stroke="none"/>';
  }
  if (event.theme === 'health') {
    return '<path d="M0 14 C-19 3 -20 -9 -10 -12 C-4 -14 0 -9 0 -7 C2 -13 11 -15 16 -9 C21 -2 11 8 0 14Z"/><path d="M-9 1 h5 l3 -6 3 12 3 -6 h7" stroke-width="1.8"/>';
  }
  if (event.theme === 'education') {
    return '<path d="M0 -9 C-7 -14 -14 -14 -20 -10 v21 C-12 8 -5 9 0 14 C6 9 13 8 20 11 v-21 C13 -14 7 -14 0 -9Z"/><path d="M0 -9 V14"/>';
  }
  if (event.theme === 'environment' || event.theme === 'spring') {
    return '<path d="M-15 13 C-20 -2 -6 -18 19 -16 C18 8 5 19 -15 13Z"/><path d="M-15 13 C-5 0 5 -8 17 -14"/><path d="M-1 0 l-7 -7 M6 -6 l-1 9"/>';
  }
  if (event.theme === 'family') {
    return '<path d="M0 15 C-8 9 -18 2 -18 -7 C-18 -17 -6 -20 0 -10 C7 -20 19 -17 19 -7 C19 2 8 9 0 15Z"/>';
  }
  if (event.theme === 'peace') {
    return '<path d="M-13 17 Q-8 -4 16 -16"/><path d="M-6 6 Q-19 -2 -16 -11 Q-7 -9 -6 6Z"/><path d="M1 -2 Q-4 -17 5 -19 Q9 -10 1 -2Z"/><path d="M3 -3 Q15 -2 19 -11 Q10 -13 3 -3Z"/><path d="M-12 12 Q-20 5 -20 0 Q-12 1 -12 12Z"/>';
  }
  if (event.theme === 'patriotic') {
    return '<path d="M-13 16 V-17"/><path d="M-13 -15 Q-2 -21 13 -14 V3 Q0 -3 -13 3"/><path d="M-1 -12 l2.2 4 4.5 .5 -3.3 3.1 .9 4.5 -4.3 -2.3 -4.2 2.3 .9 -4.5 -3.2 -3.1 4.5 -.5Z" fill="currentColor" stroke="none"/>';
  }
  if (event.theme === 'equality') {
    return '<circle cx="-5.5" cy="-4.5" r="10.5"/><circle cx="6.5" cy="4.5" r="10.5"/><path d="M-18 16 H19"/>';
  }
  if (event.theme === 'winter') {
    return '<path d="M0 -19 V19 M-17 -10 L17 10 M-17 10 L17 -10"/><path d="M-5 -14 L0 -9 L5 -14 M-5 14 L0 9 L5 14 M-17 -3 L-11 -2 L-13 -8 M17 3 L11 2 L13 8 M-17 3 L-11 2 L-13 8 M17 -3 L11 -2 L13 -8"/>';
  }
  if (event.theme === 'autumn') {
    return '<path d="M0 -18 Q4 -8 12 -11 Q9 -3 19 2 Q8 4 10 13 Q3 10 0 19 Q-3 10 -10 13 Q-8 4 -19 2 Q-9 -3 -12 -11 Q-4 -8 0 -18Z"/><path d="M0 -3 V19"/>';
  }
  if (event.theme === 'birthday' || event.theme === 'new-year') {
    return '<path d="M0 -20 V20 M-20 0 H20 M-14 -14 L14 14 M14 -14 L-14 14"/><circle cx="0" cy="0" r="4" fill="currentColor" stroke="none"/>';
  }
  if (event.theme === 'culture') {
    return '<circle r="12"/><path d="M0 -19 V-12 M0 12 V19 M-19 0 H-12 M12 0 H19"/><circle r="4.5" fill="currentColor" stroke="none"/>';
  }
  return '<path d="M0 -17 Q3 -3 17 0 Q3 3 0 17 Q-3 3 -17 0 Q-3 -3 0 -17Z"/>';
}

function iconSvg(event) {
  const [primary] = palette(event);
  const solemn = event.tone === 'solemn';
  const ink = solemn ? '#83909A' : primary;
  const opacity = solemn ? '.40' : '.64';
  const line = solemn ? '#9AA1A5' : '#9D998F';
  const label = String(event.label)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const glyph = glyphFor(event);
  // Every coordinate on the right is the exact mirror of the left (x=256).
  // No ornaments beneath the tail; the bird, its silver ring and the greeting
  // remain visually dominant even on narrow screens.
  const top = solemn ? '' : '<path d="M96 78 Q97.7 88.3 108 90 Q97.7 91.7 96 102 Q94.3 91.7 84 90 Q94.3 88.3 96 78Z"/><path d="M416 78 Q417.7 88.3 428 90 Q417.7 91.7 416 102 Q414.3 91.7 404 90 Q414.3 88.3 416 78Z"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none" role="img" aria-label="' + label + '">'
    + '<g stroke="' + line + '" stroke-width="1.6" stroke-linecap="round" opacity=".36" fill="none">'
    + '<path d="M105 155 C91 180 86 205 87 228"/><path d="M407 155 C421 180 426 205 425 228"/>'
    + '<circle cx="118" cy="116" r="2"/><circle cx="394" cy="116" r="2"/>'
    + '</g>'
    + '<g fill="' + ink + '" opacity="' + (solemn ? '.18' : '.36') + '">' + top + '</g>'
    + '<g transform="translate(83 366)" color="' + ink + '" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="' + opacity + '">' + glyph + '</g>'
    + '<g transform="translate(429 366) scale(-1 1)" color="' + ink + '" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="' + opacity + '">' + glyph + '</g>'
    + '</svg>\n';
}

const catalog = readFileSync(resolve('packages/client/ui-conversation/src/client/skeleton/celebrations.ts'),'utf8')
const destination = resolve('apps/web/public/assets/celebrations')
mkdirSync(destination, {recursive:true})
const events = discover(catalog)
const names = new Set(events.map(e => e.id + '.svg'))
for(const name of readdirSync(destination)){if(name.endsWith('.svg') && !names.has(name))unlinkSync(resolve(destination,name))}
for(const event of events)writeFileSync(resolve(destination,event.id+'.svg'),iconSvg(event))
writeFileSync(resolve(destination,'manifest.json'),JSON.stringify(events,null,2)+'\n')
console.log('PHOENIX Celebrations: '+events.length+' independent transparent SVG ornaments')
