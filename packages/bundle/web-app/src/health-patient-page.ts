/**
 * Dedicated patient-facing pilot. HTML is intentionally separate from the
 * clinician console and general chat. No third-party scripts or localStorage.
 */
export function renderHealthPatientPage(nonce:string):string {
  if (!/^[A-Za-z0-9+/=]{16,64}$/u.test(nonce)) throw new Error('INVALID_CSP_NONCE')
  const html=String.raw`<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PHOENIX Healthia · Mi portal</title>
<style>
:root{color-scheme:light;font-family:Inter,"Segoe UI",system-ui,sans-serif;background:#f8f6f3;color:#292522}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px}main{max-width:850px;margin:32px auto}
header{display:flex;gap:15px;align-items:center;margin-bottom:26px}header span{display:grid;place-items:center;background:#fff0e6;color:#c64b1e;font-size:25px;width:58px;height:58px;border-radius:19px}
h1{font-size:28px;margin:0}h2{font-size:19px;margin:0 0 12px}p{line-height:1.6;color:#58524f}
.card{background:#fff;border:1px solid #e9dfd9;border-radius:18px;padding:22px;margin:15px 0;box-shadow:0 5px 19px rgba(50,40,30,.04)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px}
input,textarea{width:100%;padding:11px;border-radius:10px;border:1px solid #cbbfba;font:inherit;color:#292522}
textarea{min-height:76px;resize:vertical}
textarea:focus-visible{outline:3px solid #a95427;outline-offset:2px}
button{font:inherit;background:#c94d1e;color:white;border:0;border-radius:11px;padding:12px 16px;cursor:pointer;margin-top:14px}
button.secondary{background:#ede7e2;color:#332b25}button:focus-visible,input:focus-visible{outline:3px solid #a95427;outline-offset:2px}
small{color:#766d67}.hidden{display:none!important}.item{padding:14px;border:1px solid #eae2dc;border-radius:12px;margin-top:10px}
.notice{background:#fdf0e7;border-left:3px solid #c94d1e;padding:12px 15px}#message{min-height:28px;color:#9f321c}
</style></head><body><main>
<header><span aria-hidden="true">✚</span><div><h1>PHOENIX Healthia</h1><small>Mi portal de salud · acceso local protegido</small></div></header>
<div class="notice"><strong>Acceso privado.</strong> Solo se muestran documentos expresamente publicados por un profesional. No comparte información con el chat ni con otras instalaciones de PHOENIX.</div>
<p id="message" role="alert" aria-live="polite"></p>
<section id="auth" class="grid">
<form class="card" id="login"><h2>Ingresar</h2>
<label for="account">Identificador de acceso</label><input id="account" name="account" autocomplete="username" required maxlength="32">
<label for="password">Contraseña</label><input id="password" type="password" name="password" autocomplete="current-password" required minlength="16">
<button type="submit">Acceder a mi portal</button></form>
<form class="card" id="redeem"><h2>Activar invitación</h2>
<p>Solicita una invitación privada a tu profesional. Caduca en 15 minutos y se usa una sola vez.</p>
<label for="invite">Código de invitación</label><input id="invite" name="invite" required maxlength="64">
<label for="new-password">Crear contraseña de 16 caracteres o más</label><input id="new-password" type="password" name="password" autocomplete="new-password" required minlength="16">
<button type="submit">Activar acceso</button></form></section>
<section id="workspace" class="hidden">
<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
<div><h2>Mi información autorizada</h2><small>Documentos publicados explícitamente por mi profesional</small></div>
<button id="logout" class="secondary" type="button">Cerrar sesión</button></div>
<div id="feed"></div></div>
<form id="preconsultation" class="card">
<h2>Preparar mi próxima consulta</h2>
<p>Tu información se guardará cifrada como datos <strong>aportados por el paciente y pendientes de revisión</strong>.
No sustituye la valoración profesional. Ante una urgencia, utiliza los servicios de emergencia.</p>
<label for="p-complaint">¿Cuál es el motivo principal de tu consulta?</label>
<textarea id="p-complaint" name="complaint" maxlength="1600" required placeholder="Describe qué te ocurre con tus propias palabras"></textarea>
<div class="grid">
<div><label for="p-timeline">¿Cuándo comenzó y cómo ha evolucionado?</label>
<textarea id="p-timeline" name="timeline" maxlength="1600"></textarea></div>
<div><label for="p-symptoms">Otros síntomas que deseas comunicar</label>
<textarea id="p-symptoms" name="symptoms" maxlength="1600"></textarea></div>
<div><label for="p-medications">Medicamentos y suplementos que utilizas</label>
<textarea id="p-medications" name="medications" maxlength="1600"></textarea></div>
<div><label for="p-allergies">Alergias o reacciones que recuerdas</label>
<textarea id="p-allergies" name="allergies" maxlength="1600"></textarea></div>
</div>
<label for="p-questions">Preguntas que quieres hacer al equipo</label>
<textarea id="p-questions" name="questions" maxlength="1600"></textarea>
<button id="submit-preconsultation" type="submit">Enviar preparación protegida</button>
<p><small>Esta información no modifica tus antecedentes confirmados; un profesional deberá revisarla.</small></p>
</form>
<div class="card"><h2>Preparaciones enviadas</h2><div id="intake-list"></div></div>
</section>
<p><small>Este portal piloto funciona únicamente en la instalación clínica local, cuando un administrador lo habilita. No sustituye la consulta médica ni habilita acceso remoto.</small></p>
</main><script nonce="__NONCE__">
'use strict';
let csrf='';
const get=id=>document.getElementById(id);
function message(t){get('message').textContent=t}
async function api(route,method='GET',body){
 const res=await fetch('/health/patient/api/'+route,{
  method,cache:'no-store',credentials:'same-origin',
  headers:{accept:'application/json',...method==='GET'?{}:{'content-type':'application/json','x-phoenix-patient':'1',...csrf?{'x-phoenix-patient-csrf':csrf}:{}}},
  ...body===undefined?{}:{body:JSON.stringify(body)},
 });
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error('Solicitud rechazada ('+res.status+'). Comprueba las credenciales y vuelve a intentar.');
 return data;
}
function showAuth(){get('auth').classList.remove('hidden');get('workspace').classList.add('hidden');csrf=''}
function showWorkspace(){get('auth').classList.add('hidden');get('workspace').classList.remove('hidden')}
function renderFeed(items){
 const root=get('feed');root.replaceChildren();
 if(!Array.isArray(items)||items.length===0){const p=document.createElement('p');p.textContent='Aún no hay citas o recetas publicadas para esta cuenta.';root.append(p);return}
 for(const entry of items.slice(0,80)){
  const div=document.createElement('article');div.className='item';
  const title=document.createElement('strong');
  title.textContent=entry.kind==='appointment'?'Cita publicada':'Receta publicada';
  div.append(title);
  const main=document.createElement('p');
  main.textContent=entry.kind==='appointment'
    ? 'Fecha: '+String(entry.at||'Por confirmar')+' · Estado: '+String(entry.status||'')
    : String(entry.medication||'Medicamento')+' · '+String(entry.directions||'');
  div.append(main);root.append(div);
 }
}
async function refreshIntake(){
 const list=await api('intake');
 const root=get('intake-list');root.replaceChildren();
 if(!Array.isArray(list.items)||!list.items.length){
  const empty=document.createElement('p');empty.textContent='Todavía no has enviado información de preconsulta.';root.append(empty);return;
 }
 for(const item of list.items.slice(0,25)){
  const row=document.createElement('article');row.className='item';
  const name=document.createElement('strong');name.textContent=String(item.complaint??'Preconsulta');
  const status=document.createElement('p');status.textContent='Recibida: '+String(item.createdAt??'')+
    ' · '+(item.status==='reviewed'?'Revisada por profesional':'Pendiente de revisión');
  row.append(name,status);root.append(row);
 }
}
async function refresh(){
 try{
  const session=await api('session');
  csrf=session.csrf;
  const feed=await api('feed');
  showWorkspace();renderFeed(feed.items);
  await refreshIntake();
 }catch{showAuth()}
}
get('preconsultation').addEventListener('submit',async event=>{
 event.preventDefault();message('');
 const form=get('preconsultation'),button=get('submit-preconsultation');
 const answers={
  complaint:get('p-complaint').value,timeline:get('p-timeline').value,
  symptoms:get('p-symptoms').value,medications:get('p-medications').value,
  allergies:get('p-allergies').value,questions:get('p-questions').value,
 };
 if(!answers.complaint.trim()){message('Indica el motivo principal.');return;}
 button.disabled=true;
 try{
  await api('intake','POST',answers);form.reset();
  message('Preparación recibida. Tu equipo la revisará antes de incorporarla a la historia.');
  await refreshIntake();
 }catch(err){message(err.message)}
 finally{button.disabled=false}
});
get('login').addEventListener('submit',async event=>{
 event.preventDefault();message('');
 try{
  const x=await api('login','POST',{accountId:get('account').value,password:get('password').value});
  csrf=x.csrf;get('password').value='';await refresh();
 }catch(err){message(err.message)}
});
get('redeem').addEventListener('submit',async event=>{
 event.preventDefault();message('');
 try{
  const result=await api('redeem','POST',{invite:get('invite').value,password:get('new-password').value});
  get('invite').value='';get('new-password').value='';
  get('account').value=result.accountId;
  message('Cuenta activada. Conserva tu identificador de acceso en un lugar privado y entra con tu nueva contraseña.');
 }catch(err){message(err.message)}
});
get('logout').addEventListener('click',async()=>{
 try{await api('logout','POST',{})}catch{}
 showAuth();get('feed').replaceChildren();message('Sesión cerrada');
});
void refresh();
</script></body></html>`
  return html.replaceAll('__NONCE__',nonce)
}
