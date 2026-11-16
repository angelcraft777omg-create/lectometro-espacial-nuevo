/* Lectómetro Espacial
   Toda la lógica de la web en el navegador. Los datos se guardan en el servidor:
   este archivo habla con api/index.php (PHP + base de datos) y se refresca solo. */
(function(){
'use strict';

/* ================= utilidades ================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Math.round(n).toLocaleString('es-ES');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const byName = (a, b) => a.name.localeCompare(b.name, 'es', {sensitivity:'base'});
const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-ES', {day:'numeric', month:'short'}); };
const words = t => String(t).trim().split(/\s+/).filter(Boolean).length;
const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);

/* ================= catálogo ================= */
const BONUS = 50;
const MIN_WORDS = 20;
const COLORS = ['#ffd447','#ff6f59','#4be0c2','#7cc4ff','#c59bff','#ff9ecb','#a8e05f','#ffa94d','#f5f2ff','#5ee6f0'];
const GENRES = {
  aventura:{n:'Aventura', e:'🗺️'}, miedo:{n:'Miedo', e:'👻'}, misterio:{n:'Misterio y thriller', e:'🕵️'},
  accion:{n:'Acción', e:'💥'}, fantasia:{n:'Fantasía', e:'🐉'}, ciencia:{n:'Ciencia ficción', e:'🤖'},
  humor:{n:'Humor', e:'😂'}, comic:{n:'Cómic', e:'💬'}, animales:{n:'Animales y naturaleza', e:'🐾'},
  real:{n:'Historias reales', e:'🌍'}, poesia:{n:'Poesía', e:'🎵'}, otro:{n:'Otro tipo', e:'📚'}
};
const CH_TYPES = {
  pages:{n:'Páginas leídas entre todos', u:'páginas'},
  books:{n:'Libros terminados entre todos', u:'libros'},
  readers:{n:'Tripulantes con al menos un libro terminado', u:'tripulantes'},
  reviews:{n:'Reseñas publicadas', u:'reseñas'}
};
const STATIONS = [
  {name:'Tierra', rank:'Cadete espacial', at:0, x:135, y:150, r:30, kind:'earth'},
  {name:'Luna', rank:'Explorador lunar', at:100, x:375, y:128, r:21, kind:'moon'},
  {name:'Marte', rank:'Piloto marciano', at:250, x:610, y:158, r:25, kind:'mars'},
  {name:'Cinturón de asteroides', rank:'Esquivador de asteroides', at:450, x:845, y:132, r:30, kind:'rocks', label:'Asteroides'},
  {name:'Júpiter', rank:'Navegante de Júpiter', at:700, x:780, y:352, r:37, kind:'jupiter'},
  {name:'Saturno', rank:'Surfista de anillos', at:1000, x:520, y:336, r:27, kind:'saturn'},
  {name:'Urano', rank:'Capitán del hielo', at:1400, x:265, y:358, r:24, kind:'uranus'},
  {name:'Neptuno', rank:'Comandante azul', at:1900, x:150, y:560, r:26, kind:'neptune'},
  {name:'Plutón', rank:'Pionero de Plutón', at:2500, x:470, y:548, r:16, kind:'pluto'},
  {name:'Galaxia Lectora', rank:'Leyenda galáctica', at:3200, x:815, y:556, r:34, kind:'galaxy'}
];
/* tramos de la ruta: curvas de Bézier entre parada y parada */
const SEGS = STATIONS.slice(0, -1).map((a, i) => {
  const b = STATIONS[i + 1];
  if (i === 3) return [a, {x:1005, y:150}, {x:985, y:372}, b];
  if (i === 6) return [a, {x:60, y:352}, {x:8, y:540}, b];
  const s = i % 2 ? 1 : -1, dx = b.x - a.x;
  return [a, {x:a.x + dx / 3, y:a.y + 46 * s}, {x:a.x + 2 * dx / 3, y:b.y - 46 * s}, b];
});
const bez = (p, t) => {
  const u = 1 - t;
  return {
    x: u*u*u*p[0].x + 3*u*u*t*p[1].x + 3*u*t*t*p[2].x + t*t*t*p[3].x,
    y: u*u*u*p[0].y + 3*u*u*t*p[1].y + 3*u*t*t*p[2].y + t*t*t*p[3].y
  };
};

/* ================= datos ================= */
/* Los datos viven en el servidor. Aquí se guarda la última copia recibida, ya lista para pintar. */
const API = 'api/index.php';
const REFRESCO = 8000; // cada cuántos milisegundos se pregunta al servidor si hay cambios
const COLLS = ['students', 'books', 'challenges', 'reviews', 'codes'];
const store = {students:[], books:[], challenges:[], reviews:[], codes:[]};
const LS_KEY = 'lectometro-espacial-v1';
let selected = null, session = null, ready = false, fresh = false, gateTeacher = false, gateKey = '', serverError = '';
let csrf = '', version = -1, cargando = false, otraVez = false;
let editingBook = null, editingCh = null;

const norm = {
  students: d => ({id:d.id, name:String(d.name || 'Sin nombre').slice(0, 40), color:Math.abs(Math.round(num(d.color))) % COLORS.length, createdAt:String(d.createdAt || '')}),
  codes: d => ({id:String(d.id), studentId:String(d.studentId || '')}),
  books: d => {
    const pages = clamp(Math.round(num(d.pages, 1)), 1, 5000);
    return {id:d.id, studentId:String(d.studentId || ''), title:String(d.title || 'Sin título').slice(0, 120), author:String(d.author || '').slice(0, 80),
      genre:GENRES[d.genre] ? d.genre : 'otro', pages, pagesRead:clamp(Math.round(num(d.pagesRead)), 0, pages),
      createdAt:String(d.createdAt || ''), updatedAt:String(d.updatedAt || d.createdAt || ''),
      log:Array.isArray(d.log) ? d.log.filter(x => x && typeof x === 'object').map(x => ({d:String(x.d || ''), p:Math.round(num(x.p))})).slice(-80) : []};
  },
  challenges: d => ({id:d.id, title:String(d.title || 'Reto').slice(0, 80), type:CH_TYPES[d.type] ? d.type : 'pages',
    target:clamp(Math.round(num(d.target, 1)), 1, 1000000), reward:String(d.reward || '').slice(0, 120), createdAt:String(d.createdAt || '')}),
  reviews: d => ({id:d.id, studentId:String(d.studentId || ''), title:String(d.title || 'Sin título').slice(0, 120), genre:GENRES[d.genre] ? d.genre : 'otro',
    pages:clamp(Math.round(num(d.pages, 1)), 1, 5000), stars:clamp(Math.round(num(d.stars, 3)), 1, 5), text:String(d.text || '').slice(0, 2000), createdAt:String(d.createdAt || ''),
    status:d.status === 'approved' ? 'approved' : 'pending', bookId:String(d.bookId || '')})
};

function setSync(state){
  const t = {loading:'Conectando…', cloud:'Datos al día', slow:'Sin conexión: reintentando…', error:'No se puede conectar'};
  $('#sync').dataset.state = state; $('#sync-text').textContent = t[state] || '';
}

/* Llama a la API. Con `get` hace una lectura; sin él, envía datos por POST. Si algo falla, lanza {mensaje, estado}. */
async function api(accion, datos, get){
  let r;
  try {
    r = await fetch(API + '?accion=' + accion + (get || ''), get != null
      ? {credentials:'same-origin', cache:'no-store'}
      : {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-CSRF-Token':csrf}, body:JSON.stringify(datos || {})});
  } catch (e) { throw {mensaje:'Sin conexión con el servidor. Comprueba internet y vuelve a probar.'}; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!j) throw {mensaje:'El servidor no ha respondido bien. Comprueba que la carpeta api/ está subida y que el alojamiento tiene PHP.', estado:r.status};
  if (!j.ok) throw {mensaje:j.error || 'No se ha podido completar.', estado:r.status};
  return j;
}
/* Pide los datos al servidor. Si nada ha cambiado desde la última vez, el servidor lo dice y no se repinta nada. */
async function cargar(forzar){
  if (cargando) { if (forzar) otraVez = true; return; }
  cargando = true;
  let pintar = !ready;
  try {
    const j = await api('estado', null, session && !forzar && version >= 0 ? '&v=' + version : '');
    serverError = ''; ready = true; fresh = true; setSync('cloud');
    if (!j.sin_cambios) {
      csrf = j.csrf || ''; version = j.rol ? j.version : -1;
      const d = j.datos || {};
      COLLS.forEach(c => { store[c] = Array.isArray(d[c]) ? d[c].map(x => norm[c](x)) : []; });
      applySession(j.rol === 'maestro' ? {role:'teacher'} : j.rol === 'alumno' ? {role:'student', id:String(j.yo)} : null);
      pintar = true;
    }
  } catch (e) {
    if (!ready) { serverError = e.mensaje; pintar = true; setSync('error'); } else setSync('slow');
  }
  cargando = false;
  if (pintar) renderAll();
  if (otraVez) { otraVez = false; return cargar(true); }
}
/* Envía un cambio y, si sale bien, vuelve a pedir los datos. Devuelve la respuesta, o null si falla (y avisa). */
async function enviar(accion, datos){
  try { const j = await api(accion, datos); await cargar(true); return j; }
  catch (e) { toast(e.mensaje); if (e.estado === 401 || e.estado === 403) cargar(true); return null; }
}

/* ================= acceso ================= */
const isTeacher = () => !!session && session.role === 'teacher';
const validCode = c => /^\d{4}$/.test(c);
const codeOf = id => (store.codes.find(c => c.studentId === id) || {}).id || '';
/* El servidor dice quién ha entrado; aquí solo se reacciona cuando cambia. */
function applySession(s){
  const igual = (!s && !session) || (!!s && !!session && s.role === session.role && s.id === session.id);
  session = s;
  if (igual) return;
  selected = s && s.role === 'student' ? s.id : null; gateTeacher = false;
  resetBookForm(); resetChForm(); $('#rv-form').reset(); showStep(1);
  route(); window.scrollTo(0, 0);
}
async function logout(){
  try { await api('salir'); } catch (e) {}
  version = -1; await cargar(true);
}
const bigRocket = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#0a0d2c" stroke="#3a428f" stroke-width="2"/><g transform="rotate(35 32 32)"><path d="M32 8c8 7 11 17 11 26v8H21v-8c0-9 3-19 11-26z" fill="#f5f2ff"/><circle cx="32" cy="26" r="5" fill="#4be0c2" stroke="#0b0f33" stroke-width="2"/><path d="M21 34l-8 10h8zM43 34l8 10h-8z" fill="#ff6f59"/><path d="M26 44h12l-6 13z" fill="#ffd447"/></g></svg>';
function renderGate(){
  let key;
  if (session) key = 'in';
  else if (serverError) key = 'error:' + serverError;
  else if (!ready) key = 'loading';
  else key = gateTeacher ? 'teacher' : 'login';
  document.body.classList.toggle('gated', key !== 'in');
  if (key === gateKey) return;
  gateKey = key;
  const el = $('#gate-card');
  if (key === 'in') { el.innerHTML = ''; return; }
  if (key === 'loading') { el.innerHTML = bigRocket + '<h2>Lectómetro Espacial</h2><p class="note">Conectando con la nave nodriza…</p>'; return; }
  if (serverError) { el.innerHTML = bigRocket + '<h2>No se puede conectar</h2><p class="note">' + esc(serverError) + '</p><p class="gate-note">Se volverá a intentar sola en unos segundos.</p>'; return; }
  if (key === 'teacher') {
    el.innerHTML = bigRocket + '<h2>Entrada del maestro</h2><p class="note">Escribe tu clave de maestro.</p>'
      + '<form data-form="teacher-login"><div class="field"><label for="gate-pass">Clave del maestro</label><input type="password" id="gate-pass" autocomplete="current-password" style="font:inherit;color:var(--ink);background:#0a0d2c;border:2px solid var(--line);border-radius:12px;padding:9px 12px;width:100%"></div>'
      + '<button class="btn" type="submit">Entrar como maestro</button><span class="err" id="gate-err" role="alert"></span></form>'
      + '<button type="button" class="linkbtn" data-act="gate-student">Tengo un código de tripulante</button>';
    $('#gate-pass').focus({preventScroll:true});
    return;
  }
  el.innerHTML = bigRocket + '<h2>Lectómetro Espacial</h2><p class="note">Escribe tu código de 4 cifras para subir a bordo.</p>'
    + '<form data-form="login"><label for="gate-code">Mi código</label><input type="text" id="gate-code" class="code-input" inputmode="numeric" maxlength="4" autocomplete="off" aria-describedby="gate-err"><button class="btn" type="submit">Entrar</button><span class="err" id="gate-err" role="alert"></span></form>'
    + '<button type="button" class="linkbtn" data-act="gate-teacher">Soy el maestro</button>';
  $('#gate-code').focus({preventScroll:true});
}
function applyRole(){
  const t = isTeacher(), s = session && session.role === 'student' ? student(session.id) : null;
  document.body.classList.toggle('is-teacher', t);
  document.body.classList.toggle('is-student', !!s);
  $('#h-lect').textContent = t ? 'Cuaderno de lecturas' : 'Mis libros';
  $('#lect-intro').textContent = t ? 'Registra el libro de cada tripulante y actualiza las páginas a medida que avanza. Su nave se mueve sola por el mapa.' : 'Estos son los libros que llevas apuntados. Cuando tu maestro actualiza tus páginas, tu nave avanza por el mapa.';
  $('#books-title').textContent = t ? 'Libros registrados' : 'Mis libros apuntados';
  const chip = $('#userchip'); chip.hidden = !session; $('#logout').hidden = !session;
  chip.innerHTML = t ? '<span class="dot sm" style="background:var(--sun)" aria-hidden="true">M</span>Modo maestro' : s ? dot(s, true) + esc(s.name) : '';
  $('#rv-as').textContent = s ? 'Vas a publicar como ' + s.name + '.' : '';
  $('#rv-publish').textContent = t ? 'Publicar reseña' : 'Enviar a mi maestro';
  $('#rv-intro').textContent = t ? 'Acepta las reseñas que envía la tripulación. También puedes escribir una en nombre de un tripulante: se publica al momento.' : 'Cuenta qué te ha parecido tu libro en cuatro etapas. Cuando tu maestro acepte la reseña, se publicará y sumarás los puntos del libro.';
}
/* ================= progreso ================= */
function locate(points){
  let i = 0;
  while (i < STATIONS.length - 1 && points >= STATIONS[i + 1].at) i++;
  const last = i === STATIONS.length - 1;
  return {idx:i, frac:last ? 0 : (points - STATIONS[i].at) / (STATIONS[i + 1].at - STATIONS[i].at), toNext:last ? 0 : STATIONS[i + 1].at - points};
}
function progress(){
  const m = new Map(store.students.map(s => [s.id, {pages:0, finished:0, books:[]}]));
  store.books.forEach(b => { const p = m.get(b.studentId); if (!p) return; p.pages += b.pagesRead; if (b.pagesRead >= b.pages) p.finished++; p.books.push(b); });
  m.forEach(p => { p.points = p.pages + p.finished * BONUS; Object.assign(p, locate(p.points)); });
  return m;
}
const initials = name => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
};
const student = id => store.students.find(s => s.id === id);
const approved = () => store.reviews.filter(r => r.status === 'approved');
const dot = (s, sm) => s
  ? '<span class="dot' + (sm ? ' sm' : '') + '" style="background:' + COLORS[s.color] + '" aria-hidden="true">' + esc(initials(s.name)) + '</span>'
  : '<span class="dot' + (sm ? ' sm' : '') + '" style="background:#8f97e6" aria-hidden="true">?</span>';
const starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9z"/></svg>';
const rocketSvg = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c5 4 7 10 7 15v4H9v-4c0-5 2-11 7-15z" fill="#f5f2ff" stroke="#0b0f33" stroke-width="1.5"/><circle cx="16" cy="13" r="3" fill="#4be0c2" stroke="#0b0f33" stroke-width="1.5"/><path d="M9 18l-5 6h5zM23 18l5 6h-5z" fill="#ff6f59" stroke="#0b0f33" stroke-width="1.2"/><path d="M12.5 22h7L16 30z" fill="#ffd447"/></svg>';

/* ================= mapa ================= */
function planet(s, i){
  const c = 'pc' + i, r = s.r;
  const clip = '<clipPath id="' + c + '"><circle r="' + r + '"/></clipPath>';
  switch (s.kind) {
    case 'earth': return clip + '<circle r="' + r + '" fill="#3d8bea"/><g clip-path="url(#' + c + ')" fill="#58c97a"><ellipse cx="-12" cy="-11" rx="14" ry="10"/><ellipse cx="15" cy="8" rx="11" ry="15"/><ellipse cx="-17" cy="20" rx="9" ry="6"/></g><circle r="' + r + '" fill="none" stroke="#bfe1ff" stroke-opacity=".55" stroke-width="2"/>';
    case 'moon': return '<circle r="' + r + '" fill="#d9dbe6"/><circle cx="-7" cy="-5" r="5" fill="#b4b7c9"/><circle cx="8" cy="4" r="4" fill="#b4b7c9"/><circle cx="-3" cy="10" r="2.5" fill="#b4b7c9"/><circle cx="7" cy="-10" r="2" fill="#b4b7c9"/>';
    case 'mars': return clip + '<circle r="' + r + '" fill="#e0623f"/><g clip-path="url(#' + c + ')"><ellipse cx="-8" cy="4" rx="9" ry="5" fill="#b9432a"/><ellipse cx="11" cy="-7" rx="6" ry="4" fill="#b9432a"/><ellipse cx="6" cy="15" rx="7" ry="3" fill="#b9432a"/><ellipse cx="0" cy="-25" rx="13" ry="5" fill="#fbe9df"/></g>';
    case 'rocks': return '<g fill="#a8937e" stroke="#5f5145" stroke-width="1.5" stroke-linejoin="round"><polygon points="-30,-6 -20,-16 -8,-12 -6,-1 -16,7 -27,4"/><polygon points="2,-22 14,-26 22,-17 16,-8 5,-10"/><polygon points="8,2 22,-2 31,8 25,19 11,17 5,9"/><polygon points="-14,13 -4,10 2,18 -5,26 -15,22"/><polygon points="-2,-6 5,-8 8,-2 3,3 -3,1"/></g>';
    case 'jupiter': return clip + '<circle r="' + r + '" fill="#e6bd8f"/><g clip-path="url(#' + c + ')"><rect x="-40" y="-24" width="80" height="8" fill="#c98f5e"/><rect x="-40" y="-6" width="80" height="11" fill="#b9774a"/><rect x="-40" y="16" width="80" height="7" fill="#c98f5e"/><ellipse cx="13" cy="10" rx="9" ry="5" fill="#d1553c"/></g>';
    case 'saturn': return clip + '<g transform="rotate(-14)"><ellipse rx="50" ry="13" fill="none" stroke="#f3dfa0" stroke-width="6"/><circle r="' + r + '" fill="#e8c56d"/><g clip-path="url(#' + c + ')"><rect x="-30" y="-9" width="60" height="6" fill="#d3a94a"/><rect x="-30" y="8" width="60" height="5" fill="#d3a94a"/></g><path d="M-50 0A50 13 0 0 0 50 0" fill="none" stroke="#f3dfa0" stroke-width="6"/></g>';
    case 'uranus': return '<g transform="rotate(14)"><ellipse rx="8" ry="38" fill="none" stroke="#d4f7f9" stroke-width="2.5"/><circle r="' + r + '" fill="#8fe3e8"/><path d="M0 -38A8 38 0 0 1 0 38" fill="none" stroke="#d4f7f9" stroke-width="2.5"/></g>';
    case 'neptune': return clip + '<circle r="' + r + '" fill="#3a5be0"/><g clip-path="url(#' + c + ')" fill="#fff" fill-opacity=".32"><ellipse cx="-6" cy="-9" rx="15" ry="3"/><ellipse cx="9" cy="6" rx="13" ry="2.5"/><ellipse cx="-10" cy="15" rx="9" ry="2"/></g>';
    case 'pluto': return clip + '<circle r="' + r + '" fill="#d8b89a"/><g clip-path="url(#' + c + ')"><ellipse cx="3" cy="5" rx="9" ry="7" fill="#f6e8d8"/></g>';
    default: return '<circle r="58" fill="url(#glow)"/><ellipse rx="46" ry="16" fill="none" stroke="#ffd447" stroke-width="4" transform="rotate(-20)" opacity=".9"/><ellipse rx="35" ry="11" fill="none" stroke="#ff9ecb" stroke-width="3.5" transform="rotate(28)" opacity=".9"/><ellipse rx="24" ry="8" fill="none" stroke="#7cc4ff" stroke-width="3" transform="rotate(75)" opacity=".9"/><circle r="9" fill="#fff6c4"/><g fill="#fff"><circle cx="-38" cy="-24" r="2"/><circle cx="40" cy="-20" r="1.6"/><circle cx="30" cy="28" r="2"/><circle cx="-30" cy="26" r="1.5"/></g>';
  }
}
function buildMap(){
  const route = SEGS.map((p, i) => (i ? '' : 'M' + p[0].x + ' ' + p[0].y) + 'C' + p[1].x + ' ' + p[1].y + ' ' + p[2].x + ' ' + p[2].y + ' ' + p[3].x + ' ' + p[3].y).join('');
  let h = '<defs><radialGradient id="glow"><stop offset="0" stop-color="#ffd447" stop-opacity=".45"/><stop offset="1" stop-color="#ffd447" stop-opacity="0"/></radialGradient></defs>';
  h += '<path class="route" d="' + route + '"/>';
  STATIONS.forEach((s, i) => {
    const ly = (s.kind === 'galaxy' ? 44 : s.kind === 'uranus' ? 40 : s.r) + 22;
    h += '<g transform="translate(' + s.x + ' ' + s.y + ')">' + planet(s, i)
      + '<text class="st-name" y="' + ly + '" text-anchor="middle">' + esc(s.label || s.name) + '</text>'
      + '<text class="st-at" y="' + (ly + 16) + '" text-anchor="middle">' + (s.at ? fmt(s.at) + ' puntos' : 'Salida') + '</text></g>';
  });
  h += '<g id="tokens"></g>';
  $('#map').innerHTML = h;
}
function ringLayout(n, cx, cy, r0, arc){
  /* arc: reparte en el arco superior (órbita); si no, en círculos completos */
  const out = []; let left = n, ring = 0;
  if (!arc && left) { out.push({x:cx, y:cy}); left--; }
  while (left > 0) {
    const r = arc ? r0 + ring * 30 : 30 * (ring + 1);
    const span = arc ? 220 : 360;
    const cap = Math.max(1, Math.floor((span * Math.PI / 180) * r / 31) + (arc ? 1 : 0));
    const k = Math.min(cap, left);
    const stepDeg = arc ? Math.min(k > 1 ? span / (k - 1) : 0, (31 / r) * 180 / Math.PI * 1.05) : 360 / k;
    const start = arc ? 90 - stepDeg * (k - 1) / 2 : -90;
    for (let j = 0; j < k; j++) {
      const a = (start + stepDeg * j) * Math.PI / 180;
      out.push({x:cx + r * Math.cos(a), y:cy - r * Math.sin(a)});
    }
    left -= k; ring++;
  }
  return out;
}
function renderTokens(prog){
  const g = $('#tokens'); if (!g) return;
  const orbit = STATIONS.map(() => []), clusters = [];
  store.students.slice().sort(byName).forEach(s => {
    const p = prog.get(s.id);
    if (p.frac < 0.12) { orbit[p.idx].push(s); return; }
    const pt = bez(SEGS[p.idx], 0.22 + 0.58 * ((p.frac - 0.12) / 0.88));
    let cl = clusters.find(c => Math.hypot(c.x - pt.x, c.y - pt.y) < 32);
    if (!cl) { cl = {x:pt.x, y:pt.y, list:[]}; clusters.push(cl); }
    cl.list.push(s);
  });
  const placed = [];
  orbit.forEach((list, i) => {
    const st = STATIONS[i], r0 = (st.kind === 'galaxy' ? 50 : st.kind === 'saturn' ? 40 : st.r) + 22;
    ringLayout(list.length, st.x, st.y, r0, true).forEach((pt, j) => placed.push({s:list[j], x:pt.x, y:pt.y}));
  });
  clusters.forEach(c => ringLayout(c.list.length, c.x, c.y, 0, false).forEach((pt, j) => placed.push({s:c.list[j], x:pt.x, y:pt.y})));
  placed.sort((a, b) => (a.s.id === selected) - (b.s.id === selected));
  g.innerHTML = placed.map((t, n) => {
    const p = prog.get(t.s.id), st = STATIONS[p.idx];
    const where = p.frac < 0.12 ? 'en ' + st.name : 'entre ' + st.name + ' y ' + STATIONS[p.idx + 1].name;
    const label = t.s.name + ', ' + plural(p.points, 'punto estelar', 'puntos estelares') + ', ' + where;
    return '<g class="tok' + (t.s.id === selected ? ' sel' : '') + '" data-act="select" data-id="' + esc(t.s.id) + '" tabindex="0" role="button" aria-label="' + esc(label) + '" transform="translate(' + clamp(t.x, 18, 982).toFixed(1) + ' ' + clamp(t.y, 18, 642).toFixed(1) + ')">'
      + '<title>' + esc(label) + '</title><g class="tok-bob" style="animation-delay:-' + ((n * 0.37) % 3.6).toFixed(2) + 's">'
      + '<circle class="halo" r="19"/><circle r="14" fill="' + COLORS[t.s.color] + '" stroke="#0b0f33" stroke-width="2.5"/><text>' + esc(initials(t.s.name)) + '</text></g></g>';
  }).join('');
}
function renderDetail(prog){
  const el = $('#detail'), s = student(selected);
  if (!s) {
    selected = null;
    el.innerHTML = store.students.length
      ? '<h3>Diario de a bordo</h3><p class="note">Toca una nave del mapa o un nombre de la lista para ver por dónde va, cuántas páginas lleva y cuánto le falta para el siguiente planeta.</p>'
      : '<h3>Aún no hay tripulación</h3><p class="note">Añade a tu alumnado para que sus naves aparezcan en la Tierra, listas para despegar.</p><a class="btn teacher-only" href="#tripulacion">Añadir tripulantes</a>';
    return;
  }
  const p = prog.get(s.id), st = STATIONS[p.idx], next = STATIONS[p.idx + 1];
  const books = p.books.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  el.innerHTML = '<div class="who">' + dot(s) + '<div><h3>' + esc(s.name) + '</h3><span class="rank">' + esc(st.rank) + '</span></div></div>'
    + '<div class="kv"><div><b>' + fmt(p.points) + '</b><span>puntos estelares</span></div><div><b>' + fmt(p.finished) + '</b><span>libros terminados</span></div>'
    + '<div><b>' + fmt(p.pages) + '</b><span>páginas leídas</span></div><div><b>' + fmt(p.books.length - p.finished) + '</b><span>libros en marcha</span></div></div>'
    + (next
      ? '<div><p class="note">De ' + esc(st.name) + ' a ' + esc(next.name) + ': faltan <b>' + fmt(p.toNext) + '</b> puntos.</p><div class="bar" style="margin-top:6px"><i style="width:' + (p.frac * 100).toFixed(1) + '%"></i></div></div>'
      : '<p class="rank">Ha llegado a la Galaxia Lectora. Misión completada.</p>')
    + (books.length
      ? '<ul class="mini-list">' + books.map(b => '<li>' + esc(b.title) + '<span>' + (b.pagesRead >= b.pages ? 'terminado' : fmt(b.pagesRead) + ' / ' + fmt(b.pages)) + '</span></li>').join('') + '</ul>'
      : '<p class="note">Todavía no tiene libros registrados.</p>');
}
function renderCrew(prog){
  const el = $('#crew');
  if (!store.students.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1">La lista de la tripulación aparecerá aquí.</div>'; return; }
  el.innerHTML = store.students.slice().sort(byName).map(s => {
    const p = prog.get(s.id), st = STATIONS[p.idx], next = STATIONS[p.idx + 1];
    return '<button type="button" data-act="select" data-id="' + esc(s.id) + '" class="' + (s.id === selected ? 'sel' : '') + '">' + dot(s, true)
      + '<span class="nm">' + esc(s.name) + '</span>'
      + '<span class="bar' + (next ? '' : ' done') + '"><i style="width:' + (next ? p.frac * 100 : 100).toFixed(1) + '%"></i></span>'
      + '<span class="sub">' + esc(st.rank) + ' · ' + plural(p.points, 'punto', 'puntos') + (next ? ' · faltan ' + fmt(p.toNext) + ' para ' + esc(next.name) : '') + '</span></button>';
  }).join('');
}

/* ================= pintado general ================= */
function busy(container){
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT' && container.contains(a)) { container.dataset.dirty = '1'; return true; }
  return false;
}
function fillStudents(sel, first){
  const keep = sel.value;
  sel.innerHTML = '<option value="">' + esc(first) + '</option>' + store.students.slice().sort(byName).map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
  if (keep && student(keep)) sel.value = keep;
}
function renderStats(prog){
  let pages = 0, fin = 0;
  prog.forEach(p => { pages += p.pages; fin += p.finished; });
  $('#st-students').textContent = fmt(store.students.length);
  $('#st-books').textContent = fmt(fin);
  $('#st-students').nextElementSibling.textContent = store.students.length === 1 ? 'tripulante' : 'tripulantes';
  $('#st-books').nextElementSibling.textContent = fin === 1 ? 'libro terminado' : 'libros terminados';
  $('#st-pages').nextElementSibling.textContent = pages === 1 ? 'página leída' : 'páginas leídas';
  $('#st-reviews').nextElementSibling.textContent = approved().length === 1 ? 'reseña publicada' : 'reseñas publicadas';
  $('#st-pages').textContent = fmt(pages);
  $('#st-reviews').textContent = fmt(approved().length);
  return {pages, fin};
}
function renderRoster(prog){
  const el = $('#roster');
  $('#roster-count').textContent = store.students.length ? plural(store.students.length, 'tripulante', 'tripulantes') + ' en la misión' : '';
  $('#copy-codes').hidden = !store.students.length;
  if (busy(el)) return;
  if (!store.students.length) { el.innerHTML = '<div class="empty">Todavía no hay nadie en la tripulación. Pega la lista de clase en el recuadro de arriba y cada tripulante recibirá su código.</div>'; return; }
  el.innerHTML = store.students.slice().sort(byName).map(s => {
    const p = prog.get(s.id), nb = store.books.filter(b => b.studentId === s.id).length, nr = approved().filter(r => r.studentId === s.id).length;
    return '<div class="row">'
      + '<button type="button" class="colorbtn" data-act="color" data-id="' + esc(s.id) + '" title="Cambiar el color de la nave" aria-label="Cambiar el color de la nave de ' + esc(s.name) + '">' + dot(s) + '</button>'
      + '<div class="grow"><input type="text" data-rename="' + esc(s.id) + '" value="' + esc(s.name) + '" maxlength="40" aria-label="Nombre de ' + esc(s.name) + '">'
      + '<div class="sub">' + esc(STATIONS[p.idx].rank) + ' · ' + plural(p.points, 'punto', 'puntos') + ' · ' + plural(nb, 'libro', 'libros') + ' · ' + plural(nr, 'reseña', 'reseñas') + '</div></div>'
      + '<div class="acts"><span class="hint">Código</span><span class="code">' + esc(codeOf(s.id) || '····') + '</span>'
      + '<button type="button" class="btn small ghost" data-act="recode" data-id="' + esc(s.id) + '">Nuevo código</button>'
      + '<button type="button" class="btn small danger" data-act="del-student" data-id="' + esc(s.id) + '">Quitar</button></div></div>';
  }).join('');
}
function renderBooks(){
  fillStudents($('#book-student'), 'Elige tripulante…');
  fillStudents($('#book-filter'), 'Toda la tripulación');
  const el = $('#books'); if (busy(el)) return;
  const teacher = isTeacher(), f = teacher ? $('#book-filter').value : (session ? session.id : '');
  const list = store.books.filter(b => !f || b.studentId === f).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!list.length) {
    el.innerHTML = '<div class="empty">' + (!teacher ? 'Todavía no tienes libros apuntados. Avisa a tu maestro cuando empieces uno.' : store.books.length ? 'Este tripulante todavía no tiene libros.' : 'Aún no hay libros registrados. El primero que apuntes aparecerá aquí.') + '</div>';
    return;
  }
  el.innerHTML = list.map(b => {
    const s = student(b.studentId), done = b.pagesRead >= b.pages, g = GENRES[b.genre];
    return '<div class="row">' + dot(s, true)
      + '<div class="grow"><div class="ttl">' + esc(b.title) + '</div><div class="sub">' + (teacher ? esc(s ? s.name : 'Tripulante borrado') + ' · ' : '') + (b.author ? esc(b.author) + ' · ' : '') + g.e + ' ' + esc(g.n) + '</div></div>'
      + '<div class="book-prog"><div class="bar' + (done ? ' done' : '') + '"><i style="width:' + (b.pagesRead / b.pages * 100).toFixed(1) + '%"></i></div>'
      + '<span class="pill ' + (done ? 'ok' : 'go') + '" style="align-self:flex-start">' + (done ? 'Terminado' : 'Leyendo') + '</span></div>'
      + (teacher
        ? '<form class="pages-form" data-form="pages" data-id="' + esc(b.id) + '"><input type="number" name="read" min="0" max="' + b.pages + '" step="1" value="' + b.pagesRead + '" inputmode="numeric" aria-label="Páginas leídas de ' + esc(b.title) + '"><span>de ' + fmt(b.pages) + ' pág.</span><button class="btn small" type="submit">Actualizar</button></form>'
          + '<div class="acts"><button type="button" class="btn small ghost" data-act="edit-book" data-id="' + esc(b.id) + '">Editar</button>'
          + '<button type="button" class="btn small danger" data-act="del-book" data-id="' + esc(b.id) + '">Borrar</button></div>'
        : '<span class="pill">' + fmt(b.pagesRead) + ' de ' + fmt(b.pages) + ' páginas</span>')
      + '</div>';
  }).join('');
}
function challengeValue(type, prog, totals){
  if (type === 'pages') return totals.pages;
  if (type === 'books') return totals.fin;
  if (type === 'reviews') return approved().length;
  let n = 0; prog.forEach(p => { if (p.finished > 0) n++; }); return n;
}
function renderChallenges(prog, totals){
  const el = $('#missions');
  if (!store.challenges.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">Todavía no hay retos de grupo.<button type="button" class="btn teacher-only" data-act="suggest">Crear cuatro retos sugeridos</button></div>';
    return;
  }
  el.innerHTML = store.challenges.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(c => {
    const v = challengeValue(c.type, prog, totals), pct = clamp(v / c.target * 100, 0, 100), done = v >= c.target, t = CH_TYPES[c.type];
    return '<article class="card mission' + (done ? ' done' : '') + '"><div><h3>' + esc(c.title) + '</h3><span class="kind">' + esc(t.n) + '</span></div>'
      + '<div class="count">' + fmt(v) + ' <small>de ' + fmt(c.target) + ' ' + t.u + '</small></div>'
      + '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="' + c.target + '" aria-valuenow="' + Math.min(v, c.target) + '" aria-label="' + esc(c.title) + '"><i style="width:' + pct.toFixed(1) + '%"></i>' + rocketSvg.replace('<svg', '<svg style="left:clamp(16px,' + pct.toFixed(1) + '%,calc(100% - 8px))"') + '</div>'
      + (done ? '<span class="stamp">¡Misión cumplida!</span>' : '<span class="note">Faltan ' + fmt(c.target - v) + ' ' + t.u + '.</span>')
      + (c.reward ? '<p class="reward"><b>Recompensa:</b> ' + esc(c.reward) + '</p>' : '')
      + '<div class="acts teacher-only" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn small ghost" data-act="edit-ch" data-id="' + esc(c.id) + '">Editar</button><button type="button" class="btn small danger" data-act="del-ch" data-id="' + esc(c.id) + '">Borrar</button></div></article>';
  }).join('');
}
function bookFor(r){
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return store.books.find(x => x.id === r.bookId && x.studentId === r.studentId) || store.books.find(x => x.studentId === r.studentId && same(x.title, r.title));
}
const gainFor = r => { const b = bookFor(r); return b ? (b.pagesRead >= b.pages ? 0 : b.pages - b.pagesRead + BONUS) : r.pages + BONUS; };
function reviewCard(r, foot){
  const s = student(r.studentId), g = GENRES[r.genre];
  let st = ''; for (let i = 1; i <= 5; i++) st += starSvg.replace('<svg', '<svg class="' + (i <= r.stars ? 'f' : '') + '"');
  return '<article class="card review"><div class="who">' + dot(s, true) + '<div><b>' + esc(s ? s.name : 'Tripulante') + '</b><small>' + esc(day(r.createdAt)) + '</small></div></div>'
    + '<h3>' + esc(r.title) + '</h3>'
    + '<div class="meta"><span class="pill">' + g.e + ' ' + esc(g.n) + '</span><span class="pill">' + fmt(r.pages) + ' páginas</span><span class="stars" role="img" aria-label="' + r.stars + ' de 5 estrellas">' + st + '</span></div>'
    + '<p class="txt">' + esc(r.text) + '</p>' + foot + '</article>';
}
function renderReviews(){
  fillStudents($('#rv-student'), 'Elige tripulante…');
  fillReviewBooks();
  const teacher = isTeacher(), me = session && session.role === 'student' ? session.id : '';
  const byDate = (a, b) => b.createdAt.localeCompare(a.createdAt);
  /* bandeja del maestro */
  const pend = store.reviews.filter(r => r.status !== 'approved').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $('#rv-pending-card').hidden = !pend.length;
  $('#rv-pending-title').textContent = 'Reseñas por aceptar (' + pend.length + ')';
  const tab = document.querySelector('.tabs a[data-tab="resenas"]'), label = 'Reseñas' + (teacher && pend.length ? ' (' + pend.length + ')' : '');
  if (tab.textContent !== label) tab.textContent = label;
  $('#rv-pending').innerHTML = teacher ? pend.map(r => {
    const b = bookFor(r), gain = gainFor(r);
    const what = !b ? 'Se registrará «' + r.title + '» como libro terminado: +' + fmt(gain) + ' puntos.'
      : gain ? 'Su libro «' + b.title + '» pasará a terminado: +' + fmt(gain) + ' puntos.' : 'Su libro «' + b.title + '» ya estaba terminado: no suma puntos nuevos.';
    return reviewCard(r, '<p class="note">' + esc(what) + '</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-act="approve-review" data-id="' + esc(r.id) + '">Aceptar y sumar puntos</button>'
      + '<button type="button" class="btn small danger" data-act="del-review" data-id="' + esc(r.id) + '">Rechazar</button></div>');
  }).join('') : '';
  /* reseñas publicadas (y las propias que esperan) */
  const f = $('#rv-filter').value, pub = approved();
  const list = store.reviews.filter(r => (r.status === 'approved' || (me && r.studentId === me)) && (!f || r.genre === f))
    .sort((a, b) => (a.status === 'approved') - (b.status === 'approved') || byDate(a, b));
  $('#rv-feed-title').textContent = 'Reseñas publicadas (' + fmt(pub.length) + ')';
  const el = $('#reviews');
  if (!list.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1">' + (pub.length ? 'No hay reseñas de este tipo de libro todavía.' : 'Aún no hay reseñas publicadas. ¿Quién se anima con la primera?') + '</div>'; return; }
  el.innerHTML = list.map(r => reviewCard(r,
    (r.status !== 'approved' ? '<span class="pill go" style="align-self:flex-start">Esperando a que tu maestro la acepte</span>' : '')
    + (teacher || (me === r.studentId && r.status !== 'approved') ? '<div><button type="button" class="btn small danger" data-act="del-review" data-id="' + esc(r.id) + '">Borrar reseña</button></div>' : ''))).join('');
}
let raf = 0;
function renderAll(){
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderGate(); applyRole();
    const prog = progress(), totals = renderStats(prog);
    renderTokens(prog); renderDetail(prog); renderCrew(prog);
    renderRoster(prog); renderBooks(); renderChallenges(prog, totals); renderReviews();
    if (isTeacher()) renderInsights(prog);
  });
}
document.addEventListener('focusout', () => setTimeout(() => {
  const d = $$('[data-dirty]'); if (!d.length) return;
  d.forEach(el => delete el.dataset.dirty); renderAll();
}, 400));

/* ================= avisos ================= */
let toastTimer = 0;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}
/* borrar en dos pasos: el primer toque arma el botón, el segundo borra */
function armed(btn, text){
  if (btn.classList.contains('armed')) return true;
  btn.dataset.label = btn.textContent; btn.textContent = text; btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}

/* ================= tripulación ================= */
$('#student-form').addEventListener('submit', async e => {
  e.preventDefault();
  const names = $('#student-names').value.split(/\n|;/).map(n => n.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
  const err = $('#student-err'); err.textContent = '';
  if (!names.length) { err.textContent = 'Escribe al menos un nombre.'; return; }
  if (store.students.length + names.length > 60) { err.textContent = 'Como máximo caben 60 tripulantes.'; return; }
  if (await enviar('alumnos_crear', {nombres:names})) {
    $('#student-names').value = '';
    toast(names.length === 1 ? 'Tripulante añadido con su código.' : names.length + ' tripulantes añadidos, cada uno con su código.');
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset && t.dataset.rename) {
    const s = student(t.dataset.rename), name = t.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!s) return;
    if (!name || name === s.name) { t.value = s.name; return; }
    if (await enviar('alumno_guardar', {id:s.id, name})) toast('Nombre cambiado.'); else t.value = s.name;
  }
  if (t.id === 'book-filter') renderAll();
  if (t.id === 'idle-days') { try { localStorage.setItem(LS_KEY + '-dias', t.value); } catch (err) {} renderAll(); }
  if (t.id === 'rv-filter') renderAll();
  if (t.id === 'rv-student') { fillReviewBooks(true); }
  if (t.id === 'rv-book') { applyReviewBook(); }
  if (t.id === 'book-done') syncDone();
});

/* ================= lecturas ================= */
function syncDone(){
  const done = $('#book-done').checked, read = $('#book-read');
  if (done) { read.value = $('#book-pages').value || read.value; read.disabled = true; } else read.disabled = false;
}
$('#book-pages').addEventListener('input', () => { if ($('#book-done').checked) $('#book-read').value = $('#book-pages').value; });
function resetBookForm(){
  editingBook = null; $('#book-form').reset(); $('#book-read').disabled = false;
  $('#book-form-title').textContent = 'Registrar un libro'; $('#book-submit').textContent = 'Registrar libro';
  $('#book-cancel').hidden = true; $('#book-err').textContent = '';
}
$('#book-cancel').addEventListener('click', resetBookForm);
$('#book-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#book-err'); err.textContent = '';
  const studentId = $('#book-student').value, title = $('#book-title').value.trim();
  const pages = Math.round(num($('#book-pages').value)), done = $('#book-done').checked;
  const read = done ? pages : Math.round(num($('#book-read').value));
  if (!studentId) { err.textContent = 'Elige a qué tripulante pertenece el libro.'; return; }
  if (!title) { err.textContent = 'Escribe el título del libro.'; return; }
  if (!(pages >= 1 && pages <= 5000)) { err.textContent = 'Las páginas del libro deben estar entre 1 y 5000.'; return; }
  if (read < 0 || read > pages) { err.textContent = 'Las páginas leídas no pueden pasar de ' + pages + '.'; return; }
  const old = editingBook && store.books.find(b => b.id === editingBook);
  if (await enviar('libro_guardar', {id:old ? old.id : '', studentId, title, author:$('#book-author').value.trim(), genre:$('#book-genre').value, pages, pagesRead:read})) {
    toast(old ? 'Libro actualizado.' : (read >= pages ? 'Libro terminado. ¡Su nave avanza!' : 'Libro registrado. ¡Despegue!'));
    resetBookForm();
  }
});
document.addEventListener('submit', async e => {
  const f = e.target, kind = f.dataset && f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  if (kind === 'teacher-login' || kind === 'login') {
    const err = $('#gate-err'), btn = f.querySelector('button[type=submit]');
    const datos = kind === 'login' ? {codigo:$('#gate-code').value.trim()} : {clave:$('#gate-pass').value};
    if (kind === 'login' && !validCode(datos.codigo)) { err.textContent = 'El código tiene 4 cifras.'; return; }
    if (kind !== 'login' && !datos.clave) { err.textContent = 'Escribe tu clave de maestro.'; return; }
    err.textContent = ''; btn.disabled = true;
    try { await api(kind === 'login' ? 'entrar' : 'entrar_maestro', datos); version = -1; await cargar(true); }
    catch (ex) { err.textContent = ex.mensaje; btn.disabled = false; const g = $('#gate-code'); if (g) g.select(); }
    return;
  }
  if (kind !== 'pages') return;
  const b = store.books.find(x => x.id === f.dataset.id); if (!b) return;
  const read = Math.round(num(f.elements.read.value, -1));
  if (read < 0 || read > b.pages) { toast('Escribe un número entre 0 y ' + b.pages + '.'); return; }
  if (read === b.pagesRead) { toast('Ese libro ya tenía ' + read + ' páginas leídas.'); return; }
  const finishedNow = read >= b.pages && b.pagesRead < b.pages;
  if (await enviar('libro_paginas', {id:b.id, pagesRead:read}))
    toast(finishedNow ? '¡Libro terminado! 50 puntos de regalo.' : 'Páginas actualizadas.');
});

/* ================= retos ================= */
function resetChForm(){
  editingCh = null; $('#ch-form').reset();
  $('#ch-form-title').textContent = 'Crear un reto nuevo'; $('#ch-submit').textContent = 'Crear reto';
  $('#ch-cancel').hidden = true; $('#ch-err').textContent = '';
}
$('#ch-cancel').addEventListener('click', resetChForm);
$('#ch-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#ch-err'); err.textContent = '';
  const title = $('#ch-title').value.trim(), target = Math.round(num($('#ch-target').value));
  if (!title) { err.textContent = 'Ponle un nombre al reto.'; return; }
  if (!(target >= 1)) { err.textContent = 'El objetivo debe ser un número mayor que cero.'; return; }
  const old = editingCh && store.challenges.find(c => c.id === editingCh);
  if (await enviar('reto_guardar', {id:old ? old.id : '', title, type:$('#ch-type').value, target, reward:$('#ch-reward').value.trim()})) { toast(old ? 'Reto actualizado.' : 'Reto creado.'); resetChForm(); }
});

/* ================= reseñas ================= */
let step = 1;
function fillReviewBooks(force){
  if (session && session.role === 'student') $('#rv-student').value = session.id;
  const sel = $('#rv-book'), sid = $('#rv-student').value, keep = force ? '' : sel.value;
  sel.disabled = !sid;
  if (!sid) { sel.innerHTML = '<option value="">Primero elige tripulante…</option>'; $('#rv-title-field').hidden = true; return; }
  const mine = store.books.filter(b => b.studentId === sid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sel.innerHTML = (mine.length ? '<option value="">Elige uno de tus libros…</option>' : '')
    + mine.map(b => '<option value="' + esc(b.id) + '">' + esc(b.title) + '</option>').join('')
    + '<option value="otro">Otro libro (escribo yo el título)</option>';
  if (keep && (keep === 'otro' || mine.some(b => b.id === keep))) sel.value = keep;
  $('#rv-title-field').hidden = sel.value !== 'otro';
}
function applyReviewBook(){
  const v = $('#rv-book').value, b = store.books.find(x => x.id === v);
  $('#rv-title-field').hidden = v !== 'otro';
  if (b) {
    $('#rv-title').value = b.title; $('#rv-pages').value = b.pages;
    const r = document.querySelector('#rv-genres input[value="' + b.genre + '"]'); if (r) r.checked = true;
  } else if (v === 'otro') { $('#rv-title').value = ''; $('#rv-title').focus(); }
}
function reviewTitle(){
  const v = $('#rv-book').value, b = store.books.find(x => x.id === v);
  return b ? b.title : $('#rv-title').value.trim();
}
function checkStep(n){
  if (n === 1) {
    if (!$('#rv-student').value) return 'Elige de quién es la reseña.';
    if (!$('#rv-book').value) return 'Elige el libro del que vas a hablar.';
    if (!reviewTitle()) return 'Escribe el título de tu libro.';
  }
  if (n === 2 && !document.querySelector('#rv-genres input:checked')) return 'Elige qué tipo de libro es.';
  if (n === 3) {
    const p = Math.round(num($('#rv-pages').value));
    if (!(p >= 1 && p <= 5000)) return 'Escribe cuántas páginas tiene el libro.';
    if (!document.querySelector('#rv-stars input:checked')) return 'Elige cuántas estrellas le das.';
  }
  if (n === 4) {
    const w = words($('#rv-text').value);
    if (w < MIN_WORDS) return 'Te faltan ' + plural(MIN_WORDS - w, 'palabra', 'palabras') + ' para poder publicar.';
  }
  return '';
}
function showStep(n){
  step = n;
  $$('#rv-form .step').forEach(f => f.classList.toggle('on', Number(f.dataset.step) === n));
  $$('#rv-steps li').forEach((li, i) => { li.classList.toggle('now', i + 1 === n); li.classList.toggle('past', i + 1 < n); if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  $('#rv-back').hidden = n === 1; $('#rv-next').hidden = n === 4; $('#rv-publish').hidden = n !== 4;
  $('#rv-err').textContent = ''; updateCounter();
}
function updateCounter(){
  const w = words($('#rv-text').value), ok = w >= MIN_WORDS;
  $('#rv-count').textContent = w;
  const bar = $('#rv-bar'); bar.classList.toggle('done', ok); bar.firstElementChild.style.width = clamp(w / MIN_WORDS * 100, 0, 100) + '%';
  $('#rv-publish').disabled = !ok;
}
$('#rv-text').addEventListener('input', updateCounter);
$('#rv-next').addEventListener('click', () => {
  const m = checkStep(step); if (m) { $('#rv-err').textContent = m; return; }
  showStep(step + 1);
  const first = document.querySelector('#rv-form .step.on input, #rv-form .step.on textarea, #rv-form .step.on select'); if (first) first.focus();
});
$('#rv-back').addEventListener('click', () => showStep(step - 1));
$('#rv-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (step !== 4) { $('#rv-next').click(); return; }
  for (let n = 1; n <= 4; n++) { const m = checkStep(n); if (m) { showStep(n); $('#rv-err').textContent = m; return; } }
  const data = {studentId:$('#rv-student').value, bookId:store.books.some(b => b.id === $('#rv-book').value) ? $('#rv-book').value : '', title:reviewTitle(),
    genre:document.querySelector('#rv-genres input:checked').value, pages:Math.round(num($('#rv-pages').value)),
    stars:Number(document.querySelector('#rv-stars input:checked').value), text:$('#rv-text').value.trim()};
  const teacher = isTeacher(), gained = teacher ? gainFor(data) : 0; // el servidor decide: las del alumnado quedan pendientes
  $('#rv-publish').disabled = true;
  if (await enviar('resena_crear', data)) {
    $('#rv-form').reset(); fillReviewBooks(true); showStep(1);
    toast(teacher ? 'Reseña publicada.' + (gained ? ' Libro terminado: +' + fmt(gained) + ' puntos.' : '') : '¡Reseña enviada! Cuando tu maestro la acepte, sumarás los puntos del libro.');
    $('#rv-feed-title').scrollIntoView({behavior:'smooth', block:'start'});
  } else updateCounter();
});

const approving = new Set();

/* ================= acciones de botones ================= */
async function act(btn){
  const a = btn.dataset.act, id = btn.dataset.id;
  if (a === 'gate-teacher') { gateTeacher = true; renderAll(); return; }
  if (a === 'gate-student') { gateTeacher = false; renderAll(); return; }
  if (a === 'copy-codes') {
    const text = store.students.slice().sort(byName).map(s => s.name + ': ' + (codeOf(s.id) || 'sin código')).join('\n');
    try { navigator.clipboard.writeText(text).then(() => toast('Lista de códigos copiada. Pégala donde quieras.'), () => toast('No se ha podido copiar. Apunta los códigos de la lista.')); }
    catch (e) { toast('No se ha podido copiar. Apunta los códigos de la lista.'); }
    return;
  }
  if (a === 'recode') {
    const s = student(id); if (!s || !armed(btn, '¿Seguro? El código anterior dejará de valer')) return;
    if (await enviar('alumno_codigo', {id})) toast('Código nuevo para ' + s.name + '.');
    return;
  }
  if (a === 'select') { selected = selected === id ? null : id; renderAll(); return; }
  if (a === 'color') { const s = student(id); if (s) await enviar('alumno_guardar', {id, color:(s.color + 1) % COLORS.length}); return; }
  if (a === 'del-student') {
    const nb = store.books.filter(b => b.studentId === id), nr = store.reviews.filter(r => r.studentId === id);
    if (!armed(btn, nb.length || nr.length ? '¿Seguro? Se borran también sus ' + nb.length + ' libros y ' + nr.length + ' reseñas' : '¿Seguro? Toca otra vez')) return;
    if (await enviar('alumno_borrar', {id})) toast('Tripulante quitado de la misión.');
    return;
  }
  if (a === 'del-book') { if (armed(btn, '¿Seguro? Toca otra vez') && await enviar('libro_borrar', {id})) { if (editingBook === id) resetBookForm(); toast('Libro borrado.'); } return; }
  if (a === 'del-ch') { if (armed(btn, '¿Seguro? Toca otra vez') && await enviar('reto_borrar', {id})) { if (editingCh === id) resetChForm(); toast('Reto borrado.'); } return; }
  if (a === 'approve-review') {
    const r = store.reviews.find(x => x.id === id); if (!r || r.status === 'approved' || approving.has(id)) return;
    approving.add(id); btn.disabled = true;
    const gained = gainFor(r), s = student(r.studentId); // el servidor publica la reseña y deja el libro terminado
    if (await enviar('resena_aceptar', {id}))
      toast(gained ? 'Reseña aceptada. ' + (s ? s.name : 'El tripulante') + ' suma ' + fmt(gained) + ' puntos.' : 'Reseña aceptada. El libro ya estaba terminado, así que no suma puntos nuevos.');
    approving.delete(id); return;
  }
  if (a === 'del-review') { if (armed(btn, '¿Seguro? Toca otra vez') && await enviar('resena_borrar', {id})) toast('Reseña borrada.'); return; }
  if (a === 'edit-book') {
    const b = store.books.find(x => x.id === id); if (!b) return;
    editingBook = id; $('#book-student').value = b.studentId; $('#book-title').value = b.title; $('#book-author').value = b.author;
    $('#book-genre').value = b.genre; $('#book-pages').value = b.pages; $('#book-read').value = b.pagesRead; $('#book-done').checked = b.pagesRead >= b.pages; syncDone();
    $('#book-form-title').textContent = 'Editar libro'; $('#book-submit').textContent = 'Guardar cambios'; $('#book-cancel').hidden = false;
    $('#book-form-title').scrollIntoView({behavior:'smooth', block:'start'}); $('#book-title').focus({preventScroll:true});
    return;
  }
  if (a === 'edit-ch') {
    const c = store.challenges.find(x => x.id === id); if (!c) return;
    editingCh = id; $('#ch-title').value = c.title; $('#ch-type').value = c.type; $('#ch-target').value = c.target; $('#ch-reward').value = c.reward;
    $('#ch-form-title').textContent = 'Editar reto'; $('#ch-submit').textContent = 'Guardar cambios'; $('#ch-cancel').hidden = false;
    $('#ch-form-title').scrollIntoView({behavior:'smooth', block:'start'}); $('#ch-title').focus({preventScroll:true});
    return;
  }
  if (a === 'suggest') {
    if (!await enviar('retos_sugeridos')) return;
    toast('Retos creados. Puedes editarlos cuando quieras.');
  }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g.tok')) { e.preventDefault(); act(e.target); }
});

/* ================= pestañas y modo profe ================= */
const TABS = ['mapa', 'tripulacion', 'lecturas', 'retos', 'resenas', 'seguimiento'];
function route(){
  const h = location.hash.replace('#', '');
  let tab = TABS.includes(h) ? h : 'mapa';
  if ((tab === 'tripulacion' || tab === 'seguimiento') && !isTeacher()) tab = 'mapa';
  TABS.forEach(t => $('#view-' + t).classList.toggle('on', t === tab));
  $$('.tabs a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
window.addEventListener('hashchange', route);
$('#logout').addEventListener('click', logout);

/* ================= seguimiento (solo maestro) ================= */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9'], OTHER = '#7d8194', SURFACE = '#171c52';
const DONUT = ['aventura', 'miedo', 'misterio', 'accion', 'fantasia', 'humor', 'comic'];
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const weekStart = d => { const x = dayStart(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
const shortDate = d => d.toLocaleDateString('es-ES', {day:'numeric', month:'short'});
const lastMove = b => (b.log.length ? b.log[b.log.length - 1].d : b.updatedAt) || b.createdAt;
function ring(a0, a1, R, r){
  const pt = (a, rad) => (100 + rad * Math.cos(a)).toFixed(2) + ' ' + (100 + rad * Math.sin(a)).toFixed(2);
  if (a1 - a0 >= Math.PI * 2 - 0.0001) {
    const m = a0 + Math.PI;
    return 'M' + pt(a0, R) + 'A' + R + ' ' + R + ' 0 1 1 ' + pt(m, R) + 'A' + R + ' ' + R + ' 0 1 1 ' + pt(a0, R) + 'ZM' + pt(a0, r) + 'A' + r + ' ' + r + ' 0 1 0 ' + pt(m, r) + 'A' + r + ' ' + r + ' 0 1 0 ' + pt(a0, r) + 'Z';
  }
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return 'M' + pt(a0, R) + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + pt(a1, R) + 'L' + pt(a1, r) + 'A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + pt(a0, r) + 'Z';
}
function niceMax(v){
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function renderInsights(prog){
  const books = store.books.filter(b => prog.has(b.studentId));
  /* --- tipos de libro --- */
  const counts = {}; Object.keys(GENRES).forEach(k => counts[k] = 0);
  books.forEach(b => counts[b.genre]++);
  const total = books.length, pct = n => total ? Math.round(n / total * 100) + ' %' : '0 %';
  const colorOf = k => DONUT.indexOf(k) >= 0 ? SERIES[DONUT.indexOf(k)] : OTHER;
  $('#genre-note').textContent = total ? 'Según los ' + plural(total, 'libro registrado', 'libros registrados') + ', terminados o en marcha.' : 'Cuando registres libros, aquí verás qué tipos se leen más.';
  const otherKeys = Object.keys(GENRES).filter(k => DONUT.indexOf(k) < 0), otherN = otherKeys.reduce((n, k) => n + counts[k], 0);
  const parts = DONUT.map(k => ({n:counts[k], c:colorOf(k), tip:GENRES[k].n + ': ' + plural(counts[k], 'libro', 'libros') + ' (' + pct(counts[k]) + ')'}))
    .concat({n:otherN, c:OTHER, tip:'Otros tipos (' + otherKeys.filter(k => counts[k]).map(k => GENRES[k].n).join(', ') + '): ' + plural(otherN, 'libro', 'libros') + ' (' + pct(otherN) + ')'})
    .filter(x => x.n > 0);
  let a = -Math.PI / 2, svg = '<svg viewBox="0 0 200 200" role="img" aria-label="Diagrama circular de tipos de libro. Los datos están en la tabla de al lado.">';
  if (!total) svg += '<path d="' + ring(0, Math.PI * 2, 92, 58) + '" fill="#0a0d2c" fill-rule="evenodd" stroke="#3a428f"/>';
  parts.forEach(x => {
    const a1 = a + x.n / total * Math.PI * 2;
    svg += '<path class="mark" tabindex="0" d="' + ring(a, a1, 92, 58) + '" fill="' + x.c + '" fill-rule="evenodd" stroke="' + SURFACE + '" stroke-width="2" stroke-linejoin="round" data-tip="' + esc(x.tip) + '"/>';
    a = a1;
  });
  svg += '<text x="100" y="100" font-size="34" font-weight="800">' + fmt(total) + '</text><text x="100" y="122" font-size="14" font-weight="600" style="fill:var(--ink-soft)">' + (total === 1 ? 'libro' : 'libros') + '</text></svg>';
  $('#donut').innerHTML = svg;
  $('#genre-table').innerHTML = '<table class="gtable"><thead><tr><th scope="col">Tipo</th><th scope="col">Libros</th><th scope="col">Parte</th></tr></thead><tbody>'
    + Object.keys(GENRES).sort((x, y) => counts[y] - counts[x]).map(k => '<tr class="' + (counts[k] ? '' : 'zero') + '"><th scope="row"><span class="sw" style="background:' + colorOf(k) + '"></span>' + esc(GENRES[k].n) + '</th><td>' + fmt(counts[k]) + '</td><td class="pc">' + pct(counts[k]) + '</td></tr>').join('')
    + '</tbody></table>';

  /* --- páginas por semana --- */
  const now = new Date(), w0 = weekStart(now), weeks = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(w0); d.setDate(d.getDate() - 7 * i); weeks.push({d, n:0}); }
  books.forEach(b => {
    const log = b.log.length ? b.log : [{d:b.updatedAt, p:b.pagesRead}];
    let prev = 0;
    log.forEach(x => {
      const delta = x.p - prev; prev = x.p;
      const t = new Date(x.d); if (isNaN(t) || delta <= 0) return;
      const ws = weekStart(t).getTime(), w = weeks.find(k => k.d.getTime() === ws);
      if (w) w.n += delta;
    });
  });
  const top = niceMax(Math.max.apply(null, weeks.map(w => w.n))), X0 = 44, X1 = 512, Y0 = 18, Y1 = 176, step = (X1 - X0) / weeks.length, bw = step - 12;
  const peak = weeks.reduce((m, w) => w.n > m.n ? w : m, weeks[0]);
  let c = '<svg viewBox="0 0 520 210" role="img" aria-label="Gráfica de barras de páginas leídas por semana. Los datos están en la tabla de debajo.">';
  [0, 0.5, 1].forEach(f => { const y = Y1 - (Y1 - Y0) * f; c += '<line class="gridline" x1="' + X0 + '" x2="' + X1 + '" y1="' + y + '" y2="' + y + '"/><text x="' + (X0 - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + fmt(top * f) + '</text>'; });
  weeks.forEach((w, i) => {
    const x = X0 + step * i + 6, h = w.n ? Math.max(3, (Y1 - Y0) * w.n / top) : 0, y = Y1 - h, r = Math.min(4, h), last = i === weeks.length - 1;
    const tip = 'Semana del ' + shortDate(w.d) + ': ' + plural(w.n, 'página', 'páginas');
    if (h) c += '<path class="mark" tabindex="0" d="M' + x + ' ' + Y1 + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + r) + 'V' + Y1 + 'Z" fill="' + SERIES[0] + '" data-tip="' + esc(tip) + '"/>';
    c += '<rect x="' + (x - 6) + '" y="' + Y0 + '" width="' + step + '" height="' + (Y1 - Y0 + 24) + '" fill="transparent" data-tip="' + esc(tip) + '"/>';
    if (w.n && (w === peak || last)) c += '<text class="val" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + fmt(w.n) + '</text>';
    c += '<text x="' + (x + bw / 2) + '" y="' + (Y1 + 18) + '" text-anchor="middle">' + esc(last ? 'Esta sem.' : shortDate(w.d)) + '</text>';
  });
  $('#weeks').innerHTML = c + '</svg>';
  $('#weeks-table').innerHTML = '<table class="gtable"><thead><tr><th scope="col">Semana del</th><th scope="col">Páginas</th></tr></thead><tbody>'
    + weeks.map(w => '<tr><th scope="row">' + esc(shortDate(w.d)) + '</th><td>' + fmt(w.n) + '</td></tr>').join('') + '</tbody></table>';

  /* --- quién necesita un empujón --- */
  const limit = Number($('#idle-days').value) || 7, today = dayStart(now).getTime();
  const ico = {ok:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 12.2L2.6 8.4l1.5-1.5 2.3 2.3 5.5-5.5 1.5 1.5z"/></svg>',
    warn:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.9 3h1.8v3.6l2.6 1.6-.9 1.5-3.5-2.1z"/></svg>',
    bad:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 1l7.5 13h-15zm-.9 4.5h1.8v4.2H7.1zm0 5.4h1.8v1.8H7.1z"/></svg>'};
  const rows = store.students.map(s => {
    const mine = prog.get(s.id).books, current = mine.filter(b => b.pagesRead < b.pages).sort((x, y) => lastMove(y).localeCompare(lastMove(x)))[0];
    let lastT = 0; mine.forEach(b => { const t = new Date(lastMove(b)).getTime(); if (t > lastT) lastT = t; });
    const days = lastT ? Math.max(0, Math.round((today - dayStart(new Date(lastT)).getTime()) / 86400000)) : -1;
    const ago = days < 0 ? '' : days === 0 ? 'hoy' : days === 1 ? 'ayer' : 'hace ' + days + ' días';
    let level, label;
    if (!mine.length) { level = 'bad'; label = 'Sin libros registrados'; }
    else if (days >= limit) { level = days >= limit * 2 ? 'bad' : 'warn'; label = days + ' días sin actualizar'; }
    else if (!current) { level = 'warn'; label = 'Sin libro en marcha'; }
    else { level = 'ok'; label = 'Al día'; }
    const sub = !mine.length ? 'Todavía no ha empezado ningún libro.'
      : 'Último avance: ' + ago + (current ? ' · Leyendo «' + current.title + '» (' + fmt(current.pagesRead) + ' de ' + fmt(current.pages) + ')' : ' · Ha terminado todos sus libros');
    return {s, level, label, sub, days, order:level === 'bad' ? 0 : level === 'warn' ? 1 : 2};
  }).sort((x, y) => x.order - y.order || y.days - x.days || byName(x.s, y.s));
  const need = rows.filter(r => r.level !== 'ok').length;
  $('#idle-summary').textContent = !rows.length ? 'Añade a tu tripulación para ver aquí su actividad.'
    : need ? plural(need, 'tripulante necesita', 'tripulantes necesitan') + ' ánimo, de ' + rows.length + '. Aparecen primero.' : 'Toda la tripulación está al día.';
  $('#idle').innerHTML = rows.map(r => '<div class="row">' + dot(r.s, true) + '<div class="grow"><div class="ttl">' + esc(r.s.name) + '</div><div class="sub">' + esc(r.sub) + '</div></div><span class="status ' + r.level + '">' + ico[r.level] + esc(r.label) + '</span></div>').join('');
}
/* etiqueta flotante de las gráficas */
const tipEl = $('#tip');
function showTip(m, x, y){
  tipEl.textContent = m.dataset.tip; tipEl.classList.add('on');
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.transform = 'translate(' + clamp(x + 14, 8, window.innerWidth - w - 8) + 'px,' + clamp(y - h - 12, 8, window.innerHeight - h - 8) + 'px)';
}
document.addEventListener('pointermove', e => { const m = e.target.closest ? e.target.closest('[data-tip]') : null; if (m) showTip(m, e.clientX, e.clientY); else tipEl.classList.remove('on'); });
document.addEventListener('focusin', e => { const m = e.target.closest ? e.target.closest('[data-tip]') : null; if (m) { const r = m.getBoundingClientRect(); showTip(m, r.left + r.width / 2, r.top); } });
document.addEventListener('focusout', () => tipEl.classList.remove('on'));

/* ================= cielo ================= */
function sky(){
  const c = $('#stars'), dpr = Math.min(window.devicePixelRatio || 1, 2), w = window.innerWidth, h = window.innerHeight;
  c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const neb = (cx, cy, r, col) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(11,15,51,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); };
  neb(w * 0.85, h * 0.1, Math.max(w, h) * 0.5, 'rgba(75,224,194,.10)');
  neb(w * 0.08, h * 0.9, Math.max(w, h) * 0.55, 'rgba(255,111,89,.10)');
  let seed = 20261116; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const n = Math.round(w * h / 5200);
  for (let i = 0; i < n; i++) {
    const r = rnd() < 0.08 ? 1.7 : rnd() * 1.1 + 0.3;
    x.globalAlpha = 0.35 + rnd() * 0.65; x.fillStyle = rnd() < 0.15 ? '#ffd447' : rnd() < 0.2 ? '#9fd8ff' : '#ffffff';
    x.beginPath(); x.arc(rnd() * w, rnd() * h, r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
}
let skyTimer = 0;
window.addEventListener('resize', () => { clearTimeout(skyTimer); skyTimer = setTimeout(sky, 200); });

/* ================= arranque ================= */
$('#book-genre').innerHTML = Object.keys(GENRES).map(k => '<option value="' + k + '">' + esc(GENRES[k].n) + '</option>').join('');
$('#ch-type').innerHTML = Object.keys(CH_TYPES).map(k => '<option value="' + k + '">' + esc(CH_TYPES[k].n) + '</option>').join('');
$('#rv-filter').innerHTML = '<option value="">Todos los tipos de libro</option>' + Object.keys(GENRES).map(k => '<option value="' + k + '">' + esc(GENRES[k].n) + '</option>').join('');
$('#rv-genres').innerHTML = Object.keys(GENRES).map(k => '<label><input type="radio" name="rv-genre" id="rv-genre-' + k + '" value="' + k + '"><span class="em" aria-hidden="true">' + GENRES[k].e + '</span>' + esc(GENRES[k].n) + '</label>').join('');
$('#rv-stars').innerHTML = [5, 4, 3, 2, 1].map(n => '<input type="radio" name="rv-star" id="rv-star-' + n + '" value="' + n + '"><label for="rv-star-' + n + '" title="' + n + (n === 1 ? ' estrella' : ' estrellas') + '" aria-label="' + n + (n === 1 ? ' estrella' : ' estrellas') + '">' + starSvg + '</label>').join('');
try { const dd = localStorage.getItem(LS_KEY + '-dias'); if (dd && $('#idle-days option[value="' + dd + '"]')) $('#idle-days').value = dd; } catch (e) {}
buildMap(); sky(); route(); showStep(1);
/* Primer cargado, y luego se pregunta al servidor cada pocos segundos mientras la pestaña esté a la vista. */
cargar(true);
setInterval(() => { if (document.visibilityState === 'visible' && (session || !ready)) cargar(); }, REFRESCO);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) cargar(); });
})();
