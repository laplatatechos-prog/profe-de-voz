// Profe de Voz — aprendé cualquier tema por módulos cortos, con exámenes y puntaje.
// Todo se guarda en este navegador (localStorage). La clave de API solo viaja a la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const APP_VERSION = 16;
const PALETTE = ['pink', 'mint', 'sky', 'lemon', 'lavender', 'peach'];
const tint = (i) => PALETTE[i % PALETTE.length];
const PASS = 6; // nota mínima para aprobar el examen de etapa

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Datos ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let subjects = store.get('subjects', []);
let settings = Object.assign({ key: '', rate: 1, voiceURI: '', autoRead: true, length: 'corto' }, store.get('settings', {}));
if (!settings.autoOn) { settings.autoRead = true; settings.autoOn = true; try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {} } // pedido: leer cada tema solo
settings.pitch = 1; // el tono grave sonaba mal: siempre tono natural
if (!settings.length) settings.length = 'corto';
const save = () => { store.set('subjects', subjects); store.set('settings', settings); };

// Adaptar áreas creadas con la versión anterior (etapas sin módulos).
for (const s of subjects) {
  s.current = s.current || 0;
  for (const st of s.stages) { st.exams = st.exams || []; if (st.history) delete st.history; }
}

// ---------- Claude ----------
async function askClaude(system, messages, maxTokens = 1200) {
  if (!settings.key) throw new Error('Primero cargá tu clave de Claude en Configuración (⚙︎ arriba a la derecha).');
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
    });
  } catch { throw new Error('No hay conexión a internet.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('La clave no es válida. Revisala en Configuración.');
    if (/credit/i.test(m)) throw new Error('Tu cuenta de Claude se quedó sin crédito. Cargá saldo en platform.claude.com.');
    throw new Error('Error de Claude: ' + m);
  }
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
async function askJSON(system, user, maxTokens = 2000) {
  const raw = await askClaude(system + '\nDevolvé SOLO JSON válido, sin texto antes ni después, sin ```.', [{ role: 'user', content: user }], maxTokens);
  const a = Math.min(...['{', '['].map((c) => raw.indexOf(c)).filter((i) => i >= 0));
  const b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  return JSON.parse(raw.slice(a, b + 1));
}
const lengthRule = (short = settings.length === 'corto') => short
  ? 'Muy breve y directo: entre 35 y 60 palabras, frases cortas y simples, la idea principal y un ejemplo de una línea. Nada de relleno.'
  : 'Entre 90 y 150 palabras, en 2 o 3 párrafos cortos, con un ejemplo concreto de la vida real.';
const TEACHER_BASE = 'Sos un profesor claro y paciente que enseña a una persona de Argentina. Hablale de vos, en español rioplatense. ' +
  'Tus textos también se leen en voz alta: no uses markdown, asteriscos, numerales, viñetas, tablas ni emojis.';
const teacher = () => TEACHER_BASE + (settings.name ? ` El alumno se llama ${settings.name}; usá su nombre de vez en cuando.` : '');

// ---------- Voz ----------
// Usa las voces gratis del navegador/teléfono, priorizando las más naturales.
const MALE = /\b(male|hombre|masculin|jorge|diego|pablo|alvaro|álvaro|raul|raúl|carlos|juan|enrique|alonso|tom[aá]s|gonzalo|andr[eé]s|jaime|jorge|miguel|antonio|federico|mateo|lucas|dario|darío|alejandro|gerardo|liam|arnau|teo|elias|elías|emilio|jos[eé]|manuel|nicol[aá]s|santiago)\b/i;
const FEMALE = /\b(female|mujer|femenin|helena|laura|sabina|paulina|m[oó]nica|elena|dalia|elvira|paloma|luc[ií]a|camila|valentina|marisol|paola|salome|salomé|ximena|abril|ana|carla|catalina|isabel|mar[ií]a|sof[ií]a|elsa|irene|lola|esperanza|monserrat)\b/i;
const QUALITY = /(natural|neural|online|google|premium|enhanced|mejorad)/i;
const genderOf = (v) => (MALE.test(v.name) ? 'hombre' : FEMALE.test(v.name) ? 'mujer' : '');
const qualityOf = (v) => (QUALITY.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);

let voices = [];
function loadVoices() { voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : []; }
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = () => { loadVoices(); if (view.name === 'settings') render(); };
  // En Android las voces a veces tardan en aparecer: reintentamos unos segundos.
  let tries = 0; const t = setInterval(() => { const n = voices.length; loadVoices(); if (voices.length !== n && view.name === 'settings') render(); if (++tries > 10) clearInterval(t); }, 500);
}
function spanishVoices() {
  return voices.filter((v) => /^es/i.test(v.lang)).sort((a, b) => qualityOf(b) - qualityOf(a) || /AR|419/i.test(b.lang) - /AR|419/i.test(a.lang) || a.name.localeCompare(b.name));
}
function currentVoice() {
  return voices.find((v) => v.voiceURI === settings.voiceURI) || spanishVoices()[0] || null;
}

let speakingBtn = null, speakToken = 0, audio = null;
function setSpeaking(on) {
  const b = document.getElementById('stopFab');
  if (b) b.classList.toggle('on', on);
}
function speak(text, btn) {
  setTimeout(() => setSpeaking(true), 0);
  const wasThis = speakingBtn && speakingBtn === btn;
  stopSpeaking();
  if (wasThis) return; // segundo toque = parar
  const clean = String(text).replace(/[*#_`]/g, '');
  speakingBtn = btn || null;
  if (btn) btn.textContent = '■ Parar';
  if (settings.engine === 'piper' && settings.piperVoice) speakPiper(clean, speakToken);
  else speakBrowser(clean);
}
function speakBrowser(clean) {
  if (!('speechSynthesis' in window)) return stopSpeaking();
  const sentences = clean.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const parts = [];
  for (const x of sentences) { if (parts.length && (parts[parts.length - 1] + x).length < 220) parts[parts.length - 1] += x; else parts.push(x); }
  const v = currentVoice();
  let i = 0;
  const next = () => {
    if (i >= parts.length) { stopSpeaking(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++].trim());
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-AR';
    u.rate = settings.rate || 1;
    u.onend = next; u.onerror = next;
    speechSynthesis.speak(u);
  };
  next();
}
// ---- Voces naturales Piper: se descargan una vez y funcionan dentro del navegador, gratis ----
const PIPER_VOICES = [
  { id: 'es_MX-ald-medium', name: 'Alejandro', gender: 'hombre', country: 'México', mb: 63 },
  { id: 'es_ES-davefx-medium', name: 'David', gender: 'hombre', country: 'España', mb: 63 },
  { id: 'es_ES-sharvard-medium', name: 'Sergio', gender: 'hombre', country: 'España', mb: 77 },
  { id: 'es_MX-claude-high', name: 'Claude', gender: '', country: 'México · alta calidad', mb: 63 },
];
let piperMod = null, piperSession = null, piperSessionVoice = null, piperStored = null;
const abs = (p) => new URL(p, location.href).href;
async function getPiper() {
  if (!piperMod) piperMod = await import('./vendor/piper/piper-tts-web.js');
  return piperMod;
}
async function piperSessionFor(voiceId, progress) {
  const m = await getPiper();
  if (piperSession && piperSessionVoice === voiceId) return piperSession;
  m.TtsSession._instance = null; // la librería reutiliza la sesión; forzamos una nueva al cambiar de voz
  piperSession = await m.TtsSession.create({
    voiceId, progress,
    wasmPaths: { onnxWasm: abs('vendor/ort/'), piperData: abs('vendor/piper/piper_phonemize.data'), piperWasm: abs('vendor/piper/piper_phonemize.wasm') },
  });
  piperSessionVoice = voiceId;
  return piperSession;
}
async function piperDownloaded() {
  if (piperStored) return piperStored;
  try { piperStored = await (await getPiper()).stored(); } catch { piperStored = []; }
  return piperStored;
}
function chunks(clean) {
  const sentences = clean.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const out = [];
  for (const x of sentences) { if (out.length && (out[out.length - 1] + x).length < 180) out[out.length - 1] += x; else out.push(x); }
  return out.map((x) => x.trim()).filter(Boolean);
}
function playBlob(blob) {
  return new Promise((res) => {
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.playbackRate = settings.rate || 1;
    audio.onended = () => { URL.revokeObjectURL(url); res(); };
    audio.onerror = () => res();
    audio.play().catch(() => res());
  });
}
async function speakPiper(clean, token) {
  const parts = chunks(clean);
  try {
    if (speakingBtn) speakingBtn.textContent = '… Preparando voz';
    const sess = await piperSessionFor(settings.piperVoice);
    let next = sess.predict(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const blob = await next;
      if (token !== speakToken) return;
      if (speakingBtn) speakingBtn.textContent = '■ Parar';
      if (i + 1 < parts.length) next = sess.predict(parts[i + 1]); // prepara la próxima frase mientras suena esta
      await playBlob(blob);
      if (token !== speakToken) return;
    }
    stopSpeaking();
  } catch (e) {
    console.error(e);
    if (token !== speakToken) return;
    toast('No pude usar la voz natural, uso la del teléfono.');
    speakBrowser(clean);
  }
}
function stopSpeaking() {
  speakToken++;
  if (audio) { audio.pause(); audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setSpeaking(false);
  if (speakingBtn) speakingBtn.textContent = '▶ Escuchar';
  speakingBtn = null;
}
function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:20px;background:#2b2b2b;color:#fff;padding:12px 16px;border-radius:12px;z-index:50;font-size:15px;text-align:center';
  document.body.appendChild(d); setTimeout(() => d.remove(), 4500);
}
const listenBtn = (id) => `<button class="soft speak-btn" data-speak="${id}">▶ Escuchar</button>`;

// ---------- Navegación ----------
let view = { name: 'home' };
const stack = [];
function go(name, params = {}, push = true) {
  stopSpeaking();
  document.querySelectorAll('.confetti').forEach((c) => c.remove());
  if (push) stack.push(view);
  view = { name, ...params };
  render(); window.scrollTo(0, 0);
}
function back() { stopSpeaking(); view = stack.pop() || { name: 'home' }; render(); window.scrollTo(0, 0); }
document.getElementById('backBtn').onclick = back;
document.getElementById('settingsBtn').onclick = () => go('settings');

function setHeader(title) {
  document.getElementById('title').textContent = title;
  document.getElementById('backBtn').classList.toggle('hidden', view.name === 'home');
  document.getElementById('settingsBtn').classList.toggle('hidden', view.name === 'settings');
}
const views = {};
function render() {
  (views[view.name] || views.home)();
  document.body.classList.toggle('has-answer', view.name === 'module' || view.name === 'exam');
  app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); // animación de entrada
}
// Pequeña vibración al tocar botones (en celulares que lo permiten).
document.addEventListener('pointerdown', (e) => { if (e.target.closest('button, .tap, .mod') && navigator.vibrate) { try { navigator.vibrate(8); } catch {} } });
function confetti() {
  const colors = ['#f6c344', '#ffffff', '#ff8fa3', '#7ad3a8', '#8fb8ff'];
  const box = document.createElement('div'); box.className = 'confetti';
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(c);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 4000);
}
const getSubj = () => subjects.find((s) => s.id === view.sid);

// ---------- Configuración ----------
views.settings = () => {
  setHeader('Configuración');
  const v = currentVoice();
  const list = spanishVoices();
  const label = (x) => `${x.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-\s*Spanish.*$/i, '')} · ${x.lang}${genderOf(x) ? ' · ' + genderOf(x) : ''}${QUALITY.test(x.name) ? ' ★' : ''}`;
  const COUNTRY = { AR: 'Argentina', ES: 'España', MX: 'México', US: 'Estados Unidos', '419': 'Latinoamérica', CO: 'Colombia', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', UY: 'Uruguay' };
  const country = (x) => COUNTRY[(x.lang.split(/[-_]/)[1] || '').toUpperCase()] || 'Español';
  app.innerHTML = `
    <h2>Voz</h2>
    <div class="card">
      <label style="margin-top:0">Voces naturales <span class="pill ok">gratis</span></label>
      <div class="voices">${PIPER_VOICES.map((p) => {
        const on = settings.engine === 'piper' && settings.piperVoice === p.id;
        const have = (piperStored || []).includes(p.id);
        const prog = view.dl && view.dl.id === p.id ? view.dl.pct : null;
        return `<button class="voice-btn ${on ? 'on' : ''}" data-piper="${p.id}">
          <span class="voice-ico">${p.gender === 'hombre' ? '👨' : '🎙️'}</span>
          <span class="voice-txt"><b>${p.name}${p.gender ? ' · Hombre' : ''}</b><span>${p.country} · ${prog != null ? `descargando ${prog}%` : have ? 'lista ✓' : `se descarga una vez (${p.mb} MB)`}</span></span>
          ${on ? '<span class="voice-check">✓</span>' : ''}
          ${prog != null ? `<span class="dl-bar" style="width:${prog}%"></span>` : ''}
        </button>`; }).join('')}</div>
      <label>Voces del teléfono</label>
      ${list.length ? `<div class="voices">${list.map((x, i) => `
        <button class="voice-btn ${settings.engine !== 'piper' && v && v.voiceURI === x.voiceURI ? 'on' : ''}" data-voice="${esc(x.voiceURI)}">
          <span class="voice-ico">${genderOf(x) === 'hombre' ? '👨' : genderOf(x) === 'mujer' ? '👩' : '🗣️'}</span>
          <span class="voice-txt"><b>Voz ${i + 1}${genderOf(x) ? ' · ' + (genderOf(x) === 'hombre' ? 'Hombre' : 'Mujer') : ''}</b><span>${country(x)}${QUALITY.test(x.name) ? ' · ★ natural' : ''}</span></span>
          ${settings.engine !== 'piper' && v && v.voiceURI === x.voiceURI ? '<span class="voice-check">✓</span>' : ''}
        </button>`).join('')}</div>`
        : `<div class="voices"><button class="voice-btn ${settings.engine !== 'piper' ? 'on' : ''}" data-voice=""><span class="voice-ico">🗣️</span><span class="voice-txt"><b>Voz del teléfono</b><span>Español</span></span>${settings.engine !== 'piper' ? '<span class="voice-check">✓</span>' : ''}</button></div>`}
      <label>Velocidad: <b id="rateVal">${settings.rate.toFixed(2)}x</b></label>
      <div class="row"><span class="muted small">Lenta</span><input class="grow" id="rate" type="range" min="0.6" max="1.8" step="0.05" value="${settings.rate}"><span class="muted small">Rápida</span></div>
      <label class="row" style="gap:10px;color:var(--text)"><input type="checkbox" id="autoRead" style="width:auto" ${settings.autoRead ? 'checked' : ''}> Leer cada tema en voz alta automáticamente</label>
      <div style="margin-top:14px"><button class="soft" id="testVoice">▶ Probar voz</button></div>
    </div>

    <h2>Tu nombre</h2>
    <div class="card"><div class="row"><input class="grow" id="nameSet" placeholder="Tu nombre" value="${esc(settings.name || '')}"><button class="soft" id="nameSave">Guardar</button></div></div>
    <h2>Clave de Claude</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Se guarda solo en este equipo.</p>
      <input id="keyInput" type="password" placeholder="sk-ant-..." autocomplete="off" value="${esc(settings.key)}">
      <div class="row" style="margin-top:10px"><button id="saveKey">Guardar</button><span id="keyMsg" class="muted"></span></div>
      <p class="muted small">Para sacarla: platform.claude.com → Claves (API Keys) → Crear clave. Empieza con sk-ant-.</p>
    </div>
    <h2>Borrar</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">Borra todas las áreas, módulos y puntajes guardados en este equipo. Tu clave y tu voz elegida quedan.</p>
      <button class="danger block" id="wipe">🗑️ Borrar todo lo aprendido</button>
    </div>
    <p class="muted small" style="text-align:center;margin-top:24px">Versión ${APP_VERSION}</p>
`;
  const $ = (id) => document.getElementById(id);
  app.querySelectorAll('[data-voice]').forEach((b) => b.onclick = () => {
    settings.voiceURI = b.dataset.voice; settings.engine = 'browser'; save(); render();
    speak('Hola, soy tu profe. Así suena mi voz.');
  });
  if (!piperStored) piperDownloaded().then(() => { if (view.name === 'settings' && !view.dl) render(); });
  app.querySelectorAll('[data-piper]').forEach((b) => b.onclick = async () => {
    if (view.dl) return;
    const id = b.dataset.piper;
    const have = (piperStored || []).includes(id);
    if (!have) {
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
      view.dl = { id, pct: 0 }; render();
      try {
        await piperSessionFor(id, (p) => {
          if (!p || !p.total || String(p.url).startsWith('tts://')) return;
          const pct = Math.min(99, Math.round((100 * p.loaded) / p.total));
          if (view.dl && pct !== view.dl.pct) { view.dl.pct = pct; const el = app.querySelector(`[data-piper="${id}"]`); if (el) { el.querySelector('.voice-txt span').textContent = `descargando ${pct}%`; const bar = el.querySelector('.dl-bar'); if (bar) bar.style.width = pct + '%'; } }
        });
        piperStored = null; await piperDownloaded();
        if (!piperStored.includes(id)) piperStored.push(id);
      } catch (e) {
        console.error(e); view.dl = null; render(); toast('No se pudo descargar la voz. Probá con WiFi.'); return;
      }
      view.dl = null;
    }
    settings.engine = 'piper'; settings.piperVoice = id; save(); render();
    speak('Hola, soy tu profe. Así suena mi voz.');
  });
  $('rate').oninput = (e) => { settings.rate = +e.target.value; $('rateVal').textContent = settings.rate.toFixed(2) + 'x'; save(); };
  $('rate').onchange = () => speak('Así suena esta velocidad.');
  $('autoRead').onchange = (e) => { settings.autoRead = e.target.checked; save(); };
  $('testVoice').onclick = () => speak('Hola, soy tu profe. Vamos a aprender juntos, de a poco.', $('testVoice'));
  $('nameSave').onclick = () => { settings.name = $('nameSet').value.trim(); save(); toast(settings.name ? `Listo, ${settings.name}.` : 'Nombre borrado.'); };
  $('wipe').onclick = () => {
    if (!confirm('¿Seguro que querés borrar todas las áreas y puntajes? No se puede deshacer.')) return;
    subjects = []; save(); stack.length = 0; view = { name: 'home' }; render(); toast('Listo, se borró todo.');
  };
  $('saveKey').onclick = async () => {
    settings.key = $('keyInput').value.trim(); save();
    $('keyMsg').textContent = 'Probando…';
    try { await askClaude('Respondé solo "ok".', [{ role: 'user', content: 'hola' }], 10); $('keyMsg').textContent = '✓ Funciona'; setTimeout(back, 700); }
    catch (e) { $('keyMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};

// ---------- Inicio ----------
views.home = () => {
  setHeader('Profe de Voz');
  const items = subjects.map((s) => {
    const done = s.stages.filter((x) => x.done).length;
    const avg = average(s.stages.map(stageScore).filter((x) => x != null));
    const scored = s.stages.filter((x) => stageScore(x) != null);
    const rows = scored.map((x) => { const best = stageScore(x);
      return `<div class="between score-row"><span>${esc(x.title)}</span><span class="pill ${best >= PASS ? 'ok' : 'bad'}">${fmt(best)}</span></div>`; }).join('');
    return `<div class="card tap tint-${tint(subjects.indexOf(s))}" data-sid="${s.id}">
      <div class="between"><b><span class="emoji">${s.emoji || '📘'}</span> ${esc(s.topic)}</b>${avg != null ? `<span class="pill ${avg >= PASS ? 'ok' : 'bad'}">${levelOf(avg)[2]} ${fmt(avg)}</span>` : ''}</div>
      <div class="bar"><div style="width:${(100 * done) / s.stages.length}%"></div></div>
      ${avg != null ? `<div class="small" style="margin-top:8px;font-weight:600">${levelOf(avg)[2]} ${levelOf(avg)[1]}</div>` : ''}
      <div class="muted small" style="margin-top:6px">Aprendiste ${done} de ${s.stages.length} etapas${scored.length ? ` · ${((n) => n + (n === 1 ? ' examen rendido' : ' exámenes rendidos'))(s.stages.reduce((n, x) => n + x.exams.length + (x.modules || []).reduce((a, m) => a + (m.scores || []).length, 0), 0))}` : ' · todavía sin exámenes'}</div>
      ${rows ? `<div class="score-list">${rows}</div>` : ''}</div>`;
  }).join('');
  app.innerHTML = `
    ${!settings.key ? `<div class="card" style="background:var(--accent-soft);border-color:transparent">Para empezar, cargá tu clave de Claude en <a href="#" id="toSettings">Configuración</a>.</div>` : ''}
    ${!settings.name ? `<div class="card name-card"><b>👋 ¡Hola! ¿Cómo te llamás?</b>
      <div class="row" style="margin-top:10px"><input class="grow" id="nameInput" placeholder="Tu nombre"><button id="nameGo">Listo</button></div></div>`
      : `<div class="hello">Hola, ${esc(settings.name)} 👋</div>`}
    <h2>Nuevo tema</h2>
    <div class="card">
      <div class="row"><input class="grow" id="topicInput" placeholder="¿Qué querés aprender? Ej: inteligencia artificial"><button id="topicGo">Crear</button></div>
      <div id="homeStatus" class="muted small" style="margin-top:8px"></div>
    </div>
    <h2>Mis áreas</h2>
    ${items || '<p class="muted">Todavía no agregaste ninguna.</p>'}`;
  const ng = document.getElementById('nameGo');
  if (ng) { const ni = document.getElementById('nameInput'); ni.onkeydown = (e) => { if (e.key === 'Enter') ng.click(); };
    ng.onclick = () => { const n = ni.value.trim(); if (!n) return; settings.name = n; save(); render(); speak(`Hola ${n}, soy tu profe. ¿Qué querés aprender hoy?`); }; }
  const ts = document.getElementById('toSettings'); if (ts) ts.onclick = (e) => { e.preventDefault(); go('settings'); };
  app.querySelectorAll('[data-sid]').forEach((el) => el.onclick = () => go('subject', { sid: el.dataset.sid }));
  const inp = document.getElementById('topicInput');
  inp.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('topicGo').click(); };
  document.getElementById('topicGo').onclick = () => { const t = inp.value.trim(); if (t) createSubject(t); };
};

async function createSubject(topic) {
  const st = document.getElementById('homeStatus'), btn = document.getElementById('topicGo');
  st.textContent = `Armando el temario de "${topic}"… (tarda unos segundos)`; btn.disabled = true;
  try {
    const j = await askJSON(
      'Sos un profesor experto que arma planes de estudio para un adulto hispanohablante que estudia desde el celular. ' +
      'Forma: {"topic":"nombre corto","emoji":"un emoji que represente el tema","description":"una frase","stages":[{"title":"...","summary":"una frase","modules":[{"title":"título corto y concreto"}]}]}. ' +
      'Entre 5 y 8 etapas, de lo básico a lo avanzado. Cada etapa con 3 a 5 módulos MUY cortos (cada uno se lee en 1 o 2 minutos).',
      'Quiero aprender: ' + topic, 3000);
    const s = {
      id: Date.now().toString(36), topic: j.topic || topic, emoji: j.emoji || '📘', description: j.description || '', current: 0,
      stages: j.stages.map((x) => ({ title: x.title, summary: x.summary, done: false, exams: [],
        modules: (x.modules || []).map((m) => ({ title: m.title || m, content: null, seen: false, chat: [] })) })),
    };
    subjects.unshift(s); save();
    go('subject', { sid: s.id });
  } catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; btn.disabled = false; }
}

// ---------- Área (temario) ----------
views.subject = () => {
  const s = getSubj(); if (!s) return go('home', {}, false);
  setHeader(s.topic);
  const done = s.stages.filter((x) => x.done).length;
  app.innerHTML = `
    <div class="card"><div class="muted">${esc(s.description)}</div><div class="bar"><div style="width:${(100 * done) / s.stages.length}%"></div></div>
      <div class="muted small" style="margin-top:6px">${done} de ${s.stages.length} etapas aprobadas</div></div>
    ${s.stages.map((st, i) => {
      const state = st.done ? 'done' : i === s.current ? 'current' : i > s.current ? 'locked' : '';
      const best = stageScore(st);
      const open = view.open === undefined ? state === 'current' : view.open === i;
      return `<div class="card ${state} stage-${tint(i)}">
        <div class="stage-head tap" data-toggle="${i}"><div class="num">${st.done ? '✓' : i + 1}</div>
          <div class="grow" style="flex:1"><b>${esc(st.title)}</b><div class="muted small">${esc(st.summary)}${state === 'locked' ? ' · 🔒 Se habilita al aprobar la anterior' : ''}</div></div>
          ${best != null ? `<span class="pill ${best >= PASS ? 'ok' : 'bad'}">${fmt(best)}</span>` : ''}</div>
        ${open && state !== 'locked' ? `
          <div class="modules">${(st.modules || []).map((m, k) => `<div class="mod ${modBest(m) >= PASS ? 'seen' : ''}" data-mod="${i}:${k}"><span class="dot">${modBest(m) >= PASS ? '⭐' : ''}</span><span style="flex:1">${esc(m.title)}</span>${modBest(m) != null ? `<span class="pill ${modBest(m) >= PASS ? 'ok' : 'bad'}">${fmt(modBest(m))}</span>` : ''}</div>`).join('')}
            ${!st.modules || !st.modules.length ? '<div class="muted small">Tocá "Empezar" para armar los módulos.</div>' : ''}</div>
          <div class="stage-actions">
            <button data-start="${i}">${(st.modules || []).some((m) => m.seen) ? 'Seguir' : 'Empezar'}</button>
          </div>` : ''}
      </div>`;
    }).join('')}
    <div style="text-align:center;margin-top:24px"><button class="plain small" id="delSubj">Borrar esta área</button></div>`;
  app.querySelectorAll('[data-toggle]').forEach((el) => el.onclick = () => {
    const i = +el.dataset.toggle;
    if (i > s.current && !s.stages[i].done) { return; }
    view.open = view.open === i ? -1 : i; render();
  });
  app.querySelectorAll('[data-mod]').forEach((el) => el.onclick = () => { const [i, k] = el.dataset.mod.split(':').map(Number); go('module', { sid: s.id, si: i, mi: k }); });
  app.querySelectorAll('[data-start]').forEach((el) => el.onclick = async () => {
    const i = +el.dataset.start, st = s.stages[i];
    if (!st.modules || !st.modules.length) {
      el.disabled = true; el.textContent = 'Armando módulos…';
      try { await ensureModules(s, i); } catch (e) { el.disabled = false; el.textContent = 'Empezar'; alertBox(e.message); return; }
    }
    const k = Math.max(0, st.modules.findIndex((m) => !(modBest(m) >= PASS)));
    go('module', { sid: s.id, si: i, mi: k });
  });
  document.getElementById('delSubj').onclick = () => {
    if (!confirm(`¿Borrar "${s.topic}" y todo su progreso?`)) return;
    subjects = subjects.filter((x) => x !== s); save(); stack.length = 0; go('home', {}, false);
  };
};
function alertBox(msg) { const d = document.createElement('div'); d.className = 'card err'; d.textContent = msg; app.prepend(d); window.scrollTo(0, 0); }

async function ensureModules(s, i) {
  const st = s.stages[i];
  if (st.modules && st.modules.length) return;
  const j = await askJSON(teacher(), `Tema: ${s.topic}. Etapa: "${st.title}" (${st.summary}). Dividila en 3 a 5 módulos MUY cortos. Forma: {"modules":[{"title":"..."}]}`, 800);
  st.modules = j.modules.map((m) => ({ title: m.title, content: null, seen: false, chat: [] }));
  save();
}

// ---------- Módulo: aprender conversando ----------
// El profe explica una idea en 1 o 2 frases y enseguida pregunta. Corrige, explica la siguiente idea y vuelve a preguntar.
// Son 2 pasos por módulo; si el alumno pide más detalle, recién ahí se extiende. Al final: puntaje, nivel y chiste.
const STEPS = 2;
function learnSystem(s, st, m) {
  return teacher() + `
Estás enseñando "${s.topic}". Etapa: "${st.title}". Módulo: "${m.title}".
Enseñás este módulo en ${STEPS} pasos, como una charla. En cada paso explicás UNA sola idea en 1 o 2 frases muy cortas (máximo 30 palabras en total) y enseguida hacés UNA pregunta corta sobre esa idea.
Siempre respondés SOLO con JSON válido, sin texto extra:
- Si el mensaje es "EMPEZAR": {"explain":"idea 1","question":"pregunta 1"}
- Si el alumno responde la pregunta: {"kind":"answer","correct":1-10,"clarity":1-10,"feedback":"una frase corta: si estuvo bien o qué faltó","explain":"siguiente idea (vacío si ya fue el último paso)","question":"siguiente pregunta (vacío si ya fue el último paso)"}
  "correct" = qué tan correcta es la respuesta. "clarity" = qué tan clara y precisa la explicó.
- Si el alumno NO responde sino que pregunta algo o pide más detalle: {"kind":"doubt","reply":"respondé su duda, acá sí podés extenderte un poco (máximo 70 palabras)","question":"repetí la pregunta pendiente"}`;
}
views.module = () => {
  const s = getSubj(); const st = s.stages[view.si]; const m = st.modules[view.mi];
  setHeader(`${view.si + 1}. ${st.title}`);
  if (!view.turns) { view.turns = []; view.msgs = []; view.answers = []; view.step = 1; view.type = 'modulo'; }
  app.innerHTML = `
    <div class="muted small">Módulo ${view.mi + 1} de ${st.modules.length} · Paso ${Math.min(view.step, STEPS)} de ${STEPS}</div>
    <div class="lesson-title">${esc(m.title)}</div>
    <div class="chat" id="chat"></div>
    <div id="learnStatus" class="loading hidden">Pensando…</div>
    <div class="row answer-row" id="answerRow">
      <textarea class="grow" id="ans" rows="2" placeholder="Respondé o preguntá lo que quieras"></textarea>
      <button id="send">Enviar</button>
    </div>`;
  drawTurns();
  const send = document.getElementById('send'), ans = document.getElementById('ans');
  ans.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } };
  send.onclick = () => { const t = ans.value.trim(); if (!t) return; ans.value = ''; learnTurn(s, st, m, t); };
  if (!view.turns.length) learnTurn(s, st, m, null);
};
function drawTurns() {
  const chat = document.getElementById('chat'); if (!chat) return;
  chat.innerHTML = view.turns.map((t, i) => t.role === 'me'
    ? `<div class="msg me">${esc(t.text)}</div>`
    : `<div class="msg ai">${t.score != null ? `<div class="mini-score ${t.score >= PASS ? 'ok' : 'bad'}">${levelOf(t.score)[2]} ${fmt(t.score)}</div>` : ''}${t.feedback ? `<div class="fb">${esc(t.feedback)}</div>` : ''}${t.explain ? `<div>${esc(t.explain)}</div>` : ''}${t.question ? `<div class="q">❓ ${esc(t.question)}</div>` : ''}
        <button class="plain small say" data-say="${i}">🔊</button></div>`).join('');
  chat.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => speak(turnText(view.turns[+b.dataset.say])));
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}
const turnText = (t) => [t.feedback, t.explain, t.question].filter(Boolean).join(' ');
async function learnTurn(s, st, m, text) {
  const keep = view;
  const status = document.getElementById('learnStatus'), send = document.getElementById('send');
  if (text != null) { view.turns.push({ role: 'me', text }); view.msgs.push({ role: 'user', content: text }); drawTurns(); }
  else view.msgs.push({ role: 'user', content: 'EMPEZAR' });
  status.classList.remove('hidden'); send.disabled = true; stopSpeaking();
  try {
    const sys = learnSystem(s, st, m) + `\nPaso actual: ${view.step} de ${STEPS}.`;
    const raw = await askClaude(sys + '\nDevolvé SOLO JSON válido.', view.msgs, 600);
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (view !== keep) return;
    view.msgs.push({ role: 'assistant', content: raw });
    let turn;
    if (text == null) turn = { role: 'ai', explain: j.explain, question: j.question };
    else if (j.kind === 'doubt') turn = { role: 'ai', explain: j.reply, question: j.question };
    else {
      const correct = clamp(j.correct), clarity = clamp(j.clarity);
      view.answers.push({ correct, clarity });
      const score = (correct + clarity) / 2;
      view.step++;
      if (view.step > STEPS || !j.question) {
        m.content = m.content || view.turns.filter((t) => t.explain).map((t) => t.explain).join(' ');
        view.lastFeedback = j.feedback;
        return finishExam(s);
      }
      turn = { role: 'ai', score, feedback: j.feedback, explain: j.explain, question: j.question };
    }
    view.turns.push(turn);
    render();
    if (settings.autoRead) speak(turnText(turn));
  } catch (e) {
    if (view !== keep) return;
    view.msgs.pop(); if (text != null) view.turns.pop(); drawTurns();
    status.classList.add('hidden'); send.disabled = false; alertBox(e.message);
  }
}

// ---------- Exámenes ----------
const EXAMS = {
  rapido: { name: 'Repaso rápido', n: 3, desc: '3 preguntas cortas para ver si te quedó lo principal.', unlocks: false },
  etapa: { name: 'Examen de la etapa', n: 5, desc: `5 preguntas. Si sacás ${PASS} o más, aprobás y se habilita la etapa siguiente.`, unlocks: true },
  integrador: { name: 'Examen integrador', n: 6, desc: 'Mezcla preguntas de todas las etapas que ya viste.', unlocks: false },
  practico: { name: 'Caso práctico', n: 2, desc: '2 situaciones reales donde tenés que aplicar lo aprendido.', unlocks: false },
};

EXAMS.modulo = { name: 'Examen del módulo', n: 2, desc: '', unlocks: false };
async function startModuleExam(s, si, mi, btn) {
  const m = s.stages[si].modules[mi];
  btn.disabled = true; btn.textContent = 'Preparando examen…';
  try {
    const j = await askJSON(teacher(), `Tema: ${s.topic}. El alumno acaba de leer este módulo, "${m.title}":\n${m.content}\n` +
      'Armá 2 preguntas abiertas y cortas sobre ESTE contenido, que se respondan en 1 o 2 frases. Forma: {"questions":["...","..."]}', 600);
    go('exam', { sid: s.id, si, mi, type: 'modulo', questions: j.questions.slice(0, 2), answers: [], idx: 0 }, false);
  } catch (e) { btn.disabled = false; btn.textContent = 'Listo, tomame examen →'; alertBox(e.message); }
}

views.examMenu = () => {
  const s = getSubj(), st = s.stages[view.si];
  setHeader('Exámenes');
  app.innerHTML = `
    <div class="muted">Etapa ${view.si + 1}: <b style="color:var(--text)">${esc(st.title)}</b></div>
    <p class="muted small">Respondé escribiendo o dictando con el teclado. Cada respuesta tiene dos notas del 1 al 10: <b>corrección</b> (si está bien) y <b>claridad</b> (si se entiende cómo lo explicás).</p>
    ${Object.entries(EXAMS).map(([k, e]) => `<button class="exam-type" data-type="${k}"><b>${e.name}</b><span>${e.desc}</span></button>`).join('')}
    ${st.exams.length ? `<h2>Tus notas en esta etapa</h2>${st.exams.slice().reverse().map((e) => `
      <div class="card between"><div><b>${esc(EXAMS[e.type]?.name || e.type)}</b><div class="muted small">${new Date(e.date).toLocaleDateString('es-AR')} · corrección ${fmt(e.correct)} · claridad ${fmt(e.clarity)}</div></div>
      <span class="pill ${e.score >= PASS ? 'ok' : 'bad'}">${fmt(e.score)}</span></div>`).join('')}` : ''}`;
  app.querySelectorAll('[data-type]').forEach((el) => el.onclick = () => startExam(s, view.si, el.dataset.type, el));
};

async function startExam(s, si, type, btn) {
  const st = s.stages[si], cfg = EXAMS[type];
  btn.disabled = true; btn.querySelector('span').textContent = 'Preparando preguntas…';
  const scope = type === 'integrador'
    ? s.stages.slice(0, Math.max(si, s.current) + 1).map((x) => `${x.title}: ${(x.modules || []).map((m) => m.title).join(', ')}`).join(' | ')
    : `${st.title}: ${(st.modules || []).map((m) => m.title).join(', ')}`;
  const kind = type === 'practico' ? 'situaciones prácticas de la vida real donde haya que aplicar lo aprendido (cada una de 2 o 3 frases, terminando en una pregunta)'
    : 'preguntas abiertas y concretas que se respondan en 1 a 4 frases';
  try {
    const j = await askJSON(teacher(), `Tema: ${s.topic}. Contenido a evaluar: ${scope}.
Armá ${cfg.n} ${kind}, variadas, de dificultad progresiva. Forma: {"questions":["...","..."]}`, 1200);
    go('exam', { sid: s.id, si, type, questions: j.questions.slice(0, cfg.n), answers: [], idx: 0 });
  } catch (e) { btn.disabled = false; btn.querySelector('span').textContent = cfg.desc; alertBox(e.message); }
}

views.exam = () => {
  const s = getSubj(), cfg = EXAMS[view.type];
  setHeader(cfg.name);
  const i = view.idx, q = view.questions[i], a = view.answers[i];
  app.innerHTML = `
    <div class="muted small">Pregunta ${i + 1} de ${view.questions.length}</div>
    <div class="bar" style="margin-bottom:14px"><div style="width:${(100 * i) / view.questions.length}%;background:var(--accent)"></div></div>
    <div class="card"><div style="font-size:18px">${esc(q)}</div><div style="margin-top:10px">${listenBtn('q')}</div></div>
    ${a ? `
      <div class="card"><div class="muted small">Tu respuesta</div>${esc(a.answer)}</div>
      <div class="scores">
        <div class="card"><div class="muted small">Corrección</div><div class="score-big" style="color:${a.correct >= PASS ? 'var(--ok)' : 'var(--bad)'}">${a.correct}</div></div>
        <div class="card"><div class="muted small">Claridad</div><div class="score-big" style="color:${a.clarity >= PASS ? 'var(--ok)' : 'var(--bad)'}">${a.clarity}</div></div>
      </div>
      <div class="card"><div class="between"><b>Devolución</b>${listenBtn('fb')}</div><p style="margin-bottom:0">${esc(a.feedback)}</p>
        ${a.ideal ? `<p class="muted" style="margin-bottom:0"><b>Una buena respuesta sería:</b> ${esc(a.ideal)}</p>` : ''}</div>
      <button class="block" id="nextQ">${i + 1 < view.questions.length ? 'Siguiente pregunta →' : 'Ver resultado'}</button>`
    : `
      <textarea id="ans" placeholder="Escribí o dictá tu respuesta con el teclado"></textarea>
      <button class="block" id="send" style="margin-top:10px">Enviar respuesta</button>
      <div id="examStatus" class="muted small" style="margin-top:8px;text-align:center"></div>`}`;
  const qb = app.querySelector('[data-speak="q"]'); qb.onclick = () => speak(q, qb);
  if (settings.autoRead && !a) speak(q, qb);
  if (a) {
    const fb = app.querySelector('[data-speak="fb"]'); fb.onclick = () => speak(a.feedback, fb);
    document.getElementById('nextQ').onclick = () => {
      if (i + 1 < view.questions.length) { view.idx++; stopSpeaking(); render(); window.scrollTo(0, 0); }
      else finishExam(s);
    };
    return;
  }
  const send = document.getElementById('send');
  send.onclick = async () => {
    const answer = document.getElementById('ans').value.trim();
    if (!answer) return;
    send.disabled = true; document.getElementById('examStatus').textContent = 'Corrigiendo…';
    try {
      const g = await askJSON(teacher() + ' Corregís exámenes con justicia y de forma alentadora, marcando qué faltó o qué estuvo mal.',
        `Tema: ${s.topic}. Pregunta: ${q}\nRespuesta del alumno: ${answer}\n` +
        'Poné dos notas enteras del 1 al 10: "correct" (qué tan correcta y completa es) y "clarity" (qué tan clara, ordenada y precisa es la explicación; si es correcta pero confusa, baja esta nota). ' +
        'Forma: {"correct":0,"clarity":0,"feedback":"2 a 4 frases: qué estuvo bien, qué faltó o estuvo mal, y cómo decirlo más claro","ideal":"una respuesta modelo breve"}', 800);
      view.answers[i] = { answer, correct: clamp(g.correct), clarity: clamp(g.clarity), feedback: g.feedback, ideal: g.ideal };
      render();
      if (settings.autoRead) speak(g.feedback, app.querySelector('[data-speak="fb"]'));
    } catch (e) { send.disabled = false; document.getElementById('examStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};
// Niveles chistosos (de menor a mayor). "min" = nota mínima para llegar a ese nivel.
const LEVELS = [
  { min: 0, name: 'Nivel Musgo', sos: 'Sos un Musgo', emoji: '🌿', jokes: ['Estás verde y quietito, pegado a la piedra. ¡A moverse!', 'El musgo crece despacito… pero crece. ¡Vos también!'] },
  { min: 2, name: 'Nivel Plancton', sos: 'Sos un Plancton', emoji: '🦠', jokes: ['Sos chiquitito, pero las ballenas comen de vos. ¡Algo es algo!', 'Flotás en el océano del conocimiento sin rumbo. ¡Nadá un poquito!'] },
  { min: 3, name: 'Nivel Larvoide', sos: 'Sos un Larvoide', emoji: '🐛', jokes: ['Todavía sos larva, pero ojo que de acá sale mariposa.', 'Te arrastrás, pero vas para adelante. ¡Un repaso y te salen alas!'] },
  { min: 4, name: 'Nivel Araña de rincón', sos: 'Sos una Araña de rincón', emoji: '🕷️', jokes: ['Escondida en el rincón, sin hacer ruido… ¡salí a la luz!', 'Ya tejiste algo de telaraña, falta que se pegue el conocimiento.'] },
  { min: 5, name: 'Nivel Cuadrúpedo', sos: 'Sos un Cuadrúpedo', emoji: '🐕', jokes: ['Caminás en cuatro patas, pero ya caminás. ¡Falta pararse!', 'Firme en cuatro patas. Un empujoncito y te ponés en dos.'] },
  { min: 6, name: 'Nivel Cachalote bípedo', sos: 'Sos un Cachalote bípedo', emoji: '🐋', jokes: ['Un cachalote caminando en dos patas: raro, pero aprobaste.', 'Sos enorme y raro, pero avanzás. ¡Así se hace!'] },
  { min: 7, name: 'Nivel Presidente de país del tercer mundo', sos: 'Sos un Presidente de país del tercer mundo', emoji: '🎩', jokes: ['Prometés mucho y cumplís bastante. ¡Más que muchos presidentes!', 'Ya tenés banda presidencial. Ahora no te endeudes con el FMI.'] },
  { min: 8, name: 'Nivel Homo erectus', sos: 'Sos un Homo erectus', emoji: '🦍', jokes: ['Ya caminás derechito y descubriste el fuego. ¡Bien ahí!', 'Postura erguida y mente despierta. La evolución te sonríe.'] },
  { min: 9, name: 'Nivel Ninja supremo', sos: 'Sos un Ninja supremo', emoji: '🥷', jokes: ['Respondiste tan rápido y preciso que nadie te vio venir.', 'Cinturón negro en este tema. El examen ni se dio cuenta.'] },
  { min: 9.7, name: 'Nivel Dios', sos: 'Sos un Dios', emoji: '⚡', jokes: ['Nivel Dios: el examen te pidió disculpas por molestarte.', 'Ya no estudiás el tema: el tema te estudia a vos.'] },
];
const levelFor = (n) => [...LEVELS].reverse().find((l) => n >= l.min) || LEVELS[0];
const jokeFor = (n) => { const j = levelFor(n).jokes; return j[Math.floor(Math.random() * j.length)]; };
const levelOf = (n) => { const l = levelFor(n); return [n, l.name, l.emoji, l.sos]; };
const modBest = (m) => (m.scores && m.scores.length ? Math.max(...m.scores) : null);
function stageScore(st) {
  const xs = (st.modules || []).map(modBest).filter((x) => x != null).concat(st.exams.map((e) => e.score));
  return xs.length ? average((st.modules || []).map(modBest).filter((x) => x != null).length ? (st.modules || []).map(modBest).filter((x) => x != null) : xs) : null;
}
const clamp = (n) => Math.max(1, Math.min(10, Math.round(+n || 1)));
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

function finishExam(s) {
  const st = s.stages[view.si], cfg = EXAMS[view.type];
  const correct = average(view.answers.map((a) => a.correct)), clarity = average(view.answers.map((a) => a.clarity));
  const score = Math.round(((correct + clarity) / 2) * 10) / 10;
  let unlocked = false;
  if (view.type === 'modulo') {
    const m = st.modules[view.mi];
    m.scores = m.scores || []; m.scores.push(score); m.seen = true;
    if (!st.done && st.modules.every((x) => modBest(x) >= PASS)) {
      st.done = true; unlocked = true;
      if (s.current === view.si) s.current = Math.min(view.si + 1, s.stages.length - 1);
    }
    save();
    return go('result', { sid: s.id, si: view.si, mi: view.mi, type: 'modulo', score, correct, clarity, unlocked, feedback: view.lastFeedback }, false);
  }
  st.exams.push({ type: view.type, date: Date.now(), score, correct, clarity });
  if (cfg.unlocks && score >= PASS && !st.done) {
    st.done = true; unlocked = true;
    if (s.current === view.si) s.current = Math.min(view.si + 1, s.stages.length - 1);
  }
  save();
  go('result', { sid: s.id, si: view.si, type: view.type, score, correct, clarity, unlocked }, false);
}

views.result = () => {
  const s = getSubj(), st = s.stages[view.si], cfg = EXAMS[view.type], ok = view.score >= PASS;
  setHeader('Resultado');
  const isMod = view.type === 'modulo';
  const m = isMod ? st.modules[view.mi] : null;
  const lastMod = isMod && view.mi === st.modules.length - 1;
  if (!view.joke) view.joke = jokeFor(view.score);
  const msg = ok ? (view.unlocked ? '¡Terminaste la etapa! Se habilitó la siguiente.' : view.score >= 8 ? '¡Excelente!' : '¡Muy bien!') : 'Todavía no. Repetí el módulo y probá de nuevo.';
  app.innerHTML = `
    <div class="result-screen ${ok ? 'pass' : 'fail'}">
      <div class="result-inner">
        <div class="result-topic">${isMod ? esc(m.title) : esc(cfg.name) + ' · ' + esc(st.title)}</div>
        <div class="result-emoji">${levelOf(view.score)[2]}</div>
        <div class="result-label">${settings.name ? esc(settings.name) + ", sacaste" : "Sacaste"}</div>
        <div class="result-num">${fmt(view.score)}</div>
        <div class="result-level">${levelOf(view.score)[3]}</div>
        <div class="result-joke">${esc(view.joke)}</div>
        ${view.feedback ? `<div class="result-joke" style="font-style:normal">${esc(view.feedback)}</div>` : ""}
        <div class="result-msg">${msg}</div>
        <div class="result-sub"><span>Corrección <b>${fmt(view.correct)}</b></span><span>Claridad <b>${fmt(view.clarity)}</b></span></div>
        ${isMod ? `
          ${ok ? '' : '<button class="block result-btn" id="repeat">↻ Repetir módulo</button>'}
          ${!lastMod ? `<button class="block result-btn ${ok ? '' : 'ghost'}" id="nextMod">Siguiente módulo →</button>` : ''}
          ${ok ? `<button class="block result-btn ${lastMod ? '' : 'ghost'}" id="repeat">↻ Repetir módulo</button>` : ''}
          <button class="block result-btn ghost" id="toSubj">Volver al temario</button>` : `
          <button class="block result-btn" id="toSubj">Volver al temario</button>
          <button class="block result-btn ghost" id="again">Elegir otro examen</button>`}
      </div>
    </div>`;
  speak(`${settings.name ? settings.name + ', sacaste' : 'Sacaste'} ${fmt(view.score)}. ${levelOf(view.score)[3]}. ${view.joke} ${msg}`);
  if (ok) confetti();
  document.getElementById('toSubj').onclick = () => { stack.length = 0; view = { name: 'home' }; go('subject', { sid: s.id }); };
  const ag = document.getElementById('again'); if (ag) ag.onclick = () => go('examMenu', { sid: s.id, si: view.si }, false);
  const nm = document.getElementById('nextMod'); if (nm) nm.onclick = () => go('module', { sid: s.id, si: view.si, mi: view.mi + 1 }, false);
  const rp = document.getElementById('repeat'); if (rp) rp.onclick = () => go('module', { sid: s.id, si: view.si, mi: view.mi }, false);
};
const fmt = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

// Botón fijo para parar la voz
document.getElementById('stopFab').onclick = () => stopSpeaking();
// ---------- Arranque ----------
if ('serviceWorker' in navigator) {
  // Busca versiones nuevas cada vez que se abre la app y recarga sola si hay una.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !window.__reloaded) { window.__reloaded = true; location.reload(); } });
}
render();
