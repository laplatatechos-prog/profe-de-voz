// Profe de Voz — aprendé cualquier tema por módulos cortos, con exámenes y puntaje.
// Todo se guarda en este navegador (localStorage). La clave de API solo viaja a la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const PASS = 6; // nota mínima para aprobar el examen de etapa

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Datos ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let subjects = store.get('subjects', []);
let settings = Object.assign({ key: '', rate: 1, voiceURI: '', autoRead: false }, store.get('settings', {}));
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
const TEACHER = 'Sos un profesor claro y paciente que enseña a un adulto de Argentina. Hablale de vos, en español rioplatense. ' +
  'Tus textos también se leen en voz alta: no uses markdown, asteriscos, numerales, viñetas, tablas ni emojis.';

// ---------- Voz ----------
// Usa las voces gratis del navegador/teléfono, priorizando las más naturales.
const MALE = /\b(male|hombre|masculin|jorge|diego|pablo|alvaro|álvaro|raul|raúl|carlos|juan|enrique|alonso|tom[aá]s|gonzalo|andr[eé]s|jaime|jorge|miguel|antonio|federico|mateo|lucas|dario|darío|alejandro|gerardo|liam|arnau|teo|elias|elías|emilio|jos[eé]|manuel|nicol[aá]s|santiago)\b/i;
const FEMALE = /\b(female|mujer|femenin|helena|laura|sabina|paulina|m[oó]nica|elena|dalia|elvira|paloma|luc[ií]a|camila|valentina|marisol|paola|salome|salomé|ximena|abril|ana|carla|catalina|isabel|mar[ií]a|sof[ií]a|elsa|irene|lola|esperanza|monserrat)\b/i;
const QUALITY = /(natural|neural|online|google|premium|enhanced|mejorad)/i;
const genderOf = (v) => (MALE.test(v.name) ? 'hombre' : FEMALE.test(v.name) ? 'mujer' : '');
const qualityOf = (v) => (QUALITY.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);

let voices = [];
function loadVoices() { voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : []; }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = () => { loadVoices(); if (view.name === 'settings') render(); }; }
function spanishVoices() {
  return voices.filter((v) => /^es/i.test(v.lang)).sort((a, b) => qualityOf(b) - qualityOf(a) || /AR|419/i.test(b.lang) - /AR|419/i.test(a.lang) || a.name.localeCompare(b.name));
}
function currentVoice() {
  return voices.find((v) => v.voiceURI === settings.voiceURI) || spanishVoices()[0] || null;
}

let speakingBtn = null, speakToken = 0;
function speak(text, btn) {
  const wasThis = speakingBtn && speakingBtn === btn;
  stopSpeaking();
  if (wasThis) return; // segundo toque = parar
  const clean = String(text).replace(/[*#_`]/g, '');
  speakingBtn = btn || null;
  if (btn) btn.textContent = '■ Parar';
  speakBrowser(clean);
}
function speakBrowser(clean) {
  if (!('speechSynthesis' in window)) return stopSpeaking();
  const parts = clean.match(/[^.!?\n]+[.!?]*\s*/g) || [clean];
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
function stopSpeaking() {
  speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
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
function render() { (views[view.name] || views.home)(); }
const getSubj = () => subjects.find((s) => s.id === view.sid);

// ---------- Configuración ----------
views.settings = () => {
  setHeader('Configuración');
  const v = currentVoice();
  const list = view.allVoices ? [...voices].sort((a, b) => a.lang.localeCompare(b.lang)) : spanishVoices();
  const label = (x) => `${x.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-\s*Spanish.*$/i, '')} · ${x.lang}${genderOf(x) ? ' · ' + genderOf(x) : ''}${QUALITY.test(x.name) ? ' ★' : ''}`;
  const hasMale = list.some((x) => genderOf(x) === 'hombre');
  app.innerHTML = `
    <h2>Voz</h2>
    <div class="card">
      <label style="margin-top:0">Voz del profe</label>
      ${list.length ? `<select id="voiceSel">${list.map((x) => `<option value="${esc(x.voiceURI)}" ${v && v.voiceURI === x.voiceURI ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}</select>`
        : '<p class="muted">No encontré voces en español en este navegador.</p>'}
      <p class="muted small">★ = voz de mejor calidad. ${hasMale ? '' : 'Este navegador no trae voces de hombre en español. '}Más abajo te explico cómo sumar voces de hombre gratis.</p>
      <button class="plain small" id="allVoices" style="padding-left:0">${view.allVoices ? 'Mostrar solo voces en español' : 'Mostrar todas las voces'}</button>
      <label>Velocidad: <b id="rateVal">${settings.rate.toFixed(2)}x</b></label>
      <div class="row"><span class="muted small">Lenta</span><input class="grow" id="rate" type="range" min="0.6" max="1.8" step="0.05" value="${settings.rate}"><span class="muted small">Rápida</span></div>
      <label class="row" style="gap:10px;color:var(--text)"><input type="checkbox" id="autoRead" style="width:auto" ${settings.autoRead ? 'checked' : ''}> Leer en voz alta los módulos automáticamente</label>
      <div style="margin-top:14px"><button class="soft" id="testVoice">▶ Probar voz</button></div>
    </div>

    <h2>¿Querés una voz de hombre o más natural en el celular?</h2>
    <div class="card small" style="font-size:15px">
      <p style="margin-top:0">En Android, Chrome usa la voz que tenga configurada el teléfono. Se cambia gratis así:</p>
      <ol style="padding-left:20px;margin:0">
        <li>Abrí <b>Ajustes</b> del teléfono y buscá <b>"Texto a voz"</b> (en Samsung: Administración general → Idioma → Texto a voz).</li>
        <li>En <b>Motor preferido</b> elegí <b>Servicios de Google</b> (es el más natural).</li>
        <li>Tocá el engranaje ⚙ al lado → <b>Instalar datos de voz</b> → <b>Español</b> (Estados Unidos o España).</li>
        <li>Elegí una de las voces de hombre (probalas con el botón ▶) y descargala.</li>
        <li>Cerrá esta app y abrila de nuevo.</li>
      </ol>
      <p class="muted" style="margin-bottom:0">En la compu, abrí la app en Microsoft Edge: trae voces muy naturales de hombre, como "Tomás" de Argentina.</p>
    </div>

    <h2>Clave de Claude</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Se guarda solo en este equipo.</p>
      <input id="keyInput" type="password" placeholder="sk-ant-..." autocomplete="off" value="${esc(settings.key)}">
      <div class="row" style="margin-top:10px"><button id="saveKey">Guardar</button><span id="keyMsg" class="muted"></span></div>
      <p class="muted small">Para sacarla: platform.claude.com → Claves (API Keys) → Crear clave. Empieza con sk-ant-.</p>
    </div>`;
  const $ = (id) => document.getElementById(id);
  if ($('voiceSel')) $('voiceSel').onchange = () => { settings.voiceURI = $('voiceSel').value; save(); speak('Hola, esta es mi voz.'); };
  if ($('allVoices')) $('allVoices').onclick = () => { view.allVoices = !view.allVoices; render(); };
  $('rate').oninput = (e) => { settings.rate = +e.target.value; $('rateVal').textContent = settings.rate.toFixed(2) + 'x'; save(); };
  $('rate').onchange = () => speak('Así suena esta velocidad.');
  $('autoRead').onchange = (e) => { settings.autoRead = e.target.checked; save(); };
  $('testVoice').onclick = () => speak('Hola, soy tu profe. Vamos a aprender juntos, de a poco.', $('testVoice'));
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
    const avg = average(s.stages.flatMap((x) => x.exams.map((e) => e.score)));
    return `<div class="card tap" data-sid="${s.id}">
      <div class="between"><b>${esc(s.topic)}</b>${avg != null ? `<span class="pill ${avg >= PASS ? 'ok' : 'bad'}">Promedio ${avg.toFixed(1)}</span>` : ''}</div>
      <div class="muted small">${done} de ${s.stages.length} etapas aprobadas</div>
      <div class="bar"><div style="width:${(100 * done) / s.stages.length}%"></div></div></div>`;
  }).join('');
  app.innerHTML = `
    ${!settings.key ? `<div class="card" style="background:var(--accent-soft);border-color:transparent">Para empezar, cargá tu clave de Claude en <a href="#" id="toSettings">Configuración</a>.</div>` : ''}
    <h2>Nuevo tema</h2>
    <div class="card">
      <div class="row"><input class="grow" id="topicInput" placeholder="¿Qué querés aprender? Ej: inteligencia artificial"><button id="topicGo">Crear</button></div>
      <div id="homeStatus" class="muted small" style="margin-top:8px"></div>
    </div>
    <h2>Mis áreas</h2>
    ${items || '<p class="muted">Todavía no agregaste ninguna.</p>'}`;
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
      'Forma: {"topic":"nombre corto","description":"una frase","stages":[{"title":"...","summary":"una frase","modules":[{"title":"título corto y concreto"}]}]}. ' +
      'Entre 5 y 8 etapas, de lo básico a lo avanzado. Cada etapa con 3 a 5 módulos MUY cortos (cada uno se lee en 1 o 2 minutos).',
      'Quiero aprender: ' + topic, 3000);
    const s = {
      id: Date.now().toString(36), topic: j.topic || topic, description: j.description || '', current: 0,
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
      const best = st.exams.length ? Math.max(...st.exams.map((e) => e.score)) : null;
      const open = view.open === undefined ? state === 'current' : view.open === i;
      return `<div class="card ${state}">
        <div class="stage-head tap" data-toggle="${i}"><div class="num">${st.done ? '✓' : i + 1}</div>
          <div class="grow" style="flex:1"><b>${esc(st.title)}</b><div class="muted small">${esc(st.summary)}${state === 'locked' ? ' · 🔒 Se habilita al aprobar la anterior' : ''}</div></div>
          ${best != null ? `<span class="pill ${best >= PASS ? 'ok' : 'bad'}">${best.toFixed(1)}</span>` : ''}</div>
        ${open && state !== 'locked' ? `
          <div class="modules">${(st.modules || []).map((m, k) => `<div class="mod ${m.seen ? 'seen' : ''}" data-mod="${i}:${k}"><span class="dot"></span><span>${esc(m.title)}</span></div>`).join('')}
            ${!st.modules || !st.modules.length ? '<div class="muted small">Tocá "Empezar" para armar los módulos.</div>' : ''}</div>
          <div class="stage-actions">
            <button data-start="${i}">${(st.modules || []).some((m) => m.seen) ? 'Seguir' : 'Empezar'}</button>
            <button class="soft" data-exam="${i}">Exámenes</button>
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
    const k = Math.max(0, st.modules.findIndex((m) => !m.seen));
    go('module', { sid: s.id, si: i, mi: k });
  });
  app.querySelectorAll('[data-exam]').forEach((el) => el.onclick = () => go('examMenu', { sid: s.id, si: +el.dataset.exam }));
  document.getElementById('delSubj').onclick = () => {
    if (!confirm(`¿Borrar "${s.topic}" y todo su progreso?`)) return;
    subjects = subjects.filter((x) => x !== s); save(); stack.length = 0; go('home', {}, false);
  };
};
function alertBox(msg) { const d = document.createElement('div'); d.className = 'card err'; d.textContent = msg; app.prepend(d); window.scrollTo(0, 0); }

async function ensureModules(s, i) {
  const st = s.stages[i];
  if (st.modules && st.modules.length) return;
  const j = await askJSON(TEACHER, `Tema: ${s.topic}. Etapa: "${st.title}" (${st.summary}). Dividila en 3 a 5 módulos MUY cortos. Forma: {"modules":[{"title":"..."}]}`, 800);
  st.modules = j.modules.map((m) => ({ title: m.title, content: null, seen: false, chat: [] }));
  save();
}

// ---------- Módulo ----------
views.module = () => {
  const s = getSubj(); const st = s.stages[view.si]; const m = st.modules[view.mi];
  setHeader(`${view.si + 1}. ${st.title}`);
  const total = st.modules.length;
  app.innerHTML = `
    <div class="muted small">Módulo ${view.mi + 1} de ${total}</div>
    <div class="lesson-title">${esc(m.title)}</div>
    <div id="modBody">${m.content ? '' : '<div class="loading">Preparando el módulo…</div>'}</div>`;
  if (m.content) drawModule(s, st, m); else loadModule(s, st, m);
};
async function loadModule(s, st, m) {
  const keep = view;
  try {
    m.content = await askClaude(TEACHER + `
Estás enseñando "${s.topic}". Temario: ${s.stages.map((x, n) => `${n + 1}. ${x.title}`).join(' | ')}.
Etapa actual: "${st.title}". Módulos de esta etapa: ${st.modules.map((x) => x.title).join(' | ')}.
Escribí SOLO el contenido del módulo que te pidan: entre 90 y 150 palabras, en 2 o 3 párrafos cortos, con un ejemplo concreto de la vida real. Sin saludo ni despedida, sin repetir el título.`,
      [{ role: 'user', content: `Módulo: "${m.title}"` }], 700);
    save();
    if (view === keep) drawModule(s, st, m);
  } catch (e) {
    if (view === keep) document.getElementById('modBody').innerHTML = `<p class="err">${esc(e.message)}</p><button class="soft" id="retry">Reintentar</button>`;
    const r = document.getElementById('retry'); if (r) r.onclick = () => render();
  }
}
function drawModule(s, st, m) {
  m.seen = true; save();
  const last = view.mi === st.modules.length - 1;
  document.getElementById('modBody').innerHTML = `
    <div style="margin:10px 0 14px">${listenBtn('mod')}</div>
    <div class="lesson">${esc(m.content)}</div>
    <div class="row" style="margin-top:24px">
      ${view.mi > 0 ? '<button class="soft" id="prev">← Anterior</button>' : ''}
      <span class="grow"></span>
      ${last ? '<button id="toExam">Ir a los exámenes</button>' : '<button id="next">Siguiente →</button>'}
    </div>
    <h2>¿Tenés una duda?</h2>
    <div class="chat" id="chat">${m.chat.map((c) => `<div class="msg ${c.role === 'user' ? 'me' : 'ai'}">${esc(c.content)}</div>`).join('')}</div>
    <div class="row" style="margin-top:10px"><input class="grow" id="q" placeholder="Escribí o dictá tu pregunta"><button id="ask">Preguntar</button></div>`;
  const lb = app.querySelector('[data-speak]');
  lb.onclick = () => speak(m.title + '. ' + m.content, lb);
  const p = document.getElementById('prev'); if (p) p.onclick = () => go('module', { sid: s.id, si: view.si, mi: view.mi - 1 }, false);
  const n = document.getElementById('next'); if (n) n.onclick = () => go('module', { sid: s.id, si: view.si, mi: view.mi + 1 }, false);
  const te = document.getElementById('toExam'); if (te) te.onclick = () => go('examMenu', { sid: s.id, si: view.si }, false);
  const q = document.getElementById('q'), ask = document.getElementById('ask');
  q.onkeydown = (e) => { if (e.key === 'Enter') ask.click(); };
  ask.onclick = async () => {
    const text = q.value.trim(); if (!text) return;
    q.value = ''; ask.disabled = true;
    m.chat.push({ role: 'user', content: text }); drawChat(m);
    try {
      const reply = await askClaude(TEACHER + ` Estás en el módulo "${m.title}" del tema "${s.topic}". Este es el contenido que leyó el alumno:\n${m.content}\nRespondé su duda en menos de 100 palabras.`,
        m.chat.slice(-12).map((c) => ({ role: c.role, content: c.content })), 600);
      m.chat.push({ role: 'assistant', content: reply }); save(); drawChat(m);
      if (settings.autoRead) speak(reply);
    } catch (e) { m.chat.pop(); drawChat(m); alertBox(e.message); }
    ask.disabled = false;
  };
  if (settings.autoRead) speak(m.title + '. ' + m.content, lb);
}
function drawChat(m) {
  document.getElementById('chat').innerHTML = m.chat.map((c) => `<div class="msg ${c.role === 'user' ? 'me' : 'ai'}">${esc(c.content)}</div>`).join('');
}

// ---------- Exámenes ----------
const EXAMS = {
  rapido: { name: 'Repaso rápido', n: 3, desc: '3 preguntas cortas para ver si te quedó lo principal.', unlocks: false },
  etapa: { name: 'Examen de la etapa', n: 5, desc: `5 preguntas. Si sacás ${PASS} o más, aprobás y se habilita la etapa siguiente.`, unlocks: true },
  integrador: { name: 'Examen integrador', n: 6, desc: 'Mezcla preguntas de todas las etapas que ya viste.', unlocks: false },
  practico: { name: 'Caso práctico', n: 2, desc: '2 situaciones reales donde tenés que aplicar lo aprendido.', unlocks: false },
};

views.examMenu = () => {
  const s = getSubj(), st = s.stages[view.si];
  setHeader('Exámenes');
  app.innerHTML = `
    <div class="muted">Etapa ${view.si + 1}: <b style="color:var(--text)">${esc(st.title)}</b></div>
    <p class="muted small">Respondé escribiendo o dictando con el teclado. Cada respuesta tiene dos notas del 1 al 10: <b>corrección</b> (si está bien) y <b>claridad</b> (si se entiende cómo lo explicás).</p>
    ${Object.entries(EXAMS).map(([k, e]) => `<button class="exam-type" data-type="${k}"><b>${e.name}</b><span>${e.desc}</span></button>`).join('')}
    ${st.exams.length ? `<h2>Tus notas en esta etapa</h2>${st.exams.slice().reverse().map((e) => `
      <div class="card between"><div><b>${esc(EXAMS[e.type]?.name || e.type)}</b><div class="muted small">${new Date(e.date).toLocaleDateString('es-AR')} · corrección ${e.correct.toFixed(1)} · claridad ${e.clarity.toFixed(1)}</div></div>
      <span class="pill ${e.score >= PASS ? 'ok' : 'bad'}">${e.score.toFixed(1)}</span></div>`).join('')}` : ''}`;
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
    const j = await askJSON(TEACHER, `Tema: ${s.topic}. Contenido a evaluar: ${scope}.
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
      const g = await askJSON(TEACHER + ' Corregís exámenes con justicia y de forma alentadora, marcando qué faltó o qué estuvo mal.',
        `Tema: ${s.topic}. Pregunta: ${q}\nRespuesta del alumno: ${answer}\n` +
        'Poné dos notas enteras del 1 al 10: "correct" (qué tan correcta y completa es) y "clarity" (qué tan clara, ordenada y precisa es la explicación; si es correcta pero confusa, baja esta nota). ' +
        'Forma: {"correct":0,"clarity":0,"feedback":"2 a 4 frases: qué estuvo bien, qué faltó o estuvo mal, y cómo decirlo más claro","ideal":"una respuesta modelo breve"}', 800);
      view.answers[i] = { answer, correct: clamp(g.correct), clarity: clamp(g.clarity), feedback: g.feedback, ideal: g.ideal };
      render();
      if (settings.autoRead) speak(g.feedback, app.querySelector('[data-speak="fb"]'));
    } catch (e) { send.disabled = false; document.getElementById('examStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};
const clamp = (n) => Math.max(1, Math.min(10, Math.round(+n || 1)));
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

function finishExam(s) {
  const st = s.stages[view.si], cfg = EXAMS[view.type];
  const correct = average(view.answers.map((a) => a.correct)), clarity = average(view.answers.map((a) => a.clarity));
  const score = Math.round(((correct + clarity) / 2) * 10) / 10;
  st.exams.push({ type: view.type, date: Date.now(), score, correct, clarity });
  let unlocked = false;
  if (cfg.unlocks && score >= PASS && !st.done) {
    st.done = true; unlocked = true;
    if (s.current === view.si) s.current = Math.min(view.si + 1, s.stages.length - 1);
  }
  save();
  go('result', { sid: s.id, si: view.si, type: view.type, score, correct, clarity, unlocked }, false);
}

views.result = () => {
  const s = getSubj(), cfg = EXAMS[view.type], ok = view.score >= PASS;
  setHeader('Resultado');
  const msg = ok ? (view.unlocked ? '¡Aprobaste! Se habilitó la etapa siguiente.' : '¡Muy bien!') : 'Todavía no. Repasá los módulos y probá de nuevo.';
  app.innerHTML = `
    <div class="card" style="text-align:center;padding:28px 16px">
      <div class="muted">${esc(cfg.name)}</div>
      <div class="score-big" style="font-size:64px;margin:8px 0;color:${ok ? 'var(--ok)' : 'var(--bad)'}">${view.score.toFixed(1)}</div>
      <div>${msg}</div>
    </div>
    <div class="scores">
      <div class="card"><div class="muted small">Corrección</div><div class="score-big">${view.correct.toFixed(1)}</div></div>
      <div class="card"><div class="muted small">Claridad</div><div class="score-big">${view.clarity.toFixed(1)}</div></div>
    </div>
    <button class="block" id="toSubj">Volver al temario</button>
    <button class="block soft" id="again" style="margin-top:10px">Elegir otro examen</button>`;
  speak(`Tu nota es ${view.score.toFixed(1).replace('.', ',')}. ${msg}`);
  document.getElementById('toSubj').onclick = () => { stack.length = 0; view = { name: 'home' }; go('subject', { sid: s.id }); };
  document.getElementById('again').onclick = () => go('examMenu', { sid: s.id, si: view.si }, false);
};

// ---------- Arranque ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
