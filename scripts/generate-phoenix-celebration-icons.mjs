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

function petals(x,y,color,scale=1,rotate=0){
 let p=`<g transform="translate(${x} ${y}) rotate(${rotate}) scale(${scale})">`;
 for(let i=0;i<6;i++)p+=`<ellipse cx="0" cy="-15" rx="8" ry="17" transform="rotate(${i*60})" fill="${color}" fill-opacity=".74" stroke="#FFFFFF" stroke-width="1.4"/>`;
 return p+`<circle r="6" fill="#F8DE9B" stroke="#C7A060" stroke-width="1.5"/></g>`;
}

function leafBranch(side,color,seed){
 const tx=side==="left"?"12":"500",mirror=side==="left"?"":"scale(-1 1)";
 let out=`<g transform="translate(${tx} 0) ${mirror}" fill="${color}" stroke="${color}" opacity=".88"><path d="M8 455 Q54 435 103 378" fill="none" stroke-width="3.4" stroke-linecap="round"/>`;
 for(let i=0;i<6;i++){
  let x=18+i*15,y=448-i*12,d=seed%2===0?1:-1;
  out+=`<ellipse cx="${x}" cy="${y-15}" rx="6.5" ry="15" transform="rotate(${-(26+i*5)} ${x} ${y-15})" opacity="${.57+i*.055}"/>`;
  out+=`<ellipse cx="${x+8}" cy="${y+9}" rx="5.5" ry="12" transform="rotate(${34+i*5} ${x+8} ${y+9})" opacity=".7"/>`;
 }
 return out+"</g>";
}

function star(x,y,size,color){
 const a=[];
 for(let i=0;i<10;i++){const theta=-Math.PI/2+i*Math.PI/5,rad=i%2===0?size:size*.43;a.push(`${(x+Math.cos(theta)*rad).toFixed(1)},${(y+Math.sin(theta)*rad).toFixed(1)}`)}
 return `<polygon points="${a.join(" ")}" fill="${color}" stroke="#FFF5DA" stroke-width="1.2"/>`;
}

function sparkle(x,y,color,size=11){
 return `<path d="M${x} ${y-size} Q${x+1.4} ${y-1.4} ${x+size} ${y} Q${x+1.4} ${y+1.4} ${x} ${y+size} Q${x-1.4} ${y+1.4} ${x-size} ${y} Q${x-1.4} ${y-1.4} ${x} ${y-size}Z" fill="${color}" opacity=".82"/>`;
}

function swash(primary,secondary,seed){
 const k=(seed%31)-15;
 return `<g opacity=".88">
 <path d="M76 447 Q175 ${417+k} 248 446 Q321 ${474-k} 436 437" fill="none" stroke="${primary}" stroke-width="6" stroke-linecap="round"/>
 <path d="M91 459 Q169 ${442+k} 247 462 Q334 ${480-k} 414 449" fill="none" stroke="${secondary}" stroke-width="3" stroke-linecap="round"/>
 </g>`;
}

function iconSvg(e){
 const [a,b]=palette(e),seed=hash(e.id),style=seed%4,pattern=seed%3;
 const label=e.label.toLowerCase(),country=e.country;
 const full=e.theme==="patriotic"||/independ|patri|constituci|restauraci/.test(label);
 const mothers=/madres|mother/.test(label),fathers=/padres|father/.test(label);
 const christmas=/navidad|christmas|nochebuena/.test(label);
 const halloween=/halloween/.test(label);
 const cancer=/cáncer|cancer|sida|aids|tuberculosis|suicidio|violencia|holocausto/.test(label);
 const solemn=e.tone==="solemn"||cancer;
 const leaves = leafBranch("left",solemn?"#80929F":a,seed)+leafBranch("right",solemn?"#80929F":a,seed+1);
 let motif="";
 if(solemn){
  motif=`<g opacity=".60">${leaves}${sparkle(252,453,"#93A0A9",9)}</g>`;
 }else if(full){
  const color1=country==="DO"?"#1556A6":a,color2=country==="DO"?"#CD3F4B":b;
  motif=`${leaves}<path d="M78 435 Q145 405 248 440 Q351 474 436 428 L430 457 Q328 499 244 457 Q145 428 82 468Z" fill="${color1}" fill-opacity=".84" stroke="#E9D5B1" stroke-width="3"/>
  <path d="M78 450 Q152 419 250 457 Q348 487 431 441" fill="none" stroke="#FFF" stroke-width="10" opacity=".85"/>
  <path d="M82 460 Q156 433 244 466 Q357 493 427 455" fill="none" stroke="${color2}" stroke-width="7" opacity=".9"/>
  ${star(72,400,13,"#D8AF69")}${star(441,388,12,"#D8AF69")}`;
 }else if(mothers||/mujer|familia|niñ/.test(label)){
  motif=`${petals(98,415,a,.92,seed%36)}${petals(405,415,b,.8,25)}${petals(153,459,b,.65,10)}
   <path d="M213 455 C190 435 208 417 230 439 C250 416 277 431 256 457 L234 478Z" fill="${a}" fill-opacity=".87" stroke="#FFF" stroke-width="2"/>
   ${sparkle(371,465,"#D4B983",9)}`;
 }else if(fathers){
  motif=`<path d="M238 415 L276 415 L268 443 L246 443Z" fill="#123C75" stroke="#D4AD67" stroke-width="4"/>
  <path d="M249 444 L265 444 L280 479 L256 500 L231 478Z" fill="${a}" stroke="#D7BA82" stroke-width="3"/>
  ${leaves}${star(100,413,11,b)}${star(411,411,11,b)}`;
 }else if(christmas){
  motif=`${leafBranch("left","#2E8B67",seed)}${leafBranch("right","#2E8B67",seed)}
    <circle cx="105" cy="438" r="15" fill="#B93C45" stroke="#D7B96F" stroke-width="3"/>
    <circle cx="412" cy="444" r="15" fill="#B93C45" stroke="#D7B96F" stroke-width="3"/>
    <path d="M235 446 Q255 429 277 446 L255 470Z" fill="#A9393D" stroke="#D3A74F" stroke-width="3"/>
    ${star(254,488,17,"#E0B35C")}`;
 }else if(halloween){
  motif=`<path d="M94 470 Q102 415 126 424 Q147 407 153 470 Q128 484 94 470Z" fill="#D3873C" stroke="#9F5B25" stroke-width="4"/>
  <path d="M119 421 Q120 402 131 401" stroke="#397C54" stroke-width="6" fill="none"/>
  <path d="M101 455 l8 -8 8 8 M127 455 l8 -8 8 8 M107 464 Q125 478 141 461" stroke="#422D35" stroke-width="4" fill="none"/>
  ${sparkle(404,431,"#C78340",13)}<path d="M365 398 Q383 381 395 399 Q408 378 425 393 Q408 390 399 406 Q384 394 365 398Z" fill="#343047" opacity=".73"/>`;
 }else if(e.theme==="health"){
  motif=`<g stroke="${a}" fill="none" stroke-width="5" stroke-linecap="round">
   <path d="M108 393 V435 Q107 468 143 468 Q178 468 179 438 V414"/>
   <path d="M178 437 Q230 474 274 456"/>
   <circle cx="295" cy="459" r="19" fill="#D9F1EC" stroke="${a}"/>
   <path d="M354 446 H378 l9 -20 12 42 10 -22 h35" stroke-width="4"/></g>
   ${sparkle(79,440,b,10)}`;
 }else if(e.theme==="education"){
  motif=`<path d="M124 439 Q183 422 251 452 Q318 419 389 439 L389 481 Q323 463 251 488 Q182 464 124 481Z"
   fill="#EAD6B5" fill-opacity=".92" stroke="${a}" stroke-width="4"/>
   <path d="M251 452 L251 488 M142 451 Q191 438 233 464 M268 465 Q320 437 369 452"
   fill="none" stroke="#B48B51" stroke-width="2.5"/>
   ${star(114,426,11,"#CBAB61")}${star(405,427,12,"#CBAE67")}`;
 }else if(e.theme==="science"){
  let edges="";for(let k=0;k<5;k++){let yy=410+17*k,dx=14+(seed%6)*k;edges+=`<path d="M${28+dx} ${yy} H${105+dx} L${147+dx} ${460}" stroke="${k%2===0?a:b}" stroke-width="3" fill="none"/><circle cx="${28+dx}" cy="${yy}" r="5" fill="${a}"/>`;edges+=`<path d="M${484-dx} ${yy} H${407-dx} L${365-dx} 460" stroke="${k%2===0?a:b}" stroke-width="3" fill="none"/><circle cx="${484-dx}" cy="${yy}" r="5" fill="${a}"/>`}
  motif=`${edges}<rect x="222" y="437" width="69" height="64" rx="11" fill="#E5F1FA" fill-opacity=".94" stroke="${a}" stroke-width="5"/><rect x="236" y="450" width="41" height="38" rx="4" fill="${a}" opacity=".75"/>`;
 }else if(e.theme==="environment"){
  motif=`${leafBranch("left",a,seed)}${leafBranch("right",a,seed)}
    <path d="M239 485 Q208 453 223 423 Q253 416 285 437 Q297 477 259 491Z" fill="${a}" fill-opacity=".76" stroke="#D9E4C1" stroke-width="3"/>
    <path d="M229 446 L261 478 Q256 439 283 439" fill="none" stroke="#EFF4D9" stroke-width="3"/>`;
 }else if(e.theme==="equality"){
  motif=`${petals(97,437,a,.74,5)}${petals(408,437,a,.74,35)}
  <path d="M244 419 C227 440 248 449 254 457 C267 442 282 430 273 417 C259 407 235 418 240 435 C244 450 270 469 278 490"
  fill="none" stroke="${a}" stroke-width="20" stroke-linecap="round"/>
  ${sparkle(377,467,b,8)}`;
 }else if(e.theme==="new-year"){
  motif=`${swash(a,b,seed)}${star(99,423,13,"#D1A149")}${star(413,409,14,"#D1A149")}`;
  for(const [cx,cy] of [[73,374],[418,363]]){
    for(let i=0;i<12;i++){let an=i*Math.PI/6,x1=cx+Math.cos(an)*15,y1=cy+Math.sin(an)*15,x2=cx+Math.cos(an)*(28+seed%8),y2=cy+Math.sin(an)*(28+seed%8);motif+=`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${i%2?a:b}" stroke-width="3" stroke-linecap="round"/>`;}}
 }else if(e.theme==="peace"){
  motif=`${leaves}
  <path d="M231 461 Q246 439 253 435 Q270 443 287 445 Q267 450 267 468 Q253 483 231 461Z" fill="#ECF0F0" stroke="#8298A4" stroke-width="2"/>
  <path d="M247 445 Q235 418 217 411 Q219 439 245 460" fill="#F7FBFC" stroke="#8298A4" stroke-width="2"/>
  <path d="M278 459 Q307 441 318 438" stroke="#5E9367" stroke-width="3" fill="none"/>`;
 }else if(e.theme==="autumn"){
  motif=`<path d="M104 469 Q101 425 132 423 Q162 428 165 469 Q132 484 104 469Z" fill="#CB8B43" stroke="#AA662F" stroke-width="4"/>
   <path d="M132 423 Q130 404 140 400" fill="none" stroke="#59845C" stroke-width="6"/>
   ${leafBranch("right",a,seed)}${sparkle(406,427,b,13)}`;
 }else if(e.theme==="birthday"){
  motif=`${swash(a,b,seed)}<path d="M229 452 H280 V486 Q254 499 229 486Z" fill="#EEC898" stroke="#B88D51" stroke-width="4"/>
  <path d="M255 452 V426" stroke="#AF7047" stroke-width="5"/>${sparkle(255,411,"#F2AF48",15)}
  <circle cx="95" cy="417" r="25" fill="#DFB574" fill-opacity=".7"/><circle cx="411" cy="418" r="23" fill="#D49BB3" fill-opacity=".7"/>`;
 }else {
  motif=`${leaves}${swash(a,b,seed)}${sparkle(86,384,a,11)}${sparkle(426,390,b,10)}`;
 }
 const accents=solemn?"":`${sparkle(53+(seed%26),50+(seed%20),a,8)}${sparkle(435-(seed%24),59+(seed%17),b,7)}`;
 const extra=style===0?`<path d="M82 364 Q125 349 142 378" fill="none" stroke="${a}" stroke-width="2" opacity=".48"/>`:
 style===1?`<path d="M369 374 Q411 354 440 368" fill="none" stroke="${b}" stroke-width="2" opacity=".52"/>`:
 style===2?`${sparkle(134,376,b,7)}${sparkle(374,379,a,8)}`:
 `<circle cx="78" cy="381" r="3.5" fill="${a}"/><circle cx="433" cy="378" r="3.5" fill="${b}"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none" role="img" aria-label="${String(e.label).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
<g stroke-linejoin="round" stroke-linecap="round">${motif}${accents}${extra}</g></svg>`;
}
const catalog = readFileSync(resolve('packages/client/ui-conversation/src/client/skeleton/celebrations.ts'),'utf8')
const destination = resolve('apps/web/public/assets/celebrations')
mkdirSync(destination, {recursive:true})
const events = discover(catalog)
const names = new Set(events.map(e => e.id + '.svg'))
for(const name of readdirSync(destination)){if(name.endsWith('.svg') && !names.has(name))unlinkSync(resolve(destination,name))}
for(const event of events)writeFileSync(resolve(destination,event.id+'.svg'),iconSvg(event))
writeFileSync(resolve(destination,'manifest.json'),JSON.stringify(events,null,2)+'\\n')
console.log('PHOENIX Celebrations: '+events.length+' independent transparent SVG ornaments')
