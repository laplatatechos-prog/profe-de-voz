// Profe de Voz — aprendé cualquier tema por módulos cortos, con exámenes y puntaje.
// Todo se guarda en este navegador (localStorage). La clave de API solo viaja a la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const FAST_MODEL = 'claude-haiku-5-5'; // más rápido para la charla y las correcciones
const API_URL = 'https://api.anthropic.com/v1/messages';
const APP_VERSION = 30;
// Ranking compartido (Supabase gratis). La clave es "publicable": está hecha para ir en la app.
const SB_URL = 'https://gfroofkdxjgmsqohmqly.supabase.co', SB_KEY = 'sb_publishable_YfBmqwYVuM8GAol1acW8Ng_GvxkVcBt';
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
async function askClaude(system, messages, maxTokens = 1200, model = MODEL) {
  try { return await askClaudeOnce(system, messages, maxTokens, model); }
  catch (e) { if (model !== MODEL && /model/i.test(e.message)) return askClaudeOnce(system, messages, maxTokens, MODEL); throw e; } // si el modelo rápido no está, usa el normal
}
async function askClaudeOnce(system, messages, maxTokens, model) {
  let res;
  if (!settings.key) { // sin clave propia: pasa por el servidor, que usa la clave del administrador
    try {
      res = await fetch(`${SB_URL}/functions/v1/claude`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SB_KEY },
        body: JSON.stringify({ player: settings.playerId, model, max_tokens: maxTokens, system, messages }) });
    } catch { throw new Error('No hay conexión a internet.'); }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = d?.error?.code;
      if (code === 'pending' || code === 'rejected' || code === 'no_member') { settings.access = { status: code === 'no_member' ? 'none' : code }; save(); setTimeout(render, 50); }
      if (/credit/i.test(d?.error?.message || '')) throw new Error('La cuenta de Claude del administrador se quedó sin crédito. Avisale.');
      throw new Error(d?.error?.message || 'No pude hablar con el profe. Probá de nuevo.');
    }
    return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
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
// Saca el JSON de la respuesta de Claude. Si vino cortado o raro, devuelve null (no rompe la app).
function parseLoose(raw) {
  const s = String(raw || '').replace(/```(json)?/g, '');
  const a = s.search(/[{[]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function askJSON(system, user, maxTokens = 2000, model = MODEL) {
  const raw = await askClaude(system + '\nDevolvé SOLO JSON válido, sin texto antes ni después, sin ```.', [{ role: 'user', content: user }], maxTokens, model);
  let j = parseLoose(raw);
  if (j == null) j = parseLoose(await askClaude(system + '\nDevolvé SOLO JSON válido, sin texto antes ni después, sin ```.', [{ role: 'user', content: user }], maxTokens + 1500));
  if (j == null) throw new Error('El profe se trabó un segundo. Tocá de nuevo el botón.');
  return j;
}
const lengthRule = (short = settings.length === 'corto') => short
  ? 'Muy breve y directo: entre 35 y 60 palabras, frases cortas y simples, la idea principal y un ejemplo de una línea. Nada de relleno.'
  : 'Entre 90 y 150 palabras, en 2 o 3 párrafos cortos, con un ejemplo concreto de la vida real.';
const TEACHER_BASE = 'Sos un profesor claro y paciente que enseña a una persona de Argentina. Hablale de vos, en español rioplatense. ' +
  'Tenés mucha personalidad: sos expresivo, irónico y gracioso, con sarcasmo cariñoso bien argentino y exageraciones ("¡Pará, pará! ¿Me estás cargando? ¡Eso estuvo bárbaro!", "Mirá vos, casi casi… como el colectivo que se te escapa por un metro"). ' +
  'Usá exclamaciones, preguntas retóricas y comparaciones de la vida cotidiana argentina (el mate, el colectivo, la abuela, el asado, el fútbol). Nunca ofendas ni humilles: la ironía siempre es con cariño y para motivar. La claridad de la explicación es lo primero. ' +
  'Tus textos también se leen en voz alta: no uses markdown, asteriscos, numerales, viñetas, tablas ni emojis.';
const teacher = () => TEACHER_BASE + ' No uses el nombre del alumno: hablale directo, sin nombrarlo (la app lo nombra sola al final del examen).';

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
  if (wasThis) return Promise.resolve(); // segundo toque = parar
  speakingBtn = btn || null;
  if (btn) btn.textContent = '■ Parar';
  const token = speakToken;
  // El texto puede traer marcas {{s:nombre}}: ahí suena el sonido del personaje.
  const segs = String(text).split(/\{\{(s:\w+|p)\}\}/);
  return (async () => {
    for (let i = 0; i < segs.length; i++) {
      if (token !== speakToken) return;
      if (i % 2) { if (segs[i] === 'p') await new Promise((ok) => setTimeout(ok, 450)); else await playSfx(segs[i].slice(2)); continue; }
      const clean = segs[i].replace(/[*#_`]/g, '').replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      if (settings.engine === 'piper' && settings.piperVoice) await speakPiper(clean, token);
      else await speakBrowser(clean, token);
    }
    if (token === speakToken) stopSpeaking();
  })();
}
function speakBrowser(clean, token = speakToken) {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  return new Promise((done) => { // termina cuando lee todo (o si se pide otra lectura, esta se ignora)
  const sentences = clean.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const parts = [];
  for (const x of sentences) { if (parts.length && (parts[parts.length - 1] + x).length < 220) parts[parts.length - 1] += x; else parts.push(x); }
  const v = currentVoice();
  let i = 0;
  const next = () => {
    if (token !== speakToken) return done(); // un "cancel" viejo no debe cortar la lectura nueva
    if (i >= parts.length) return done();
    const u = new SpeechSynthesisUtterance(parts[i++].trim());
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-AR';
    // Más expresión: las exclamaciones suben un poquito, los suspensos van más lento.
    const txt = u.text, base = settings.rate || 1;
    u.rate = /…|\.\.\./.test(txt) ? base * 0.9 : /!/.test(txt) ? base * 1.06 : base;
    u.pitch = /!/.test(txt) ? 1.1 : /\?/.test(txt) ? 1.05 : 1;
    u.onend = next; u.onerror = next;
    speechSynthesis.speak(u);
  };
  // En Android, hablar justo después de cancelar a veces se pierde: esperamos un instante.
  setTimeout(next, 150);
  });
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
  } catch (e) {
    console.error(e);
    if (token !== speakToken) return;
    toast('No pude usar la voz natural, uso la del teléfono.');
    await speakBrowser(clean, token);
  }
}
// ---- Sonidos de personajes: se generan en el momento con Web Audio (gratis, sin archivos) ----
let actx = null, sfxOut = null;
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
document.addEventListener('pointerdown', () => audioCtx(), { passive: true }); // Android pide un toque para habilitar el audio
function stopSfx() { if (sfxOut) { try { sfxOut.disconnect(); } catch {} sfxOut = null; } }
// tono: frecuencia que va de f a f2, con volumen que sube y baja
function tone(c, out, t, dur, f, f2, type = 'sine', vol = 0.3, vib = 0) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2 || f, t + dur);
  if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib; lg.gain.value = f * 0.08; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
}
// ruido filtrado (para soplidos, rugidos, truenos)
function noise(c, out, t, dur, f, f2, vol = 0.3, q = 1) {
  const n = c.createBufferSource(), b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = b; const fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = 'bandpass'; fl.Q.value = q; fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(f2 || f, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(fl).connect(g).connect(out); n.start(t); n.stop(t + dur);
}
const SOUNDS = {
  pop: (c, o, t) => { tone(c, o, t, .08, 400, 1200, 'sine', .4); tone(c, o, t + .15, .08, 500, 1400, 'sine', .3); return .3; },
  boing: (c, o, t) => { tone(c, o, t, .5, 150, 600, 'sine', .35, 14); return .55; },
  flutter: (c, o, t) => { for (let i = 0; i < 10; i++) noise(c, o, t + i * .06, .04, 2500, 1500, .2, 2); return .65; },
  cricket: (c, o, t) => { [0, .35].forEach((d) => { for (let i = 0; i < 4; i++) tone(c, o, t + d + i * .05, .035, 4200, 4200, 'sine', .12); }); return .6; },
  squeak: (c, o, t) => { tone(c, o, t, .12, 2200, 2800, 'sine', .2); tone(c, o, t + .18, .15, 2400, 3000, 'sine', .2); return .4; },
  coo: (c, o, t) => { tone(c, o, t, .35, 380, 300, 'sine', .3, 8); tone(c, o, t + .4, .45, 360, 280, 'sine', .3, 8); return .9; },
  meow: (c, o, t) => { tone(c, o, t, .25, 500, 800, 'triangle', .3); tone(c, o, t + .25, .35, 800, 450, 'triangle', .3); return .65; },
  quack: (c, o, t) => { [0, .3].forEach((d) => { tone(c, o, t + d, .18, 300, 220, 'sawtooth', .15); noise(c, o, t + d, .18, 1200, 800, .2, 3); }); return .55; },
  moo: (c, o, t) => { tone(c, o, t, 1, 140, 110, 'sawtooth', .15, 3); return 1; },
  heehaw: (c, o, t) => { [0, .45].forEach((d) => { tone(c, o, t + d, .2, 700, 500, 'sawtooth', .12); tone(c, o, t + d + .2, .25, 250, 200, 'sawtooth', .14); }); return .95; },
  neigh: (c, o, t) => { tone(c, o, t, .9, 900, 500, 'sawtooth', .1, 18); return .95; },
  chirp: (c, o, t) => { [0, .12, .24].forEach((d, i) => tone(c, o, t + d, .1, 2000 + i * 300, 3200, 'sine', .2)); return .4; },
  guitar: (c, o, t) => { [196, 247, 294, 392].forEach((f, i) => tone(c, o, t + i * .07, .9, f, f, 'triangle', .18)); return 1.1; },
  trumpet: (c, o, t) => { tone(c, o, t, .9, 300, 520, 'sawtooth', .14, 10); return .95; },
  laser: (c, o, t) => { [0, .2].forEach((d) => tone(c, o, t + d, .18, 1800, 200, 'square', .1)); return .45; },
  robot: (c, o, t) => { [0, .12, .24, .36].forEach((d, i) => tone(c, o, t + d, .1, [440, 660, 330, 880][i], null, 'square', .09)); return .5; },
  tada: (c, o, t) => { tone(c, o, t, .12, 523, 523, 'triangle', .25); tone(c, o, t + .14, .6, 784, 784, 'triangle', .28); tone(c, o, t + .14, .6, 1047, 1047, 'triangle', .15); return .8; },
  tick: (c, o, t) => { tone(c, o, t, .06, 1400, 1400, 'square', .12); return .08; },
  bubble: (c, o, t) => { [0, .15, .3, .45].forEach((d, i) => tone(c, o, t + d, .12, 300 + i * 120, 900 + i * 150, 'sine', .25)); return .6; },
  thud: (c, o, t) => { tone(c, o, t, .35, 110, 40, 'sine', .5); noise(c, o, t, .2, 200, 80, .3); tone(c, o, t + .45, .3, 90, 35, 'sine', .4); return .8; },
  buzz: (c, o, t) => { tone(c, o, t, 1, 520, 640, 'sawtooth', .08, 28); return 1; },
  squish: (c, o, t) => { tone(c, o, t, .3, 180, 320, 'sine', .3, 12); tone(c, o, t + .3, .35, 320, 150, 'sine', .3, 12); return .7; },
  croak: (c, o, t) => { [0, .3].forEach((d) => tone(c, o, t + d, .22, 140, 110, 'square', .12, 35)); return .6; },
  scuttle: (c, o, t) => { for (let i = 0; i < 14; i++) noise(c, o, t + i * .05, .03, 4000, 3000, .25, 3); return .75; },
  bark: (c, o, t) => { [0, .28].forEach((d) => { tone(c, o, t + d, .15, 520, 260, 'sawtooth', .18); noise(c, o, t + d, .12, 900, 500, .2); }); return .5; },
  monkey: (c, o, t) => { tone(c, o, t, .2, 400, 700, 'triangle', .3); tone(c, o, t + .22, .2, 400, 750, 'triangle', .3); tone(c, o, t + .45, .45, 900, 500, 'triangle', .3); return .9; },
  bloop: (c, o, t) => { tone(c, o, t, .25, 200, 800, 'sine', .35); tone(c, o, t + .3, .25, 250, 900, 'sine', .3); return .6; },
  whale: (c, o, t) => { tone(c, o, t, .8, 180, 380, 'sine', .35, 4); tone(c, o, t + .7, .7, 380, 160, 'sine', .3, 4); return 1.4; },
  dolphin: (c, o, t) => { [0, .12, .24, .36, .5].forEach((d, i) => tone(c, o, t + d, .1, 1800 + i * 200, 2600, 'sine', .15)); return .7; },
  purr: (c, o, t) => { for (let i = 0; i < 3; i++) tone(c, o, t + i * .25, .2, 90, 70, 'triangle', .35, 25); return .8; },
  honk: (c, o, t) => { tone(c, o, t, .2, 350, 330, 'square', .12); tone(c, o, t + .25, .35, 330, 300, 'square', .12); return .65; },
  fanfare: (c, o, t) => { [523, 659, 784].forEach((f, i) => tone(c, o, t + i * .14, .14, f, f, 'sawtooth', .12)); tone(c, o, t + .42, .6, 1047, 1047, 'sawtooth', .14, 5); return 1.05; },
  eagle: (c, o, t) => { tone(c, o, t, .6, 2600, 1400, 'sawtooth', .07, 30); noise(c, o, t, .6, 3000, 1800, .15, 4); return .7; },
  horn: (c, o, t) => { tone(c, o, t, .9, 110, 105, 'sawtooth', .15); tone(c, o, t, .9, 165, 160, 'sawtooth', .1); return .95; },
  ding: (c, o, t) => { tone(c, o, t, 1, 1568, 1568, 'sine', .3); tone(c, o, t, .6, 3136, 3136, 'sine', .1); return 1; },
  drum: (c, o, t) => { [0, .2, .4, .55].forEach((d) => { tone(c, o, t + d, .18, 150, 60, 'sine', .5); noise(c, o, t + d, .06, 1200, 600, .15); }); return .8; },
  hoot: (c, o, t) => { tone(c, o, t, .3, 420, 380, 'sine', .35, 6); tone(c, o, t + .4, .5, 420, 360, 'sine', .35, 6); return .95; },
  rocket: (c, o, t) => { noise(c, o, t, 1.2, 200, 3000, .35, .7); tone(c, o, t, 1.2, 100, 900, 'sawtooth', .06); return 1.2; },
  magic: (c, o, t) => { [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(c, o, t + i * .08, .5, f, f, 'triangle', .14)); return .9; },
  swoosh: (c, o, t) => { noise(c, o, t, .35, 400, 5000, .45, 1.5); noise(c, o, t + .4, .25, 5000, 600, .35, 1.5); return .7; },
  roar: (c, o, t) => { noise(c, o, t, 1, 300, 120, .5, .8); tone(c, o, t, 1, 90, 60, 'sawtooth', .2, 8); return 1; },
  hero: (c, o, t) => { [392, 523, 659].forEach((f, i) => tone(c, o, t + i * .12, .12, f, f, 'square', .1)); tone(c, o, t + .36, .7, 784, 784, 'square', .12, 6); return 1.1; },
  thunder: (c, o, t) => { noise(c, o, t, 1.3, 120, 60, .6, .5); [523, 659, 784, 1047].forEach((f) => tone(c, o, t + .5, 1, f, f, 'sine', .08, 5)); return 1.5; },
  choir: (c, o, t) => { [440, 554, 659, 880].forEach((f) => tone(c, o, t, 1.2, f, f, 'triangle', .07, 5)); return 1.2; },
};
function playSfx(name, once) {
  return new Promise((res) => {
    const c = audioCtx(), fn = SOUNDS[name];
    if (!c || !fn) return res();
    try {
      stopSfx();
      // Más fuerte: subimos el volumen y un compresor evita que se distorsione.
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 6;
      sfxOut = c.createGain(); sfxOut.gain.value = once ? 1.5 : 2.6;
      sfxOut.connect(comp).connect(c.destination);
      // Un solo sonido, una sola vez.
      const at = fn(c, sfxOut, c.currentTime + 0.05) + 0.1;
      setTimeout(res, at * 1000 + 200);
    } catch { res(); }
  });
}
function stopSpeaking() {
  speakToken++;
  if (audio) { audio.pause(); audio = null; }
  stopSfx();
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

// ---------- Compartir: abre el menú del teléfono (WhatsApp, etc.) o copia el link ----------
const APP_LINK = 'https://laplatatechos-prog.github.io/profe-de-voz/';
async function shareApp(text) {
  const msg = text || '¡Mirá esta app! Te enseña cualquier tema hablando, te toma examen y te dice qué bicho sos: del Musgo hasta Nivel Dios. ¿Te animás?';
  // En el celular: el menú del teléfono (WhatsApp, Telegram, mail, SMS, Instagram y todas las apps).
  if (navigator.share && /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Profe de Voz', text: msg, url: APP_LINK }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  shareMenu(msg);
}
// En la compu (o si el teléfono no tiene menú): botones para cada lugar.
function shareMenu(msg) {
  const full = `${msg} ${APP_LINK}`, m = encodeURIComponent(msg), u = encodeURIComponent(APP_LINK), f = encodeURIComponent(full);
  const opts = [
    ['💬', 'WhatsApp', `https://wa.me/?text=${f}`],
    ['✈️', 'Telegram', `https://t.me/share/url?url=${u}&text=${m}`],
    ['✉️', 'Mail', `mailto:?subject=${encodeURIComponent('Profe de Voz')}&body=${f}`],
    ['📘', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['✖️', 'X', `https://x.com/intent/post?text=${f}`],
    ['💭', 'SMS', `sms:?body=${f}`],
  ];
  document.querySelectorAll('.share-sheet').forEach((x) => x.remove());
  const d = document.createElement('div'); d.className = 'share-sheet';
  d.innerHTML = `<div class="share-box"><b>📤 Compartir</b>
    <div class="share-grid">${opts.map(([e, n, href]) => `<a class="share-opt" href="${href}" target="_blank" rel="noopener">${e}<span>${n}</span></a>`).join('')}
    <button class="share-opt" id="shCopy">🔗<span>Copiar link</span></button>
    ${navigator.share ? '<button class="share-opt" id="shMore">⋯<span>Más apps</span></button>' : ''}</div>
    <button class="ghost block" id="shClose" style="margin-top:12px">Cerrar</button></div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.onclick = (e) => { if (e.target === d) close(); };
  d.querySelector('#shClose').onclick = close;
  d.querySelectorAll('a.share-opt').forEach((a) => a.addEventListener('click', () => setTimeout(close, 300)));
  d.querySelector('#shCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(full); toast('Copié el link. Pegalo donde quieras.'); } catch { prompt('Copiá este link:', full); }
    close();
  };
  const more = d.querySelector('#shMore');
  if (more) more.onclick = async () => { close(); try { await navigator.share({ title: 'Profe de Voz', text: msg, url: APP_LINK }); } catch {} };
}
// ---------- Cuenta regresiva de 20 segundos para responder ----------
const COUNTDOWN = 20;
let cdTimer = null, cdWait = 0;
function clearCountdown() { clearInterval(cdTimer); cdTimer = null; cdWait++; document.querySelectorAll('.countdown').forEach((x) => x.remove()); }
// Arranca cuando la voz termina de leer la pregunta. Al llegar a 0 manda lo que haya escrito, o "no sé".
function startCountdown(spoken, onZero) {
  clearCountdown();
  const my = cdWait;
  Promise.resolve(spoken).then(() => {
    if (my !== cdWait) return;
    let left = COUNTDOWN;
    const d = document.createElement('div'); d.className = 'countdown';
    d.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="cd-bg"/><circle cx="50" cy="50" r="44" class="cd-ring"/></svg><b>${left}</b>`;
    document.body.appendChild(d);
    const ring = d.querySelector('.cd-ring'), num = d.querySelector('b'), L = 2 * Math.PI * 44;
    ring.style.strokeDasharray = L;
    const paint = () => { num.textContent = left; ring.style.strokeDashoffset = L * (1 - left / COUNTDOWN); d.classList.toggle('hurry', left <= 5); num.classList.remove('beat'); void num.offsetWidth; num.classList.add('beat'); };
    paint();
    cdTimer = setInterval(() => {
      left--; paint();
      if (left > 0 && left <= 5) playSfx('tick', true);
      if (left <= 0) { clearCountdown(); onZero(); }
    }, 1000);
  });
}
// ---------- Navegación ----------
let view = { name: 'home' };
const stack = [];
function go(name, params = {}, push = true) {
  stopSpeaking(); clearCountdown();
  document.querySelectorAll('.confetti').forEach((c) => c.remove());
  if (push) stack.push(view);
  view = { name, ...params };
  render(); window.scrollTo(0, 0);
}
function back() { stopSpeaking(); clearCountdown(); view = stack.pop() || { name: 'home' }; render(); window.scrollTo(0, 0); }
document.getElementById('backBtn').onclick = back;
document.getElementById('settingsBtn').onclick = () => go('settings');
document.getElementById('rankBtn').onclick = () => go('ranking');

function setHeader(title) {
  document.getElementById('title').textContent = title;
  document.getElementById('backBtn').classList.toggle('hidden', view.name === 'home');
  document.getElementById('settingsBtn').classList.toggle('hidden', view.name === 'settings');
  document.getElementById('rankBtn').classList.toggle('hidden', view.name !== 'home' || !SB_URL);
}
const views = {};
// Sin clave propia y sin aprobación del administrador: solo se ve la pantalla de pedir acceso.
const needsAccess = () => !settings.key && !(settings.access && settings.access.status === 'approved');
let lastShown = null;
function render() {
  if (needsAccess() && !['access', 'settings'].includes(view.name)) view = { name: 'access' };
  (views[view.name] || views.home)();
  document.body.classList.toggle('has-answer', view.name === 'module' || view.name === 'exam');
  if (lastShown !== view) { lastShown = view; app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); } // animación solo al cambiar de pantalla
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
      <label class="row" style="gap:10px;color:var(--text);margin-top:10px"><input type="checkbox" id="shareRank" style="width:auto" ${settings.share ? 'checked' : ''}> Aparecer en el ranking (se comparte tu nombre, tus temas y tu nivel)</label>
      <div style="margin-top:14px"><button class="soft" id="testVoice">▶ Probar voz</button></div>
    </div>

    <h2>Tu nombre</h2>
    <div class="card"><div class="row"><input class="grow" id="nameSet" placeholder="Tu nombre" value="${esc(settings.name || '')}"><button class="soft" id="nameSave">Guardar</button></div></div>
    ${settings.key || (settings.access && settings.access.is_admin) ? `<h2>Clave de Claude</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Se guarda solo en este equipo.</p>
      <input id="keyInput" type="password" placeholder="sk-ant-..." autocomplete="off" value="${esc(settings.key)}">
      <div class="row" style="margin-top:10px"><button id="saveKey">Guardar</button><span id="keyMsg" class="muted"></span></div>
      <p class="muted small">Para sacarla: platform.claude.com → Claves (API Keys) → Crear clave. Empieza con sk-ant-.</p>
    </div>` : ''}
    <h2>Administrador</h2>
    <div class="card">
      ${settings.access && settings.access.is_admin ? `<p style="margin-top:0">👑 Sos el administrador.</p>
        <button class="block" id="toAdmin">Ver solicitudes y personas</button>
        ${settings.key ? `<button class="soft block" id="pushKey" style="margin-top:10px">🔑 Usar mi clave para todos (se guarda solo en el servidor)</button>` : ''}
        <div id="adminMsg" class="muted small" style="margin-top:8px">${settings.access.has_key ? '✓ La clave ya está guardada en el servidor.' : 'Falta guardar tu clave en el servidor.'}</div>`
      : `<p class="muted small" style="margin-top:0">Solo para quien maneja la app.</p>
        <div class="row"><input class="grow" id="adminCode" placeholder="Código de administrador" autocomplete="off"><button class="soft" id="adminGo">Entrar</button></div>
        <div id="adminMsg" class="muted small" style="margin-top:8px"></div>`}
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
  $('shareRank').onchange = (e) => { settings.share = e.target.checked; save(); if (settings.share) subjects.forEach(shareScore); else sbRpc('remove_player', { p_player: settings.playerId }).catch(() => {}); };
  $('testVoice').onclick = () => speak('Hola, soy tu profe. Vamos a aprender juntos, de a poco.', $('testVoice'));
  $('nameSave').onclick = () => { settings.name = $('nameSet').value.trim(); save(); toast(settings.name ? `Listo, ${settings.name}.` : 'Nombre borrado.'); };
  $('wipe').onclick = () => {
    if (!confirm('¿Seguro que querés borrar todas las áreas y puntajes? No se puede deshacer.')) return;
    subjects = []; save(); stack.length = 0; view = { name: 'home' }; render(); toast('Listo, se borró todo.');
  };
  if ($('adminGo')) $('adminGo').onclick = async () => {
    $('adminMsg').textContent = 'Revisando…';
    const ok = await sbRpc('claim_admin', { p_player: settings.playerId, p_name: settings.name || 'Admin', p_code: $('adminCode').value }).catch(() => false);
    if (!ok) { $('adminMsg').innerHTML = '<span class="err">Código incorrecto.</span>'; return; }
    if (settings.key) await sbRpc('admin_set_key', { p_player: settings.playerId, p_key: settings.key }).catch(() => {});
    await refreshAccess(); toast('👑 Listo, sos el administrador.'); render();
  };
  if ($('toAdmin')) $('toAdmin').onclick = () => go('admin');
  if ($('pushKey')) $('pushKey').onclick = async () => {
    const ok = await sbRpc('admin_set_key', { p_player: settings.playerId, p_key: settings.key }).catch(() => false);
    await refreshAccess(); $('adminMsg').textContent = ok ? '✓ Clave guardada en el servidor. Los aprobados ya pueden usar la app.' : 'No se pudo guardar.';
  };
  if ($('saveKey')) $('saveKey').onclick = async () => {
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
    ${!settings.name ? `<div class="card name-card"><b>👋 ¡Hola! ¿Cómo te llamás?</b>
      <div class="row" style="margin-top:10px"><input class="grow" id="nameInput" placeholder="Tu nombre"><button id="nameGo">Listo</button></div></div>`
      : `<div class="hello">Hola, ${esc(settings.name)} 👋</div>`}
    <div class="card ask-card">
      <div class="ask-q">¿Qué querés estudiar hoy? 📚</div>
      <input id="topicInput" class="ask-input" placeholder="Escribí o dictá un tema. Ej: reels, inteligencia artificial">
      <button id="topicGo" class="block" style="margin-top:10px">Empezar a estudiar →</button>
      <div id="homeStatus" class="muted small" style="margin-top:8px"></div>
    </div>
    <div class="row share-row">${SB_URL ? '<button class="grow rank-cta" id="toRank">🏆 Ranking</button>' : ''}<button class="grow share-cta" id="shareBtn">📤 Compartir la app</button></div>
    <h2>Mis áreas</h2>
    ${items || '<p class="muted">Todavía no agregaste ninguna.</p>'}`;
  const ng = document.getElementById('nameGo');
  if (ng) { const ni = document.getElementById('nameInput'); ni.onkeydown = (e) => { if (e.key === 'Enter') ng.click(); };
    ng.onclick = () => { const n = ni.value.trim(); if (!n) return; settings.name = n; save(); render(); speak(`Hola, soy tu profe. ¿Qué querés aprender hoy?`); }; }
  const tr = document.getElementById('toRank'); if (tr) tr.onclick = () => go('ranking');
  document.getElementById('shareBtn').onclick = () => shareApp();
  const ts = document.getElementById('toSettings'); if (ts) ts.onclick = (e) => { e.preventDefault(); go('settings'); };
  app.querySelectorAll('[data-sid]').forEach((el) => el.onclick = () => go('subject', { sid: el.dataset.sid }));
  const inp = document.getElementById('topicInput');
  if (settings.name && settings.autoRead && !view.asked) { view.asked = true; speak('¿Qué querés estudiar hoy?'); }
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
    subjects.unshift(s); save(); shareScore(s);
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
- Si el alumno responde la pregunta: {"kind":"answer","correct":1-10,"clarity":1-10,"feedback":"una o dos frases cortas, claras y cálidas, SIN chistes ni ironía (la app ya hizo el chiste): si estuvo bien o qué faltó","explain":"siguiente idea (vacío si ya fue el último paso)","question":"siguiente pregunta (vacío si ya fue el último paso)"}
  Cuando el alumno responde, el feedback, la siguiente idea y la pregunta van SIN chistes, ironías ni bromas: claros y directos.
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
  send.onclick = () => { const t = ans.value.trim(); if (!t) return; ans.value = ''; clearCountdown(); learnTurn(s, st, m, t); };
  if (!view.turns.length) learnTurn(s, st, m, null);
};
function drawTurns() {
  const chat = document.getElementById('chat'); if (!chat) return;
  chat.innerHTML = view.turns.map((t, i) => t.role === 'me'
    ? `<div class="msg me">${esc(t.text)}</div>`
    : `<div class="msg ai">${t.score != null ? `<div class="mini-score ${t.score >= PASS ? 'ok' : 'bad'}">${t.lv ? t.lv.emoji : levelOf(t.score)[2]} ${fmt(t.score)} · ${esc(t.lv ? t.lv.sos : levelOf(t.score)[3])}</div>${t.joke ? `<div class="joke">${esc(t.joke)}</div>` : ''}${t.gossip ? `<div class="gossip">🗣️ ${esc(t.gossip)}</div>` : ''}` : ''}${t.feedback ? `<div class="fb">${esc(t.feedback)}</div>` : ''}${t.explain ? `<div>${esc(t.explain)}</div>` : ''}${t.question ? `<div class="q">❓ ${esc(t.question)}</div>` : ''}
        <button class="plain small say" data-say="${i}">🔊</button></div>`).join('');
  chat.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => speak(turnText(view.turns[+b.dataset.say])));
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}
const scoreLine = (n, lv, withName) => `${withName && settings.name ? settings.name + ', sacaste' : 'Sacaste'} ${fmt(n)}. ${lv ? lv.sos : levelOf(n)[3]}.${lv && lv.sound ? ` {{s:${lv.sound}}}` : ''}`;
// Pausa dramática antes del remate del chiste.
const dramatic = (j) => { if (!j) return ''; const s = j.match(/[^.!?…]+[.!?…]+["”]?\s*/g) || [j]; return s.length < 2 ? j : s.slice(0, -1).join('') + ' {{p}} ' + s[s.length - 1]; };
const turnText = (t) => [t.score != null ? scoreLine(t.score, t.lv) : '', dramatic(t.joke), t.gossip, t.feedback, t.explain, t.question].filter(Boolean).join(' ');
async function learnTurn(s, st, m, text) {
  const keep = view;
  if (view.busy) return; // evita que se pida dos veces lo mismo
  view.busy = true;
  const status = document.getElementById('learnStatus'), send = document.getElementById('send');
  if (text != null) { view.turns.push({ role: 'me', text }); view.msgs.push({ role: 'user', content: text }); drawTurns(); }
  else view.msgs.push({ role: 'user', content: 'EMPEZAR' });
  status.classList.remove('hidden'); send.disabled = true; stopSpeaking();
  try {
    const sys = learnSystem(s, st, m) + `\nPaso actual: ${view.step} de ${STEPS}.`;
    let raw = await askClaude(sys + '\nDevolvé SOLO JSON válido.', view.msgs, 1200, FAST_MODEL);
    let j = parseLoose(raw);
    if (j == null && view === keep) { raw = await askClaude(sys + '\nDevolvé SOLO JSON válido, completo y cerrado, sin texto extra.', view.msgs, 2000); j = parseLoose(raw); }
    if (view !== keep) return;
    if (j == null) throw new Error('El profe se trabó un segundo. Mandá tu respuesta de nuevo.');
    view.busy = false;
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
      const lv = pickLevel(score);
      turn = { role: 'ai', score, lv, joke: lv.joke, gossip: gossip(), feedback: j.feedback, explain: j.explain, question: j.question };
    }
    view.turns.push(turn);
    render();
    const spoken = settings.autoRead ? speak(turnText(turn)) : null;
    if (turn.question) startCountdown(spoken, () => { const a = document.getElementById('ans'); if (!a || view !== keep) return; if (!a.value.trim()) a.value = 'No sé (se terminó el tiempo)'; document.getElementById('send').click(); });
  } catch (e) {
    if (view !== keep) return;
    view.busy = false;
    view.msgs.pop();
    if (text != null) { view.turns.pop(); const a = document.getElementById('ans'); if (a && !a.value) a.value = text; }
    drawTurns();
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
  if (!a) startCountdown(settings.autoRead ? speak(q, qb) : null, () => { const x = document.getElementById('ans'); if (!x) return; if (!x.value.trim()) x.value = 'No sé (se terminó el tiempo)'; document.getElementById('send').click(); });
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
    clearCountdown();
    send.disabled = true; document.getElementById('examStatus').textContent = 'Corrigiendo…';
    try {
      const g = await askJSON(teacher() + ' Corregís exámenes con justicia y de forma alentadora, marcando qué faltó o qué estuvo mal.',
        `Tema: ${s.topic}. Pregunta: ${q}\nRespuesta del alumno: ${answer}\n` +
        'Poné dos notas enteras del 1 al 10: "correct" (qué tan correcta y completa es) y "clarity" (qué tan clara, ordenada y precisa es la explicación; si es correcta pero confusa, baja esta nota). ' +
        'Forma: {"correct":0,"clarity":0,"feedback":"2 a 4 frases: qué estuvo bien, qué faltó o estuvo mal, y cómo decirlo más claro","ideal":"una respuesta modelo breve"}', 800, FAST_MODEL);
      view.answers[i] = { answer, correct: clamp(g.correct), clarity: clamp(g.clarity), feedback: g.feedback, ideal: g.ideal };
      render();
      if (settings.autoRead) speak(g.feedback, app.querySelector('[data-speak="fb"]'));
    } catch (e) { send.disabled = false; document.getElementById('examStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};
// Niveles chistosos (de menor a mayor). "min" = nota mínima. Cada nivel tiene 8 personajes con su sonido y sus chistes cortos,
// más chistes generales del nivel. Se van turnando sin repetir hasta usar todos. Desde 6, todos positivos.
const LEVELS = [
  { min: 0, chars: [
    ['Musgo', 'Sos un Musgo', '🌿', ['Diez años pegado a la misma piedra y aprendiste que la piedra es dura. ¡Algo es algo!', 'El musgo tarda, pero cubre la piedra entera. Vos también, despacito.'], 'bubble'],
    ['Ameba dormida', 'Sos una Ameba dormida', '🫧', ['Te dividiste en dos para estudiar y se durmieron las dos mitades.', 'La ameba no tiene cerebro y sobrevive igual. Vos tenés uno, ¡prendelo!'], 'bubble'],
    ['Piedra con ojos', 'Sos una Piedra con ojos', '🪨', ['Viste la pregunta, viste la respuesta… y no te moviste ni un milímetro.', 'La piedra tardó tres siglos en contestar. Vos menos, ya es un avance.'], 'thud'],
    ['Bacteria de heladera', 'Sos una Bacteria de heladera', '🦠', ['Vivís al lado del dulce de leche y ni así se te endulzó el tema.', 'Prendieron la luz, te preguntaron la lección y te escondiste atrás del tomate.'], 'buzz'],
    ['Hongo de zapatilla', 'Sos un Hongo de zapatilla', '🍄', ['Toda la semana a oscuras oliendo a pata. Hoy por lo menos te dio el sol.', 'Viajás gratis a todos los partidos, pero nunca mirás la pelota.'], 'squish'],
    ['Chicle pegado en el banco', 'Sos un Chicle pegado en el banco', '🫥', ['Veinte años escuchando clases abajo del banco, y nada. Estabas muy ocupado estando pegado.', 'Tu gran virtud es que no te soltás nunca. Pegate al tema, entonces.'], 'pop'],
    ['Pelusa de ombligo', 'Sos una Pelusa de ombligo', '🌀', ['Pasaste el día en un ombligo: todo azul y redondito. Panorama limitado.', 'Nadie sabe de dónde sale la pelusa. Ni esta respuesta tuya.'], 'pop'],
    ['Moho de pan viejo', 'Sos un Moho de pan viejo', '🍞', ['Lunes, un puntito. Viernes, dueño del pan entero. Vos estás en el lunes.', 'Del moho salió la penicilina. Del fondo puede salir algo genial.'], 'bubble'],
  ], jokes: ['Del fondo solo se puede subir. Tenés el ascensor para vos solo.', 'Los dinosaurios también empezaron siendo un bichito. Vos repasás hoy.', 'Hoy fue un día de esos. Mañana, con un repaso, es otro.', 'Como cuando la abuela pregunta si comiste y decís que sí pero no. Así fue este examen.', '¡Qué nivel! ¡Qué capacidad! ¡Qué… bueno, no me sale seguir.'] },
  { min: 2, chars: [
    ['Plancton', 'Sos un Plancton', '🦐', ['Vino la ballena a tomarte lección y te hiciste el desmayado.', 'Chiquitito, pero ya largás burbujitas de conocimiento.'], 'bubble'],
    ['Mosquito despistado', 'Sos un Mosquito despistado', '🦟', ['Toda la noche zumbando cerca de la respuesta y nunca picaste.', 'Al mosquito lo echaron por hacer ruido sin contestar. Vos al menos contestaste.'], 'buzz'],
    ['Lombriz mareada', 'Sos una Lombriz mareada', '🪱', ['Cavaste toda la tarde y saliste en el patio del vecino.', 'La lombriz no tiene ojos y encuentra el camino. Vos tenés dos.'], 'squish'],
    ['Medusa sin GPS', 'Sos una Medusa sin GPS', '🪼', ['Saliste para el arrecife y terminaste en Mar del Plata. "Me dejé llevar", dijiste.', 'Sin cerebro pero con onda. Prendé el GPS mental.'], 'bloop'],
    ['Pulga sin perro', 'Sos una Pulga sin perro', '🐾', ['Saltaste tan alto que te pasaste del perro. Saltar sabés, falta apuntar.', 'Si saltaras cien veces tu nota como la pulga, ya serías Nivel Dios.'], 'boing'],
    ['Mosca de verano', 'Sos una Mosca de verano', '🪰', ['Veinte choques contra el vidrio hasta ver la puerta abierta. Ya casi.', 'Lástima que no ves las preguntas en cámara lenta como las moscas.'], 'buzz'],
    ['Garrapata con sueño', 'Sos una Garrapata con sueño', '🕷️', ['Te subiste al perro para ir al colegio y te despertaste en la veterinaria.', 'Agarrate al tema como garrapata y no lo largues.'], 'scuttle'],
    ['Polilla del ropero', 'Sos una Polilla del ropero', '🦋', ['Te preguntaron de moda y contestaste que la lana es rica.', 'Siempre vas hacia la luz. Hoy la luz es el repaso.'], 'flutter'],
  ], jokes: ['Subiste un escalón de la evolución. Falta la escalera entera.', 'Los gigantes también fueron chiquitos alguna vez.', 'Algo quedó en la cabeza. Ahora lo regamos.', 'Le ganaste a una piedra. Por poquito. La piedra pidió revancha.', 'Estuviste tan cerca de la respuesta como yo de ganar el Quini.'] },
  { min: 3, chars: [
    ['Larvoide', 'Sos un Larvoide', '🐛', ['"Algún día voy a ser mariposa", dijiste. El espejo contestó: "Primero estudiá".', 'Comé tema todo el día como larva y te salen las alas.'], 'squish'],
    ['Renacuajo', 'Sos un Renacuajo', '🐸', ['Todavía con cola, pero ya te asoman las patitas.', 'Nadás en círculos en el charco y pensás que es el océano.'], 'croak'],
    ['Caracol sin casa', 'Sos un Caracol sin casa', '🐌', ['Saliste a las ocho, llegaste a las cinco y sin la casa. Pero llegaste.', '"Disfruto el camino", dice el caracol. Disfrutalo, pero apurá un poco.'], 'squish'],
    ['Gusano de seda dormilón', 'Sos un Gusano de seda dormilón', '🐛', ['Empezaste el capullo, te pusiste cómodo y te dormiste adentro.', 'Con tu seda se hacen vestidos de rey. Ya hilaste un poquito.'], 'squish'],
    ['Babosa de jardín', 'Sos una Babosa de jardín', '🐌', ['Cruzaste el jardín para ir a clase y llegaste al acto de fin de año.', 'Vas dejando un caminito brillante. Poquito, pero brilla.'], 'squish'],
    ['Grillo desafinado', 'Sos un Grillo desafinado', '🦗', ['Cantaste la lección toda la noche y te tiraron una zapatilla. Era la respuesta equivocada.', 'Frotá un poco más las neuronas y te sale la melodía.'], 'cricket'],
    ['Cascarudo panza arriba', 'Sos un Cascarudo panza arriba', '🪲', ['Panza arriba, moviendo las patitas: "Qué lindo se ve el cielo". Dale, date vuelta.', 'Todo cascarudo termina dándose vuelta. Vos también.'], 'thud'],
    ['Ciempiés con calambre', 'Sos un Ciempiés con calambre', '🐛', ['Se te acalambraron las cien patas y llegaste saltando en una. ¡Pero llegaste!', 'Te pusiste a pensar cómo caminar y te caíste. Menos pensar, más repasar.'], 'scuttle'],
  ], jokes: ['Todavía no sos mariposa, pero el capullo está en obra.', 'Ya tenés los bordes del rompecabezas. Falta el medio.', 'La tortuga le ganó a la liebre, acordate.', 'Contestaste con una seguridad bárbara. Lástima que era otra cosa.', 'Me gustó el esfuerzo. Lo demás, lo repasamos.'] },
  { min: 4, chars: [
    ['Araña de rincón', 'Sos una Araña de rincón', '🕷️', ['Tejiste la telaraña y cayó una mosca, un papelito y polvo. La respuesta no.', 'Salí del rincón, que el tema no muerde.'], 'scuttle'],
    ['Cucaracha valiente', 'Sos una Cucaracha valiente', '🪳', ['Prendieron la luz y fuiste la única que se quedó a terminar el examen.', 'Sobrevivís a todo. Ahora vamos por algo más que sobrevivir.'], 'scuttle'],
    ['Hormiga perdida', 'Sos una Hormiga perdida', '🐜', ['Cargaste la miga todo el día… al hormiguero equivocado.', 'Cargás cincuenta veces tu peso. Este tema es pan comido.'], 'scuttle'],
    ['Bicho bolita', 'Sos un Bicho bolita', '🐞', ['Llegó la pregunta difícil y te hiciste bolita. Desenrollate.', 'Rodaste cerquita de la respuesta. Un empujoncito más.'], 'thud'],
    ['Rata de biblioteca', 'Sos una Rata de biblioteca', '🐀', ['Leíste la tapa de todos los libros. Adentro está lo bueno, eh.', 'Rata ya sos. Te falta la biblioteca.'], 'squeak'],
    ['Paloma de plaza', 'Sos una Paloma de plaza', '🐦', ['Escuchaste toda la clase y solo te acordás de dónde había migas.', 'Las palomas siempre vuelven. Vos volvé al tema.'], 'coo'],
    ['Sapo de charco', 'Sos un Sapo de charco', '🐸', ['Creías saber todo del mar hasta que llovió y el charco creció.', 'Saltaste por la mosca y agarraste una hoja. Afiná la puntería.'], 'croak'],
    ['Lagartija apurada', 'Sos una Lagartija apurada', '🦎', ['Contestaste tan rápido que se te cayó la cola. La cola contestaba mejor.', 'Tomá un poco de sol y volvé con todo.'], 'swoosh'],
  ], jokes: ['Casi la mitad: el vaso está medio lleno y el profe trajo la jarra.', 'Estás en la puerta del aprobado. Tocá el timbre con un repaso.', 'Tenés todos los ingredientes. Falta cocinar.', 'Fuiste por medialunas y volviste con las migas. Algo trajiste.', 'El examen se rió un poquito. La próxima te reís último vos.'] },
  { min: 5, chars: [
    ['Cuadrúpedo', 'Sos un Cuadrúpedo', '🐕', ['Viste a un humano en dos patas, dijiste "qué fácil" y te caíste de cola.', 'En cuatro patas se está firme, pero parado se ve más lejos.'], 'bark'],
    ['Mono aprendiz', 'Sos un Mono aprendiz', '🐒', ['Encontraste la banana y la mordiste con cáscara y todo. Casi.', 'Te faltó una sola rama para llegar a la fruta.'], 'monkey'],
    ['Perro de la plaza', 'Sos un Perro de la plaza', '🐶', ['Buscaste la pelota, la encontraste… y te la llevaste a tu casa.', 'Olfato tenés. Te falta un poquito de entrenamiento. ¡Guau!'], 'bark'],
    ['Pulpo en entrenamiento', 'Sos un Pulpo en entrenamiento', '🐙', ['Con cuatro brazos agarraste ideas y con los otros cuatro te rascaste la cabeza.', 'Abrís frascos solo. Estás a un frasco de aprobar.'], 'bloop'],
    ['Gato de tejado', 'Sos un Gato de tejado', '🐈', ['Viste la respuesta desde el tejado pero te dio fiaca bajar.', 'Caíste más o menos parado. La próxima, aterrizaje perfecto.'], 'meow'],
    ['Pato desorientado', 'Sos un Pato desorientado', '🦆', ['Volaste al sur y llegaste al norte. Pero aprendiste geografía.', 'Nadás, caminás y volás, pero nada del todo bien. Ahora a profundizar.'], 'quack'],
    ['Vaca pensativa', 'Sos una Vaca pensativa', '🐄', ['Toda la tarde pensando y al final dijiste: "Muuu". Se notó el esfuerzo.', 'Rumiá el tema dos veces, como la vaca, y te queda grabado.'], 'moo'],
    ['Burro con ganas', 'Sos un Burro con ganas', '🫏', ['"No sé mucho, pero tengo ganas". Con ganas se aprende todo.', 'Dicen que el burro es terco. Con el estudio, eso es virtud.'], 'heehaw'],
  ], jokes: ['Llegaste a la parada justo cuando arranca el colectivo. ¡Corré que lo alcanzás!', 'Raspando, pero en camino. Otro intento y sale.', 'Medio examen en el bolsillo. Vamos por la otra mitad.', 'Cinco: el número más tibio del universo. Como el mate que te olvidaste.', 'Así de cerca, como el colectivo que te cierra la puerta en la cara.'] },
  { min: 6, chars: [
    ['Cachalote bípedo', 'Sos un Cachalote bípedo', '🐋', ['Saliste del mar caminando en dos patas y dijiste: "Vine a aprobar". Y aprobaste.', 'El cerebro más grande del planeta, y ahora sabemos para qué: para aprobar.'], 'whale'],
    ['Carpincho sabio', 'Sos un Carpincho sabio', '🦫', ['Todo el río viene a preguntarte cosas, y vos contestás sin apuro.', 'Tan tranquilo que hasta los pájaros se te sientan encima.'], 'purr'],
    ['Pingüino emprendedor', 'Sos un Pingüino emprendedor', '🐧', ['Te pusiste el traje y abriste un negocio: vender hielo en la Antártida. Éxito total.', 'No volás, pero nadás como campeón. Hoy brillaste en lo tuyo.'], 'honk'],
    ['Delfín con anteojos', 'Sos un Delfín con anteojos', '🐬', ['Te compraste anteojos y sacaste la mejor nota del océano.', 'Inteligente, simpático y siempre sonriendo. Como ahora.'], 'dolphin'],
    ['Caballo de carrera', 'Sos un Caballo de carrera', '🐎', ['Largaste último, pasaste a todos en la recta y llegaste primero. ¡Qué remontada!', 'Se nota el entrenamiento. ¡Al galope!'], 'neigh'],
    ['Loro bilingüe', 'Sos un Loro bilingüe', '🦜', ['Ya repetís las respuestas correctas en dos idiomas.', 'Dicen que el loro solo repite. Vos no repetiste: entendiste.'], 'chirp'],
    ['Oso hormiguero detective', 'Sos un Oso hormiguero detective', '🔎', ['Metiste la nariz en cada pista y resolviste el caso.', 'Metés la nariz donde nadie se anima. Por eso descubrís cosas.'], 'purr'],
    ['Tortuga maratonista', 'Sos una Tortuga maratonista', '🐢', ['Todos se rieron cuando te anotaste en la maratón. Las liebres todavía buscan el camino.', 'Vivís cien años porque no te estresás. Aprobaste con calma.'], 'tada'],
  ], jokes: ['¡Aprobaste! Ya sos del club de los que saben. Hay medialunas.', 'Lo sacaste adelante. Clap, clap, clap.', 'Le estás agarrando la mano. Vamos por más.', 'Raspando, pero adentro. Gol de rebote en el minuto noventa: vale igual.', 'Ya estás del lado de los que aprueban. No te agrandes. Bueno, un poquito.'] },
  { min: 7, chars: [
    ['Presidente de país del tercer mundo', 'Sos un Presidente de país del tercer mundo', '🎩', ['Prometiste saber el tema y, a diferencia de otros presidentes, cumpliste.', 'Ya tenés la banda presidencial. Ahora no te endeudes con el FMI.'], 'fanfare'],
    ['Cóndor andino', 'Sos un Cóndor andino', '🦅', ['Volaste tan alto que desde arriba se veían todas las respuestas.', 'Volás horas sin mover las alas. Aprovechaste bien lo que estudiaste.'], 'eagle'],
    ['Capitán de barco pirata', 'Sos un Capitán de barco pirata', '🏴‍☠️', ['Años buscando el tesoro y era esta nota. Tu loro ya repite las respuestas.', 'La X del mapa marcaba el aprobado. ¡Al abordaje!'], 'horn'],
    ['Chef con estrella', 'Sos un Chef con estrella', '👨‍🍳', ['Plato de restaurante caro. Le faltó una pizca de sal nomás.', 'Un poco más de práctica y te dan la segunda estrella.'], 'ding'],
    ['Gaucho payador', 'Sos un Gaucho payador', '🪕', ['Contestaste en versos y encima estaba bien. Te ganaste un aplauso y un mate.', 'El payador improvisa. Vos no hizo falta: sabías.'], 'guitar'],
    ['León con corona', 'Sos un León con corona', '🦁', ['Te pusiste la corona, rugiste, y las respuestas se acomodaron solas.', 'Dormís veinte horas y las otras cuatro sacás buenas notas.'], 'roar'],
    ['Jirafa ingeniera', 'Sos una Jirafa ingeniera', '🦒', ['Hiciste un puente con el cuello para que todos crucen el río. Inteligente y solidaria.', 'Ya ves el tema desde arriba, sin esfuerzo.'], 'ding'],
    ['Abeja reina', 'Sos una Abeja reina', '🐝', ['Votaron en la colmena quién sabía más. Ganaste vos.', 'Hiciste un examen dulce como la miel.'], 'buzz'],
  ], jokes: ['Ya jugás en primera. Falta poquito para la Selección.', 'Si esto fuera una carrera, ya estás en el podio.', 'El profe está tan contento que ya piensa en el próximo tema.', '¡Pará, pará! ¿Me estás cargando? Ese siete vale un asado.', 'Ya sabés más que mi cuñado, que opina de todo.'] },
  { min: 8, chars: [
    ['Homo erectus', 'Sos un Homo erectus', '🦍', ['Te paraste derechito, miraste alrededor y dijiste: "Uy, ahora entiendo todo".', 'La evolución tardó millones de años en pararse. Vos, un examen.'], 'drum'],
    ['Lechuza doctora', 'Sos una Lechuza doctora', '🦉', ['Todo el bosque viene a consultarte. Hoy atendiste vos.', 'Ves clarito hasta de noche. Doctora en el tema.'], 'hoot'],
    ['Astronauta', 'Sos un Astronauta', '🧑‍🚀', ['Despegaste y llegaste a la Luna. "Houston, no tenemos ningún problema".', 'Este tema ya te queda chico, te vas al espacio.'], 'rocket'],
    ['Mago de barrio', 'Sos un Mago de barrio', '🧙', ['Abracadabra, y de la galera salieron todas las respuestas.', 'No es magia, es práctica. Por eso salió el truco.'], 'magic'],
    ['Científico loco', 'Sos un Científico loco', '🧪', ['Mezclaste dos ideas, salió humo violeta y una respuesta perfecta. ¡Eureka!', 'Los científicos se equivocan mil veces. Vos acertaste de una.'], 'laser'],
    ['Elefante con memoria de oro', 'Sos un Elefante con memoria de oro', '🐘', ['Te acordaste de todo. Hasta del chiste del módulo anterior.', 'Hoy tu conocimiento fue tamaño elefante.'], 'trumpet'],
    ['Detective de lupa', 'Sos un Detective de lupa', '🕵️', ['Lupa en mano, encontraste cada pista. "Elemental". Caso cerrado.', 'No se te escapó casi nada. Así trabaja un detective.'], 'ding'],
    ['Puma inventor', 'Sos un Puma inventor', '🐆', ['Inventaste una máquina de aprobar exámenes. Funciona bárbaro, se ve.', 'Rápido, ágil y sin hacer ruido. Así respondiste.'], 'roar'],
  ], jokes: ['Ya podrías explicarle el tema a otro. Y te entenderían.', 'El profe le contó a todos los otros profes.', 'Te falta muy poquito para la cima.', 'Me estás haciendo quedar mal a mí, que soy el profe.', 'Si esto fuera fútbol, ya te llaman de Europa.'] },
  { min: 9, chars: [
    ['Ninja supremo', 'Sos un Ninja supremo', '🥷', ['Entraste sin ruido, respondiste todo y el profe ni se dio cuenta de que terminaste.', 'Cinturón negro en este tema.'], 'swoosh'],
    ['Dragón sabio', 'Sos un Dragón sabio', '🐉', ['Escupís fuego y respuestas correctas. Las dos queman.', 'Mil años de sabiduría en un solo examen.'], 'roar'],
    ['Superhéroe del barrio', 'Sos un Superhéroe del barrio', '🦸', ['Salvaste el examen sin despeinarte la capa.', 'Tu superpoder: saberte el tema de memoria.'], 'hero'],
    ['Campeón del mundo', 'Sos un Campeón del mundo', '🏆', ['Último minuto de la final, última pregunta y… ¡gol! Vuelta olímpica.', '¡Dale campeón! Se nota el entrenamiento.'], 'fanfare'],
    ['Samurái del saber', 'Sos un Samurái del saber', '⚔️', ['Cortaste cada pregunta a la mitad, hiciste una reverencia y te fuiste.', 'Honor, disciplina y conocimiento. Todo junto.'], 'swoosh'],
    ['Robot del futuro', 'Sos un Robot del futuro', '🤖', ['Vino un robot del año 3000, te escaneó y dijo: "Error. Este humano sabe más que yo".', 'Nivel de conocimiento: altísimo. Recomendación: seguí así.'], 'robot'],
    ['Águila imperial', 'Sos un Águila imperial', '🦅', ['Viste la respuesta desde tres kilómetros y bajaste en picada a agarrarla.', 'La mejor vista del cielo y del tema.'], 'eagle'],
    ['Fénix renacido', 'Sos un Fénix renacido', '🔥', ['Quemaste el tema de tanto estudiarlo y renaciste sabio.', 'Tus respuestas curan cualquier duda.'], 'magic'],
  ], jokes: ['Casi perfecto. El examen te quiere pedir un autógrafo.', 'Nivel maestro. Pocos llegan hasta acá.', 'Si seguís así, el profe te va a pedir clases a vos.', '¿Querés que te aplauda de pie? Ya estoy de pie.', 'No tengo nada para corregirte, y a un profe eso le duele.'] },
  { min: 9.7, chars: [
    ['Dios', 'Sos un Dios', '⚡', ['El examen te vio y te pidió disculpas por molestarte.', 'Ya no estudiás el tema: el tema te estudia a vos. Y saca un dos.'], 'thunder'],
    ['Leyenda viviente', 'Sos una Leyenda viviente', '🌟', ['Te van a hacer una estatua en la plaza. Con palomas, pero estatua.', 'Dentro de mil años van a contar este examen.'], 'choir'],
    ['Rey del universo', 'Sos el Rey del universo', '👑', ['Las estrellas votaron al rey del universo. Ganaste por unanimidad.', 'Hasta el sol te pidió un autógrafo.'], 'fanfare'],
    ['Unicornio genio', 'Sos un Unicornio genio', '🦄', ['Un unicornio aparece cada mil años y saca diez. Hoy apareció.', 'Tan perfecto que el arcoíris se puso celoso.'], 'magic'],
    ['Mente galáctica', 'Sos una Mente galáctica', '🌌', ['Los extraterrestres te escucharon y ya te mandaron la nave para que les des clases.', 'Tu cerebro ya no entra en este planeta.'], 'choir'],
    ['Sol en persona', 'Sos el Sol en persona', '☀️', ['Brillaste tanto que el profe se tuvo que poner anteojos de sol.', 'Este examen tuvo luz propia: la tuya.'], 'choir'],
    ['Cerebro cósmico', 'Sos un Cerebro cósmico', '🧠', ['Quisieron medir tu cerebro y se rompió la máquina.', 'Tus neuronas hicieron una fiesta y todas sacaron diez.'], 'laser'],
    ['Titán del Olimpo', 'Sos un Titán del Olimpo', '🏛️', ['Los dioses del Olimpo te vieron y te hicieron lugar en la mesa.', 'Sostenés todo el tema sin despeinarte.'], 'thunder'],
  ], jokes: ['No hay nada más que enseñarte. El profe se va de vacaciones.', 'Desbloqueaste el final secreto del juego.', 'Te reservamos el aula y la tiza.', 'Me rindo. Te doy la tiza, el pizarrón y el sueldo. Bueno, el sueldo no.', 'Este examen lo cuelgo en el living, al lado de la foto de la abuela.'] },
];
const levelFor = (n) => [...LEVELS].reverse().find((l) => n >= l.min) || LEVELS[0];
// Lo que ya salió: no se repite un personaje ni un chiste hasta haber pasado por todos.
let rot = store.get('profe-rot2', { bags: {}, last: {}, used: [] });
function pickLevel(n) {
  const l = levelFor(n), key = String(l.min);
  let bag = (rot.bags[key] || []).filter((nm) => l.chars.some((c) => c[0] === nm));
  if (!bag.length) bag = l.chars.map((c) => c[0]).filter((nm) => nm !== rot.last[key] || l.chars.length < 2); // bolsa nueva, sin repetir el último
  const name = bag[Math.floor(Math.random() * bag.length)];
  rot.bags[key] = bag.filter((x) => x !== name); rot.last[key] = name;
  const c = l.chars.find((x) => x[0] === name);
  const pool = c[3].concat(l.jokes);
  let fresh = pool.filter((j) => !rot.used.includes(j));
  if (!fresh.length) { rot.used = rot.used.filter((j) => !pool.includes(j)); fresh = pool; }
  const joke = fresh[Math.floor(Math.random() * fresh.length)];
  rot.used.push(joke); if (rot.used.length > 300) rot.used = rot.used.slice(-300);
  store.set('profe-rot2', rot);
  return { name: 'Nivel ' + c[0], sos: c[1], emoji: c[2], sound: c[4], joke };
}
const jokeFor = (n) => pickLevel(n).joke;
const levelOf = (n) => { const c = levelFor(n).chars[0]; return [n, 'Nivel ' + c[0], c[2], c[1]]; };
const modBest = (m) => (m.scores && m.scores.length ? Math.max(...m.scores) : null);
function stageScore(st) {
  const xs = (st.modules || []).map(modBest).filter((x) => x != null).concat(st.exams.map((e) => e.score));
  return xs.length ? average((st.modules || []).map(modBest).filter((x) => x != null).length ? (st.modules || []).map(modBest).filter((x) => x != null) : xs) : null;
}
const clamp = (n) => Math.max(1, Math.min(10, Math.round(+n || 1)));
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// ---------- Acceso: pedir permiso al administrador ----------
async function refreshAccess() {
  try {
    const rows = await sbRpc('my_status', { p_player: settings.playerId });
    const a = rows && rows[0];
    if (a) { settings.access = { status: a.status, is_admin: a.is_admin, has_key: a.has_key }; save(); }
  } catch {}
  return settings.access;
}
views.access = () => {
  setHeader('Profe de Voz');
  const st = (settings.access && settings.access.status) || 'none';
  const name = settings.name || '';
  app.innerHTML = `
    <div class="card ask-card" style="text-align:center">
      <div style="font-size:64px">${st === 'pending' ? '⏳' : st === 'rejected' ? '🚫' : '👋'}</div>
      ${st === 'pending' ? `<div class="ask-q">¡Listo, ${esc(name)}! Tu pedido está esperando</div>
          <p class="muted">El administrador tiene que aprobarte. Avisale por WhatsApp así lo ve rápido.</p>
          <button class="block" id="nudge">💬 Avisarle que pedí entrar</button>
          <button class="soft block" id="recheck" style="margin-top:10px">🔄 Ya me aprobó, revisar</button>`
      : st === 'rejected' ? `<div class="ask-q">Tu pedido no fue aprobado</div>
          <p class="muted">Si creés que es un error, hablá con el administrador y volvé a pedirlo.</p>
          <button class="block" id="ask">Pedir acceso de nuevo</button>`
      : `<div class="ask-q">Para entrar, pedile permiso al administrador</div>
          <p class="muted">Escribí tu nombre y mandale la solicitud. Cuando te apruebe, ya podés estudiar.</p>
          <input id="accName" class="ask-input" placeholder="Tu nombre" value="${esc(name)}">
          <button class="block" id="ask" style="margin-top:10px">🙋 Pedir acceso</button>`}
      <div id="accMsg" class="muted small" style="margin-top:10px"></div>
    </div>
    <p class="muted small" style="text-align:center">¿Sos el administrador? Entrá en <a href="#" id="accAdmin">Configuración</a>.</p>`;
  const $ = (id) => document.getElementById(id);
  $('accAdmin').onclick = (e) => { e.preventDefault(); go('settings'); };
  if ($('ask')) $('ask').onclick = async () => {
    const n = ($('accName') ? $('accName').value : settings.name || '').trim();
    if (!n) { $('accMsg').textContent = 'Escribí tu nombre primero.'; return; }
    settings.name = n; save(); $('accMsg').textContent = 'Enviando…';
    try { const s = await sbRpc('request_access', { p_player: settings.playerId, p_name: n }); settings.access = { status: s || 'pending' }; save(); render(); }
    catch { $('accMsg').textContent = 'No pude enviar el pedido. ¿Tenés internet?'; }
  };
  if ($('recheck')) $('recheck').onclick = async () => {
    $('accMsg').textContent = 'Revisando…';
    await refreshAccess();
    if (settings.access && settings.access.status === 'approved') { toast('¡Te aprobaron! 🎉'); view = { name: 'home' }; render(); }
    else $('accMsg').textContent = 'Todavía no. Probá en un ratito.';
  };
  if ($('nudge')) $('nudge').onclick = () => shareApp(`Hola, soy ${settings.name}. Te mandé una solicitud para entrar a Profe de Voz. ¿Me aprobás?`);
};
views.admin = () => {
  setHeader('Administrador');
  const draw = () => {
    const rows = view.rows || [];
    const label = { pending: '⏳ Esperando', approved: '✅ Aprobado', rejected: '🚫 Rechazado' };
    app.innerHTML = `
      <div class="card ask-card"><div class="ask-q">👑 Solicitudes y personas</div>
        <div class="muted small">Cada persona aprobada usa tu clave desde el servidor. Cada respuesta del profe es 1 consulta. Podés cambiar el límite diario de cada uno.</div></div>
      ${view.err ? `<div class="card err">${esc(view.err)}</div>` : !view.rows ? '<p class="muted">Cargando…</p>' : !rows.length ? '<p class="muted">Todavía nadie pidió entrar.</p>'
        : rows.map((m) => `<div class="card">
            <div class="between"><b>${esc(m.name)}${m.is_admin ? ' 👑' : ''}</b><span class="small">${label[m.status] || m.status}</span></div>
            <div class="muted small">Hoy: ${m.used_today}${m.is_admin ? '' : ` de ${m.daily_limit}`} consultas · En total: ${m.total_used} · Pidió el ${new Date(m.created_at).toLocaleDateString('es-AR')}</div>
            ${m.is_admin ? '' : `<div class="row" style="margin-top:8px;gap:8px;align-items:center"><span class="small">Límite por día:</span><input type="number" min="0" max="5000" value="${m.daily_limit}" data-lim="${m.player}" style="width:90px"><button class="soft" data-limsave="${m.player}">Guardar</button></div>`}
            ${m.is_admin ? '' : `<div class="row" style="margin-top:10px;gap:8px">
              ${m.status !== 'approved' ? `<button class="grow" data-ok="${m.player}">✅ Aprobar</button>` : ''}
              ${m.status !== 'rejected' ? `<button class="grow ghost" data-no="${m.player}">🚫 ${m.status === 'approved' ? 'Quitar acceso' : 'Rechazar'}</button>` : ''}</div>`}
          </div>`).join('')}
      <button class="soft block" id="reload">🔄 Actualizar</button>`;
    const set = async (target, status) => { await sbRpc('admin_set_status', { p_player: settings.playerId, p_target: target, p_status: status }).catch(() => {}); load(); };
    app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => set(b.dataset.ok, 'approved'));
    app.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => set(b.dataset.no, 'rejected'));
    app.querySelectorAll('[data-limsave]').forEach((b) => b.onclick = async () => {
      const v = +app.querySelector(`[data-lim="${b.dataset.limsave}"]`).value;
      const ok = await sbRpc('admin_set_limit', { p_player: settings.playerId, p_target: b.dataset.limsave, p_limit: v }).catch(() => false);
      toast(ok ? `Límite guardado: ${v} por día.` : 'No se pudo guardar.'); load();
    });
    document.getElementById('reload').onclick = load;
  };
  const load = () => sbRpc('admin_people', { p_player: settings.playerId })
    .then((r) => { view.rows = r || []; view.err = null; }).catch((e) => { view.err = e.message; })
    .finally(() => { if (view.name === 'admin') draw(); });
  draw(); if (!view.rows) load();
};
// Al abrir: revisa el estado de acceso (por si lo aprobaron mientras tanto).
setTimeout(() => refreshAccess().then(() => { if (view.name === 'access' && !needsAccess()) { view = { name: 'home' }; render(); } else if (view.name === 'access' || view.name === 'settings') render(); }), 500);
// ---------- Ranking compartido (Supabase, plan gratis) ----------
// Esta clave es "publicable": está hecha para ir en la app. Solo deja usar las dos funciones del ranking.
const uuid4 = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
if (!/^[0-9a-f-]{36}$/i.test(settings.playerId || '')) { settings.playerId = uuid4(); save(); }
if (settings.share == null) { settings.share = true; save(); }
async function sbRpc(fn, body) {
  if (!SB_URL) throw new Error('El ranking todavía no está conectado.');
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('No pude conectar con el ranking.');
  const txt = await r.text();
  try { return txt ? JSON.parse(txt) : null; } catch { return null; }
}
const subjAvg = (s) => average(s.stages.map(stageScore).filter((x) => x != null));
function shareScore(s) {
  const avg = subjAvg(s);
  if (!settings.share || !SB_URL) return;
  const l = avg != null ? levelOf(avg) : [0, '', s.emoji || '📘'];
  // Sube también si recién empezó (sin nota), así los demás ven qué está estudiando.
  sbRpc('submit_score', { p_player: settings.playerId, p_name: (settings.name || 'Alguien sin nombre').slice(0, 30), p_topic: s.topic.slice(0, 60), p_avg: avg != null ? Math.round(avg * 10) / 10 : null, p_level: l[1], p_emoji: l[2] }).then(() => { rankAt = 0; }).catch(() => {});
}
// Al abrir la app, sube los puntajes que ya tenías (por si ya estudiaste antes de que existiera el ranking).
setTimeout(() => { subjects.forEach(shareScore); rankingRows().catch(() => {}); }, 3000);
// ---------- Lo que el profe te cuenta "por lo bajo" sobre cómo les va a los demás ----------
let rankCache = null, rankAt = 0;
async function rankingRows() {
  if (rankCache && Date.now() - rankAt < 5 * 60 * 1000) return rankCache;
  rankCache = ((await sbRpc('get_ranking', { p_player: settings.playerId })) || []).map((r) => ({ ...r, avg: r.avg == null ? null : +r.avg }));
  rankAt = Date.now();
  return rankCache;
}
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
// Solo cuando hay NOVEDAD de otra persona (tema nuevo, nota nueva o cambio de nivel). Cada novedad se cuenta una vez.
let seenGossip = store.get('profe-chismes', null);
function gossip() {
  rankingRows().catch(() => {});
  const rows = rankCache; if (!rows) return '';
  const me = 'che';
  const others = rows.filter((r) => !r.me);
  const sig = (r) => `${r.avg == null ? '-' : r.avg}|${r.level || ''}`;
  if (!seenGossip) { seenGossip = {}; } // primera vez: todo lo de los demás es novedad
  const news = others.filter((r) => seenGossip[r.player + '|' + r.topic] !== sig(r));
  if (!news.length) {
    if (!others.length && !seenGossip.__solo) { seenGossip.__solo = 1; store.set('profe-chismes', seenGossip); return `Te cuento una cosa, ${me}, pero no se lo digas a nadie… todavía no hay nadie más en el ranking. O sea que sos el primero… y también el último. Compartí la app, así tengo de quién hablar.`; }
    return '';
  }
  const o = pickOne(news), key = o.player + '|' + o.topic, before = seenGossip[key];
  seenGossip[key] = sig(o); store.set('profe-chismes', seenGossip);
  const n = o.name, tp = o.topic, L = o.level, a = o.avg != null ? fmt(o.avg) : null;
  const mine = rows.find((r) => r.me && r.topic === tp && r.avg != null);
  const prevAvg = before && before.split('|')[0] !== '-' ? +before.split('|')[0] : null;
  if (a == null) return pickOne([
    `Te cuento una cosa, pero no te quiero decir nada… ${n} empezó a estudiar ${tp}. Todavía no rindió nada. Se hace el misterioso. Yo no te dije nada, ¿eh?`,
    `Psst… no sé si debería contarte esto. ${n} arrancó con ${tp}. Viene con todo, o eso dice. Vos hacete el que no sabe.`,
  ]);
  if (prevAvg != null && o.avg > prevAvg) return `No te quiero decir nada, pero… ${n} subió en ${tp}. Ahora tiene ${a} y está en el ${L}. Se está poniendo las pilas. Yo no te dije nada, ¿eh?`;
  if (prevAvg != null && o.avg < prevAvg) return `Esto queda entre nosotros… ${n} bajó un poquito en ${tp}. Ahora tiene ${a}, en el ${L}. Pobre, pasale un mate. Pero yo no te conté nada.`;
  if (mine && o.avg > mine.avg) return `Che, te cuento una cosa, pero no te quiero decir nada… ${n} ya está en el ${L} en ${tp}, con ${a}. Y vos ahí, en el ${mine.level}… Yo no te dije nada, ¿eh?`;
  if (mine && o.avg < mine.avg) return `Shh, esto no te lo dije yo… en ${tp} le estás ganando a ${n}, que está en el ${L} con ${a}. Hacete el humilde, ¿eh?`;
  return pickOne([
    `Te cuento una cosa, pero no te quiero decir nada… ${n} está estudiando ${tp} y ya sacó ${a}. Está en el ${L}. Yo no te dije nada, ¿eh?`,
    `Psst… me dijeron por ahí que ${n} anda con ${tp}. Sacó ${a} y quedó en el ${L}. Ya se la cree, ¿viste? Pero no te dije nada.`,
  ]);
}
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
views.ranking = () => {
  setHeader('Ranking');
  const draw = () => {
    const rows = view.rows || [];
    const topics = [...new Set(rows.map((r) => r.topic))];
    let list;
    if (view.tab === 'general' || !view.tab) {
      const by = {};
      rows.forEach((r) => { const k = r.player; by[k] = by[k] || { name: r.name, me: r.me, xs: [], rs: [] }; if (r.avg != null) by[k].xs.push(r.avg); by[k].rs.push(r); });
      list = Object.values(by).map((p) => { const avg = average(p.xs); const one = p.rs.filter((x) => x.avg != null); const l = avg == null ? [0, 'Recién empezando', '🐣'] : one.length === 1 ? [0, one[0].level, one[0].emoji] : levelOf(avg); return { ...p, avg, level: l[1], emoji: l[2], extra: `Estudia: ${[...new Set(p.rs.map((x) => x.topic))].join(', ')}` }; });
    } else list = rows.filter((r) => r.topic === view.tab).map((r) => ({ ...r }));
    list.forEach((x) => { if (x.avg == null) { x.level = x.level || 'Recién empezó, todavía sin nota'; x.emoji = x.emoji || '🐣'; } });
    list.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
    app.innerHTML = `
      <div class="card ask-card"><div class="ask-q">🏆 ¿Quién sabe más?</div>
        <div class="muted small">Acá ves el nivel y el personaje de todas las personas que usan la app.</div></div>
      <div class="chips">
        <button class="chip ${!view.tab || view.tab === 'general' ? 'on' : ''}" data-tab="general">🌎 General</button>
        ${topics.map((t) => `<button class="chip ${view.tab === t ? 'on' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      ${view.err ? `<div class="card err">${esc(view.err)}</div>` : !view.rows ? '<p class="muted">Cargando…</p>'
        : !list.length ? '<p class="muted">Todavía no hay nadie. ¡Rendí un examen y sé el primero!</p>'
        : list.map((p, i) => `<div class="card rank-row ${p.me ? 'me' : ''}">
            <div class="rank-pos">${medal(i)}</div>
            <div class="rank-emoji">${p.emoji}</div>
            <div class="grow"><b>${esc(p.name)}${p.me ? ' (vos)' : ''}</b><div class="small">${esc(p.level)}</div><div class="muted small">${esc(p.extra || '')}</div></div>
            ${p.avg != null ? `<div class="pill ${p.avg >= PASS ? 'ok' : 'bad'}">${fmt(p.avg)}</div>` : ''}</div>`).join('')}
      ${!settings.share ? '<p class="muted small">Vos no aparecés porque desactivaste "Aparecer en el ranking" en Configuración.</p>' : !settings.name ? '<p class="muted small">Para aparecer, poné tu nombre en Configuración.</p>' : ''}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { view.tab = b.dataset.tab; draw(); });
  };
  draw();
  if (!view.rows && !view.loading) {
    view.loading = true;
    sbRpc('get_ranking', { p_player: settings.playerId })
      .then((rows) => { view.rows = (rows || []).map((r) => ({ ...r, avg: r.avg == null ? null : +r.avg })); })
      .catch((e) => { view.err = e.message; })
      .finally(() => { view.loading = false; if (view.name === 'ranking') draw(); });
  }
};
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
    save(); shareScore(s);
    return go('result', { sid: s.id, si: view.si, mi: view.mi, type: 'modulo', score, correct, clarity, unlocked, feedback: view.lastFeedback }, false);
  }
  st.exams.push({ type: view.type, date: Date.now(), score, correct, clarity });
  if (cfg.unlocks && score >= PASS && !st.done) {
    st.done = true; unlocked = true;
    if (s.current === view.si) s.current = Math.min(view.si + 1, s.stages.length - 1);
  }
  save(); shareScore(s);
  go('result', { sid: s.id, si: view.si, type: view.type, score, correct, clarity, unlocked }, false);
}

views.result = () => {
  const s = getSubj(), st = s.stages[view.si], cfg = EXAMS[view.type], ok = view.score >= PASS;
  setHeader('Resultado');
  const isMod = view.type === 'modulo';
  const m = isMod ? st.modules[view.mi] : null;
  const lastMod = isMod && view.mi === st.modules.length - 1;
  if (!view.lv) { view.lv = pickLevel(view.score); view.joke = view.lv.joke; view.gossip = gossip(); }
  const msg = ok ? (view.unlocked ? '¡Terminaste la etapa! Se habilitó la siguiente.' : view.score >= 8 ? '¡Excelente!' : '¡Muy bien!') : 'Todavía no. Repetí el módulo y probá de nuevo.';
  app.innerHTML = `
    <div class="result-screen ${ok ? 'pass' : 'fail'}">
      <div class="result-inner">
        <div class="result-topic">${isMod ? esc(m.title) : esc(cfg.name) + ' · ' + esc(st.title)}</div>
        <div class="result-emoji">${view.lv.emoji}</div>
        <div class="result-label">${settings.name ? esc(settings.name) + ", sacaste" : "Sacaste"}</div>
        <div class="result-num">${fmt(view.score)}</div>
        <div class="result-level">${esc(view.lv.sos)}</div>
        <div class="result-joke">${esc(view.joke)}</div>
        ${view.gossip ? `<div class="result-gossip">🗣️ ${esc(view.gossip)}</div>` : ''}
        ${view.feedback ? `<div class="result-joke" style="font-style:normal">${esc(view.feedback)}</div>` : ""}
        <div class="result-msg">${msg}</div>
        <div class="result-sub"><span>Corrección <b>${fmt(view.correct)}</b></span><span>Claridad <b>${fmt(view.clarity)}</b></span></div>
        ${isMod ? `
          ${ok ? '' : '<button class="block result-btn" id="repeat">↻ Repetir módulo</button>'}
          ${!lastMod ? `<button class="block result-btn ${ok ? '' : 'ghost'}" id="nextMod">Siguiente módulo →</button>` : ''}
          ${ok ? `<button class="block result-btn ${lastMod ? '' : 'ghost'}" id="repeat">↻ Repetir módulo</button>` : ''}
          <button class="block result-btn ghost" id="shareLvl">📤 Compartir mi nivel</button>
          <button class="block result-btn ghost" id="toSubj">Volver al temario</button>` : `
          <button class="block result-btn" id="toSubj">Volver al temario</button>
          <button class="block result-btn ghost" id="again">Elegir otro examen</button>
          <button class="block result-btn ghost" id="shareLvl">📤 Compartir mi nivel</button>`}
      </div>
    </div>`;
  speak(`${scoreLine(view.score, view.lv, true)} {{p}} ${dramatic(view.joke)} ${view.gossip || ''} ${view.feedback || ''} ${msg}`);
  if (ok) confetti();
  document.getElementById('toSubj').onclick = () => { stack.length = 0; view = { name: 'home' }; go('subject', { sid: s.id }); };
  document.getElementById('shareLvl').onclick = () => shareApp(`${settings.name ? settings.name + ' sacó' : 'Saqué'} ${fmt(view.score)} en ${s.topic}: ${view.lv.sos.replace(/^Sos/, settings.name ? 'es' : 'soy')} ${view.lv.emoji}. ¿Te animás a superarlo? Probá la app:`);
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
// Precarga la voz natural en segundo plano, así la primera lectura no se demora.
setTimeout(() => { if (settings.engine === 'piper' && settings.piperVoice) piperSessionFor(settings.piperVoice).catch(() => {}); }, 2500);
