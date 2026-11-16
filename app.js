// Profe de Voz — app de estudio por voz con Claude
// Todo se guarda en el navegador (localStorage). La clave de API nunca sale del equipo,
// salvo para hablar directo con la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const $ = (id) => document.getElementById(id);

// ---------- Datos guardados ----------
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let subjects = store.get('subjects', []);   // [{id, topic, description, stages:[{title, summary, done, history:[]}], current}]
let settings = store.get('settings', { key: '', rate: 1 });
const save = () => { store.set('subjects', subjects); store.set('settings', settings); };

// ---------- Claude ----------
async function askClaude(system, messages, maxTokens = 1200) {
  if (!settings.key) { show('settings'); throw new Error('Primero cargá tu clave de API en Ajustes.'); }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('La clave de API no es válida. Revisala en Ajustes.');
    if (res.status === 400 && /credit/i.test(m)) throw new Error('Tu cuenta de Anthropic no tiene crédito. Cargá saldo en console.anthropic.com.');
    throw new Error('Error de Claude: ' + m);
  }
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// ---------- Voz: hablar ----------
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
  voice = vs.find((v) => /AR|419|US|MX/i.test(v.lang)) || vs[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd && onEnd(); return; }
  speechSynthesis.cancel();
  // Partimos en frases: Chrome en Android corta los textos largos.
  const parts = text.replace(/[*#_`]/g, '').match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  let i = 0;
  const next = () => {
    if (i >= parts.length) { setSpeaking(false); onEnd && onEnd(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++].trim());
    u.lang = voice?.lang || 'es-AR'; if (voice) u.voice = voice;
    u.rate = settings.rate || 1;
    u.onend = next; u.onerror = next;
    speechSynthesis.speak(u);
  };
  setSpeaking(true); next();
}
function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); setSpeaking(false); }
function setSpeaking(on) { $('lessonMic').classList.toggle('speaking', on); $('lessonMic').textContent = on ? '⏹' : '🎤'; }

// ---------- Voz: escuchar ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen(btn, statusEl, onText) {
  if (!SR) { statusEl.textContent = 'Este navegador no reconoce voz. Usá Chrome, o escribí.'; return; }
  stopSpeaking();
  const r = new SR();
  r.lang = 'es-AR'; r.interimResults = true; r.maxAlternatives = 1;
  let finalText = '';
  btn.classList.add('listening'); statusEl.textContent = 'Te escucho…';
  r.onresult = (e) => {
    let t = '';
    for (const res of e.results) t += res[0].transcript;
    finalText = t; statusEl.textContent = '“' + t + '”';
  };
  r.onerror = (e) => {
    statusEl.textContent = e.error === 'not-allowed' ? 'Necesito permiso para usar el micrófono.' : 'No te escuché bien, probá de nuevo.';
  };
  r.onend = () => { btn.classList.remove('listening'); if (finalText.trim()) onText(finalText.trim()); };
  r.start();
}

// ---------- Navegación ----------
let currentSubject = null, currentStage = null;
function show(view) {
  for (const v of ['settings', 'home', 'subject', 'lesson']) $('v-' + v).classList.toggle('hidden', v !== view);
  $('dock').classList.toggle('hidden', view !== 'lesson');
  $('backBtn').classList.toggle('hidden', view === 'home');
  $('settingsBtn').classList.toggle('hidden', view === 'settings');
  if (view === 'home') { $('title').textContent = 'Profe de Voz'; renderHome(); }
  if (view === 'settings') { $('title').textContent = 'Ajustes'; $('keyInput').value = settings.key; $('rate').value = settings.rate; $('rateVal').textContent = settings.rate + 'x'; }
  if (view === 'subject') renderSubject();
  window.scrollTo(0, 0);
  show.current = view;
}
$('backBtn').onclick = () => {
  stopSpeaking();
  if (show.current === 'lesson') show('subject'); else show('home');
};
$('settingsBtn').onclick = () => show('settings');

// ---------- Ajustes ----------
$('saveKey').onclick = async () => {
  settings.key = $('keyInput').value.trim(); save();
  $('keyMsg').textContent = 'Probando…';
  try { await askClaude('Respondé solo "ok".', [{ role: 'user', content: 'hola' }], 10); $('keyMsg').textContent = '✅ Funciona'; setTimeout(() => show('home'), 800); }
  catch (e) { $('keyMsg').innerHTML = '<span class="err">' + e.message + '</span>'; }
};
$('rate').oninput = (e) => { settings.rate = +e.target.value; $('rateVal').textContent = settings.rate + 'x'; save(); };
$('testVoice').onclick = () => speak('Hola, soy tu profe. Vamos a aprender juntos.');

// ---------- Inicio ----------
function renderHome() {
  const box = $('subjects');
  if (!subjects.length) { box.innerHTML = '<p class="muted">Todavía no agregaste ninguna.</p>'; return; }
  box.innerHTML = '';
  for (const s of subjects) {
    const done = s.stages.filter((x) => x.done).length;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="subject"><div><b></b><div class="muted">${done} de ${s.stages.length} etapas</div></div><span>›</span></div>
      <div class="bar"><div style="width:${(100 * done) / s.stages.length}%"></div></div>`;
    el.querySelector('b').textContent = s.topic;
    el.onclick = () => { currentSubject = s; show('subject'); };
    box.appendChild(el);
  }
}
$('topicMic').onclick = () => listen($('topicMic'), $('homeStatus'), createSubject);
$('topicGo').onclick = () => { const t = $('topicInput').value.trim(); if (t) createSubject(t); };
$('topicInput').onkeydown = (e) => { if (e.key === 'Enter') $('topicGo').click(); };

async function createSubject(topic) {
  $('homeStatus').textContent = 'Armando tu temario de "' + topic + '"…';
  $('topicGo').disabled = true;
  try {
    const raw = await askClaude(
      'Sos un profesor experto que arma planes de estudio para un adulto hispanohablante (Argentina) que aprende por voz desde el celular. ' +
      'Devolvé SOLO un JSON válido, sin texto extra, con esta forma: ' +
      '{"topic":"nombre corto del tema","description":"una frase sobre qué va a aprender","stages":[{"title":"...","summary":"qué se aprende en esta etapa, 1 o 2 frases"}]}. ' +
      'Armá entre 6 y 10 etapas, de lo más básico a lo avanzado, en orden lógico.',
      [{ role: 'user', content: 'Quiero aprender: ' + topic }],
      2000
    );
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const s = {
      id: Date.now().toString(36), topic: json.topic || topic, description: json.description || '',
      stages: json.stages.map((x) => ({ title: x.title, summary: x.summary, done: false, history: [] })),
      current: 0,
    };
    subjects.unshift(s); save();
    $('topicInput').value = '';
    $('homeStatus').textContent = 'Tocá el micrófono y decí otro tema';
    currentSubject = s; show('subject');
    speak(`Listo. Armé un temario de ${s.stages.length} etapas sobre ${s.topic}. ${s.description} Tocá la primera etapa para empezar.`);
  } catch (e) {
    $('homeStatus').innerHTML = '<span class="err">' + e.message + '</span>';
  } finally { $('topicGo').disabled = false; }
}

// ---------- Temario ----------
function renderSubject() {
  const s = currentSubject;
  $('title').textContent = s.topic;
  $('subjDesc').textContent = s.description;
  const done = s.stages.filter((x) => x.done).length;
  $('subjBar').style.width = (100 * done) / s.stages.length + '%';
  const box = $('stages'); box.innerHTML = '';
  s.stages.forEach((st, i) => {
    const state = st.done ? 'done' : i === s.current ? 'current' : i > s.current ? 'locked' : '';
    const el = document.createElement('div');
    el.className = 'card stage ' + state;
    el.innerHTML = `<div class="n">${st.done ? '✓' : i + 1}</div><div><b></b><div class="muted"></div></div>`;
    el.querySelector('b').textContent = st.title;
    el.querySelector('.muted').textContent = st.summary + (state === 'locked' ? ' 🔒' : '');
    el.onclick = () => {
      if (state === 'locked') { speak('Esa etapa se habilita cuando termines las anteriores.'); return; }
      openLesson(i);
    };
    box.appendChild(el);
  });
}
$('deleteSubject').onclick = () => {
  if (!confirm('¿Borrar "' + currentSubject.topic + '" y todo su progreso?')) return;
  subjects = subjects.filter((x) => x !== currentSubject); save(); show('home');
};

// ---------- Clase ----------
function lessonSystem(s, i) {
  const st = s.stages[i];
  return `Sos un profesor paciente y claro que enseña "${s.topic}" por voz a un adulto de Argentina. Hablale de vos, en español rioplatense.
Temario completo: ${s.stages.map((x, n) => `${n + 1}. ${x.title}`).join(' | ')}.
Ahora estás en la etapa ${i + 1}: "${st.title}" — ${st.summary}

Reglas importantes:
- Tus respuestas se leen en voz alta: NO uses markdown, viñetas, asteriscos, tablas ni emojis. Escribí como se habla.
- Enseñá de a poco: cada respuesta entre 80 y 150 palabras, con un ejemplo concreto de la vida real cuando sirva.
- Al final de cada respuesta hacé una pregunta corta para ver si entendió o para seguir (por ejemplo "¿Seguimos?" o una pregunta de repaso).
- Si el alumno pregunta algo, respondé eso primero.
- Cuando hayas cubierto todo lo de esta etapa, decile que está listo para el examen oral de la etapa.`;
}

function renderChat() {
  const st = currentSubject.stages[currentStage];
  const chat = $('chat'); chat.innerHTML = '';
  for (const m of st.history) {
    if (m.hidden) continue;
    const el = document.createElement('div');
    el.className = 'msg ' + (m.role === 'user' ? 'me' : 'ai');
    el.textContent = m.content;
    chat.appendChild(el);
  }
  window.scrollTo(0, document.body.scrollHeight);
}

async function openLesson(i) {
  currentStage = i;
  const s = currentSubject, st = s.stages[i];
  $('title').textContent = `${i + 1}. ${st.title}`;
  show('lesson'); renderChat();
  if (!st.history.length) await sendToTeacher('Empezá la clase de esta etapa.', true);
  else $('lessonStatus').textContent = 'Seguí donde dejaste. Tocá el micrófono para hablar.';
}

let busy = false;
async function sendToTeacher(text, hidden = false) {
  if (busy) return; busy = true;
  const st = currentSubject.stages[currentStage];
  st.history.push({ role: 'user', content: text, hidden }); renderChat();
  $('lessonStatus').textContent = 'Pensando…'; $('lessonSend').disabled = true;
  try {
    const msgs = st.history.slice(-30).map((m) => ({ role: m.role, content: m.content }));
    if (msgs[0].role !== 'user') msgs.shift();
    const reply = await askClaude(lessonSystem(currentSubject, currentStage), msgs);
    st.history.push({ role: 'assistant', content: reply }); save(); renderChat();
    $('lessonStatus').textContent = 'Hablando… (tocá ⏹ para cortar)';
    speak(reply, () => { $('lessonStatus').textContent = 'Tocá el micrófono para responder'; });
  } catch (e) {
    st.history.pop(); renderChat();
    $('lessonStatus').innerHTML = '<span class="err">' + e.message + '</span>';
  } finally { busy = false; $('lessonSend').disabled = false; }
}

$('lessonMic').onclick = () => {
  if ($('lessonMic').classList.contains('speaking')) { stopSpeaking(); $('lessonStatus').textContent = 'Tocá el micrófono para hablar'; return; }
  listen($('lessonMic'), $('lessonStatus'), (t) => sendToTeacher(t));
};
$('lessonSend').onclick = () => { const t = $('lessonInput').value.trim(); if (t) { $('lessonInput').value = ''; sendToTeacher(t); } };
$('lessonInput').onkeydown = (e) => { if (e.key === 'Enter') $('lessonSend').click(); };

// ---------- Arranque ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
show(settings.key ? 'home' : 'settings');
