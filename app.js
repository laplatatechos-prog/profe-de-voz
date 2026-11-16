// Profe de Voz — aprendé cualquier tema por módulos cortos, con exámenes y puntaje.
// Todo se guarda en este navegador (localStorage). La clave de API solo viaja a la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const APP_VERSION = 23;
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
  if (wasThis) return Promise.resolve(); // segundo toque = parar
  speakingBtn = btn || null;
  if (btn) btn.textContent = '■ Parar';
  const token = speakToken;
  // El texto puede traer marcas {{s:nombre}}: ahí suena el sonido del personaje.
  const segs = String(text).split(/\{\{s:(\w+)\}\}/);
  return (async () => {
    for (let i = 0; i < segs.length; i++) {
      if (token !== speakToken) return;
      if (i % 2) { await playSfx(segs[i]); continue; }
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
    u.rate = settings.rate || 1;
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
      sfxOut = c.createGain(); sfxOut.gain.value = once ? 1.5 : 3.2;
      sfxOut.connect(comp).connect(c.destination);
      // Más largo: el sonido se repite hasta durar unos 2,5 segundos.
      let at = 0;
      do { at += fn(c, sfxOut, c.currentTime + 0.05 + at) + 0.12; } while (!once && at < 2.3);
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
      <label class="row" style="gap:10px;color:var(--text);margin-top:10px"><input type="checkbox" id="shareRank" style="width:auto" ${settings.share ? 'checked' : ''}> Aparecer en el ranking (se comparte tu nombre, tus temas y tu nivel)</label>
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
  $('shareRank').onchange = (e) => { settings.share = e.target.checked; save(); if (settings.share) subjects.forEach(shareScore); else sbRpc('remove_player', { p_player: settings.playerId }).catch(() => {}); };
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
    <div class="card ask-card">
      <div class="ask-q">${settings.name ? esc(settings.name) + ', ¿qué' : '¿Qué'} querés estudiar hoy? 📚</div>
      <input id="topicInput" class="ask-input" placeholder="Escribí o dictá un tema. Ej: reels, inteligencia artificial">
      <button id="topicGo" class="block" style="margin-top:10px">Empezar a estudiar →</button>
      <div id="homeStatus" class="muted small" style="margin-top:8px"></div>
    </div>
    <div class="row share-row">${SB_URL ? '<button class="grow rank-cta" id="toRank">🏆 Ranking</button>' : ''}<button class="grow share-cta" id="shareBtn">📤 Compartir la app</button></div>
    <h2>Mis áreas</h2>
    ${items || '<p class="muted">Todavía no agregaste ninguna.</p>'}`;
  const ng = document.getElementById('nameGo');
  if (ng) { const ni = document.getElementById('nameInput'); ni.onkeydown = (e) => { if (e.key === 'Enter') ng.click(); };
    ng.onclick = () => { const n = ni.value.trim(); if (!n) return; settings.name = n; save(); render(); speak(`Hola ${n}, soy tu profe. ¿Qué querés aprender hoy?`); }; }
  const tr = document.getElementById('toRank'); if (tr) tr.onclick = () => go('ranking');
  document.getElementById('shareBtn').onclick = () => shareApp();
  const ts = document.getElementById('toSettings'); if (ts) ts.onclick = (e) => { e.preventDefault(); go('settings'); };
  app.querySelectorAll('[data-sid]').forEach((el) => el.onclick = () => go('subject', { sid: el.dataset.sid }));
  const inp = document.getElementById('topicInput');
  if (settings.name && settings.autoRead && !view.asked) { view.asked = true; speak(`${settings.name}, ¿qué querés estudiar hoy?`); }
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
  send.onclick = () => { const t = ans.value.trim(); if (!t) return; ans.value = ''; clearCountdown(); learnTurn(s, st, m, t); };
  if (!view.turns.length) learnTurn(s, st, m, null);
};
function drawTurns() {
  const chat = document.getElementById('chat'); if (!chat) return;
  chat.innerHTML = view.turns.map((t, i) => t.role === 'me'
    ? `<div class="msg me">${esc(t.text)}</div>`
    : `<div class="msg ai">${t.score != null ? `<div class="mini-score ${t.score >= PASS ? 'ok' : 'bad'}">${t.lv ? t.lv.emoji : levelOf(t.score)[2]} ${fmt(t.score)} · ${esc(t.lv ? t.lv.sos : levelOf(t.score)[3])}</div>${t.joke ? `<div class="joke">${esc(t.joke)}</div>` : ''}` : ''}${t.feedback ? `<div class="fb">${esc(t.feedback)}</div>` : ''}${t.explain ? `<div>${esc(t.explain)}</div>` : ''}${t.question ? `<div class="q">❓ ${esc(t.question)}</div>` : ''}
        <button class="plain small say" data-say="${i}">🔊</button></div>`).join('');
  chat.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => speak(turnText(view.turns[+b.dataset.say])));
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}
const scoreLine = (n, lv) => `${settings.name ? settings.name + ', sacaste' : 'Sacaste'} ${fmt(n)}. ${lv ? lv.sos : levelOf(n)[3]}.${lv && lv.sound ? ` {{s:${lv.sound}}}` : ''}`;
const turnText = (t) => [t.score != null ? scoreLine(t.score, t.lv) : '', t.joke, t.feedback, t.explain, t.question].filter(Boolean).join(' ');
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
      const lv = pickLevel(score);
      turn = { role: 'ai', score, lv, joke: lv.joke, feedback: j.feedback, explain: j.explain, question: j.question };
    }
    view.turns.push(turn);
    render();
    const spoken = settings.autoRead ? speak(turnText(turn)) : null;
    if (turn.question) startCountdown(spoken, () => { const a = document.getElementById('ans'); if (!a || view !== keep) return; if (!a.value.trim()) a.value = 'No sé (se terminó el tiempo)'; document.getElementById('send').click(); });
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
        'Forma: {"correct":0,"clarity":0,"feedback":"2 a 4 frases: qué estuvo bien, qué faltó o estuvo mal, y cómo decirlo más claro","ideal":"una respuesta modelo breve"}', 800);
      view.answers[i] = { answer, correct: clamp(g.correct), clarity: clamp(g.clarity), feedback: g.feedback, ideal: g.ideal };
      render();
      if (settings.autoRead) speak(g.feedback, app.querySelector('[data-speak="fb"]'));
    } catch (e) { send.disabled = false; document.getElementById('examStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};
// Niveles chistosos (de menor a mayor). "min" = nota mínima. Cada nivel tiene 8 personajes con su sonido y sus chistes,
// más chistes generales del nivel. Se van turnando sin repetir hasta usar todos. Desde 6, todos positivos.
const LEVELS = [
  { min: 0, chars: [
    ['Musgo', 'Sos un Musgo', '🌿', ['Un musgo se pasó diez años pegado a la misma piedra. Un día un caracol le preguntó qué estaba haciendo. "Estudiando", dijo el musgo. "¿Y qué aprendiste?" "Que la piedra es dura." ¡Algo es algo, dale que la próxima aprendés más!', 'Dicen que el musgo crece del lado de la sombra. Vos hoy creciste del lado de la siesta. Pero tranqui, que el musgo tarda, pero cubre la piedra entera.'], 'bubble'],
    ['Ameba dormida', 'Sos una Ameba dormida', '🫧', ['Una ameba quiso estudiar para el examen y se dividió en dos para repartir el trabajo. Una mitad se durmió y la otra se fue a buscar a la primera. Resultado: dos amebas dormidas. ¡Despertate que hay que repasar!', 'Las amebas no tienen cerebro y aun así sobreviven hace millones de años. Vos tenés uno entero, así que imaginate lo lejos que podés llegar si lo prendés.'], 'bubble'],
    ['Piedra con ojos', 'Sos una Piedra con ojos', '🪨', ['Una piedra con ojos miró pasar toda la clase. Vio la pregunta, vio la respuesta, vio al profe hacerle señas. Y no se movió ni un milímetro. Mirar ya lo tenés, ahora falta rodar un poquito.', 'Le preguntaron a una piedra qué opinaba del tema. Lo pensó tres siglos y contestó: "…". Vos tardaste menos, eso ya es un avance.'], 'thud'],
    ['Bacteria de heladera', 'Sos una Bacteria de heladera', '🦠', ['Una bacteria vivía feliz al lado del dulce de leche. Un día abrieron la heladera, prendieron la luz y le preguntaron la lección. La bacteria se escondió atrás del tomate. ¡Salí de ahí que te espera el repaso!', 'Las bacterias de heladera aguantan el frío, la oscuridad y hasta la lavandina. Si aguantan todo eso, vos aguantás un repasito más.'], 'buzz'],
    ['Hongo de zapatilla', 'Sos un Hongo de zapatilla', '🍄', ['Un hongo vivía en una zapatilla de fútbol. Toda la semana a oscuras, oliendo a pata. Un día lo sacaron al sol y dijo: "¡Ah, existe el mundo!". Bueno, hoy saliste al sol. Ahora a aprender.', 'El hongo de zapatilla es el único que viaja gratis a todos los partidos. Viajar, viajó. Mirar el partido, no tanto. ¡La próxima mirá la pelota!'], 'squish'],
    ['Chicle pegado en el banco', 'Sos un Chicle pegado en el banco', '🫥', ['Un chicle quedó pegado abajo del banco de la escuela. Escuchó todas las clases durante veinte años. Y nunca aprendió nada, porque estaba muy ocupado estando pegado. ¡Despegate y repasá!', 'El chicle tiene una gran virtud: no se suelta nunca. Usá eso para el estudio: pegate al tema y no lo largues.'], 'pop'],
    ['Pelusa de ombligo', 'Sos una Pelusa de ombligo', '🌀', ['Una pelusa se pasó el día entero adentro de un ombligo. Le preguntaron qué había visto del mundo. "Todo azul, todo redondito." Un panorama limitado, pero tranquilo, que hoy vemos más.', 'Nadie sabe de dónde sale la pelusa del ombligo. Y nadie supo de dónde salió esta respuesta tuya. Misterios de la ciencia. ¡Repasamos y lo aclaramos!'], 'pop'],
    ['Moho de pan viejo', 'Sos un Moho de pan viejo', '🍞', ['Un moho se instaló en un pan del lunes. Para el viernes ya era dueño del pan entero. Lento, pero conquistador. Vos estás en el lunes del tema: para el viernes lo dominás.', 'Del moho sacaron la penicilina, uno de los inventos más importantes de la historia. O sea, del fondo más fondo puede salir algo genial. ¡Ese sos vos!'], 'bubble'],
  ], jokes: ['Dicen que el que está en el fondo solo puede subir. Vos tenés todo el ascensor para vos solo. ¡Vamos piso por piso!', 'Los dinosaurios también empezaron siendo un bichito en un charco. Tardaron millones de años, pero vos tenés la ventaja de que podés repasar hoy mismo.', 'Hoy fue un día de esos. Mañana, con un repasito, es otro día. Y el profe ya está calentando la voz.'] },
  { min: 2, chars: [
    ['Plancton', 'Sos un Plancton', '🦐', ['Un plancton flotaba tranquilo en el mar cuando apareció una ballena. "¿Me vas a comer?" "No, vine a preguntarte la lección." El plancton se hizo el desmayado. ¡La próxima la ballena te va a encontrar preparado!', 'El plancton es chiquito pero produce la mitad del oxígeno del planeta. Vos sos chiquito en este tema, pero ya estás largando burbujitas de conocimiento.'], 'bubble'],
    ['Mosquito despistado', 'Sos un Mosquito despistado', '🦟', ['Un mosquito pasó toda la noche zumbando alrededor de una oreja. Nunca picó. A la mañana dijo: "Estuve cerca". Vos estuviste zumbando cerca de la respuesta. Ahora, ¡a picar!', 'Al mosquito lo echaron del examen por hacer ruido y no contestar nada. Vos al menos contestaste algo. Ya le ganaste al mosquito.'], 'buzz'],
    ['Lombriz mareada', 'Sos una Lombriz mareada', '🪱', ['Una lombriz cavó toda la tarde buscando la respuesta. Cuando salió a la superficie, estaba en el patio del vecino. Cavar, cavaste. Ahora apuntá para el lado correcto.', 'Una lombriz no tiene ojos y aun así encuentra el camino. Vos tenés dos, así que con un repasito la encontrás seguro.'], 'squish'],
    ['Medusa sin GPS', 'Sos una Medusa sin GPS', '🪼', ['Una medusa salió para el arrecife y terminó en una playa de Mar del Plata. Le preguntaron qué hacía ahí. "Me dejé llevar." ¡Hoy no te dejes llevar, nadá para el lado del tema!', 'La medusa no tiene cerebro, pero tiene onda. Vos tenés las dos cosas. Prendé el GPS mental y vamos de nuevo.'], 'bloop'],
    ['Pulga sin perro', 'Sos una Pulga sin perro', '🐾', ['Una pulga saltó altísimo para llegar a un perro. Saltó tan alto que se pasó y cayó del otro lado. Saltar, sabés. Ahora falta apuntar.', 'La pulga salta cien veces su tamaño. Si vos saltaras cien veces tu nota de hoy, ya serías Nivel Dios. ¡A saltar!'], 'boing'],
    ['Mosca de verano', 'Sos una Mosca de verano', '🪰', ['Una mosca se chocó veinte veces contra la misma ventana. A la vez veintiuno descubrió que la puerta estaba abierta. Vos ya te chocaste un par de veces, la puerta está cerca.', 'Las moscas ven en cámara lenta, por eso es tan difícil atraparlas. Ojalá vos vieras las preguntas en cámara lenta. ¡Con práctica se logra!'], 'buzz'],
    ['Garrapata con sueño', 'Sos una Garrapata con sueño', '🕷️', ['Una garrapata se subió al lomo de un perro para viajar al colegio. Se durmió en el camino y se despertó en la veterinaria. ¡Hoy no te duermas!', 'Las garrapatas se agarran fuerte y no se sueltan. Aplicá eso al tema: agarralo y no lo largues hasta saberlo.'], 'scuttle'],
    ['Polilla del ropero', 'Sos una Polilla del ropero', '🦋', ['Una polilla vivía en el ropero comiéndose un suéter. Le preguntaron qué sabía de moda. "Que la lana es rica." Sabe de algo, pero no de lo que le preguntaron. ¡Te pasó lo mismo!', 'La polilla siempre va hacia la luz. Hoy la luz es el repaso. ¡Volá para allá!'], 'flutter'],
  ], jokes: ['Ya no estás en el fondo del mar: subiste un escalón de la evolución. Te falta una escalera entera, pero ya arrancaste.', 'Chiquito, pero con ganas. Los gigantes también fueron chiquitos alguna vez. Un repaso y crecés un poco.', 'Algo quedó en la cabeza, y eso ya es un montón para empezar. Ahora lo regamos y crece.'] },
  { min: 3, chars: [
    ['Larvoide', 'Sos un Larvoide', '🐛', ['Una larva se miró al espejo y dijo: "Algún día voy a ser mariposa". El espejo le contestó: "Primero estudiá". ¡Ya vas a tener alas!', 'Las larvas comen todo el día para crecer. Vos tenés que hacer lo mismo pero con el tema. Dale de comer al cerebro y salen las alas.'], 'squish'],
    ['Renacuajo', 'Sos un Renacuajo', '🐸', ['Un renacuajo le dijo a su mamá rana: "¿Cuándo voy a saltar como vos?". La rana le dijo: "Cuando se te caiga la cola y te salgan patas". Bueno, a vos ya te están saliendo las patitas.', 'El renacuajo nada en círculos en el charco y piensa que es el océano. Pronto vas a saltar y descubrir que el mundo es más grande.'], 'croak'],
    ['Caracol sin casa', 'Sos un Caracol sin casa', '🐌', ['Un caracol salió para la escuela a las ocho. Llegó a las cinco de la tarde y se había olvidado la casa. Llegó tarde y sin casa, pero llegó. ¡Eso cuenta!', 'Le preguntaron al caracol por qué iba tan lento. "Porque disfruto el camino." Disfrutalo vos también, pero apurá un poquito.'], 'squish'],
    ['Gusano de seda dormilón', 'Sos un Gusano de seda dormilón', '🐛', ['Un gusano de seda empezó a tejer su capullo, se puso cómodo y se quedó dormido adentro. Un año después seguía ahí. ¡Despertate que la seda no se teje sola!', 'Con la seda de un gusano se hacen vestidos de reyes. Vos ya hilaste un poquito; seguí tejiendo que sale algo lindo.'], 'squish'],
    ['Babosa de jardín', 'Sos una Babosa de jardín', '🐌', ['Una babosa quiso cruzar el jardín para ir a clase. Tardó tanto que cuando llegó ya era el acto de fin de año. Pero le dieron diploma por perseverante.', 'La babosa deja un caminito brillante por donde pasa. Vos también vas dejando algo: un poquito de conocimiento. ¡Seguí!'], 'squish'],
    ['Grillo desafinado', 'Sos un Grillo desafinado', '🦗', ['Un grillo quiso cantar toda la noche la lección. Los vecinos le tiraron una zapatilla. No por cantar, sino porque cantaba la respuesta equivocada.', 'El grillo canta frotando las patas. Vos frotá un poquito más las neuronas y te sale la melodía correcta.'], 'cricket'],
    ['Cascarudo panza arriba', 'Sos un Cascarudo panza arriba', '🪲', ['Un cascarudo se dio vuelta y quedó panza arriba, moviendo las patitas. Un rato después dijo: "Desde acá el cielo se ve lindo". Lindo sí, pero hay que darse vuelta. ¡Arriba!', 'Todo cascarudo que se cae panza arriba termina dándose vuelta. Lleva su tiempo, pero lo logra. Vos también.'], 'thud'],
    ['Ciempiés con calambre', 'Sos un Ciempiés con calambre', '🐛', ['Un ciempiés quiso correr al examen y se le acalambraron las cien patas al mismo tiempo. Llegó saltando en una sola. ¡Pero llegó!', 'Al ciempiés le preguntaron cómo hace para caminar con tantas patas. Se puso a pensar y se cayó. A veces hay que pensar menos y repasar más.'], 'scuttle'],
  ], jokes: ['Ya se ve algo de forma. Todavía no sos mariposa, pero el capullo está en construcción.', 'Te estás armando pieza por pieza, como un rompecabezas de mil piezas. Ya tenés los bordes, ¡falta el medio!', 'De a poquito se llega lejos. La tortuga le ganó a la liebre, acordate.'] },
  { min: 4, chars: [
    ['Araña de rincón', 'Sos una Araña de rincón', '🕷️', ['Una araña tejió una telaraña hermosa en el rincón. Esperó todo el día que cayera una respuesta. Cayó una mosca, un papelito y un poco de polvo. ¡Casi! La próxima cae la respuesta.', 'Las arañas de rincón son tímidas: se esconden cuando prenden la luz. ¡Salí del rincón que el tema no muerde!'], 'scuttle'],
    ['Cucaracha valiente', 'Sos una Cucaracha valiente', '🪳', ['Prendieron la luz de la cocina y todas las cucarachas salieron corriendo. Menos una, que dijo: "Yo me quedo a terminar el examen". Valiente sos. Ahora, a mejorar la nota.', 'Dicen que las cucarachas sobrevivirían a todo. Vos sobreviviste a este examen. Ahora vamos por algo más que sobrevivir.'], 'scuttle'],
    ['Hormiga perdida', 'Sos una Hormiga perdida', '🐜', ['Una hormiga cargó una miga enorme todo el día. Cuando llegó, se dio cuenta de que era el hormiguero equivocado. Trabajadora sos, falta encontrar el caminito.', 'Las hormigas cargan cincuenta veces su peso. Con esa fuerza, cargar este tema es pan comido. ¡Dale!'], 'scuttle'],
    ['Bicho bolita', 'Sos un Bicho bolita', '🐞', ['Llegó la pregunta difícil y el bicho bolita hizo lo único que sabe: se hizo bolita. Rodó, rodó y quedó cerquita de la respuesta. ¡Desenrollate y agarrala!', 'El bicho bolita se enrolla para protegerse. Pero en el examen no hay que protegerse: hay que animarse a contestar.'], 'thud'],
    ['Rata de biblioteca', 'Sos una Rata de biblioteca', '🐀', ['Una rata vivía en la biblioteca. Leyó la tapa de todos los libros. Nunca abrió ninguno. ¡Abrí el libro, que adentro está lo bueno!', 'Le dicen rata de biblioteca al que estudia mucho. Vos estás a mitad de camino: rata ya sos, falta la biblioteca.'], 'squeak'],
    ['Paloma de plaza', 'Sos una Paloma de plaza', '🐦', ['Una paloma escuchó a un profesor dando clase en la plaza. Se quedó toda la tarde. Al final solo se acordaba de dónde había migas. ¡Prioridades, che!', 'Las palomas siempre vuelven a casa, por más lejos que las lleven. Vos siempre podés volver al tema y repasarlo.'], 'coo'],
    ['Sapo de charco', 'Sos un Sapo de charco', '🐸', ['Un sapo vivía en un charco y creía que sabía todo del mar. Un día llovió fuerte y el charco se hizo grande. "¡Uy, cuánto me faltaba!" A vos te pasa igual: ¡a agrandar el charco!', 'El sapo saltó para agarrar una mosca y agarró una hoja. Saltaste bien, falta afinar la puntería.'], 'croak'],
    ['Lagartija apurada', 'Sos una Lagartija apurada', '🦎', ['Una lagartija contestó tan rápido que se le cayó la cola en el camino. La cola contestó mejor que ella. ¡Más despacito, que vos podés!', 'Las lagartijas toman sol para tener energía. Tomá un poquito de sol, comé algo rico y volvé con todo.'], 'swoosh'],
  ], jokes: ['Casi la mitad: el vaso ya está medio lleno. Y el profe trajo la jarra.', 'Estás en la puerta del aprobado. Tocá el timbre con un repaso y te abren.', 'Ya sabés bastante, falta ordenar las ideas. Es como tener todos los ingredientes y falta cocinar.'] },
  { min: 5, chars: [
    ['Cuadrúpedo', 'Sos un Cuadrúpedo', '🐕', ['Un cuadrúpedo vio a un humano caminar en dos patas y dijo: "Qué fácil". Lo intentó y se cayó de cola. Pero se levantó. ¡Ya casi te parás!', 'Caminar en cuatro patas es muy estable. Pero para ver más lejos hay que pararse. Un empujoncito y te ponés en dos.'], 'bark'],
    ['Mono aprendiz', 'Sos un Mono aprendiz', '🐒', ['Un mono aprendiz encontró una banana. La miró, la olió, la mordió con cáscara y todo. Casi. Ya tenés la banana: ahora falta pelarla bien.', 'El mono saltó de rama en rama hasta la punta del árbol. Le faltó una rama para llegar a la fruta. ¡Una rama más!'], 'monkey'],
    ['Perro de la plaza', 'Sos un Perro de la plaza', '🐶', ['Le tiraron la pelota a un perro de la plaza. Corrió, la buscó, la encontró… y se la llevó para la casa. Buscar, sabés. ¡Falta traerla!', 'Los perros aprenden con práctica y premio. La práctica la ponés vos, el premio es el aprobado. ¡Guau!'], 'bark'],
    ['Pulpo en entrenamiento', 'Sos un Pulpo en entrenamiento', '🐙', ['Un pulpo tiene ocho brazos. En el examen agarró cuatro ideas y con los otros cuatro se rascaba la cabeza. ¡Usá todos los brazos!', 'Los pulpos son súper inteligentes: abren frascos solos. Vos estás a un frasco de aprobar.'], 'bloop'],
    ['Gato de tejado', 'Sos un Gato de tejado', '🐈', ['Un gato se subió al tejado para ver la respuesta desde arriba. La vio. Pero le dio fiaca bajar a buscarla. ¡Bajá, que está ahí nomás!', 'Los gatos siempre caen parados. Hoy caíste más o menos parado. La próxima, aterrizaje perfecto.'], 'meow'],
    ['Pato desorientado', 'Sos un Pato desorientado', '🦆', ['Un pato quiso volar al sur para el invierno. Se equivocó y llegó al norte. Pero en el camino aprendió un montón de geografía. ¡Algo es algo!', 'El pato nada, camina y vuela, pero ninguna cosa del todo bien. Vos sabés un poco de todo el tema. ¡Ahora a profundizar!'], 'quack'],
    ['Vaca pensativa', 'Sos una Vaca pensativa', '🐄', ['Una vaca se pasó toda la tarde mirando el pasto y pensando. Al final dijo: "Muuu". No era la respuesta, pero se notó el esfuerzo.', 'Las vacas rumian: mastican dos veces lo mismo. Hacé lo mismo con el tema y te queda grabado.'], 'moo'],
    ['Burro con ganas', 'Sos un Burro con ganas', '🫏', ['Un burro le dijo al profe: "No sé mucho, pero tengo ganas". El profe le dijo: "Con ganas se aprende todo". El burro aprobó al año siguiente. ¡Vos vas más rápido!', 'Dicen que el burro es terco. Pero ser terco con el estudio es una virtud: no aflojes.'], 'heehaw'],
  ], jokes: ['Estás a un pasito de aprobar. Es como llegar a la parada justo cuando arranca el colectivo: ¡corré que lo alcanzás!', 'Raspando, pero en camino. Otro intento y lo sacás, palabra de profe.', 'Medio examen en el bolsillo. Vamos por la otra mitad, que ya sabés dónde está.'] },
  { min: 6, chars: [
    ['Cachalote bípedo', 'Sos un Cachalote bípedo', '🐋', ['Un cachalote salió del mar caminando en dos patas. La gente en la playa no lo podía creer. "¿Qué hacés acá?" "Vine a aprobar." Y aprobó. ¡Como vos!', 'El cachalote tiene el cerebro más grande del planeta. Ahora sabemos para qué lo usa: para aprobar exámenes caminando.'], 'whale'],
    ['Carpincho sabio', 'Sos un Carpincho sabio', '🦫', ['Todos los animales del río iban a preguntarle cosas al carpincho. Él escuchaba tranquilo, sin apurarse, y siempre tenía la respuesta. Hoy el carpincho sabio sos vos.', 'El carpincho es tan tranquilo que hasta los pájaros se le sientan encima. Con esa calma aprobaste. ¡Así se hace!'], 'purr'],
    ['Pingüino emprendedor', 'Sos un Pingüino emprendedor', '🐧', ['Un pingüino se puso su mejor traje y abrió un negocio en la Antártida: vendía hielo. Le fue bárbaro. Vos hiciste lo mismo con el examen: un éxito.', 'El pingüino no vuela, pero nada como un campeón. Cada uno brilla en lo suyo, y hoy brillaste en el examen.'], 'honk'],
    ['Delfín con anteojos', 'Sos un Delfín con anteojos', '🐬', ['Un delfín se compró anteojos para leer mejor. Al día siguiente sacó la mejor nota del océano. Los peces todavía preguntan dónde los compró.', 'El delfín es simpático, inteligente y siempre sonríe. Igual que vos después de este examen.'], 'dolphin'],
    ['Caballo de carrera', 'Sos un Caballo de carrera', '🐎', ['Un caballo de carrera salió último en la largada. En la curva pasó a tres. En la recta final pasó a todos y llegó primero. Así fue tu examen: ¡qué remontada!', 'Los caballos de carrera entrenan todos los días. Se nota que vos también. ¡Al galope!'], 'neigh'],
    ['Loro bilingüe', 'Sos un Loro bilingüe', '🦜', ['Un loro aprendió a hablar en dos idiomas. Ahora repite las respuestas correctas en castellano y en inglés. Vos todavía no hablás inglés con el tema, pero en castellano ya la tenés clarísima.', 'Al loro le dicen que solo repite. Pero vos no repetiste: entendiste. Eso es mucho más.'], 'chirp'],
    ['Oso hormiguero detective', 'Sos un Oso hormiguero detective', '🔎', ['Un oso hormiguero investigó todo el hormiguero con su nariz larguísima. Encontró cada pista y resolvió el caso. Vos encontraste las respuestas con la misma nariz.', 'El oso hormiguero mete la nariz donde nadie se anima. Por eso descubre cosas. ¡Bien ahí, curioso!'], 'purr'],
    ['Tortuga maratonista', 'Sos una Tortuga maratonista', '🐢', ['Una tortuga se anotó en una maratón. Todos se rieron. Llegó tranquila, a su ritmo, y cruzó la meta. Las liebres todavía están buscando el camino.', 'La tortuga vive más de cien años porque no se estresa. Aprobaste con calma, así se hace.'], 'tada'],
  ], jokes: ['¡Aprobaste! Ya sos parte del club de los que saben. La cuota es gratis y hay medialunas.', 'Bien ahí. Lo sacaste adelante, y eso merece un aplauso. Clap, clap, clap.', '¡Adentro! Se nota que le estás agarrando la mano al tema. Ahora vamos por más.'] },
  { min: 7, chars: [
    ['Presidente de país del tercer mundo', 'Sos un Presidente de país del tercer mundo', '🎩', ['Un presidente prometió en campaña que iba a saber todo el tema. Y a diferencia de otros presidentes, ¡cumplió bastante! Ya tenés la banda presidencial.', 'Asumiste la presidencia del examen con buena nota. Ahora no te endeudes con el FMI y seguí así.'], 'fanfare'],
    ['Cóndor andino', 'Sos un Cóndor andino', '🦅', ['Un cóndor voló tan alto sobre la cordillera que desde arriba se veía todo el tema. Las montañas, los ríos y las respuestas. Así de alto volaste hoy.', 'El cóndor puede volar horas sin mover las alas, aprovechando el viento. Vos aprovechaste lo que estudiaste. ¡Qué vuelo!'], 'eagle'],
    ['Capitán de barco pirata', 'Sos un Capitán de barco pirata', '🏴‍☠️', ['Un capitán pirata buscó un tesoro durante años. Hoy lo encontró: era una nota bárbara. Su loro ya repite las respuestas correctas.', 'Todo buen pirata tiene un mapa. Vos tenés el mapa del tema, y la X marcaba el aprobado. ¡Al abordaje!'], 'horn'],
    ['Chef con estrella', 'Sos un Chef con estrella', '👨‍🍳', ['Un chef cocinó el examen como si fuera un plato de restaurante caro. Ingredientes justos, buena presentación. Le faltó una pizca de sal nomás. ¡Una estrella para vos!', 'La receta del tema ya la tenés casi de memoria. Un poquito más de práctica y te dan la segunda estrella.'], 'ding'],
    ['Gaucho payador', 'Sos un Gaucho payador', '🪕', ['Un gaucho agarró la guitarra y respondió el examen en versos. Rimaba y encima estaba bien. El jurado le dio un aplauso y un mate.', 'El payador improvisa y siempre le sale. Vos improvisaste poco porque sabías. ¡Eso es mejor todavía!'], 'guitar'],
    ['León con corona', 'Sos un León con corona', '🦁', ['El león se despertó, se puso la corona y dijo: "Hoy apruebo". Dio un rugido y todas las respuestas se acomodaron solas. Rey de la selva y del examen.', 'Dicen que el león duerme veinte horas por día. Las otras cuatro las usa para sacarse buenas notas, como vos.'], 'roar'],
    ['Jirafa ingeniera', 'Sos una Jirafa ingeniera', '🦒', ['Una jirafa construyó un puente con su cuello largo para que los otros animales cruzaran el río. Inteligente y solidaria. Así de alto llegaste hoy.', 'La jirafa ve todo desde arriba, sin esfuerzo. Vos ya empezás a ver el tema desde arriba.'], 'ding'],
    ['Abeja reina', 'Sos una Abeja reina', '🐝', ['En la colmena hicieron una votación para ver quién sabía más del tema. Ganaste vos, por eso ahora sos la Abeja reina. Todas las obreras te traen miel.', 'Las abejas trabajan en equipo y hacen la miel más rica. Vos hiciste un examen dulce como la miel.'], 'buzz'],
  ], jokes: ['¡Muy bien! Ya jugás en primera división. Falta poquito para la Selección.', 'Esto ya es nivel serio. Si el examen fuera una carrera, ya estás en el podio.', 'Se nota que estudiaste. El profe está tan contento que ya está pensando en el próximo tema.'] },
  { min: 8, chars: [
    ['Homo erectus', 'Sos un Homo erectus', '🦍', ['Un Homo erectus se paró derechito por primera vez, miró alrededor y dijo: "Uy, ahora entiendo todo". Después descubrió el fuego. Vos hoy descubriste el tema.', 'La evolución tardó millones de años en ponerse de pie. Vos lo hiciste en un examen. ¡Bien erguido!'], 'drum'],
    ['Lechuza doctora', 'Sos una Lechuza doctora', '🦉', ['En el bosque, todos van a consultar a la Lechuza doctora. Se pone los anteojos, piensa un segundo y responde perfecto. Hoy la consulta la atendiste vos.', 'La lechuza ve clarito hasta de noche. Vos viste clarito todas las respuestas. ¡Doctora en el tema!'], 'hoot'],
    ['Astronauta', 'Sos un Astronauta', '🧑‍🚀', ['Un astronauta despegó con este examen y llegó a la Luna en tiempo récord. Desde allá llamó a la Tierra: "Houston, no tenemos ningún problema".', 'Para ser astronauta hay que estudiar un montón. Se nota que vos estudiaste: este tema ya te queda chico.'], 'rocket'],
    ['Mago de barrio', 'Sos un Mago de barrio', '🧙', ['Un mago del barrio agarró la galera, dijo "abracadabra" y sacó todas las respuestas correctas. El público aplaudió de pie. ¡Qué truco!', 'Los magos dicen que no hay magia, que todo es práctica. Y vos practicaste. ¡Por eso salió el truco!'], 'magic'],
    ['Científico loco', 'Sos un Científico loco', '🧪', ['Un científico mezcló dos ideas en un tubo de ensayo. ¡Puf! Salió humo violeta y una respuesta perfecta. "¡Eureka!", gritó. Vos también.', 'Los científicos se equivocan mil veces hasta acertar. Vos acertaste casi todo de una. ¡Un genio del laboratorio!'], 'laser'],
    ['Elefante con memoria de oro', 'Sos un Elefante con memoria de oro', '🐘', ['Dicen que los elefantes nunca olvidan. Este elefante se acordó de cada cosa que le enseñaron. Hasta del chiste del módulo anterior.', 'El elefante es enorme y sabio. Hoy tu conocimiento fue de tamaño elefante.'], 'trumpet'],
    ['Detective de lupa', 'Sos un Detective de lupa', '🕵️', ['Un detective agarró la lupa, miró cada pregunta y encontró todas las pistas. "Elemental", dijo, y resolvió el examen.', 'A un buen detective no se le escapa nada. Y a vos se te escapó muy poquito. ¡Caso cerrado!'], 'ding'],
    ['Puma inventor', 'Sos un Puma inventor', '🐆', ['Un puma se aburrió de cazar y se puso a inventar cosas. El primer invento fue una máquina de aprobar exámenes. Funciona muy bien, por lo que se ve.', 'El puma es rápido, ágil y silencioso. Así respondiste: rápido y sin hacer ruido.'], 'roar'],
  ], jokes: ['¡Excelente! Ya podrías explicarle el tema a otro. Y te van a entender.', 'Nivel crack. El profe está tan orgulloso que le contó a todos los otros profes.', '¡Qué bien! Esto ya es de los mejores. Te falta muy poquito para la cima.'] },
  { min: 9, chars: [
    ['Ninja supremo', 'Sos un Ninja supremo', '🥷', ['Un ninja entró al examen sin hacer ruido. Respondió todo tan rápido y tan bien que el profe ni se dio cuenta de que ya había terminado.', 'El ninja entrena años para moverse sin ser visto. Vos te movés por el tema sin que se te escape nada. ¡Cinturón negro!'], 'swoosh'],
    ['Dragón sabio', 'Sos un Dragón sabio', '🐉', ['Un dragón de mil años custodiaba la respuesta más difícil. Vino un estudiante, contestó perfecto, y el dragón le dio su lugar. Ahora el Dragón sabio sos vos.', 'El dragón escupe fuego. Vos escupís respuestas correctas. Las dos cosas queman de lo buenas que son.'], 'roar'],
    ['Superhéroe del barrio', 'Sos un Superhéroe del barrio', '🦸', ['En el barrio había un examen en peligro. Apareció un superhéroe con capa y lo salvó sin despeinarse. Los vecinos todavía hablan de eso.', 'Todo superhéroe tiene un superpoder. El tuyo es saberte este tema de memoria.'], 'hero'],
    ['Campeón del mundo', 'Sos un Campeón del mundo', '🏆', ['Final del mundial del conocimiento. Último minuto. Respondiste la última pregunta y ¡gol! Levantaste la copa y diste la vuelta olímpica.', 'Los campeones del mundo entrenan todos los días. Se nota que vos también. ¡Dale campeón!'], 'fanfare'],
    ['Samurái del saber', 'Sos un Samurái del saber', '⚔️', ['Un samurái desenvainó su espada y cortó cada pregunta a la mitad, con precisión perfecta. Después hizo una reverencia y se fue.', 'El samurái tiene honor, disciplina y conocimiento. Las tres cosas se notaron en tu examen.'], 'swoosh'],
    ['Robot del futuro', 'Sos un Robot del futuro', '🤖', ['Un robot del año 3000 vino a ver quién sabía más del tema. Te escaneó y dijo: "Error. Este humano sabe más que yo". Y se volvió al futuro.', 'Respuesta procesada. Nivel de conocimiento: altísimo. Recomendación del sistema: seguí así.'], 'robot'],
    ['Águila imperial', 'Sos un Águila imperial', '🦅', ['Un águila vio la respuesta desde tres kilómetros de altura, bajó en picada y la agarró en el aire. Precisión total.', 'El águila tiene la mejor vista del cielo. Y vos tuviste la mejor vista del tema.'], 'eagle'],
    ['Fénix renacido', 'Sos un Fénix renacido', '🔥', ['El fénix se prende fuego y renace más fuerte. Vos agarraste el tema, lo quemaste de tanto estudiarlo, y renaciste sabio.', 'Dicen que las lágrimas del fénix curan todo. Tus respuestas también curan cualquier duda.'], 'magic'],
  ], jokes: ['¡Impresionante! Casi perfecto. El examen está pensando en pedirte un autógrafo.', 'Esto ya es nivel maestro. Pocos llegan hasta acá, y vos llegaste.', '¡Tremendo! Si sigue así, el profe te va a pedir clases a vos.'] },
  { min: 9.7, chars: [
    ['Dios', 'Sos un Dios', '⚡', ['El examen se presentó, te vio, y te pidió disculpas por molestarte. Después se fue caminando despacito. Nivel Dios.', 'Ya no estudiás el tema: el tema te estudia a vos. Y saca un dos.'], 'thunder'],
    ['Leyenda viviente', 'Sos una Leyenda viviente', '🌟', ['Dentro de mil años, en las escuelas, van a contar la historia de este examen. Van a hacer una estatua tuya en la plaza. Con palomas, pero estatua al fin.', 'Las leyendas no se hacen, nacen. Bueno, en realidad estudian. Como vos.'], 'choir'],
    ['Rey del universo', 'Sos el Rey del universo', '👑', ['Las estrellas se juntaron para elegir al rey del universo. Votaron todas por vos. Hasta el sol te pidió un autógrafo.', 'Los planetas giran alrededor del sol. Y hoy las respuestas giraron alrededor tuyo.'], 'fanfare'],
    ['Unicornio genio', 'Sos un Unicornio genio', '🦄', ['Un unicornio aparece una vez cada mil años. Y cuando aparece, saca diez. Hoy apareció.', 'Mágico, único y perfecto. Así fue este examen. El arcoíris se puso celoso.'], 'magic'],
    ['Mente galáctica', 'Sos una Mente galáctica', '🌌', ['Los extraterrestres escucharon tus respuestas desde otra galaxia. Ahora quieren que vayas a darles clases. Ya te mandaron la nave.', 'Tu cerebro ya no entra en este planeta. Hay que buscarle una galaxia más grande.'], 'choir'],
    ['Sol en persona', 'Sos el Sol en persona', '☀️', ['Iluminaste tanto el examen que el profe tuvo que ponerse anteojos de sol. Brillás con luz propia.', 'Sin el sol no hay vida. Sin vos, este examen no habría tenido tanta luz.'], 'choir'],
    ['Cerebro cósmico', 'Sos un Cerebro cósmico', '🧠', ['Los científicos quisieron medir tu cerebro y se les rompió la máquina. "Demasiado grande", dijeron. Cerebro cósmico.', 'Tus neuronas hicieron una fiesta y todas sacaron diez. Qué fiesta.'], 'laser'],
    ['Titán del Olimpo', 'Sos un Titán del Olimpo', '🏛️', ['Los dioses del Olimpo bajaron a ver quién había hecho este examen. Te miraron y te hicieron lugar en la mesa. Ahora sos uno de ellos.', 'Los titanes eran gigantes que sostenían el cielo. Vos sostenés todo este tema sin despeinarte.'], 'thunder'],
  ], jokes: ['¡Perfecto! No hay nada más que enseñarte acá. El profe se va a tomar unas vacaciones.', 'Puntaje de leyenda. Si esto fuera un videojuego, desbloqueaste el final secreto.', 'Ya podés dar clases de esto. Te reservamos el aula y la tiza.'] },
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

// ---------- Ranking compartido (Supabase, plan gratis) ----------
// Esta clave es "publicable": está hecha para ir en la app. Solo deja usar las dos funciones del ranking.
if (!settings.playerId) { settings.playerId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); save(); }
if (settings.share == null) { settings.share = true; save(); }
async function sbRpc(fn, body) {
  if (!SB_URL) throw new Error('El ranking todavía no está conectado.');
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('No pude conectar con el ranking.');
  return r.status === 204 ? null : r.json();
}
const subjAvg = (s) => average(s.stages.map(stageScore).filter((x) => x != null));
function shareScore(s) {
  const avg = subjAvg(s);
  if (!settings.share || !settings.name || avg == null || !SB_URL) return;
  const l = levelOf(avg);
  sbRpc('submit_score', { p_player: settings.playerId, p_name: settings.name.slice(0, 30), p_topic: s.topic.slice(0, 60), p_avg: Math.round(avg * 10) / 10, p_level: l[1], p_emoji: l[2] }).catch(() => {});
}
// Al abrir la app, sube los puntajes que ya tenías (por si ya estudiaste antes de que existiera el ranking).
setTimeout(() => subjects.forEach(shareScore), 3000);
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
views.ranking = () => {
  setHeader('Ranking');
  const draw = () => {
    const rows = view.rows || [];
    const topics = [...new Set(rows.map((r) => r.topic))];
    let list;
    if (view.tab === 'general' || !view.tab) {
      const by = {};
      rows.forEach((r) => { const k = r.player; (by[k] = by[k] || { name: r.name, me: r.me, xs: [] }).xs.push(r.avg); });
      list = Object.values(by).map((p) => { const avg = average(p.xs); const l = levelOf(avg); return { ...p, avg, level: l[1], emoji: l[2], extra: `${p.xs.length} ${p.xs.length === 1 ? 'tema' : 'temas'}` }; });
    } else list = rows.filter((r) => r.topic === view.tab).map((r) => ({ ...r }));
    list.sort((a, b) => b.avg - a.avg);
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
            <div class="pill ${p.avg >= PASS ? 'ok' : 'bad'}">${fmt(p.avg)}</div></div>`).join('')}
      ${!settings.share ? '<p class="muted small">Vos no aparecés porque desactivaste "Aparecer en el ranking" en Configuración.</p>' : !settings.name ? '<p class="muted small">Para aparecer, poné tu nombre en Configuración.</p>' : ''}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { view.tab = b.dataset.tab; draw(); });
  };
  draw();
  if (!view.rows && !view.loading) {
    view.loading = true;
    sbRpc('get_ranking', { p_player: settings.playerId })
      .then((rows) => { view.rows = (rows || []).map((r) => ({ ...r, avg: +r.avg })); })
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
  if (!view.lv) { view.lv = pickLevel(view.score); view.joke = view.lv.joke; }
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
  speak(`${scoreLine(view.score, view.lv)} ${view.joke} ${view.feedback || ''} ${msg}`);
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
