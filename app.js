// Profe de Voz — aprendé cualquier tema por módulos cortos, con exámenes y puntaje.
// Todo se guarda en este navegador (localStorage). La clave de API solo viaja a la API de Anthropic.

const MODEL = 'claude-sonnet-5-5';
const FAST_MODEL = 'claude-haiku-5-5'; // más rápido para la charla y las correcciones
const API_URL = 'https://api.anthropic.com/v1/messages';
const APP_VERSION = 49;
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
  'ENFOQUE: enseñá la LÓGICA del tema, no su historia. Cómo funciona, cómo se piensa, sus conceptos, problemas, criterios y cómo se aplica, usando a los referentes más importantes como ejemplos de ideas (no como biografías ni fechas). Ejemplo: en filosofía, las grandes preguntas y cómo se razonan, no la historia de la filosofía; en arte, composición, color, luz, criterios para mirar y hacer una obra, no historia del arte. Solo enseñá historia si el tema es explícitamente historia. ' +
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
  const segs = String(text).split(/\{\{(s:[\w.~]+|p)\}\}/);
  return (async () => {
    for (let i = 0; i < segs.length; i++) {
      if (token !== speakToken) return;
      if (i % 2) { if (segs[i] === 'p') await new Promise((ok) => setTimeout(ok, 450)); else await playSfx(segs[i].slice(2)); continue; }
      const clean = segs[i].replace(/[*#_`]/g, '').replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      if (settings.engine === 'rafael' && settings.elevenKey) await speakRafael(clean, token);
      else if (settings.engine === 'piper' && settings.piperVoice) await speakPiper(clean, token);
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
// ---- Voz Rafael (ElevenLabs): el profe argentino. Usa la clave de ElevenLabs guardada solo en este equipo ----
const RAFAEL_VOICE = 'mh2gj4UAopyeumRhj8xU', RAFAEL_MODEL = 'eleven_multilingual_v2', RAFAEL_CACHE = 'rafael-voz-v1';
const isBrowserVoice = () => settings.engine !== 'piper' && settings.engine !== 'rafael';
async function rafaelAudio(text) {
  // Cada frase se guarda en el teléfono: si se repite, no se gasta crédito de ElevenLabs otra vez.
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RAFAEL_VOICE + '|' + text))))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = new URL(`rafael-cache/${h}.mp3`, location.href).href;
  let cache = null;
  try { cache = await caches.open(RAFAEL_CACHE); const hit = await cache.match(key); if (hit) return await hit.blob(); } catch {}
  let r;
  try {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${RAFAEL_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': settings.elevenKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: RAFAEL_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
    });
  } catch { throw new Error('Sin conexión para la voz de Rafael.'); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const msg = JSON.stringify(d);
    if (r.status === 401 && !/quota/i.test(msg)) throw new Error('La clave de ElevenLabs no funciona.');
    if (/quota|credit|limit/i.test(msg)) throw new Error('Rafael se quedó sin crédito de ElevenLabs este mes.');
    if (/voice_not_found|not found/i.test(msg)) throw new Error('La voz Rafael no está en esa cuenta de ElevenLabs.');
    throw new Error('Rafael no pudo hablar ahora.');
  }
  const blob = await r.blob();
  try { if (cache) await cache.put(key, new Response(blob, { headers: { 'content-type': 'audio/mpeg' } })); } catch {}
  return blob;
}
async function speakRafael(clean, token) {
  const parts = chunks(clean);
  try {
    if (speakingBtn) speakingBtn.textContent = '… Preparando voz';
    let next = rafaelAudio(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const blob = await next;
      if (token !== speakToken) return;
      if (speakingBtn) speakingBtn.textContent = '■ Parar';
      if (i + 1 < parts.length) { next = rafaelAudio(parts[i + 1]); next.catch(() => {}); } // prepara la próxima frase mientras suena esta
      await playBlob(blob);
      if (token !== speakToken) return;
    }
  } catch (e) {
    console.error(e);
    if (token !== speakToken) return;
    toast(e.message + ' Sigo con otra voz.');
    const rest = parts.join(' ');
    if (settings.piperVoice && (piperStored || []).includes(settings.piperVoice)) await speakPiper(rest, token);
    else await speakBrowser(rest, token);
  }
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
let actx = null, sfxOut = null, sfxPitch = 1;
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); loadRecs(actx); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
document.addEventListener('pointerdown', () => audioCtx(), { passive: true }); // Android pide un toque para habilitar el audio
function stopSfx() { if (sfxOut) { try { sfxOut.disconnect(); } catch {} sfxOut = null; } }
// tono: frecuencia que va de f a f2, con volumen que sube y baja
function tone(c, out, t, dur, f, f2, type = 'sine', vol = 0.3, vib = 0) {
  const o = c.createOscillator(), g = c.createGain();
  f *= sfxPitch; if (f2) f2 *= sfxPitch;
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
  guitar: (c, o, t) => { [196, 247, 294, 392].forEach((f, i) => tone(c, o, t + i * .07, .9, f, f, 'triangle', .18)); return 1.1; },
  trumpet: (c, o, t) => { tone(c, o, t, .9, 300, 520, 'sawtooth', .14, 10); return .95; },
  laser: (c, o, t) => { [0, .2].forEach((d) => tone(c, o, t + d, .18, 1800, 200, 'square', .1)); return .45; },
  robot: (c, o, t) => { [0, .12, .24, .36].forEach((d, i) => tone(c, o, t + d, .1, [440, 660, 330, 880][i], null, 'square', .09)); return .5; },
  tada: (c, o, t) => { tone(c, o, t, .12, 523, 523, 'triangle', .25); tone(c, o, t + .14, .6, 784, 784, 'triangle', .28); tone(c, o, t + .14, .6, 1047, 1047, 'triangle', .15); return .8; },
  tick: (c, o, t) => { tone(c, o, t, .06, 1400, 1400, 'square', .12); return .08; },
  bubble: (c, o, t) => { [0, .15, .3, .45].forEach((d, i) => tone(c, o, t + d, .12, 300 + i * 120, 900 + i * 150, 'sine', .25)); return .6; },
  thud: (c, o, t) => { tone(c, o, t, .35, 110, 40, 'sine', .5); noise(c, o, t, .2, 200, 80, .3); tone(c, o, t + .45, .3, 90, 35, 'sine', .4); return .8; },
  squish: (c, o, t) => { tone(c, o, t, .3, 180, 320, 'sine', .3, 12); tone(c, o, t + .3, .35, 320, 150, 'sine', .3, 12); return .7; },
  scuttle: (c, o, t) => { for (let i = 0; i < 14; i++) noise(c, o, t + i * .05, .03, 4000, 3000, .25, 3); return .75; },
  bloop: (c, o, t) => { tone(c, o, t, .25, 200, 800, 'sine', .35); tone(c, o, t + .3, .25, 250, 900, 'sine', .3); return .6; },
  fanfare: (c, o, t) => { [523, 659, 784].forEach((f, i) => tone(c, o, t + i * .14, .14, f, f, 'sawtooth', .12)); tone(c, o, t + .42, .6, 1047, 1047, 'sawtooth', .14, 5); return 1.05; },
  horn: (c, o, t) => { tone(c, o, t, .9, 110, 105, 'sawtooth', .15); tone(c, o, t, .9, 165, 160, 'sawtooth', .1); return .95; },
  ding: (c, o, t) => { tone(c, o, t, 1, 1568, 1568, 'sine', .3); tone(c, o, t, .6, 3136, 3136, 'sine', .1); return 1; },
  drum: (c, o, t) => { [0, .2, .4, .55].forEach((d) => { tone(c, o, t + d, .18, 150, 60, 'sine', .5); noise(c, o, t + d, .06, 1200, 600, .15); }); return .8; },
  rocket: (c, o, t) => { noise(c, o, t, 1.2, 200, 3000, .35, .7); tone(c, o, t, 1.2, 100, 900, 'sawtooth', .06); return 1.2; },
  magic: (c, o, t) => { [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(c, o, t + i * .08, .5, f, f, 'triangle', .14)); return .9; },
  swoosh: (c, o, t) => { noise(c, o, t, .35, 400, 5000, .45, 1.5); noise(c, o, t + .4, .25, 5000, 600, .35, 1.5); return .7; },
  hero: (c, o, t) => { [392, 523, 659].forEach((f, i) => tone(c, o, t + i * .12, .12, f, f, 'square', .1)); tone(c, o, t + .36, .7, 784, 784, 'square', .12, 6); return 1.1; },
  thunder: (c, o, t) => { noise(c, o, t, 1.3, 120, 60, .6, .5); [523, 659, 784, 1047].forEach((f) => tone(c, o, t + .5, 1, f, f, 'sine', .08, 5)); return 1.5; },
  choir: (c, o, t) => { [440, 554, 659, 880].forEach((f) => tone(c, o, t, 1.2, f, f, 'triangle', .07, 5)); return 1.2; },
};
// ---- Sonidos "reales": una voz animal = fuente (cuerdas vocales + aliento) que pasa por la "boca" (formantes) ----
// f: curva de tono [[momento 0..1, Hz]], v: curva de boca [[momento, [F1,F2,F3]]].
let noiseBuf = null;
function noiseBuffer(c) {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function curve(param, pts, t, dur, k = 1) {
  param.setValueAtTime(pts[0][1] * k, t);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * k, t + pts[i][0] * dur);
}
function voice(c, out, t, dur, o) {
  const k = (1 + (Math.random() - 0.5) * 0.08) * sfxPitch; // cada vez suena un poquito distinto, como un animal de verdad
  const src = c.createGain();
  const osc = c.createOscillator(); osc.type = o.type || 'sawtooth'; curve(osc.frequency, o.f, t, dur, k);
  if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.f[0][1] * (o.vibD || 0.03); l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + dur + .05); }
  const og = c.createGain(); og.gain.value = 1 - (o.breath || 0) * 0.5; osc.connect(og).connect(src);
  if (o.breath) { const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true; const ng = c.createGain(); ng.gain.value = o.breath * 1.5; n.connect(ng).connect(src); n.start(t); n.stop(t + dur + .05); }
  let mid = src;
  if (o.am) { const a = c.createGain(), l = c.createOscillator(), lg = c.createGain(), d = o.amD || 0.8; a.gain.value = 1 - d / 2; lg.gain.value = d / 2; l.frequency.value = o.am; l.connect(lg).connect(a.gain); l.start(t); l.stop(t + dur + .05); src.connect(a); mid = a; }
  const env = c.createGain(), atk = o.atk || 0.04, rel = Math.min(o.rel || 0.15, dur / 2), vol = o.vol || 0.5;
  env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(vol, t + atk);
  env.gain.setValueAtTime(vol, t + dur - rel); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [1, 0.55, 0.3].forEach((amp, i) => {
    const bp = c.createBiquadFilter(), g = c.createGain(); bp.type = 'bandpass'; bp.Q.value = o.q || 9;
    curve(bp.frequency, o.v.map(([m, F]) => [m, F[i]]), t, dur); g.gain.value = amp * 2.2;
    mid.connect(bp).connect(g).connect(env);
  });
  env.connect(out); osc.start(t); osc.stop(t + dur + .05);
}
// ruido con volumen que late (ronroneo, rugido)
function pulseNoise(c, out, t, dur, rate, lp, vol) {
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const a = c.createGain(), l = c.createOscillator(), lg = c.createGain(); a.gain.value = 0.5; lg.gain.value = 0.5; l.frequency.value = rate; l.connect(lg).connect(a.gain);
  const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + .08); e.gain.setValueAtTime(vol, t + dur - .15); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(a).connect(e).connect(out); n.start(t); n.stop(t + dur + .05); l.start(t); l.stop(t + dur + .05);
}
// eco de ambiente: hace que los sonidos no suenen a juguete
let reverbIR = null;
function reverb(c) {
  if (!reverbIR || reverbIR.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 1.3); reverbIR = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = reverbIR.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  }
  const cv = c.createConvolver(); cv.buffer = reverbIR; return cv;
}
const A = { a: [750, 1200, 2600], e: [500, 1800, 2600], i: [320, 2300, 3000], o: [500, 850, 2500], u: [320, 750, 2300], m: [250, 900, 2200], n: [300, 1500, 2600] };
const REAL = {
  moo: (c, o, t) => { voice(c, o, t, 1.5, { f: [[0, 95], [.25, 125], [.75, 118], [1, 82]], v: [[0, A.m], [.2, A.u], [.55, A.o], [1, A.u]], vol: .6, breath: .12, vib: 5, vibD: .02, atk: .12, rel: .4 }); return 1.6; },
  meow: (c, o, t) => { voice(c, o, t, .85, { f: [[0, 480], [.35, 720], [1, 430]], v: [[0, A.i], [.35, A.a], [.75, A.o], [1, A.u]], vol: .5, breath: .1, vib: 7, vibD: .02, atk: .06, rel: .25 }); return .95; },
  bark: (c, o, t) => { [0, .32].forEach((d) => { voice(c, o, t + d, .2, { f: [[0, 420], [.3, 620], [1, 300]], v: [[0, A.a], [1, A.o]], vol: .8, breath: .35, atk: .01, rel: .1, q: 6 }); }); return .6; },
  quack: (c, o, t) => { [0, .3, .55].forEach((d) => voice(c, o, t + d, .22, { f: [[0, 340], [1, 250]], v: [[0, [1000, 1700, 3000]], [1, [800, 1500, 2800]]], vol: .55, breath: .25, am: 45, amD: .6, q: 14, atk: .01, rel: .08 })); return .85; },
  croak: (c, o, t) => { [0, .45].forEach((d) => voice(c, o, t + d, .35, { f: [[0, 130], [1, 105]], v: [[0, [450, 1300, 2400]]], vol: .7, am: 24, amD: 1, breath: .1, atk: .02, rel: .08 })); return .85; },
  hoot: (c, o, t) => { [[0, .35], [.55, .2], [.82, .45]].forEach(([d, l]) => voice(c, o, t + d, l, { f: [[0, 360], [.2, 410], [1, 350]], v: [[0, A.u]], type: 'triangle', vol: .7, breath: .25, q: 5, atk: .05, rel: .12 })); return 1.3; },
  coo: (c, o, t) => { voice(c, o, t, .3, { f: [[0, 280], [1, 340]], v: [[0, A.u]], type: 'triangle', vol: .6, am: 20, amD: .5, breath: .15 }); voice(c, o, t + .35, .6, { f: [[0, 330], [.3, 360], [1, 260]], v: [[0, A.u], [1, A.o]], type: 'triangle', vol: .6, breath: .15, vib: 6 }); return 1; },
  neigh: (c, o, t) => { voice(c, o, t, 1.2, { f: [[0, 650], [.15, 1150], [.55, 950], [1, 380]], v: [[0, A.i], [.3, A.e], [1, A.a]], vol: .45, vib: 13, vibD: .09, breath: .2, atk: .05, rel: .35 }); pulseNoise(c, o, t + 1.25, .3, 30, 900, .4); return 1.6; },
  heehaw: (c, o, t) => { [0, .7].forEach((d) => { voice(c, o, t + d, .3, { f: [[0, 800], [1, 950]], v: [[0, A.i]], vol: .4, breath: .3, q: 7 }); voice(c, o, t + d + .32, .35, { f: [[0, 260], [1, 200]], v: [[0, A.a], [1, A.o]], vol: .6, breath: .2 }); }); return 1.4; },
  roar: (c, o, t) => { voice(c, o, t, 1.6, { f: [[0, 85], [.25, 150], [.6, 120], [1, 70]], v: [[0, A.o], [.3, A.a], [1, A.u]], vol: .8, breath: .6, am: 38, amD: .5, q: 5, atk: .1, rel: .5 }); return 1.7; },
  purr: (c, o, t) => { pulseNoise(c, o, t, 1.4, 26, 350, .9); voice(c, o, t, 1.4, { f: [[0, 26], [1, 24]], v: [[0, [180, 400, 900]]], vol: .3, q: 3 }); return 1.4; },
  honk: (c, o, t) => { [0, .35].forEach((d) => voice(c, o, t + d, .28, { f: [[0, 420], [.4, 460], [1, 360]], v: [[0, [700, 1300, 2600]]], vol: .6, breath: .15, q: 16, atk: .02, rel: .1 })); return .7; },
  eagle: (c, o, t) => { voice(c, o, t, .9, { f: [[0, 2300], [.15, 2700], [1, 1500]], v: [[0, [2500, 3600, 5000]], [1, [1800, 3000, 4500]]], vol: .35, vib: 38, vibD: .05, breath: .35, q: 6, atk: .02, rel: .4 }); return 1; },
  monkey: (c, o, t) => { [[0, 420, A.u], [.22, 480, A.u], [.44, 900, A.a], [.7, 1000, A.a]].forEach(([d, f, v]) => voice(c, o, t + d, .2, { f: [[0, f * .8], [.5, f], [1, f * .85]], v: [[0, v]], vol: .5, breath: .25, atk: .02, rel: .08 })); return 1; },
  buzz: (c, o, t) => { voice(c, o, t, 1.3, { f: [[0, 210], [.3, 245], [.7, 200], [1, 230]], v: [[0, [700, 1900, 3400]]], vol: .35, vib: 9, vibD: .02, am: 140, amD: .4, q: 4, atk: .15, rel: .4 }); return 1.3; },
  squeak: (c, o, t) => { [0, .2, .33].forEach((d) => voice(c, o, t + d, .1, { f: [[0, 2800], [.5, 3500], [1, 3000]], v: [[0, [3000, 6000, 8000]]], type: 'triangle', vol: .45, q: 3, atk: .01, rel: .04 })); return .5; },
  chirp: (c, o, t) => { let d = 0; for (let i = 0; i < 6; i++) { const top = 3600 + Math.random() * 1200, l = .06 + Math.random() * .05; tone(c, o, t + d, l, top, top * .55, 'sine', .3, i % 2 ? 40 : 0); d += l + .03; } return d + .1; },
  whale: (c, o, t) => { voice(c, o, t, 2, { f: [[0, 180], [.4, 420], [.7, 380], [1, 140]], v: [[0, A.u], [.5, A.o], [1, A.u]], type: 'triangle', vol: .6, vib: 3, vibD: .03, breath: .05, q: 4, atk: .3, rel: .6 }); return 2; },
  // trompeta triste de perder: "wah, wah, wah, waaah" bajando
  sadtrombone: (c, o, t) => { [[0, 392, .42], [.48, 370, .42], [.96, 349, .42], [1.44, 330, 1.1]].forEach(([d, f, l], i) => voice(c, o, t + d, l, { f: [[0, f], [1, i === 3 ? f * .92 : f * .97]], v: [[0, A.u], [.35, A.a], [1, i === 3 ? A.u : A.o]], vol: .5, vib: i === 3 ? 6 : 0, vibD: .025, breath: .08, q: 6, atk: .03, rel: .12 })); return 2.6; },
  dolphin: (c, o, t) => { for (let i = 0; i < 8; i++) noise(c, o, t + i * .03, .01, 6000, 6000, .35, 2); [[.3, 2200, 4200], [.55, 4000, 2600], [.8, 2600, 4800]].forEach(([d, a, b]) => tone(c, o, t + d, .2, a, b, 'sine', .25)); return 1.1; },
};
// mismo volumen para todos (medido): unos salían muy fuertes y otros muy bajitos
const REAL_GAIN = { sadtrombone: 1.2, moo: 1.15, meow: .4, bark: .5, quack: 1.6, croak: 1.7, hoot: .45, coo: .32, neigh: 2.2, heehaw: 1.6, roar: .9, purr: 1.1, honk: 1.8, eagle: .63, monkey: 1.4, buzz: 1.35, squeak: .38, chirp: 2, whale: .3, dolphin: 2 };
for (const k in REAL) SOUNDS[k] = (c, o, t) => { const g = c.createGain(); g.gain.value = REAL_GAIN[k] || 1; g.connect(o); return REAL[k](c, g, t); };
// ---- Grabaciones de verdad (dominio público CC0, de github.com/EternityForest/free-sfx) ----
// Se bajan una vez y quedan guardadas. Si todavía no llegaron, suena la versión generada.
const REC = ['owl', 'lion', 'cricketr', 'fly', 'cicada', 'beast', 'dino1', 'dino3', 'raven', 'laugh', 'yawn', 'cough', 'sniff', 'whistle', 'callwhistle', 'gasp', 'clap', 'sip', 'gulp', 'fruit', 'djembe', 'ghost', 'bell', 'gong', 'shipbell', 'cannon', 'springr', 'plop', 'splash', 'toilet', 'dishes', 'paper', 'glass', 'pot', 'dooropen', 'weird', 'kettle', 'phone', 'record', 'bubbling', 'victory', 'success', 'gameover', 'powerup', 'teleport', 'magicr', 'cymbal', 'monster', 'voice1', 'voice3'];
const REC_FB = { owl: 'hoot', lion: 'roar', cricketr: 'cricket', fly: 'buzz', cicada: 'cricket', beast: 'roar', dino1: 'roar', dino3: 'roar', raven: 'eagle', laugh: 'monkey', yawn: 'moo', cough: 'thud', sniff: 'swoosh', whistle: 'magic', callwhistle: 'magic', gasp: 'swoosh', clap: 'drum', sip: 'bubble', gulp: 'bloop', fruit: 'squish', djembe: 'drum', ghost: 'choir', bell: 'ding', gong: 'ding', shipbell: 'ding', cannon: 'thunder', springr: 'boing', plop: 'pop', splash: 'bubble', toilet: 'bubble', dishes: 'robot', paper: 'swoosh', glass: 'ding', pot: 'thud', dooropen: 'squish', weird: 'laser', kettle: 'rocket', phone: 'robot', record: 'guitar', bubbling: 'bubble', victory: 'fanfare', success: 'tada', gameover: 'horn', powerup: 'hero', teleport: 'laser', magicr: 'magic', cymbal: 'thunder', monster: 'roar', voice1: 'monkey', voice3: 'monkey' };
const REC_UP = { hoot: 'owl', roar: 'lion', cricket: 'cricketr' }; // los que antes eran inventados y ahora tienen grabación
const recBuf = {}; let recLoading = null;
function loadRecs(c) {
  if (recLoading) return recLoading;
  recLoading = Promise.all(REC.map(async (k) => { try { const r = await fetch('sfx/' + k + '.ogg'); if (r.ok) recBuf[k] = await c.decodeAudioData(await r.arrayBuffer()); } catch {} }));
  return recLoading;
}
for (const k of REC) SOUNDS[k] = (c, o, t) => {
  const b = recBuf[k]; if (!b) return SOUNDS[REC_FB[k]](c, o, t);
  const src = c.createBufferSource(), g = c.createGain(); src.buffer = b; src.playbackRate.value = sfxPitch; g.gain.value = REC_VOL;
  src.connect(g).connect(o); src.start(t); return b.duration / sfxPitch;
};
const REC_VOL = 0.85;
// Cada personaje tiene su propio "tono": el mismo bicho no suena igual que su primo.
const pitchOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) | 0; return 0.86 + (Math.abs(h) % 29) / 100; };
const charSound = (snd, name) => (String(snd).includes('~') ? snd : snd + '~' + pitchOf(name).toFixed(2));
let lastSfx = '', lastPitch = 0;
function playSfx(spec, once) {
  return new Promise((res) => {
    let [name, p] = String(spec).split('~'), pitch = +p || 1;
    if (REC_UP[name]) name = REC_UP[name];
    const c = audioCtx(), fn = SOUNDS[name];
    if (!c || !fn) return res();
    // Que no se repita: si toca el mismo sonido dos veces seguidas, cambia el tono.
    if (name !== 'tick') { if (name === lastSfx && Math.abs(pitch - lastPitch) < 0.06) pitch *= lastPitch >= 1 ? 0.87 : 1.14; lastSfx = name; lastPitch = pitch; }
    try {
      stopSfx();
      // Más fuerte: subimos el volumen y un compresor evita que se distorsione.
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 6;
      sfxOut = c.createGain(); sfxOut.gain.value = once ? 1.5 : 2.6;
      sfxOut.connect(comp).connect(c.destination);
      if (name !== 'tick') { const w = c.createGain(); w.gain.value = 0.35; sfxOut.connect(reverb(c)).connect(w).connect(comp); } // eco de ambiente
      // Un solo sonido, una sola vez.
      sfxPitch = pitch; let at; try { at = fn(c, sfxOut, c.currentTime + 0.05) + 0.1; } finally { sfxPitch = 1; }
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
async function shareApp(text, link = APP_LINK) {
  const msg = text || '¡Mirá esta app! Te enseña cualquier tema hablando, te toma examen y te dice qué bicho sos: del Musgo hasta Nivel Dios. ¿Te animás?';
  // En el celular: el menú del teléfono (WhatsApp, Telegram, mail, SMS, Instagram y todas las apps).
  if (navigator.share && /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Profe de Voz', text: msg, url: link }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  shareMenu(msg, link);
}
// En la compu (o si el teléfono no tiene menú): botones para cada lugar.
function shareMenu(msg, link = APP_LINK) {
  const full = `${msg} ${link}`, m = encodeURIComponent(msg), u = encodeURIComponent(link), f = encodeURIComponent(full);
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
function startCountdown(spoken, onZero, everySecond) {
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
    paint(); if (everySecond) playSfx('tick', true);
    cdTimer = setInterval(() => {
      left--; paint();
      if (left > 0 && (everySecond || left <= 5)) playSfx('tick', true);
      if (left <= 0) { clearCountdown(); onZero(); }
    }, 1000);
  });
}
// ---------- Navegación ----------
let view = { name: 'home' };
const stack = [];
// Recarga con la versión nueva solo si no está en medio de una clase, examen o duelo.
function reloadIfIdle() {
  if (!window.__needReload || window.__reloaded) return;
  if (['module', 'exam', 'duelPlay', 'chat'].includes(view.name)) return;
  window.__reloaded = true; location.reload();
}
function go(name, params = {}, push = true) {
  if (window.__needReload && !['module', 'exam', 'duelPlay'].includes(name)) { window.__reloaded = true; return location.reload(); }
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
// Todos entran con solicitud aprobada por el administrador. Solo el administrador entra sin pedir.
const needsAccess = () => !(settings.access && (settings.access.status === 'approved' || settings.access.is_admin));
let lastShown = null;
function render() {
  if (needsAccess() && !['access', 'settings'].includes(view.name)) view = { name: 'access' };
  else if (view.name === 'home' && store.get('profe-duel-pending', null)) { // abrieron un link de duelo
    const id = store.get('profe-duel-pending', null); try { localStorage.removeItem('profe-duel-pending'); } catch {}
    stack.length = 0; stack.push(view); view = { name: 'duel', id };
  }
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
      <label style="margin-top:0">Voz del profe <span class="pill ok">ElevenLabs</span></label>
      <div class="voices"><button class="voice-btn ${settings.engine === 'rafael' ? 'on' : ''}" data-rafael="1">
        <span class="voice-ico">🧉</span>
        <span class="voice-txt"><b>Rafael · Hombre</b><span>Argentina · el profe ${settings.elevenKey ? '· listo ✓' : '· necesita la clave de ElevenLabs'}</span></span>
        ${settings.engine === 'rafael' ? '<span class="voice-check">✓</span>' : ''}
      </button></div>
      <div id="rafaelKeyBox" style="display:${view.showRafaelKey ? 'block' : 'none'};margin-top:10px">
        <input id="elevenKey" type="password" placeholder="Pegá acá la clave de ElevenLabs" autocomplete="off" value="${esc(settings.elevenKey || '')}">
        <div class="row" style="margin-top:8px"><button id="saveEleven">Guardar y probar</button><span id="elevenMsg" class="muted small"></span></div>
        <p class="muted small">Se guarda solo en este teléfono. Se saca en elevenlabs.io → tu nombre → API Keys → Create.</p>
      </div>
      <label>Voces naturales <span class="pill ok">gratis</span></label>
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
        <button class="voice-btn ${isBrowserVoice() && v && v.voiceURI === x.voiceURI ? 'on' : ''}" data-voice="${esc(x.voiceURI)}">
          <span class="voice-ico">${genderOf(x) === 'hombre' ? '👨' : genderOf(x) === 'mujer' ? '👩' : '🗣️'}</span>
          <span class="voice-txt"><b>Voz ${i + 1}${genderOf(x) ? ' · ' + (genderOf(x) === 'hombre' ? 'Hombre' : 'Mujer') : ''}</b><span>${country(x)}${QUALITY.test(x.name) ? ' · ★ natural' : ''}</span></span>
          ${isBrowserVoice() && v && v.voiceURI === x.voiceURI ? '<span class="voice-check">✓</span>' : ''}
        </button>`).join('')}</div>`
        : `<div class="voices"><button class="voice-btn ${isBrowserVoice() ? 'on' : ''}" data-voice=""><span class="voice-ico">🗣️</span><span class="voice-txt"><b>Voz del teléfono</b><span>Español</span></span>${isBrowserVoice() ? '<span class="voice-check">✓</span>' : ''}</button></div>`}
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
  const rb = app.querySelector('[data-rafael]');
  if (rb) rb.onclick = () => {
    if (!settings.elevenKey) { view.showRafaelKey = true; $('rafaelKeyBox').style.display = 'block'; $('elevenKey').focus(); return; }
    settings.engine = 'rafael'; save(); render();
    speak('Hola, soy Rafael, tu profe. Hoy vamos a aprender algo nuevo, paso a paso y sin apuro.');
  };
  if ($('saveEleven')) $('saveEleven').onclick = async () => {
    const k = $('elevenKey').value.trim();
    if (k.length < 20) { $('elevenMsg').innerHTML = '<span class="err">Esa clave parece incompleta.</span>'; return; }
    $('elevenMsg').textContent = 'Probando…';
    const old = settings.elevenKey; settings.elevenKey = k;
    try {
      const blob = await rafaelAudio('Hola, soy Rafael, tu profe. ¡Arrancamos!');
      settings.engine = 'rafael'; view.showRafaelKey = false; save(); render(); toast('✓ Rafael ya es tu profe.'); playBlob(blob);
    } catch (e) { settings.elevenKey = old; $('elevenMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
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
      ${avg != null ? `<div class="small" style="margin-top:8px;font-weight:600"><span class="mini-emo ${animOf(levelFor(avg).chars[0][4])}" style="font-size:22px">${levelOf(avg)[2]}</span> ${levelOf(avg)[1]}</div>` : ''}
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
      <div class="muted small" style="margin-top:10px">Dificultad:</div>
      <div class="chips" id="diffChips">${Object.entries(DIFFS).map(([k, d]) => `<button class="chip ${(settings.diff || 'medio') === k ? 'on' : ''}" data-diff="${k}">${d.label}</button>`).join('')}</div>
      <button id="topicGo" class="block" style="margin-top:4px">Empezar a estudiar →</button>
      <div class="muted small" style="margin-top:12px">¿No se te ocurre nada? Tocá uno:</div>
      <div class="sug-wrap">${pickSome(SUGGESTIONS.filter((x) => !subjects.some((s) => s.topic.toLowerCase() === x.toLowerCase())), 6).map((x) => `<button class="chip sug" data-sug="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div id="homeStatus" class="muted small" style="margin-top:8px"></div>
    </div>
    <div class="row share-row">${SB_URL ? '<button class="grow rank-cta" id="toRank">⚔️ Competencia</button>' : ''}<button class="grow share-cta" id="shareBtn">📤 Compartir la app</button></div>
    <button class="block soft" id="toChars" style="margin-top:8px">🐾 Ver todos los personajes</button>
    <h2>Mis áreas</h2>
    ${items || '<p class="muted">Todavía no agregaste ninguna.</p>'}`;
  const ng = document.getElementById('nameGo');
  if (ng) { const ni = document.getElementById('nameInput'); ni.onkeydown = (e) => { if (e.key === 'Enter') ng.click(); };
    ng.onclick = () => { const n = ni.value.trim(); if (!n) return; settings.name = n; save(); render(); speak(`Hola, soy tu profe. ¿Qué querés aprender hoy?`); }; }
  const tr = document.getElementById('toRank'); if (tr) tr.onclick = () => go('compete');
  if (tr && SB_URL && !needsAccess() && Date.now() - (window.__chkDuels || 0) > 30000) { window.__chkDuels = Date.now();
    sbRpc('my_duels', { p_player: settings.playerId }).then((ds) => { window.__pendDuels = (ds || []).filter((d) => d.for_me && !d.results.some((r) => r.me && r.done)).length; const b = document.getElementById('toRank'); if (b && window.__pendDuels) b.dataset.badge = window.__pendDuels; }).catch(() => {}); }
  if (tr && window.__pendDuels) tr.dataset.badge = window.__pendDuels;
  document.getElementById('toChars').onclick = () => go('characters');
  document.getElementById('shareBtn').onclick = () => shareApp();
  const ts = document.getElementById('toSettings'); if (ts) ts.onclick = (e) => { e.preventDefault(); go('settings'); };
  app.querySelectorAll('[data-sid]').forEach((el) => el.onclick = () => go('subject', { sid: el.dataset.sid }));
  const inp = document.getElementById('topicInput');
  if (settings.name && settings.autoRead && !view.asked) { view.asked = true; speak('¿Qué querés estudiar hoy?'); }
  inp.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('topicGo').click(); };
  document.getElementById('topicGo').onclick = () => { const t = inp.value.trim(); if (t) createSubject(t); };
  app.querySelectorAll('[data-diff]').forEach((el) => el.onclick = () => { settings.diff = el.dataset.diff; save(); app.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === el)); });
  app.querySelectorAll('[data-sug]').forEach((el) => el.onclick = () => { inp.value = el.dataset.sug; createSubject(el.dataset.sug); });
};

const SUGGESTIONS = ['El sistema solar', 'Cómo hacer pan casero', 'Primeros auxilios', 'Los dinosaurios', 'Inglés para viajar', 'Cómo ahorrar plata', 'Historia argentina', 'El cuerpo humano', 'Fotografía con el celular', 'Huerta en casa', 'Los volcanes', 'Cocina básica', 'Ajedrez para principiantes', 'Los océanos', 'Cómo funciona internet', 'Mitología griega', 'Reciclaje', 'Los animales de la selva', 'Matemática del día a día', 'Guitarra para empezar', 'Las emociones', 'Electricidad en casa', 'Los planetas', 'Fútbol: reglas y tácticas', 'Inteligencia artificial', 'Cuidado de mascotas', 'Arte rupestre', 'Música: las notas', 'Nutrición sana', 'El clima y las nubes'];
function pickSome(xs, n) { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
async function createSubject(topic) {
  const st = document.getElementById('homeStatus'), btn = document.getElementById('topicGo');
  st.textContent = `Armando el temario de "${topic}"… (tarda unos segundos)`; btn.disabled = true;
  try {
    const j = await askJSON(
      'Sos un profesor experto que arma planes de estudio para un adulto hispanohablante que estudia desde el celular. ' +
      'Forma: {"topic":"nombre corto","emoji":"un emoji que represente el tema","description":"una frase","stages":[{"title":"...","summary":"una frase","modules":[{"title":"título corto y concreto"}]}]}. ' +
      'De lo básico a lo avanzado. Armá el plan sobre la LÓGICA del tema (cómo funciona, conceptos, problemas, criterios y práctica, con los referentes principales como ejemplos), NO sobre su historia ni su cronología, salvo que el tema sea explícitamente historia. ' + diffOf(null).plan + ' Cada etapa con 3 a 5 módulos MUY cortos (cada uno se lee en 1 o 2 minutos).',
      'Quiero aprender: ' + topic, 3000);
    const s = {
      id: Date.now().toString(36), diff: settings.diff || 'medio', topic: j.topic || topic, emoji: j.emoji || '📘', description: j.description || '', current: 0,
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
      <div class="muted small" style="margin-top:6px">${done} de ${s.stages.length} etapas aprobadas</div>
      <div class="chips" style="margin-top:8px">${Object.entries(DIFFS).map(([k, d]) => `<button class="chip ${(s.diff || 'medio') === k ? 'on' : ''}" data-sdiff="${k}">${d.label}</button>`).join('')}</div></div>
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
    ${courseDone(s) ? `<div class="card final-card"><b>🎓 ¡Terminaste todo el curso!</b>
      <div class="muted small" style="margin:6px 0 10px">Ahora te toca el examen final: 10 preguntas de todas las etapas.${s.finalBest != null ? ` Tu mejor nota: <b>${fmt(s.finalBest)}</b>.` : ''}</div>
      <button class="block" id="finalGo"><span>${s.finalBest != null ? 'Rendir de nuevo el examen final' : 'Rendir el examen final →'}</span></button></div>` : ''}
    <div style="text-align:center;margin-top:24px"><button class="plain small" id="delSubj">Borrar esta área</button></div>`;
  const fg = document.getElementById('finalGo'); if (fg) fg.onclick = () => startExam(s, s.stages.length - 1, 'final', fg);
  app.querySelectorAll('[data-sdiff]').forEach((el) => el.onclick = () => { s.diff = el.dataset.sdiff; save(); render(); toast('Dificultad: ' + DIFFS[s.diff].label + '. Se nota en las próximas clases y exámenes.'); });
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
const DIFFS = {
  facil: { label: '🙂 Fácil', plan: 'Nivel FÁCIL: lenguaje muy simple, como para alguien que nunca vio el tema. Entre 4 y 5 etapas.',
    teach: 'Nivel FÁCIL: explicá con palabras muy simples y ejemplos de todos los días. Preguntas sencillas pero que igual hagan pensar.',
    q: 'DIFICULTAD: fácil. Preguntas simples sobre lo principal, pero que no se contesten con una sola palabra.', kind: 'preguntas abiertas y sencillas que se respondan en 1 a 2 frases', modLen: '1 o 2 frases', prog: '(de fácil a un poquito más difícil)',
    grade: 'Corregí con paciencia: si la idea principal está bien, aunque falten detalles, puede sacar 7 u 8. ' },
  medio: { label: '🤔 Medio', plan: 'Nivel MEDIO. Entre 5 y 7 etapas.',
    teach: 'Nivel MEDIO: explicá claro y con algún dato concreto.',
    q: 'DIFICULTAD: media. Las preguntas piden explicar el porqué o el cómo con algún detalle concreto.', kind: 'preguntas abiertas y concretas que se respondan en 2 a 3 frases', modLen: '2 frases', prog: '(de fácil a media)',
    grade: 'Corregí con justicia: si es correcta pero le faltan detalles importantes, no más de 7. ' },
  dificil: { label: '🔥 Difícil', plan: 'Nivel DIFÍCIL: más profundo y técnico. Entre 6 y 8 etapas.',
    teach: 'Nivel DIFÍCIL: explicá con precisión, usando los términos correctos del tema.',
    q: '', kind: 'preguntas abiertas, difíciles y detalladas que se respondan en 2 a 4 frases', modLen: '2 o 3 frases con detalles', prog: '(de media a difícil)',
    grade: 'Corregí con exigencia: una respuesta correcta pero vaga o sin detalles no pasa de 6; 9 o 10 solo si es correcta, completa y con detalles precisos. ' },
};
const diffOf = (s) => DIFFS[(s && s.diff) || settings.diff || 'medio'] || DIFFS.medio;
const Q_HARD = 'DIFICULTAD: exigente. Las preguntas tienen que pedir detalles concretos (causas, pasos en orden, diferencias entre dos cosas, datos, consecuencias, un ejemplo real explicado) y no se pueden contestar con una sola palabra ni con algo obvio.';
DIFFS.dificil.q = Q_HARD;
const Q_RULE = 'REGLA DE ORO DE LAS PREGUNTAS: la pregunta NUNCA puede contener, insinuar ni dejar adivinar la respuesta. No repitas en la pregunta las palabras clave de la respuesta, no hagas preguntas de sí/no ni de opción múltiple, no pongas la respuesta entre paréntesis o como ejemplo. Preguntá por el porqué, el cómo, para qué sirve, qué pasaría si…, o pedí un ejemplo propio, de modo que haya que pensar o recordar.';
function learnSystem(s, st, m) {
  return teacher() + `
Estás enseñando "${s.topic}". Etapa: "${st.title}". Módulo: "${m.title}". ${diffOf(s).teach}
Enseñás este módulo en ${STEPS} pasos, como una charla. En cada paso explicás UNA sola idea en 1 o 2 frases cortas y SIEMPRE le sumás un EJEMPLO concreto de la vida cotidiana argentina que la haga fácil de entender ("Por ejemplo: …" o "Es como cuando…"), todo en un máximo de 50 palabras, y enseguida hacés UNA pregunta sobre esa idea que haga pensar (no obvia). La pregunta no puede responderse copiando palabras de tu explicación: pedí aplicarla, dar un ejemplo o explicar el porqué con sus palabras. ${Q_RULE}
Siempre respondés SOLO con JSON válido, sin texto extra:
- Si el mensaje es "EMPEZAR": {"explain":"idea 1 + ejemplo cotidiano","question":"pregunta 1"}
- Si el alumno responde la pregunta: {"kind":"answer","correct":1-10,"clarity":1-10,"feedback":"una o dos frases cortas, claras y cálidas, SIN chistes ni ironía (la app ya hizo el chiste): si estuvo bien o qué faltó; si estuvo mal o incompleta, decí la respuesta correcta con un ejemplo corto","explain":"siguiente idea + ejemplo cotidiano (vacío si ya fue el último paso)","question":"siguiente pregunta (vacío si ya fue el último paso)"}
  Cuando el alumno responde, el feedback, la siguiente idea y la pregunta van SIN chistes, ironías ni bromas: claros y directos.
  "correct" = qué tan correcta es la respuesta. "clarity" = qué tan clara y precisa la explicó.
- Si el alumno NO responde sino que pregunta algo o pide más detalle: {"kind":"doubt","reply":"respondé su duda con un ejemplo concreto y cotidiano, acá sí podés extenderte un poco (máximo 80 palabras)","question":"repetí la pregunta pendiente"}`;
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
    : `<div class="msg ai">${t.score != null ? `<div class="mini-score ${t.score >= PASS ? 'ok' : 'bad'}"><span class="mini-emo ${t.lv ? animOf(t.lv.sound) : ''}">${t.lv ? t.lv.emoji : levelOf(t.score)[2]}</span> ${fmt(t.score)} · ${esc(t.lv ? t.lv.sos : levelOf(t.score)[3])}</div>${t.joke ? `<div class="joke">${esc(t.joke)}</div>` : ''}${t.gossip ? `<div class="gossip">🗣️ ${esc(t.gossip)}</div>` : ''}` : ''}${t.feedback ? `<div class="fb">${esc(t.feedback)}</div>` : ''}${t.explain ? `<div>${esc(t.explain)}</div>` : ''}${t.question ? `<div class="q">❓ ${esc(t.question)}</div>` : ''}
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
      turn = { role: 'ai', score, lv, joke: lv.joke, gossip: '', feedback: j.feedback, explain: j.explain, question: j.question };
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

// Cada personaje se mueve según su sonido: salta, se menea, flota, pisa fuerte o gira.
const ANIM = { hop: 'bark monkey boing croak chirp squeak quack honk pop cricket cricketr springr plop laugh clap fruit gulp voice1 voice3 raven callwhistle whistle',
  wig: 'buzz scuttle squish meow purr laser robot fly cicada sniff cough phone weird dishes paper kettle toilet',
  flo: 'whale dolphin bubble bloop coo flutter eagle hoot magic choir owl ghost bubbling splash sip yawn magicr teleport record bell shipbell',
  stomp: 'roar thud moo neigh heehaw thunder drum horn lion beast dino1 dino3 monster cannon djembe pot gong dooropen cymbal gameover' };
const animOf = (snd) => { snd = String(snd).split('~')[0]; return 'a-' + (Object.keys(ANIM).find((k) => ANIM[k].split(' ').includes(snd)) || 'spin'); };
// ---------- Galería: todos los personajes, por nivel ----------
views.characters = () => {
  setHeader('Personajes');
  const seen = rot.seen || [], all = LEVELS.reduce((n, l) => n + l.chars.length, 0);
  const got = LEVELS.reduce((n, l) => n + l.chars.filter((c) => seen.includes(c[0])).length, 0);
  app.innerHTML = `
    <p class="muted small">Hay <b>${all}</b> personajes. Te tocaron <b>${got}</b>. Tocá uno para escuchar su sonido.</p>
    ${LEVELS.map((l, i) => { const next = LEVELS[i + 1];
      return `<h2>${l.min >= 6 ? '🌟' : '🌱'} Nota ${fmt(l.min)}${next ? ' a ' + fmt(Math.round((next.min - 0.1) * 10) / 10) : ' a 10'}</h2>
      <div class="char-grid">${l.chars.map((c) => `<button class="char-card ${seen.includes(c[0]) ? 'got' : ''}" data-snd="${charSound(c[4], c[0])}"><span class="char-emoji" data-anim="${animOf(c[4])}">${c[2]}</span><span>${esc(c[0])}</span>${seen.includes(c[0]) ? '<span class="char-got">✓</span>' : ''}</button>`).join('')}</div>`; }).join('')}`;
  app.querySelectorAll('[data-snd]').forEach((el) => el.onclick = () => { audioCtx(); playSfx(el.dataset.snd, true);
    const e = el.querySelector('.char-emoji'); e.classList.remove(e.dataset.anim); void e.offsetWidth; e.classList.add(e.dataset.anim); });
};

// ---------- Competencia: duelos por link ----------
// Dos (o más) personas contestan las mismas preguntas de escuela. 20 segundos cada una.
// Puntos: hasta 100 por respuesta correcta + 1 punto por cada segundo que te sobró (si estuvo bien).
// Acá NO habla el profe: ni chistes, ni personajes, ni confidencias. Solo puntaje.
const DUEL_N = 8, DUEL_T = 20, DUEL_MAX = 3;
// Terminó cuando jugaron todos los que tenían que jugar (2 o 3). Si fue por link, alcanza con 2 que terminaron.
const duelAllDone = (d) => { const rs = d.results || []; return rs.length > 1 && rs.every((r) => r.done) && (!d.expected || rs.length >= d.expected); };
const DUEL_TOPICS = [['mezcla', '🎲 Mezcla de todo'], ['matematica', '➗ Matemática'], ['lengua', '📖 Lengua'], ['naturales', '🌱 Ciencias naturales'],
  ['historia', '🇦🇷 Historia'], ['geografia', '🗺️ Geografía'], ['cultura', '🧠 Cultura general']];
const duelTopicName = (k) => (DUEL_TOPICS.find((x) => x[0] === k) || DUEL_TOPICS[0])[1].replace(/^\S+\s/, '');
// Temas ya usados: tus cursos, los "Otro tema" que escribiste y los de duelos anteriores. Aparecen como opciones.
function usedTopics(duels) {
  const fixed = DUEL_TOPICS.map((x) => duelTopicName(x[0]).toLowerCase()), seen = new Set(), out = [];
  const add = (t, e) => { t = String(t || '').trim().slice(0, 60); const k = t.toLowerCase(); if (!t || seen.has(k) || fixed.includes(k)) return; seen.add(k); out.push([t, e]); };
  store.get('profe-duel-topics', []).forEach((t) => add(t, '⚔️'));
  subjects.forEach((x) => add(x.topic, x.emoji || '📘'));
  (duels || []).forEach((d) => add(d.topic, '⚔️'));
  return out.slice(0, 10);
}
const duelLink = (id) => `${APP_LINK}?duelo=${id}`;
// Si alguien abrió un link de duelo, lo guardamos hasta que tenga acceso.
try { const q = new URLSearchParams(location.search).get('duelo'); if (q && /^[a-z0-9]{6,12}$/.test(q)) { store.set('profe-duel-pending', q); history.replaceState(null, '', location.pathname); } } catch {}
let duelPoll = null;
function stopDuelPoll() { clearInterval(duelPoll); duelPoll = null; }
const secs = (n) => `${Math.floor(n / 60) ? Math.floor(n / 60) + ' min ' : ''}${n % 60} s`;

views.compete = () => {
  setHeader('Competencia');
  // Para competir y chatear hay que estar aprobado por el administrador, aunque tengas tu propia clave.
  const acc = settings.access || {};
  if (acc.status !== 'approved' && !acc.is_admin) {
    app.innerHTML = `<div class="card ask-card"><div class="ask-q">⚔️ Competencia</div>
      <p>Para competir, ver a los demás y usar el chat, el administrador tiene que aprobarte.</p>
      ${acc.status === 'pending' ? '<p><b>⏳ Ya pediste acceso.</b> Avisale al administrador para que te apruebe, y después volvé a entrar acá.</p>'
        : `<button class="block" id="askComp">🙋 Pedir acceso${settings.name ? ' como ' + esc(settings.name) : ''}</button>`}
      <div id="askMsg" class="muted small" style="margin-top:8px"></div></div>`;
    const b = document.getElementById('askComp');
    if (b) b.onclick = async () => {
      if (!settings.name) { document.getElementById('askMsg').textContent = 'Primero poné tu nombre en Inicio.'; return; }
      b.disabled = true;
      try { const s = await sbRpc('request_access', { p_player: settings.playerId, p_name: settings.name }); settings.access = { ...acc, status: s || 'pending' }; save(); render(); }
      catch (e) { b.disabled = false; document.getElementById('askMsg').textContent = e.message; }
    };
    refreshAccess().then((a) => { if (view.name === 'compete' && a && (a.status === 'approved' || a.is_admin) && acc.status !== a.status) render(); });
    return;
  }
  const rvs = () => view.rvs || [];
  const draw = () => {
    const pend = (d) => d.for_me && !d.declined && !d.results.some((r) => r.me && r.done);
    const ds = (view.duels || []).slice().sort((a, b) => pend(b) - pend(a));
    app.innerHTML = `
      <div class="card ask-card"><div class="ask-q">⚔️ Duelo</div>
        <div class="muted small">${DUEL_N} preguntas de escuela. Tenés ${DUEL_T} segundos para cada una. Por cada respuesta bien sumás hasta 100 puntos, y además 1 punto por cada segundo que te sobró. Gana el que suma más.</div>
        <div class="muted small" style="margin-top:10px">Elegí el tema:</div>
        <div class="sug-wrap">${DUEL_TOPICS.map(([k, l]) => `<button class="chip ${(view.dt || 'mezcla') === k ? 'on' : ''}" data-dt="${k}">${l}</button>`).join('')}${usedTopics(view.duels).map(([t, e], k) => `<button class="chip ${view.dt === 'libre' && (view.free || '').trim().toLowerCase() === t.toLowerCase() ? 'on' : ''}" data-ut="${k}">${e} ${esc(t)}</button>`).join('')}<button class="chip ${view.dt === 'libre' ? 'on' : ''}" data-dt="libre">✏️ Otro tema</button></div>
        ${view.dt === 'libre' ? `<input id="freeTopic" class="ask-input" style="margin-top:8px" placeholder="Escribí el tema. Ej: los planetas, fútbol, animales" value="${esc(view.free || '')}">` : ''}
        <div class="muted small" style="margin-top:10px">¿A quién desafiás? Podés elegir hasta 2 (juegan 3 en total).</div>
        <div class="sug-wrap"><button class="chip ${!rvs().length ? 'on' : ''}" data-rv="">🔗 Por link a cualquiera</button>${(view.players || []).map((pl) => `<button class="chip ${rvs().includes(pl.id) ? 'on' : ''}" data-rv="${pl.id}">👤 ${esc(pl.name)}</button>`).join('')}</div>
        <div class="muted small" style="margin-top:10px"><b>¿Cuál es la consecuencia?</b> Es obligatoria: sin desafío no hay duelo. (Solo de palabra.)</div>
        <div class="duel-norm">🤝 <b>Regla de oro:</b> la consecuencia nunca puede ser violencia, someter ni humillar a nadie. Eso no está bien. Lo que de verdad importa es la voluntad, el conocimiento y el criterio. Ejemplos buenos: lavar los platos, leer un cuento, enseñarle algo al otro, ordenar la pieza.</div>
        <input id="duelBet" class="ask-input" maxlength="120" style="margin-top:6px" placeholder="Ej: el que pierde lava los platos" required value="${esc(view.bet || '')}">
        <button class="block" id="newDuel" style="margin-top:12px">Crear duelo y desafiar →</button>
        <div id="duelMsg" class="muted small" style="margin-top:8px"></div></div>
      <button class="block soft" id="toChat" style="margin-top:4px">💬 Charla con todos</button>
      <h2>Mis duelos</h2>
      ${view.loading ? '<p class="muted">Cargando…</p>' : view.err ? `<p class="muted">${esc(view.err)}</p>` : ds.length ? ds.map((d) => {
        const me = d.results.find((r) => r.me), others = d.results.filter((r) => !r.me);
        return `<div class="card tap duel-row ${pend(d) ? 'duel-new' : ''}" data-duel="${d.id}">${pend(d) ? `<div class="duel-badge">⚔️ ¡${esc(d.creator_name)} te desafió!</div>` : ''}<div class="between"><b>${esc(d.topic)}</b><span class="muted small">${new Date(d.created_at).toLocaleDateString('es-AR')}</span></div>${d.bet ? `<div class="small">🎲 Se apuesta: ${esc(d.bet)}</div>` : ''}
          <div class="small" style="margin-top:6px">${d.results.length ? d.results.map((r, i) => `${i === 0 && duelAllDone(d) ? '🏆 ' : ''}${esc(r.me ? 'Vos' : r.name)}: <b>${r.points}</b>${r.done ? '' : ' (jugando)'}`).join(' · ') : 'Nadie jugó todavía'}</div>
          ${d.declined && d.mine ? `<div class="small duel-declined">🙅 ${esc(d.declined_names || 'Tu rival')} rechazó el desafío</div>` : ''}
          ${!me || !me.done ? '<div class="small" style="margin-top:4px;color:var(--accent);font-weight:700">Te toca jugar →</div>' : !duelAllDone(d) ? `<div class="muted small" style="margin-top:4px">${d.target_name && d.mine ? `Esperando a ${esc(d.target_name)}…` : others.length ? 'Faltan jugadores o están jugando…' : 'Esperando rival. Compartí el link.'}</div>` : ''}</div>`;
      }).join('') : '<p class="muted">Todavía no tenés duelos. ¡Creá uno y mandale el link a alguien!</p>'}
      <button class="block soft" id="toRank2" style="margin-top:12px">🏆 Ver el ranking</button>`;
    app.querySelectorAll('[data-dt]').forEach((el) => el.onclick = () => { view.dt = el.dataset.dt; draw(); const f = document.getElementById('freeTopic'); if (f) f.focus(); });
    app.querySelectorAll('[data-ut]').forEach((el) => el.onclick = () => { view.dt = 'libre'; view.free = usedTopics(view.duels)[+el.dataset.ut][0]; draw(); });
    app.querySelectorAll('[data-rv]').forEach((el) => el.onclick = () => {
      const id = el.dataset.rv; let l = rvs();
      if (!id) l = []; else if (l.includes(id)) l = l.filter((x) => x !== id); else if (l.length >= 2) return toast('Máximo 2 rivales: el duelo es de hasta 3 personas.'); else l = l.concat(id);
      view.rvs = l; draw();
    });
    const ft = document.getElementById('freeTopic'); if (ft) ft.oninput = () => { view.free = ft.value; };
    const bt = document.getElementById('duelBet'); bt.oninput = () => { view.bet = bt.value; };
    document.getElementById('toChat').onclick = () => go('chat', { room: 'general' });
    app.querySelectorAll('[data-duel]').forEach((el) => el.onclick = () => go('duel', { id: el.dataset.duel }));
    document.getElementById('toRank2').onclick = () => go('ranking');
    document.getElementById('newDuel').onclick = () => createDuel(view.dt || 'mezcla', view.free, rvs(), (view.players || []).filter((x) => rvs().includes(x.id)), view.bet);
  };
  draw();
  if (!view.players) { view.players = []; sbRpc('duel_players', { p_player: settings.playerId }).then((x) => { view.players = x || []; if (view.name === 'compete') draw(); }).catch(() => {}); }
  if (!view.duels && !view.loading) {
    view.loading = true;
    sbRpc('my_duels', { p_player: settings.playerId }).then((x) => { view.duels = x || []; }).catch((e) => { view.err = e.message; })
      .finally(() => { view.loading = false; if (view.name === 'compete') draw(); });
  }
};
// Las consecuencias no pueden ser violencia, sometimiento ni humillación. Primero un filtro rápido y después lo revisa Claude.
const BAD_BET = /(peg|golpe|cachetad|pi[ñn]a|patad|trompad|escupi|humill|burl|desnud|arrodill|esclav|obedec|sirviente|lam[eé]|pis[aá]r?le|tirar?le|ba[ñn]o.*(fr[ií]a|helad)|agua fr[ií]a|insult|grit[aá]r?le|ridicul|empuj|encerr|quemar|cortar?le|azot|castig)/i;
async function badBet(bet) {
  const t = String(bet || '').trim();
  if (BAD_BET.test(t)) return true;
  try {
    const j = await askJSON('Revisás consecuencias (prendas) de un juego de preguntas que usan también chicos. Están PROHIBIDAS las que impliquen violencia física o verbal, sometimiento u obediencia forzada, humillación o vergüenza pública, peligro, maltrato, burlas, o algo que lastime el cuerpo o la dignidad. Están BIEN las tareas útiles o amistosas: lavar los platos, ordenar, leer, enseñar algo, cocinar, invitar algo rico, hacer un dibujo.',
      `Consecuencia: "${t}"\nForma: {"ok": true o false, "why": "si no está bien, el motivo en 6 palabras o menos"}`, 120, FAST_MODEL);
    if (j && j.ok === false) return String(j.why || '').trim() || true;
  } catch {}
  return false;
}
async function createDuel(topicKey, free, targets, targetObjs, bet) {
  const btn = document.getElementById('newDuel'), msg = document.getElementById('duelMsg');
  if (!settings.name) { msg.textContent = 'Primero poné tu nombre en Inicio o en Configuración.'; return; }
  const freeT = topicKey === 'libre' ? String(free || '').trim().slice(0, 60) : '';
  if (topicKey === 'libre' && !freeT) { msg.textContent = 'Escribí el tema del duelo.'; return; }
  if (String(bet || '').trim().length < 3) { msg.innerHTML = '<span class="err">Poné la consecuencia: sin desafío no se puede jugar. Ej: el que pierde lava los platos.</span>'; const bi = document.getElementById('duelBet'); if (bi) { bi.focus(); bi.classList.add('need'); } return; }
  btn.disabled = true; msg.textContent = 'Armando las preguntas…';
  try {
    msg.textContent = 'Revisando la consecuencia…';
    const why = await badBet(bet);
    if (why) { btn.disabled = false; const bi = document.getElementById('duelBet'); if (bi) { bi.focus(); bi.classList.add('need'); }
      msg.innerHTML = `<div class="duel-norm bad">🚫 Esa consecuencia no va${why === true ? '' : ': ' + esc(why)}. Nada de violencia, someter ni humillar a nadie. Lo importante es la voluntad, el conocimiento y el criterio. Probá con otra, por ejemplo: "el que pierde lava los platos".</div>`; return; }
    msg.textContent = 'Armando las preguntas…';
    const tema = freeT ? freeT : topicKey === 'mezcla' ? 'mezcla de matemática, lengua, ciencias naturales, historia argentina, geografía y cultura general' : duelTopicName(topicKey);
    const j = await askJSON('Sos un maestro de escuela primaria argentina que arma juegos de preguntas.',
      `Armá ${DUEL_N} grupos de preguntas de enseñanza básica (escuela primaria) sobre: ${tema}. Cada grupo tiene 3 preguntas DISTINTAS entre sí (con respuestas distintas) pero del MISMO subtema y la MISMA dificultad, para que cada jugador reciba una diferente y el duelo sea justo. ` +
      `Ejemplo de grupo: ["¿Cuánto es 7 por 8?","¿Cuánto es 6 por 9?","¿Cuánto es 8 por 7 menos 2?"] no vale porque la última es más difícil; tiene que ser parejo. ` +
      `Cada pregunta: corta (máximo 15 palabras), clara, con UNA sola respuesta correcta y corta (una palabra, un número o una frase corta), que se pueda contestar en menos de 20 segundos. Los grupos van variados y de fácil a media. Nada de opción múltiple. ${Q_RULE} Forma: {"slots":[["...","...","..."],["...","...","..."]]}`, 2500, FAST_MODEL);
    const qs = (j.slots || []).map((g) => (Array.isArray(g) ? g : [g]).filter((q) => typeof q === 'string' && q.trim()).slice(0, 3)).filter((g) => g.length >= 2).slice(0, DUEL_N);
    if (qs.length < 3) throw new Error('No pude armar las preguntas. Probá de nuevo.');
    const id = await sbRpc('create_duel4', { p_bet: String(bet).trim(), p_player: settings.playerId, p_name: settings.name, p_topic: freeT || duelTopicName(topicKey), p_diff: 'basico', p_questions: qs, p_target: targets[0] || null, p_target2: targets[1] || null });
    if (!id) throw new Error('No pude crear el duelo. Probá de nuevo.');
    if (freeT) store.set('profe-duel-topics', [freeT].concat(store.get('profe-duel-topics', []).filter((t) => t.toLowerCase() !== freeT.toLowerCase())).slice(0, 12));
    if (targetObjs.length) toast(`Listo: ${targetObjs.map((x) => x.name).join(' y ')} ${targetObjs.length > 1 ? 'van' : 'va'} a ver el desafío cuando abra${targetObjs.length > 1 ? 'n' : ''} Competencia.`);
    go('duel', { id, fresh: true });
  } catch (e) { btn.disabled = false; msg.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}
function shareDuel(d) {
  shareApp(`⚔️ ${settings.name || 'Alguien'} te desafía a un duelo de ${d.topic} en Profe de Voz: ${d.questions.length} preguntas, 20 segundos cada una. ¿Te animás?`, duelLink(d.id));
}

// Pantalla del duelo: marcador y botón para jugar o compartir. Se actualiza solo mientras alguien juega.
views.duel = () => {
  setHeader('Duelo');
  const draw = () => {
    const d = view.d;
    if (!d) { app.innerHTML = `<p class="muted">${view.err ? esc(view.err) : 'Cargando duelo…'}</p>`; return; }
    const me = d.results.find((r) => r.me), rs = d.results, top = rs[0];
    const allDone = duelAllDone(d), full = rs.length >= DUEL_MAX && !me;
    const verdict = !me || !me.done ? '' : rs.length < 2 ? 'Esperando que alguien acepte el desafío…'
      : !allDone ? (rs.some((r) => !r.done) ? 'Todavía hay alguien jugando…' : 'Falta que juegue alguien más…') : top.me ? '🏆 ¡Ganaste!' : rs.filter((r) => r.points === top.points && r.seconds === top.seconds).length > 1 ? '🤝 ¡Empate!' : `🏆 Ganó ${esc(top.name)}`;
    app.innerHTML = `
      <div class="card ask-card"><div class="ask-q">⚔️ ${esc(d.topic)}</div>
        <div class="muted small">Desafío de ${esc(d.mine ? 'vos' : d.creator_name)}${d.target_name ? ` para ${esc(d.for_me ? 'vos' : d.target_name)}` : ''} · ${d.questions.length} preguntas · ${DUEL_T} s cada una</div></div>
      ${d.bet ? `<div class="card duel-bet">🎲 <b>Consecuencia:</b> ${esc(d.bet)}<div class="duel-norm" style="margin-top:6px">🤝 Nunca violencia, someter ni humillar: lo importante es la voluntad, el conocimiento y el criterio.</div>${allDone && !(rs.length > 1 && rs[1].points === top.points && rs[1].seconds === top.seconds) ? `<div style="margin-top:4px">👉 ${esc(rs[rs.length - 1].me ? 'Te toca cumplir a vos' : 'Le toca cumplir a ' + rs[rs.length - 1].name)}.</div>` : ''}</div>` : ''}
      ${verdict ? `<div class="duel-verdict">${verdict}</div>` : ''}
      <div class="duel-board">${rs.length ? rs.map((r, i) => `<div class="duel-score ${r.me ? 'me' : ''} ${allDone ? 'final' : ''}"><span class="duel-pos">${i + 1}</span>${allDone ? `<span class="duel-char"><span class="anim-loop ${animOf(duelChar(d, r, rs).sound)}">${duelChar(d, r, rs).emoji}</span></span>` : ''}<b class="grow">${esc(r.me ? 'Vos' : r.name)}${allDone ? `<span class="duel-sos">${esc(duelChar(d, r, rs).sos)} · nota ${fmt(r.avg || 0)}</span><span class="duel-joke">${esc(duelChar(d, r, rs).joke)}</span>` : ''}</b>
        <span class="muted small">${r.done ? secs(r.seconds) : `jugando ${r.cum.length}/${d.questions.length}`}</span><span class="duel-pts">${r.points}</span></div>`).join('') : '<p class="muted">Nadie jugó todavía.</p>'}</div>
      ${d.declined ? `<div class="card duel-declined" style="text-align:center">🙅 ${esc(d.for_me ? 'Rechazaste' : (d.declined_names || 'Tu rival') + ' rechazó')} este desafío.</div>` : ''}
      ${full ? `<div class="card" style="text-align:center">Este duelo ya tiene ${DUEL_MAX} jugadores. ¡Creá uno nuevo!</div>` : ''}
      ${!d.bet && !me ? `<div class="card" style="text-align:center">Este duelo no tiene consecuencia, así que no se puede jugar. ¡Creá uno nuevo con su desafío!</div>` : ''}
      ${(!me || !me.done) && !full && (d.bet || me) ? `<button class="block" id="playDuel" style="margin-top:12px">${me ? 'Seguir jugando' : '¡Jugar ahora!'} →</button>` : ''}
      ${d.for_me && !me && !d.declined && !full ? '<button class="block ghost-red" id="declineDuel" style="margin-top:8px">🙅 Rechazar el reto</button>' : ''}
      ${rs.length < DUEL_MAX ? `<button class="block ${me && me.done ? '' : 'soft'}" id="shareDuel" style="margin-top:8px">📤 Desafiar a alguien con este duelo</button>` : ''}
      <button class="block soft" id="duelChat" style="margin-top:8px">💬 Chat del duelo</button>
      <button class="block soft" id="toComp" style="margin-top:8px">⚔️ Volver a Competencia</button>`;
    document.getElementById('duelChat').onclick = () => go('chat', { room: d.id, title: d.topic });
    if (allDone && verdict) announceDuel(d, rs);
    const vEl = app.querySelector('.duel-verdict'); if (vEl && allDone && bigGap(rs)) vEl.insertAdjacentHTML('beforeend', '<div class="small" style="font-weight:700">¡Qué paliza! 😱</div>');
    const pd = document.getElementById('playDuel');
    if (pd) pd.onclick = () => { if (me) toast('Ya habías empezado este duelo: cada uno juega una sola vez, así que queda con lo que tenías.'); startDuelPlay(d, me); };
    const sh = document.getElementById('shareDuel'); if (sh) sh.onclick = () => shareDuel(d);
    const dd = document.getElementById('declineDuel');
    if (dd) dd.onclick = async () => {
      if (!confirm(`¿Rechazar el reto de ${d.creator_name}?`)) return;
      dd.disabled = true;
      try { await sbRpc('decline_duel', { p_id: d.id, p_player: settings.playerId }); toast(`Listo, rechazaste el reto. ${d.creator_name} se va a enterar.`); window.__chkDuels = 0; window.__pendDuels = 0; stack.length = 0; view = { name: 'home' }; go('compete'); }
      catch { dd.disabled = false; toast('No se pudo rechazar. Probá de nuevo.'); }
    };
    document.getElementById('toComp').onclick = () => { stack.length = 0; view = { name: 'home' }; go('compete'); };
  };
  const load = () => sbRpc('get_duel', { p_id: view.id, p_player: settings.playerId })
    .then((d) => { if (!d) throw new Error('No encontré ese duelo, o todavía no tenés acceso a la app.'); view.d = d; view.err = null; })
    .catch((e) => { view.err = e.message; })
    .finally(() => { if (view.name === 'duel') draw(); });
  draw();
  if (!view.d) load();
  stopDuelPoll();
  duelPoll = setInterval(() => { if (view.name !== 'duel') return stopDuelPoll(); if (view.d && duelAllDone(view.d)) return; load(); }, 3000);
};
// Chistes del final del duelo: al que perdió (cargadas en buena onda, aptas para chicos) y al que ganó. Rotan sin repetirse.
const LOSER_JOKES = [
  'perdiste por tanto que el marcador pidió ayuda psicológica.', 'te ganaron tan fácil que el otro bostezó en la mitad.',
  'tus respuestas llegaron tarde, como el colectivo un domingo.', 'fuiste a la guerra con una cuchara de plástico.',
  'el ganador corrió en Fórmula 1 y vos en monopatín sin ruedas.', 'quedaste tan atrás que el anteúltimo te saludaba de lejos.',
  'hasta la calculadora se tapó los ojos.', 'tranqui: perder también es un arte… y vos sos un artista.',
  'si esto fuera fútbol, te metieron goles hasta en el vestuario.', 'el profe anotó tu puntaje en lápiz, por si mejora solo.',
  'tus neuronas pidieron vacaciones sin avisar.', 'llegaste último, y eso que éramos poquitos.', 'la tortuga te pasó, saludó y siguió de largo.',
  'jugaste con el cerebro en modo avión.', 'el mate se enfrió esperando una respuesta tuya.',
  'te esforzaste muchísimo… en perder.', 'tu puntaje es tan chiquito que hay que buscarlo con lupa.',
  'el ganador ya está festejando y vos todavía estás leyendo la primera pregunta.', 'tus respuestas fueron como el wifi del colectivo: no conectaron nunca.',
  'hasta el reloj de veinte segundos sintió vergüenza ajena.', 'el semáforo te dio verde y vos te quedaste mirando.',
  'jugaste como una heladera: fresquito, pero quieto.', 'la próxima traé el cerebro, que hoy vino solamente la mochila.',
  'te ganaron con una mano atrás y tomando la leche.', 'tu personaje pidió que lo cambien de jugador.',
  'si sumabas un poquito más, llegabas a regular.', 'perder es de humanos. Perder así, es de campeones del perder.',
  'en el diccionario, al lado de "último", ahora está tu foto.', 'el que perdió… sí, otra vez vos. Por si no te quedó claro.',
];
// ironía para el último: se dice siempre, una distinta cada vez
const IRONY = [
  '¡Pero qué maravilla, eh! ¡Qué nivel!', 'Aplausos… para los otros.', 'Un genio. Un genio incomprendido. Muy incomprendido.',
  'Impresionante. Impresionantemente bajito.', '¡Bravo, bravísimo! Ah, no, perdón: perdiste.', 'Llamen a la NASA: encontramos un puntaje más bajo que el suelo.',
  'Tranquilo, que lo importante es competir. Bueno, y ganar. Eso no.', 'Otro día glorioso para la colección de derrotas.',
];
const MIDDLE_JOKES = [
  'ni fu ni fa: en el medio, como el jamón del sándwich.', 'medalla de plata: brilla, pero menos.', 'te salvaste del último por un pelito.',
  'zafaste. Por poco, pero zafaste.', 'segundo: ni para festejar ni para llorar.',
];
const bigGap = (rs) => rs.length > 1 && rs[0].points - rs[rs.length - 1].points >= 250;
// Personaje de cada jugador según su nota (0 a 10). Siempre el mismo para ese duelo, así los dos ven lo mismo.
// Si la diferencia es enorme: el ganador recibe un personaje del nivel más alto y el que perdió uno del más bajo.
function duelChar(d, r, rs) {
  rs = rs || (view.d && view.d.results) || [];
  let l = levelFor(r.avg || 0);
  if (bigGap(rs) && rs.every((x) => x.done)) { if (rs[0].name === r.name && rs[0].me === r.me) l = LEVELS[LEVELS.length - 1]; else if (rs[rs.length - 1].name === r.name && rs[rs.length - 1].me === r.me) l = LEVELS[0]; }
  const key = d.id + '|' + r.name;
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = l.chars[h % l.chars.length];
  return { name: c[0], sos: c[1], emoji: c[2], sound: charSound(c[4], c[0]), joke: c[3][h % c[3].length] };
}
// Al terminar: trompetas y la voz dice quién ganó, con el personaje y chistes de cada uno. Una sola vez por duelo.
function announceDuel(d, rs) {
  const said = store.get('profe-duel-said', []), key = d.id + '|' + rs.length;
  if (said.includes(key) || (rs.length === 2 && said.includes(d.id))) return;
  store.set('profe-duel-said', said.concat(key).slice(-100));
  const top = rs[0], tie = rs.length > 1 && rs[1].points === top.points && rs[1].seconds === top.seconds;
  const huge = !tie && bigGap(rs);
  const sos = (r) => duelChar(d, r, rs).sos.replace(/^Sos /, r.me ? 'sos ' : 'es ');
  const voc = (r) => (r.me ? '' : r.name + ', ');
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const pos = rs.length === 3 ? ['Primero', 'Segundo', 'Último'] : ['Primero', 'Último'];
  const head = tie ? '¡Empate!' : top.me ? 'Ganaste vos.' : `Ganó ${top.name}.`;
  const lines = rs.map((r, i) => {
    const ch = duelChar(d, r, rs), base = `${pos[i] || ''}: ${r.me ? 'vos' : r.name}, ${r.points} puntos, y ${sos(r)}.`;
    if (tie) return base;
    if (i === 0) return `${base} {{s:${ch.sound}}}`; // el ganador: corto y austero
    if (i < rs.length - 1) return `${base} ${cap(voc(r) + rotPick('middle', MIDDLE_JOKES))}`;
    // el último: trompeta triste, su chiste, varias cargadas seguidas e ironía. Si la diferencia es enorme, más todavía.
    const n = huge ? 5 : 3, js = [];
    for (let k = 0; k < n; k++) js.push(cap(voc(r) + rotPick('loser', LOSER_JOKES)));
    return `{{s:sadtrombone}} ${base} ${dramatic(ch.joke)} {{p}} ${js.join(' {{p}} ')} {{p}} ${rotPick('irony', IRONY)}${huge ? ' {{p}} ¡Qué paliza! {{s:sadtrombone}} ¡Pero qué paliza!' : ''}`;
  }).join(' {{p}} ');
  const last = rs[rs.length - 1];
  const betLine = d.bet && !tie ? ` {{p}} Y acordate de la apuesta: ${d.bet}. ${last.me ? 'Te toca cumplir a vos.' : `Le toca cumplir a ${last.name}.`}` : '';
  speak(`{{s:fanfare}} ${head} {{p}} ${lines}${betLine}`);
  if (top.me || tie) confetti();
}
// Cada jugador recibe su variante de cada pregunta (misma dificultad, distinta pregunta) y en su propio orden.
const slotQs = (s) => (Array.isArray(s) ? s : [s]);
function seeded(seed) { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; }
function playerQuestions(d, variant) {
  const rnd = seeded(d.id + '|' + settings.playerId + '|' + variant);
  const qs = d.questions.map((s) => { const g = slotQs(s); return g[variant % g.length]; });
  for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
  return qs;
}
async function startDuelPlay(d, me) {
  if (me) { // ya lo empezó en otro momento: no se puede repetir, se cierra con lo que tenía
    sbRpc('duel_progress', { p_id: d.id, p_player: settings.playerId, p_name: settings.name, p_points: me.points, p_avg: me.avg || 0, p_seconds: me.seconds, p_answers: me.cum.map((c) => ({ cum: c })), p_done: true }).catch(() => {});
    view.d = null; return render();
  }
  let variant = 0;
  try { variant = await sbRpc('duel_join', { p_id: d.id, p_player: settings.playerId, p_name: settings.name }); } catch (e) { return toast(/lleno/i.test(e.message) ? `Este duelo ya tiene ${DUEL_MAX} jugadores.` : 'No pude entrar al duelo. Probá de nuevo.'); }
  go('duelPlay', { id: d.id, d, qs: playerQuestions(d, +variant || 0), idx: 0, ans: [], t0: 0, total: 0, rivalRows: d.results }, false);
}
// Juego: pregunta, cuenta regresiva de 20 que suena, y arriba el marcador tuyo y del rival.
views.duelPlay = () => {
  const d = view.d, i = view.idx, q = view.qs[i];
  setHeader(`Duelo · ${i + 1} de ${d.questions.length}`);
  const myPts = view.ans.reduce((a, x) => a + (x.pts || 0), 0);
  app.innerHTML = `
    <div class="duel-live ${rivalsNow().length > 1 ? 'three' : ''}">
      <div class="duel-live-box me"><div class="small">Vos</div><b id="myPts">${myPts}</b><div class="duel-dots">${d.questions.map((_, k) => `<i class="${view.ans[k] ? (view.ans[k].pts == null ? 'wait' : view.ans[k].c >= 6 ? 'ok' : 'bad') : ''}"></i>`).join('')}</div></div>
      <div class="duel-vs">VS</div>
      <div id="rivals" class="duel-rivals">${rivalsHtml()}</div>
    </div>
    <div class="card duel-q"><div style="font-size:20px;font-weight:700">${esc(q)}</div></div>
    <textarea id="dans" rows="2" placeholder="Escribí o dictá tu respuesta"></textarea>
    <button class="block" id="dsend" style="margin-top:8px">Responder →</button>`;
  const inp = document.getElementById('dans'), send = document.getElementById('dsend');
  inp.focus();
  view.t0 = Date.now();
  let sent = false;
  const answer = () => {
    if (sent) return; sent = true; clearCountdown();
    const used = Math.min(DUEL_T, Math.round((Date.now() - view.t0) / 1000)), text = inp.value.trim() || 'no sé';
    const k = view.idx, a = { text, used, pts: null, c: 0 };
    view.ans[k] = a; view.total += used;
    gradeDuel(d, k, a);
    if (k + 1 < d.questions.length) { view.idx++; render(); } else finishDuelPlay();
  };
  send.onclick = answer;
  inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answer(); } };
  startCountdown(Promise.resolve(), answer, true);
  pollRival();
};
async function gradeDuel(d, k, a) {
  try {
    const g = await askJSON('Corregís respuestas de un juego de preguntas de escuela primaria. Sé justo: aceptá sinónimos, faltas de ortografía y respuestas dictadas por voz. "no sé" o vacío es 0.',
      `Pregunta: ${view.qs ? view.qs[k] : slotQs(d.questions[k])[0]}\nRespuesta: ${a.text}\nForma: {"c": nota entera de 0 a 10 (10 = correcta, 5 = a medias, 0 = mal)}`, 120, FAST_MODEL);
    a.c = Math.max(0, Math.min(10, Math.round(+g.c || 0)));
  } catch { a.c = 0; }
  a.pts = a.c * 10 + (a.c >= 6 ? DUEL_T - a.used : 0);
  if (view.name === 'duelPlay' && view.d === d) updateDuelLive();
  saveDuelProgress(d, false);
}
function updateDuelLive() {
  const el = document.getElementById('myPts'); if (!el) return;
  const pts = view.ans.reduce((a, x) => a + ((x && x.pts) || 0), 0);
  if (el.textContent !== String(pts)) { el.textContent = pts; el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat'); }
  document.querySelectorAll('.duel-dots i').forEach((dot, k) => { const x = view.ans[k]; dot.className = x ? (x.pts == null ? 'wait' : x.c >= 6 ? 'ok' : 'bad') : ''; });
  paintRival();
}
function duelState(st) {
  const done = st.ans.filter((x) => x && x.pts != null);
  let cum = 0; const list = [];
  for (const x of st.ans) { if (!x || x.pts == null) break; cum += x.pts; list.push({ cum }); }
  return { points: done.reduce((s, x) => s + x.pts, 0), avg: done.length ? average(done.map((x) => x.c)) : 0, list };
}
let duelCur = null;
function saveDuelProgress(d, done) {
  const st = duelCur && duelCur.d === d ? duelCur : view;
  const s = duelState(st);
  return sbRpc('duel_progress', { p_id: d.id, p_player: settings.playerId, p_name: settings.name, p_points: s.points, p_avg: s.avg, p_seconds: st.total, p_answers: s.list, p_done: !!done }).catch(() => {});
}
// El rival "va saliendo" al mismo ritmo que vos: si ya terminó, ves sus puntos hasta tu misma pregunta; si está jugando, sus puntos de ahora.
function rivalsNow() {
  const others = (view.rivalRows || []).filter((r) => !r.me).slice(0, DUEL_MAX - 1);
  const n = view.d.questions.length, mine = view.ans.filter((x) => x && x.pts != null).length;
  const shownOf = (r) => (r.done ? (mine ? r.cum[Math.min(mine, r.cum.length) - 1] || 0 : 0) : r.points);
  return others.map((r) => ({ name: r.name, shown: shownOf(r), note: r.done ? `en la pregunta ${Math.min(mine, r.cum.length)} de ${n}` : `respondió ${r.cum.length} de ${n}` }));
}
const rivalsHtml = () => { const l = rivalsNow(); return l.length ? l.map((r, k) => `<div class="duel-live-box"><div class="small">${esc(r.name)}</div><b data-rp="${k}">${r.shown}</b><div class="small muted">${esc(r.note)}</div></div>`).join('')
  : '<div class="duel-live-box"><div class="small">Rival</div><b>–</b><div class="small muted">todavía no jugó</div></div>'; };
function paintRival() {
  const box = document.getElementById('rivals'); if (!box) return;
  const before = [...box.querySelectorAll('[data-rp]')].map((b) => b.textContent);
  box.innerHTML = rivalsHtml();
  const lv = box.closest('.duel-live'); if (lv) lv.classList.toggle('three', box.children.length > 1);
  box.querySelectorAll('[data-rp]').forEach((b, k) => { if (before[k] !== undefined && before[k] !== b.textContent) b.classList.add('beat'); });
}
function pollRival() {
  stopDuelPoll();
  const tick = () => sbRpc('get_duel', { p_id: view.id, p_player: settings.playerId }).then((d) => {
    if (!d || view.name !== 'duelPlay') return;
    view.rivalRows = d.results; paintRival();
  }).catch(() => {});
  tick(); duelPoll = setInterval(() => { if (view.name !== 'duelPlay') return stopDuelPoll(); tick(); }, 2500);
}
function finishDuelPlay() {
  const st = view, d = view.d; duelCur = st; stopDuelPoll();
  app.innerHTML = '<div class="card" style="text-align:center"><b>Corrigiendo tus respuestas…</b></div>';
  const wait = setInterval(() => {
    if (st.ans.some((x) => x.pts == null)) return;
    clearInterval(wait);
    saveDuelProgress(d, true).then(() => { stack.length = 0; view = { name: 'home' }; stack.push(view); go('duel', { id: d.id }, false); });
  }, 300);
}

// ---------- Chat entre usuarios aprobados (gratis: Supabase, no usa la clave de Claude) ----------
views.chat = () => {
  setHeader(view.room === 'general' ? 'Charla' : 'Chat del duelo');
  view.msgs = view.msgs || []; view.last = view.last || 0;
  const isAdm = settings.access && settings.access.is_admin;
  app.innerHTML = `
    <div class="muted small" style="margin-bottom:8px">${view.room === 'general' ? 'Acá charlan todas las personas que usan la app.' : `Duelo: ${esc(view.title || '')}`} Sé buena onda 🙂</div>
    <div id="chatBox" class="chat-box"></div>
    <div class="chat-send"><input id="chatIn" maxlength="300" placeholder="Escribí un mensaje"><button id="chatGo">Enviar</button></div>`;
  const box = document.getElementById('chatBox'), inp = document.getElementById('chatIn'), go2 = document.getElementById('chatGo');
  const paint = () => {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = view.msgs.length ? view.msgs.map((m) => `<div class="chat-msg ${m.me ? 'me' : ''}">${m.me ? '' : `<b>${esc(m.name)}</b>`}<span>${esc(m.text)}</span>
      <i>${new Date(m.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}${isAdm ? ` <a href="#" data-hide="${m.id}">🗑</a>` : ''}</i></div>`).join('') : '<p class="muted small" style="text-align:center">Todavía no hay mensajes. ¡Escribí el primero!</p>';
    if (atBottom || view.firstPaint !== false) { box.scrollTop = box.scrollHeight; view.firstPaint = false; }
    box.querySelectorAll('[data-hide]').forEach((a) => a.onclick = (e) => { e.preventDefault(); const id = +a.dataset.hide;
      sbRpc('hide_chat', { p_player: settings.playerId, p_id: id }).then(() => { view.msgs = view.msgs.filter((m) => m.id !== id); paint(); }).catch(() => toast('No se pudo borrar.')); });
  };
  const load = () => sbRpc('get_chat', { p_player: settings.playerId, p_room: view.room, p_after: view.last }).then((xs) => {
    if (!xs || !xs.length || view.name !== 'chat') return;
    view.msgs = view.msgs.concat(xs).slice(-200); view.last = xs[xs.length - 1].id; paint();
  }).catch(() => {});
  const send = () => {
    const text = inp.value.trim(); if (!text) return;
    go2.disabled = true;
    sbRpc('send_chat', { p_player: settings.playerId, p_room: view.room, p_text: text })
      .then(() => { inp.value = ''; return load(); })
      .catch(() => toast('No se pudo enviar. Esperá un segundito y probá de nuevo.'))
      .finally(() => { go2.disabled = false; inp.focus(); });
  };
  go2.onclick = send; inp.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  paint(); load();
  stopDuelPoll(); duelPoll = setInterval(() => { if (view.name !== 'chat') return stopDuelPoll(); load(); }, 3000);
};

// ---------- Exámenes ----------
const EXAMS = {
  rapido: { name: 'Repaso rápido', n: 3, desc: '3 preguntas cortas para ver si te quedó lo principal.', unlocks: false },
  etapa: { name: 'Examen de la etapa', n: 5, desc: `5 preguntas. Si sacás ${PASS} o más, aprobás y se habilita la etapa siguiente.`, unlocks: true },
  integrador: { name: 'Examen integrador', n: 6, desc: 'Mezcla preguntas de todas las etapas que ya viste.', unlocks: false },
  practico: { name: 'Caso práctico', n: 2, desc: '2 situaciones reales donde tenés que aplicar lo aprendido.', unlocks: false },
};

EXAMS.modulo = { name: 'Examen del módulo', n: 2, desc: '', unlocks: false };
EXAMS.final = { name: 'Examen final del curso', n: 10, desc: '10 preguntas de TODO el curso.', unlocks: false };
const courseDone = (s) => s.stages.length > 0 && s.stages.every((x) => x.done);
async function startModuleExam(s, si, mi, btn) {
  const m = s.stages[si].modules[mi];
  btn.disabled = true; btn.textContent = 'Preparando examen…';
  try {
    const j = await askJSON(teacher(), `Tema: ${s.topic}. El alumno acaba de leer este módulo, "${m.title}":\n${m.content}\n` +
      `Armá 2 preguntas abiertas sobre ESTE contenido, que se respondan en ${diffOf(s).modLen}. ${diffOf(s).q} ` + Q_RULE + ' Forma: {"questions":["...","..."]}', 600);
    go('exam', { sid: s.id, si, mi, type: 'modulo', questions: j.questions.slice(0, 2), answers: [], idx: 0 }, false);
  } catch (e) { btn.disabled = false; btn.textContent = 'Listo, tomame examen →'; alertBox(e.message); }
}

views.examMenu = () => {
  const s = getSubj(), st = s.stages[view.si];
  setHeader('Exámenes');
  app.innerHTML = `
    <div class="muted">Etapa ${view.si + 1}: <b style="color:var(--text)">${esc(st.title)}</b></div>
    <p class="muted small">Respondé escribiendo o dictando con el teclado. Cada respuesta tiene dos notas del 1 al 10: <b>corrección</b> (si está bien) y <b>claridad</b> (si se entiende cómo lo explicás).</p>
    ${Object.entries(EXAMS).filter(([k]) => k !== 'modulo' && k !== 'final').map(([k, e]) => `<button class="exam-type" data-type="${k}"><b>${e.name}</b><span>${e.desc}</span></button>`).join('')}
    ${st.exams.length ? `<h2>Tus notas en esta etapa</h2>${st.exams.slice().reverse().map((e) => `
      <div class="card between"><div><b>${esc(EXAMS[e.type]?.name || e.type)}</b><div class="muted small">${new Date(e.date).toLocaleDateString('es-AR')} · corrección ${fmt(e.correct)} · claridad ${fmt(e.clarity)}</div></div>
      <span class="pill ${e.score >= PASS ? 'ok' : 'bad'}">${fmt(e.score)}</span></div>`).join('')}` : ''}`;
  app.querySelectorAll('[data-type]').forEach((el) => el.onclick = () => startExam(s, view.si, el.dataset.type, el));
};

async function startExam(s, si, type, btn) {
  const st = s.stages[si], cfg = EXAMS[type];
  btn.disabled = true; btn.querySelector('span').textContent = 'Preparando preguntas…';
  const scope = type === 'final'
    ? s.stages.map((x) => `${x.title}: ${(x.modules || []).map((m) => m.title).join(', ')}`).join(' | ')
    : type === 'integrador'
    ? s.stages.slice(0, Math.max(si, s.current) + 1).map((x) => `${x.title}: ${(x.modules || []).map((m) => m.title).join(', ')}`).join(' | ')
    : `${st.title}: ${(st.modules || []).map((m) => m.title).join(', ')}`;
  const kind = type === 'practico' ? 'situaciones prácticas de la vida real donde haya que aplicar lo aprendido (cada una de 2 o 3 frases, terminando en una pregunta)'
    : diffOf(s).kind;
  try {
    const j = await askJSON(teacher(), `Tema: ${s.topic}. Contenido a evaluar: ${scope}.
Armá ${cfg.n} ${kind}, variadas, de dificultad progresiva ${diffOf(s).prog}. ${diffOf(s).q} ${Q_RULE}${type === 'final' ? ' Es el EXAMEN FINAL: repartí las preguntas entre TODAS las etapas, y que al menos una pida relacionar ideas de etapas distintas.' : ''} Forma: {"questions":["...","..."]}`, 1200);
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
        diffOf(s).grade +
        'Poné dos notas enteras del 1 al 10: "correct" (qué tan correcta y completa es) y "clarity" (qué tan clara, ordenada y precisa es la explicación; si es correcta pero confusa, baja esta nota). ' +
        'Forma: {"correct":0,"clarity":0,"feedback":"2 a 4 frases: qué estuvo bien, qué faltó o estuvo mal, y cómo decirlo más claro","ideal":"una respuesta modelo breve"}', 800, FAST_MODEL);
      view.answers[i] = { answer, correct: clamp(g.correct), clarity: clamp(g.clarity), feedback: g.feedback, ideal: g.ideal };
      render();
      if (settings.autoRead) speak(g.feedback, app.querySelector('[data-speak="fb"]'));
    } catch (e) { send.disabled = false; document.getElementById('examStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};
// Niveles chistosos (de menor a mayor). "min" = nota mínima. Cada nivel tiene 16 personajes con su sonido y sus chistes cortos,
// más chistes generales del nivel. Se van turnando sin repetir hasta usar todos. Desde 6, todos positivos.
const LEVELS = [
  { min: 0, chars: [
    ['Musgo', 'Sos un Musgo', '🌿', ['Diez años pegado a la misma piedra y aprendiste que la piedra es dura. ¡Algo es algo!', 'El musgo tarda, pero cubre la piedra entera. Vos también, despacito.'], 'bubble'],
    ['Ameba dormida', 'Sos una Ameba dormida', '🫧', ['Te dividiste en dos para estudiar y se durmieron las dos mitades.', 'La ameba no tiene cerebro y sobrevive igual. Vos tenés uno, ¡prendelo!'], 'plop'],
    ['Piedra con ojos', 'Sos una Piedra con ojos', '🪨', ['Viste la pregunta, viste la respuesta… y no te moviste ni un milímetro.', 'La piedra tardó tres siglos en contestar. Vos menos, ya es un avance.'], 'thud'],
    ['Bacteria de heladera', 'Sos una Bacteria de heladera', '🦠', ['Vivís al lado del dulce de leche y ni así se te endulzó el tema.', 'Prendieron la luz, te preguntaron la lección y te escondiste atrás del tomate.'], 'fly'],
    ['Hongo de zapatilla', 'Sos un Hongo de zapatilla', '🍄', ['Toda la semana a oscuras oliendo a pata. Hoy por lo menos te dio el sol.', 'Viajás gratis a todos los partidos, pero nunca mirás la pelota.'], 'sniff'],
    ['Chicle pegado en el banco', 'Sos un Chicle pegado en el banco', '🫥', ['Veinte años escuchando clases abajo del banco, y nada. Estabas muy ocupado estando pegado.', 'Tu gran virtud es que no te soltás nunca. Pegate al tema, entonces.'], 'pop'],
    ['Pelusa de ombligo', 'Sos una Pelusa de ombligo', '🌀', ['Pasaste el día en un ombligo: todo azul y redondito. Panorama limitado.', 'Nadie sabe de dónde sale la pelusa. Ni esta respuesta tuya.'], 'pop'],
    ['Moho de pan viejo', 'Sos un Moho de pan viejo', '🍞', ['Lunes, un puntito. Viernes, dueño del pan entero. Vos estás en el lunes.', 'Del moho salió la penicilina. Del fondo puede salir algo genial.'], 'bubbling'],
    ['Liquen de baldosa', 'Sos un Liquen de baldosa', '🟩', ['Te pisan todos los días y ni te enterás. Igual que este tema.', 'Tardás cien años en crecer un centímetro. Vamos a necesitar paciencia.'], 'bubble'],
    ['Papa olvidada en la alacena', 'Sos una Papa olvidada en la alacena', '🥔', ['Te salieron brotes, pero ninguna respuesta.', 'Estás quietita en la oscuridad. Salí a la luz, que hay que estudiar.'], 'thud'],
    ['Media sin par', 'Sos una Media sin par', '🧦', ['Perdiste a tu compañera y también la respuesta. Qué día.', 'Nadie sabe adónde se van las medias. Ni las respuestas.'], 'paper'],
    ['Grano de arena perdido', 'Sos un Grano de arena perdido', '⏳', ['Uno entre millones, y justo vos no sabías.', 'Todas las playas empiezan con un grano. Vos ya estás.'], 'swoosh'],
    ['Tapita de gaseosa perdida', 'Sos una Tapita de gaseosa perdida', '🔘', ['Rodaste abajo de la heladera y ahí quedaste.', 'Sin botella y sin respuesta.'], 'springr~1.3'],
    ['Pelusa de bolsillo', 'Sos una Pelusa de bolsillo', '☁️', ['Nadie sabe de dónde saliste. Tus respuestas tampoco.', 'Suavecita, pero vacía.'], 'pop'],
    ['Babosa de jardín', 'Sos una Babosa de jardín', '🐌', ['Dejaste un caminito brillante… de respuestas mal.', 'Lenta pero constante. Bueno, lenta.'], 'squish'],
    ['Hongo de heladera', 'Sos un Hongo de heladera', '🍄', ['Creciste en el fondo, al lado del tema que no abriste.', 'Hasta el queso viejo sabe más.'], 'dooropen'],
    ['Fideo pegado en el techo', 'Sos un Fideo pegado en el techo', '🍝', ['Te tiraron para ver si estabas listo y quedaste colgado. Como tus respuestas.', 'Desde arriba se ve todo, y aun así no viste la respuesta.'], 'plop~0.8'],
    ['Inodoro tapado', 'Sos un Inodoro tapado', '🚽', ['Todo entra y nada sale. Igualito que la lección de hoy.', 'Tiraste la cadena y se fue la respuesta también.'], 'toilet'],
    ['Control remoto sin pilas', 'Sos un Control remoto sin pilas', '📺', ['Apretaron todos tus botones y no cambiaste nada.', 'Te buscaron tres días abajo del sillón y al final no andabas.'], 'weird~0.8'],
    ['Celular con uno por ciento', 'Sos un Celular con uno por ciento', '🪫', ['Te quedaba energía para una respuesta y la usaste mal.', 'Vibrás, pero no prendés.'], 'phone'],
    ['Tostada quemada', 'Sos una Tostada quemada', '🍞', ['Cinco minutos de más y saliste carbón.', 'Raspándote un poquito, capaz que algo se salva.'], 'cough'],
    ['Pava que no hierve', 'Sos una Pava que no hierve', '🫖', ['Media hora en el fuego y ni tibia.', 'Para el mate falta. Y para el diez, más todavía.'], 'kettle~0.8']
  ], jokes: ['Del fondo solo se puede subir. Tenés el ascensor para vos solo.', 'Los dinosaurios también empezaron siendo un bichito. Vos repasás hoy.', 'Hoy fue un día de esos. Mañana, con un repaso, es otro.', 'Como cuando la abuela pregunta si comiste y decís que sí pero no. Así fue este examen.', '¡Qué nivel! ¡Qué capacidad! ¡Qué… bueno, no me sale seguir.'] },
  { min: 2, chars: [
    ['Plancton', 'Sos un Plancton', '🦐', ['Vino la ballena a tomarte lección y te hiciste el desmayado.', 'Chiquitito, pero ya largás burbujitas de conocimiento.'], 'bubble'],
    ['Mosquito despistado', 'Sos un Mosquito despistado', '🦟', ['Toda la noche zumbando cerca de la respuesta y nunca picaste.', 'Al mosquito lo echaron por hacer ruido sin contestar. Vos al menos contestaste.'], 'fly~1.2'],
    ['Lombriz mareada', 'Sos una Lombriz mareada', '🪱', ['Cavaste toda la tarde y saliste en el patio del vecino.', 'La lombriz no tiene ojos y encuentra el camino. Vos tenés dos.'], 'squish'],
    ['Medusa sin GPS', 'Sos una Medusa sin GPS', '🪼', ['Saliste para el arrecife y terminaste en Mar del Plata. "Me dejé llevar", dijiste.', 'Sin cerebro pero con onda. Prendé el GPS mental.'], 'bloop'],
    ['Pulga sin perro', 'Sos una Pulga sin perro', '🐾', ['Saltaste tan alto que te pasaste del perro. Saltar sabés, falta apuntar.', 'Si saltaras cien veces tu nota como la pulga, ya serías Nivel Dios.'], 'springr'],
    ['Mosca de verano', 'Sos una Mosca de verano', '🪰', ['Veinte choques contra el vidrio hasta ver la puerta abierta. Ya casi.', 'Lástima que no ves las preguntas en cámara lenta como las moscas.'], 'fly'],
    ['Garrapata con sueño', 'Sos una Garrapata con sueño', '🕷️', ['Te subiste al perro para ir al colegio y te despertaste en la veterinaria.', 'Agarrate al tema como garrapata y no lo largues.'], 'scuttle'],
    ['Polilla del ropero', 'Sos una Polilla del ropero', '🦋', ['Te preguntaron de moda y contestaste que la lana es rica.', 'Siempre vas hacia la luz. Hoy la luz es el repaso.'], 'flutter'],
    ['Hormiga sin fila', 'Sos una Hormiga sin fila', '🐜', ['Todas fueron para un lado y vos para el otro.', 'Te perdiste la fila, pero no la voluntad.'], 'scuttle'],
    ['Cangrejo al revés', 'Sos un Cangrejo al revés', '🦀', ['Caminás de costado y encima para atrás.', 'Pinzas tenés. Falta agarrar la respuesta.'], 'scuttle'],
    ['Pez dorado distraído', 'Sos un Pez dorado distraído', '🐠', ['Tres segundos de memoria. Y se nota.', 'Diste veinte vueltas a la pecera y cada vuelta era nueva.'], 'splash'],
    ['Rana sin salto', 'Sos una Rana sin salto', '🐸', ['Te preparaste para saltar y te quedaste sentada.', 'Croás bien, falta el salto.'], 'croak'],
    ['Lombriz confundida', 'Sos una Lombriz confundida', '🪱', ['No sabés cuál es tu cabeza. Y se nota.', 'Cavaste para abajo y la respuesta estaba arriba.'], 'squish'],
    ['Mosquito sin rumbo', 'Sos un Mosquito sin rumbo', '🦟', ['Zumbaste toda la noche y no picaste ni una.', 'Mucho ruido y pocas respuestas.'], 'fly~1.35'],
    ['Cucaracha optimista', 'Sos una Cucaracha optimista', '🪳', ['Sobrevivís a todo, hasta a este examen.', 'Te pisaron la nota, pero seguís caminando.'], 'scuttle'],
    ['Polilla del placard', 'Sos una Polilla del placard', '🦋', ['Te comiste el suéter, pero no el libro.', 'Vas a la luz… y la luz era la heladera.'], 'flutter'],
    ['Fantasma sin sábana', 'Sos un Fantasma sin sábana', '👻', ['Querías asustar y nadie te vio. Igual que tus respuestas.', 'Atravesás paredes, pero el examen no.'], 'ghost'],
    ['Globo desinflado', 'Sos un Globo desinflado', '🎈', ['Arrancaste lleno de aire y terminaste en el piso.', 'Un soplido más y capaz que llegás.'], 'weird~1.3'],
    ['Mosquito con hipo', 'Sos un Mosquito con hipo', '🦟', ['Ibas a picar la respuesta y te agarró el hipo.', 'Zumbás mucho, picás poco.'], 'fly~0.9'],
    ['Bombilla tapada', 'Sos una Bombilla tapada', '🧉', ['Chupás y chupás, y no sale nada.', 'Te falta destapar las ideas.'], 'sip'],
    ['Sapo resfriado', 'Sos un Sapo resfriado', '🐸', ['Croac, cof, croac. Ni cantar pudiste.', 'Abrigate y estudiá, en ese orden.'], 'cough~0.8'],
    ['Despertador dormido', 'Sos un Despertador dormido', '⏰', ['Tenías que despertar a todos y te quedaste dormido vos.', 'Llegaste tarde a tu propia alarma.'], 'yawn~1.2']
  ], jokes: ['Subiste un escalón de la evolución. Falta la escalera entera.', 'Los gigantes también fueron chiquitos alguna vez.', 'Algo quedó en la cabeza. Ahora lo regamos.', 'Le ganaste a una piedra. Por poquito. La piedra pidió revancha.', 'Estuviste tan cerca de la respuesta como yo de ganar el Quini.'] },
  { min: 3, chars: [
    ['Larvoide', 'Sos un Larvoide', '🐛', ['"Algún día voy a ser mariposa", dijiste. El espejo contestó: "Primero estudiá".', 'Comé tema todo el día como larva y te salen las alas.'], 'squish'],
    ['Renacuajo', 'Sos un Renacuajo', '🐸', ['Todavía con cola, pero ya te asoman las patitas.', 'Nadás en círculos en el charco y pensás que es el océano.'], 'splash~1.3'],
    ['Caracol sin casa', 'Sos un Caracol sin casa', '🐌', ['Saliste a las ocho, llegaste a las cinco y sin la casa. Pero llegaste.', '"Disfruto el camino", dice el caracol. Disfrutalo, pero apurá un poco.'], 'squish'],
    ['Gusano de seda dormilón', 'Sos un Gusano de seda dormilón', '🐛', ['Empezaste el capullo, te pusiste cómodo y te dormiste adentro.', 'Con tu seda se hacen vestidos de rey. Ya hilaste un poquito.'], 'squish'],
    ['Babosa brillante', 'Sos una Babosa brillante', '🐌', ['Cruzaste el jardín para ir a clase y llegaste al acto de fin de año.', 'Vas dejando un caminito brillante. Poquito, pero brilla.'], 'squish'],
    ['Grillo desafinado', 'Sos un Grillo desafinado', '🦗', ['Cantaste la lección toda la noche y te tiraron una zapatilla. Era la respuesta equivocada.', 'Frotá un poco más las neuronas y te sale la melodía.'], 'cricketr~0.85'],
    ['Cascarudo panza arriba', 'Sos un Cascarudo panza arriba', '🪲', ['Panza arriba, moviendo las patitas: "Qué lindo se ve el cielo". Dale, date vuelta.', 'Todo cascarudo termina dándose vuelta. Vos también.'], 'djembe'],
    ['Ciempiés con calambre', 'Sos un Ciempiés con calambre', '🐛', ['Se te acalambraron las cien patas y llegaste saltando en una. ¡Pero llegaste!', 'Te pusiste a pensar cómo caminar y te caíste. Menos pensar, más repasar.'], 'scuttle'],
    ['Erizo despeinado', 'Sos un Erizo despeinado', '🦔', ['Mucha púa y poca respuesta.', 'Te hiciste bolita con la pregunta. Desenrollate.'], 'squish'],
    ['Zorrino tímido', 'Sos un Zorrino tímido', '🦨', ['Ni el olor te salió bien hoy.', 'Tranqui, que nadie se acerca a burlarse.'], 'sniff~0.85'],
    ['Gallina pensativa', 'Sos una Gallina pensativa', '🐔', ['Pusiste un huevo de respuesta. Medio crudo.', 'Picoteaste por todos lados y algo encontraste.'], 'chirp'],
    ['Topo con anteojos', 'Sos un Topo con anteojos', '🐀', ['Cavaste bien, pero salió en cualquier lado.', 'Los anteojos ayudan. Falta abrir los ojos.'], 'thud'],
    ['Tortuga dormida', 'Sos una Tortuga dormida', '🐢', ['Te metiste en el caparazón justo en la pregunta difícil.', 'Despacito se llega. Despertate primero.'], 'yawn~0.8'],
    ['Ardilla olvidadiza', 'Sos una Ardilla olvidadiza', '🐿️', ['Enterraste las respuestas y no te acordás dónde.', 'Juntaste nueces, falta juntar ideas.'], 'squeak'],
    ['Pingüino resbaloso', 'Sos un Pingüino resbaloso', '🐧', ['Ibas bien y te patinaste en el hielo.', 'Elegante de traje, flojito de respuestas.'], 'honk'],
    ['Perezoso en pausa', 'Sos un Perezoso en pausa', '🦥', ['Contestaste… mañana, ¿no?', 'Colgado del árbol y del tema.'], 'yawn'],
    ['Bicicleta sin cadena', 'Sos una Bicicleta sin cadena', '🚲', ['Pedaleás con todo y no avanzás un metro.', 'Ponele la cadena al estudio y arrancás.'], 'springr~0.9'],
    ['Dinosaurio de plástico', 'Sos un Dinosaurio de plástico', '🦖', ['Rugís fuerte, pero sos de juguete.', 'Tus primos dominaron el mundo. Vos dominás la repisa.'], 'dino1~1.3'],
    ['Pochoclo sin explotar', 'Sos un Pochoclo sin explotar', '🍿', ['Todos saltaron y vos quedaste en el fondo de la olla.', 'Un poquito más de calor y explotás de sabiduría.'], 'plop~1.2'],
    ['Vaso de agua tibia', 'Sos un Vaso de agua tibia', '🥛', ['Ni frío ni caliente, como tus respuestas.', 'Refrescás poquito, pero algo es algo.'], 'gulp'],
    ['Cuervo con dudas', 'Sos un Cuervo con dudas', '🐦‍⬛', ['Graznaste la respuesta, pero en otro idioma.', 'Dicen que los cuervos son inteligentes. Hoy no se notó.'], 'raven'],
    ['Hormiga perdida en el azúcar', 'Sos una Hormiga perdida en el azúcar', '🐜', ['Encontraste el azúcar y te olvidaste del hormiguero.', 'Mucho dulce y poco camino.'], 'scuttle~1.3']
  ], jokes: ['Todavía no sos mariposa, pero el capullo está en obra.', 'Ya tenés los bordes del rompecabezas. Falta el medio.', 'La tortuga le ganó a la liebre, acordate.', 'Contestaste con una seguridad bárbara. Lástima que era otra cosa.', 'Me gustó el esfuerzo. Lo demás, lo repasamos.'] },
  { min: 4, chars: [
    ['Araña de rincón', 'Sos una Araña de rincón', '🕷️', ['Tejiste la telaraña y cayó una mosca, un papelito y polvo. La respuesta no.', 'Salí del rincón, que el tema no muerde.'], 'scuttle'],
    ['Cucaracha valiente', 'Sos una Cucaracha valiente', '🪳', ['Prendieron la luz y fuiste la única que se quedó a terminar el examen.', 'Sobrevivís a todo. Ahora vamos por algo más que sobrevivir.'], 'scuttle'],
    ['Hormiga perdida', 'Sos una Hormiga perdida', '🐜', ['Cargaste la miga todo el día… al hormiguero equivocado.', 'Cargás cincuenta veces tu peso. Este tema es pan comido.'], 'scuttle'],
    ['Bicho bolita', 'Sos un Bicho bolita', '🐞', ['Llegó la pregunta difícil y te hiciste bolita. Desenrollate.', 'Rodaste cerquita de la respuesta. Un empujoncito más.'], 'djembe~1.3'],
    ['Rata de biblioteca', 'Sos una Rata de biblioteca', '🐀', ['Leíste la tapa de todos los libros. Adentro está lo bueno, eh.', 'Rata ya sos. Te falta la biblioteca.'], 'paper~1.2'],
    ['Paloma de plaza', 'Sos una Paloma de plaza', '🐦', ['Escuchaste toda la clase y solo te acordás de dónde había migas.', 'Las palomas siempre vuelven. Vos volvé al tema.'], 'coo'],
    ['Sapo de charco', 'Sos un Sapo de charco', '🐸', ['Creías saber todo del mar hasta que llovió y el charco creció.', 'Saltaste por la mosca y agarraste una hoja. Afiná la puntería.'], 'croak'],
    ['Lagartija apurada', 'Sos una Lagartija apurada', '🦎', ['Contestaste tan rápido que se te cayó la cola. La cola contestaba mejor.', 'Tomá un poco de sol y volvé con todo.'], 'swoosh~1.25'],
    ['Comadreja curiosa', 'Sos una Comadreja curiosa', '🦡', ['Metés la nariz en todo, falta meterla en el libro.', 'Curiosidad tenés de sobra. Ya casi.'], 'squeak'],
    ['Ganso enojado', 'Sos un Ganso enojado', '🪿', ['Le gritaste al examen. No funcionó.', 'Mucha actitud. Ahora sumale respuestas.'], 'honk'],
    ['Gorrión de vereda', 'Sos un Gorrión de vereda', '🐦', ['Juntaste miguitas de respuestas. Algo comiste.', 'Chiquito y rápido. Falta un poquito de vuelo.'], 'chirp'],
    ['Cabra trepadora', 'Sos una Cabra trepadora', '🐐', ['Subiste media montaña. La otra mitad, mañana.', 'Te agarrás de cualquier piedrita. Seguí subiendo.'], 'heehaw'],
    ['Gato curioso', 'Sos un Gato curioso', '🐱', ['Tiraste el vaso de la mesa y media respuesta.', 'Siete vidas tenés. Usá una para estudiar.'], 'meow'],
    ['Pato distraído', 'Sos un Pato distraído', '🦆', ['Nadaste en círculos alrededor de la respuesta.', 'Cuac. Eso dijiste. Casi.'], 'quack'],
    ['Murciélago al revés', 'Sos un Murciélago al revés', '🦇', ['Ves todo patas para arriba. El examen también.', 'Volás de noche. Estudiá de día.'], 'squeak'],
    ['Burrito testarudo', 'Sos un Burrito testarudo', '🫏', ['Te plantaste en la respuesta equivocada.', 'Terco sos. Ahora sé terco con el estudio.'], 'heehaw'],
    ['Hormiga con mochila', 'Sos una Hormiga con mochila', '🐜', ['Cargás diez veces tu peso, pero te olvidaste los apuntes.', 'Fila india hasta el aprobado: falta poquito.'], 'scuttle~0.9'],
    ['Escoba voladora sin piloto', 'Sos una Escoba voladora sin piloto', '🧹', ['Volás, pero sin rumbo.', 'Agarrá el mango y dirigí, que ya casi.'], 'swoosh~0.85'],
    ['Gallo dormilón', 'Sos un Gallo dormilón', '🐓', ['Cantaste a las once de la mañana.', 'Ya amaneció, gallo. Despertá.'], 'yawn~1.4'],
    ['Pirata sin mapa', 'Sos un Pirata sin mapa', '🏴‍☠️', ['Encontraste el barco pero no el tesoro.', 'La equis marca la respuesta: buscala.'], 'shipbell~1.2'],
    ['Tren de juguete', 'Sos un Tren de juguete', '🚂', ['Das vueltas y vueltas en el mismo círculo.', 'Chucuchú hacia el aprobado, despacito.'], 'callwhistle~1.2'],
    ['Bombero sin manguera', 'Sos un Bombero sin manguera', '🧑‍🚒', ['Llegaste rapidísimo, pero sin agua.', 'Para apagar la duda falta la manguera del estudio.'], 'bell~1.2']
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
    ['Oveja con dudas', 'Sos una Oveja con dudas', '🐑', ['Seguiste al rebaño… hasta la mitad del camino.', '¿Bee o no bee? Esa es la cuestión.'], 'moo~1.8'],
    ['Chancho filósofo', 'Sos un Chancho filósofo', '🐖', ['Pensaste mucho y contestaste la mitad.', 'Hay barro en las ideas, pero ya se aclaran.'], 'beast~1.5'],
    ['Llama de la Puna', 'Sos una Llama de la Puna', '🦙', ['Escupiste la respuesta. Casi aciertas.', 'Subiste alto, falta un poquito de aire.'], 'neigh'],
    ['Canguro novato', 'Sos un Canguro novato', '🦘', ['Saltaste bien, pero en la dirección equivocada.', 'Tenés bolsillo: guardá ahí el repaso.'], 'boing'],
    ['Perro guardián a medias', 'Sos un Perro guardián a medias', '🐕', ['Ladraste la mitad de las respuestas.', 'Moviste la cola. Falta mover la cabeza.'], 'bark~0.85'],
    ['Ternero curioso', 'Sos un Ternero curioso', '🐄', ['Rumiaste la respuesta. Ya casi la tragás.', 'Mitad leche, mitad dudas.'], 'moo'],
    ['Caballo de calesita', 'Sos un Caballo de calesita', '🐴', ['Diste vueltas, pero llegaste a la mitad.', 'Sube y baja, como tu nota.'], 'neigh'],
    ['Mono saltarín', 'Sos un Mono saltarín', '🐒', ['Saltaste de rama en rama y agarraste la mitad.', 'Mucho salto. Ahora, puntería.'], 'monkey'],
    ['Pelota pinchada', 'Sos una Pelota pinchada', '⚽', ['Picás, pero bajito.', 'Un parche y volvés a la cancha.'], 'weird~0.7'],
    ['Mate lavado', 'Sos un Mate lavado', '🧉', ['Tenés gusto a algo, pero poquito.', 'Cambiá la yerba y arrancás de nuevo.'], 'sip~0.85'],
    ['Payaso serio', 'Sos un Payaso serio', '🤡', ['Te reís, pero de nervios.', 'Hiciste reír a medias: faltó el remate.'], 'laugh~0.85'],
    ['Abuela del WhatsApp', 'Sos una Abuela del WhatsApp', '👵', ['Mandaste la respuesta en un audio de once minutos.', 'Mucho cariño y muchos stickers, poca respuesta.'], 'phone~1.1'],
    ['Panadero madrugador', 'Sos un Panadero madrugador', '🥖', ['Abriste temprano, pero el pan salió crudito.', 'Ya casi está: falta un ratito de horno.'], 'dooropen~1.1'],
    ['Presidente de un club de barrio', 'Sos el Presidente de un club de barrio', '🏅', ['Prometiste pileta y cancha nueva. Por ahora hay un aro sin red.', 'Los socios te aplauden… algunos.'], 'clap~0.9']
  ], jokes: ['Llegaste a la parada justo cuando arranca el colectivo. ¡Corré que lo alcanzás!', 'Raspando, pero en camino. Otro intento y sale.', 'Medio examen en el bolsillo. Vamos por la otra mitad.', 'Cinco: el número más tibio del universo. Como el mate que te olvidaste.', 'Así de cerca, como el colectivo que te cierra la puerta en la cara.'] },
  { min: 6, chars: [
    ['Cachalote bípedo', 'Sos un Cachalote bípedo', '🐋', ['Saliste del mar caminando en dos patas y dijiste: "Vine a aprobar". Y aprobaste.', 'El cerebro más grande del planeta, y ahora sabemos para qué: para aprobar.'], 'whale'],
    ['Carpincho sabio', 'Sos un Carpincho sabio', '🦫', ['Todo el río viene a preguntarte cosas, y vos contestás sin apuro.', 'Tan tranquilo que hasta los pájaros se te sientan encima.'], 'purr'],
    ['Pingüino emprendedor', 'Sos un Pingüino emprendedor', '🐧', ['Te pusiste el traje y abriste un negocio: vender hielo en la Antártida. Éxito total.', 'No volás, pero nadás como campeón. Hoy brillaste en lo tuyo.'], 'honk'],
    ['Delfín con anteojos', 'Sos un Delfín con anteojos', '🐬', ['Te compraste anteojos y sacaste la mejor nota del océano.', 'Inteligente, simpático y siempre sonriendo. Como ahora.'], 'dolphin'],
    ['Caballo de carrera', 'Sos un Caballo de carrera', '🐎', ['Largaste último, pasaste a todos en la recta y llegaste primero. ¡Qué remontada!', 'Se nota el entrenamiento. ¡Al galope!'], 'neigh'],
    ['Loro bilingüe', 'Sos un Loro bilingüe', '🦜', ['Ya repetís las respuestas correctas en dos idiomas.', 'Dicen que el loro solo repite. Vos no repetiste: entendiste.'], 'voice1~1.5'],
    ['Oso hormiguero detective', 'Sos un Oso hormiguero detective', '🔎', ['Metiste la nariz en cada pista y resolviste el caso.', 'Metés la nariz donde nadie se anima. Por eso descubrís cosas.'], 'purr'],
    ['Tortuga maratonista', 'Sos una Tortuga maratonista', '🐢', ['Todos se rieron cuando te anotaste en la maratón. Las liebres todavía buscan el camino.', 'Vivís cien años porque no te estresás. Aprobaste con calma.'], 'tada'],
    ['Hornero arquitecto', 'Sos un Hornero arquitecto', '🐦', ['Armaste tu casita de barro, ¡y aprobaste!', 'Constructor nacional. Ladrillo por ladrillo.'], 'chirp'],
    ['Ballena cantora', 'Sos una Ballena cantora', '🐳', ['Cantaste la respuesta y se escuchó en todo el océano.', 'Gigante y afinada. ¡Aprobado!'], 'whale'],
    ['Pato de carrera', 'Sos un Pato de carrera', '🦆', ['Nadaste, caminaste y volaste… directo al aprobado.', 'El pato más rápido de la laguna.'], 'quack'],
    ['Zorro astuto', 'Sos un Zorro astuto', '🦊', ['Encontraste la respuesta antes que nadie.', 'Astuto y simpático. Buena combinación.'], 'squeak~0.8'],
    ['Paloma mensajera', 'Sos una Paloma mensajera', '🕊️', ['Llevaste la respuesta justo a destino.', 'Aprobado y con buena orientación.'], 'coo'],
    ['Delfín simpático', 'Sos un Delfín simpático', '🐬', ['Saltaste del agua con el aprobado en la boca.', 'Inteligente y buena onda.'], 'dolphin'],
    ['Carpincho viajero', 'Sos un Carpincho viajero', '🦫', ['Llegaste tranquilo, pero llegaste.', 'Relajado y aprobado. Así se hace.'], 'purr'],
    ['Gaviota exploradora', 'Sos una Gaviota exploradora', '🐦', ['Encontraste la respuesta desde el cielo.', 'Volaste alto y aterrizaste en el seis.'], 'eagle'],
    ['Vigilante de la plaza', 'Sos el Vigilante de la plaza', '👮', ['Silbato en mano, nada se te escapa… casi nada.', 'Ordenaste las ideas como el tránsito: bastante bien.'], 'callwhistle'],
    ['Tetera feliz', 'Sos una Tetera feliz', '🫖', ['Llegaste al punto justo para el mate.', 'Silbás contenta: hiciste las cosas bien.'], 'kettle'],
    ['Lavarropas centrifugando', 'Sos un Lavarropas centrifugando', '🌀', ['Diste mil vueltas y saliste limpito.', 'Ruidoso, pero cumplidor.'], 'weird~1.1'],
    ['Loro del almacén', 'Sos el Loro del almacén', '🦜', ['Repetís todo… y esta vez repetiste bien.', 'Le contestás a todos los clientes. Y aprobás.'], 'voice1~1.7'],
    ['Cuervo inteligente', 'Sos un Cuervo inteligente', '🐦‍⬛', ['Los cuervos usan herramientas. Vos usaste la cabeza.', 'Graznido de aprobado.'], 'raven~0.85'],
    ['Bicicletero del barrio', 'Sos el Bicicletero del barrio', '🔧', ['Arreglás todo con dos tuercas y mucho ingenio.', 'Te falta una tuerca para el diez.'], 'springr~0.75']
  ], jokes: ['¡Aprobaste! Ya sos del club de los que saben. Hay medialunas.', 'Lo sacaste adelante. Clap, clap, clap.', 'Le estás agarrando la mano. Vamos por más.', 'Raspando, pero adentro. Gol de rebote en el minuto noventa: vale igual.', 'Ya estás del lado de los que aprueban. No te agrandes. Bueno, un poquito.'] },
  { min: 7, chars: [
    ['Presidente de país del tercer mundo', 'Sos un Presidente de país del tercer mundo', '🎩', ['Prometiste saber el tema y, a diferencia de otros presidentes, cumpliste.', 'Ya tenés la banda presidencial. Ahora no te endeudes con el FMI.'], 'fanfare'],
    ['Cóndor andino', 'Sos un Cóndor andino', '🦅', ['Volaste tan alto que desde arriba se veían todas las respuestas.', 'Volás horas sin mover las alas. Aprovechaste bien lo que estudiaste.'], 'eagle'],
    ['Capitán de barco pirata', 'Sos un Capitán de barco pirata', '🏴‍☠️', ['Años buscando el tesoro y era esta nota. Tu loro ya repite las respuestas.', 'La X del mapa marcaba el aprobado. ¡Al abordaje!'], 'cannon'],
    ['Chef con estrella', 'Sos un Chef con estrella', '👨‍🍳', ['Plato de restaurante caro. Le faltó una pizca de sal nomás.', 'Un poco más de práctica y te dan la segunda estrella.'], 'dishes'],
    ['Gaucho payador', 'Sos un Gaucho payador', '🪕', ['Contestaste en versos y encima estaba bien. Te ganaste un aplauso y un mate.', 'El payador improvisa. Vos no hizo falta: sabías.'], 'guitar'],
    ['León con corona', 'Sos un León con corona', '🦁', ['Te pusiste la corona, rugiste, y las respuestas se acomodaron solas.', 'Dormís veinte horas y las otras cuatro sacás buenas notas.'], 'lion'],
    ['Jirafa ingeniera', 'Sos una Jirafa ingeniera', '🦒', ['Hiciste un puente con el cuello para que todos crucen el río. Inteligente y solidaria.', 'Ya ves el tema desde arriba, sin esfuerzo.'], 'ding'],
    ['Abeja reina', 'Sos una Abeja reina', '🐝', ['Votaron en la colmena quién sabía más. Ganaste vos.', 'Hiciste un examen dulce como la miel.'], 'buzz'],
    ['Yaguareté guardián', 'Sos un Yaguareté guardián', '🐆', ['Cuidaste el tema como tu selva.', 'Fuerte, ágil y bien argentino.'], 'lion~0.85'],
    ['DJ del conocimiento', 'Sos un DJ del conocimiento', '🎧', ['Mezclaste las ideas y la pista quedó bárbara.', 'Subile el volumen a ese siete.'], 'record'],
    ['Búho bibliotecario', 'Sos un Búho bibliotecario', '🦉', ['Te sabés dónde está cada libro. Y lo que dice.', 'Shh… estamos aprobando.'], 'owl'],
    ['Capitán de selección', 'Sos un Capitán de selección', '⚽', ['Llevás la cinta y el equipo te sigue.', 'Gol de cabeza en el examen.'], 'fanfare'],
    ['Lobo de la manada', 'Sos un Lobo de la manada', '🐺', ['La manada te sigue porque sabés el camino.', 'Aullaste la respuesta correcta.'], 'beast~0.9'],
    ['Caballo campeón', 'Sos un Caballo campeón', '🐎', ['Ganaste la carrera por varias cabezas.', 'Galopaste derecho al siete.'], 'neigh'],
    ['Elefante memorioso', 'Sos un Elefante memorioso', '🐘', ['No te olvidás de nada. ¡Grande!', 'Pisás fuerte en el tema.'], 'trumpet'],
    ['Detective del saber', 'Sos un Detective del saber', '🕵️', ['Encontraste cada pista y resolviste el caso.', 'Elemental, querido alumno.'], 'ding'],
    ['Intendente con banda', 'Sos un Intendente con banda', '🎖️', ['Cortaste la cinta y aplaudieron todos.', 'Prometiste estudiar y cumpliste. ¡Raro en un intendente!'], 'clap'],
    ['Bombero héroe', 'Sos un Bombero héroe', '🚒', ['Apagaste todas las dudas con la manguera del saber.', 'Subiste la escalera hasta la respuesta.'], 'bell'],
    ['Árbitro con silbato de oro', 'Sos un Árbitro con silbato de oro', '🏟️', ['Cobraste todo bien: ni el VAR te corrige.', 'Tarjeta verde para vos.'], 'callwhistle~0.9'],
    ['Locutor de radio', 'Sos un Locutor de radio', '📻', ['Tu voz informa y tus respuestas también.', 'En el aire, y con buena nota.'], 'record~1.1'],
    ['Gong del templo', 'Sos el Gong del templo', '🥁', ['Sonaste fuerte y claro.', 'Tu respuesta resonó en toda la sala.'], 'gong~1.1'],
    ['Panadero de medialunas', 'Sos un Panadero de medialunas', '🥐', ['Las ideas salieron doraditas.', 'Docena de respuestas, todas ricas.'], 'dooropen~0.9']
  ], jokes: ['Ya jugás en primera. Falta poquito para la Selección.', 'Si esto fuera una carrera, ya estás en el podio.', 'El profe está tan contento que ya piensa en el próximo tema.', '¡Pará, pará! ¿Me estás cargando? Ese siete vale un asado.', 'Ya sabés más que mi cuñado, que opina de todo.'] },
  { min: 8, chars: [
    ['Homo erectus', 'Sos un Homo erectus', '🦍', ['Te paraste derechito, miraste alrededor y dijiste: "Uy, ahora entiendo todo".', 'La evolución tardó millones de años en pararse. Vos, un examen.'], 'voice3~0.7'],
    ['Lechuza doctora', 'Sos una Lechuza doctora', '🦉', ['Todo el bosque viene a consultarte. Hoy atendiste vos.', 'Ves clarito hasta de noche. Doctora en el tema.'], 'owl~1.15'],
    ['Astronauta', 'Sos un Astronauta', '🧑‍🚀', ['Despegaste y llegaste a la Luna. "Houston, no tenemos ningún problema".', 'Este tema ya te queda chico, te vas al espacio.'], 'rocket'],
    ['Mago de barrio', 'Sos un Mago de barrio', '🧙', ['Abracadabra, y de la galera salieron todas las respuestas.', 'No es magia, es práctica. Por eso salió el truco.'], 'magicr'],
    ['Científico loco', 'Sos un Científico loco', '🧪', ['Mezclaste dos ideas, salió humo violeta y una respuesta perfecta. ¡Eureka!', 'Los científicos se equivocan mil veces. Vos acertaste de una.'], 'laugh~0.8'],
    ['Elefante con memoria de oro', 'Sos un Elefante con memoria de oro', '🐘', ['Te acordaste de todo. Hasta del chiste del módulo anterior.', 'Hoy tu conocimiento fue tamaño elefante.'], 'trumpet'],
    ['Detective de lupa', 'Sos un Detective de lupa', '🕵️', ['Lupa en mano, encontraste cada pista. "Elemental". Caso cerrado.', 'No se te escapó casi nada. Así trabaja un detective.'], 'ding'],
    ['Puma inventor', 'Sos un Puma inventor', '🐆', ['Inventaste una máquina de aprobar exámenes. Funciona bárbaro, se ve.', 'Rápido, ágil y sin hacer ruido. Así respondiste.'], 'lion~1.2'],
    ['Inventora de cohetes', 'Sos una Inventora de cohetes', '🚀', ['Tus respuestas despegan solas.', 'Cuenta regresiva y… ¡ocho!'], 'rocket'],
    ['Pulpo genio', 'Sos un Pulpo genio', '🐙', ['Ocho brazos, ocho puntos. Casualidad no es.', 'Abriste el frasco del tema en dos segundos.'], 'bubbling~0.8'],
    ['Pianista virtuoso', 'Sos un Pianista virtuoso', '🎹', ['Tocaste cada respuesta sin errar una nota.', 'Aplausos de pie para el concierto.'], 'guitar'],
    ['Orca estratega', 'Sos una Orca estratega', '🐋', ['Planeaste cada respuesta como una jugada.', 'La reina del océano, y del examen.'], 'whale'],
    ['Halcón peregrino', 'Sos un Halcón peregrino', '🦅', ['Viste la respuesta desde un kilómetro.', 'El más rápido del cielo. Y del examen.'], 'eagle'],
    ['León sabio', 'Sos un León sabio', '🦁', ['Rugiste y el examen se asustó.', 'Rey de la selva y del tema.'], 'lion~0.95'],
    ['Científica brillante', 'Sos una Científica brillante', '🔬', ['Hiciste el experimento y salió perfecto.', 'Eureka. Así, sin más.'], 'magic'],
    ['Chef de cinco estrellas', 'Sos un Chef de cinco estrellas', '👨‍🍳', ['Cocinaste las respuestas al punto justo.', 'Plato perfecto. Ocho estrellas Michelin.'], 'pot'],
    ['Bibliotecaria con superpoderes', 'Sos una Bibliotecaria con superpoderes', '📚', ['Encontraste la respuesta en el estante justo.', 'Silencio, que acá se aprueba.'], 'paper~0.9'],
    ['Capitán de submarino', 'Sos un Capitán de submarino', '🚢', ['Bajaste hasta lo más hondo del tema y volviste con el tesoro.', 'Periscopio arriba: se ve el diez.'], 'bubbling~0.7'],
    ['Inventora de robots', 'Sos una Inventora de robots', '🤖', ['Tus ideas tienen tornillos y funcionan.', 'Tu robot aprobó, y vos también.'], 'powerup~0.9'],
    ['Tren bala', 'Sos un Tren bala', '🚄', ['Llegaste a la respuesta antes que la pregunta.', 'Puntualidad japonesa y nota argentina.'], 'teleport~0.8'],
    ['Médica de guardia', 'Sos una Médica de guardia', '🩺', ['Diagnosticaste la pregunta y la curaste.', 'Receta: seguir así.'], 'success~0.9'],
    ['Rey del asado', 'Sos el Rey del asado', '🍖', ['Punto justo: ni crudo ni pasado.', 'Un aplauso para el asador. Y para tus respuestas.'], 'clap~1.15']
  ], jokes: ['Ya podrías explicarle el tema a otro. Y te entenderían.', 'El profe le contó a todos los otros profes.', 'Te falta muy poquito para la cima.', 'Me estás haciendo quedar mal a mí, que soy el profe.', 'Si esto fuera fútbol, ya te llaman de Europa.'] },
  { min: 9, chars: [
    ['Ninja supremo', 'Sos un Ninja supremo', '🥷', ['Entraste sin ruido, respondiste todo y el profe ni se dio cuenta de que terminaste.', 'Cinturón negro en este tema.'], 'swoosh'],
    ['Dragón sabio', 'Sos un Dragón sabio', '🐉', ['Escupís fuego y respuestas correctas. Las dos queman.', 'Mil años de sabiduría en un solo examen.'], 'monster'],
    ['Superhéroe del barrio', 'Sos un Superhéroe del barrio', '🦸', ['Salvaste el examen sin despeinarte la capa.', 'Tu superpoder: saberte el tema de memoria.'], 'powerup'],
    ['Campeón del mundo', 'Sos un Campeón del mundo', '🏆', ['Último minuto de la final, última pregunta y… ¡gol! Vuelta olímpica.', '¡Dale campeón! Se nota el entrenamiento.'], 'victory'],
    ['Samurái del saber', 'Sos un Samurái del saber', '⚔️', ['Cortaste cada pregunta a la mitad, hiciste una reverencia y te fuiste.', 'Honor, disciplina y conocimiento. Todo junto.'], 'swoosh'],
    ['Robot del futuro', 'Sos un Robot del futuro', '🤖', ['Vino un robot del año 3000, te escaneó y dijo: "Error. Este humano sabe más que yo".', 'Nivel de conocimiento: altísimo. Recomendación: seguí así.'], 'robot'],
    ['Águila imperial', 'Sos un Águila imperial', '🦅', ['Viste la respuesta desde tres kilómetros y bajaste en picada a agarrarla.', 'La mejor vista del cielo y del tema.'], 'eagle'],
    ['Fénix renacido', 'Sos un Fénix renacido', '🔥', ['Quemaste el tema de tanto estudiarlo y renaciste sabio.', 'Tus respuestas curan cualquier duda.'], 'magic'],
    ['Mago supremo', 'Sos un Mago supremo', '🪄', ['Agitaste la varita y apareció un nueve.', 'Ni el mago del barrio te alcanza.'], 'magicr~0.85'],
    ['Guepardo relámpago', 'Sos un Guepardo relámpago', '🐆', ['Respondiste tan rápido que el examen quedó atrás.', 'El más veloz de la sabana del saber.'], 'swoosh'],
    ['Astronauta comandante', 'Sos un Astronauta comandante', '👩‍🚀', ['Pilotaste la nave sin un solo error.', 'Misión cumplida, comandante.'], 'rocket'],
    ['Maestro del ajedrez', 'Sos un Maestro del ajedrez', '♟️', ['Jaque mate al examen en pocas jugadas.', 'Pensaste diez movidas adelante.'], 'gong~1.2'],
    ['Fénix de fuego azul', 'Sos un Fénix de fuego azul', '🔥', ['Ardiste de sabiduría. ¡Qué nivel!', 'Renaciste en modo genio.'], 'magic'],
    ['Superhéroe del aula', 'Sos un Superhéroe del aula', '🦸', ['Salvaste el examen con tu súper cerebro.', 'Capa puesta, nueve en el bolsillo.'], 'hero'],
    ['Cóndor de los Andes', 'Sos un Cóndor de los Andes', '🦅', ['Desde arriba lo ves todo. Y todo bien.', 'Majestuosa y sin errores.'], 'eagle'],
    ['Genio de la lámpara', 'Sos un Genio de la lámpara', '🧞', ['Te pidieron tres deseos y diste diez respuestas.', 'Frotaron la lámpara y salió un nueve.'], 'teleport'],
    ['Director de orquesta', 'Sos un Director de orquesta', '🎼', ['Cada respuesta sonó afinada.', 'Con la batuta en la mano, todo suena perfecto.'], 'cymbal~1.1'],
    ['Campanero de la catedral', 'Sos el Campanero de la catedral', '🔔', ['Tus respuestas se escuchan desde todo el barrio.', 'Din, don: aprobado.'], 'bell~0.8'],
    ['Dinosaurio rey', 'Sos el Dinosaurio rey', '🦖', ['Dominaste el tema como en el Jurásico.', 'Rugido de campeón.'], 'dino3'],
    ['Capitana de la nave espacial', 'Sos la Capitana de la nave espacial', '🛸', ['Rumbo fijo a la estrella del diez.', 'Despegaste y no paraste.'], 'teleport~1.05'],
    ['Faro del puerto', 'Sos el Faro del puerto', '🗼', ['Iluminás a todos los barcos perdidos.', 'Tu luz se ve desde lejísimos.'], 'shipbell~0.8'],
    ['Volcán en erupción', 'Sos un Volcán en erupción', '🌋', ['Explotaste de sabiduría.', 'Lava de respuestas correctas.'], 'cannon~0.7']
  ], jokes: ['Casi perfecto. El examen te quiere pedir un autógrafo.', 'Nivel maestro. Pocos llegan hasta acá.', 'Si seguís así, el profe te va a pedir clases a vos.', '¿Querés que te aplauda de pie? Ya estoy de pie.', 'No tengo nada para corregirte, y a un profe eso le duele.'] },
  { min: 9.7, chars: [
    ['Dios', 'Sos un Dios', '⚡', ['El examen te vio y te pidió disculpas por molestarte.', 'Ya no estudiás el tema: el tema te estudia a vos. Y saca un dos.'], 'thunder'],
    ['Leyenda viviente', 'Sos una Leyenda viviente', '🌟', ['Te van a hacer una estatua en la plaza. Con palomas, pero estatua.', 'Dentro de mil años van a contar este examen.'], 'victory~0.9'],
    ['Rey del universo', 'Sos el Rey del universo', '👑', ['Las estrellas votaron al rey del universo. Ganaste por unanimidad.', 'Hasta el sol te pidió un autógrafo.'], 'gong'],
    ['Unicornio genio', 'Sos un Unicornio genio', '🦄', ['Un unicornio aparece cada mil años y saca diez. Hoy apareció.', 'Tan perfecto que el arcoíris se puso celoso.'], 'magic'],
    ['Mente galáctica', 'Sos una Mente galáctica', '🌌', ['Los extraterrestres te escucharon y ya te mandaron la nave para que les des clases.', 'Tu cerebro ya no entra en este planeta.'], 'choir'],
    ['Sol en persona', 'Sos el Sol en persona', '☀️', ['Brillaste tanto que el profe se tuvo que poner anteojos de sol.', 'Este examen tuvo luz propia: la tuya.'], 'choir'],
    ['Cerebro cósmico', 'Sos un Cerebro cósmico', '🧠', ['Quisieron medir tu cerebro y se rompió la máquina.', 'Tus neuronas hicieron una fiesta y todas sacaron diez.'], 'teleport~1.2'],
    ['Titán del Olimpo', 'Sos un Titán del Olimpo', '🏛️', ['Los dioses del Olimpo te vieron y te hicieron lugar en la mesa.', 'Sostenés todo el tema sin despeinarte.'], 'cannon~0.8'],
    ['Galaxia andante', 'Sos una Galaxia andante', '🌠', ['Tenés millones de estrellas en la cabeza.', 'El universo te pidió una foto.'], 'choir'],
    ['Fuerza de la naturaleza', 'Sos una Fuerza de la naturaleza', '🌪️', ['Pasaste por el examen como un huracán.', 'Nadie te puede parar.'], 'thunder'],
    ['Profesor del profesor', 'Sos el Profesor del profesor', '🎓', ['Ahora el profe toma clases con vos.', 'Te ganaste la tiza dorada.'], 'success'],
    ['Dragón dorado', 'Sos un Dragón dorado', '🐲', ['Brillás tanto que encandilás.', 'Leyenda dorada del conocimiento.'], 'dino3~0.8'],
    ['Sol radiante', 'Sos un Sol radiante', '☀️', ['Iluminás a todo el que estudia con vos.', 'Brillás más que nunca.'], 'choir'],
    ['Unicornio legendario', 'Sos un Unicornio legendario', '🦄', ['Dicen que no existís. Acá estás.', 'Mágico, único y perfecto.'], 'magic'],
    ['Emperador del saber', 'Sos el Emperador del saber', '👑', ['Hasta los planetas te hacen reverencia.', 'Corona merecida.'], 'fanfare'],
    ['Mente infinita', 'Sos una Mente infinita', '🧠', ['Tu cabeza tiene su propia galaxia.', 'Pensás a la velocidad de la luz.'], 'cymbal'],
    ['Tormenta del saber', 'Sos la Tormenta del saber', '⛈️', ['Rayos y truenos de respuestas perfectas.', 'Llovieron dieces.'], 'thunder'],
    ['Big Bang con anteojos', 'Sos un Big Bang con anteojos', '💥', ['Empezaste un universo nuevo de sabiduría.', 'De la nada, todo. Así contestaste.'], 'cannon'],
    ['Trofeo de oro macizo', 'Sos un Trofeo de oro macizo', '🏆', ['Te ponen en la vitrina más alta.', 'Brillás tanto que hay que usar anteojos de sol.'], 'victory'],
    ['Rey de la selva y del aula', 'Sos el Rey de la selva y del aula', '🦁', ['Rugís y todos se callan para escucharte.', 'Corona doble: selva y aula.'], 'lion~0.8'],
    ['Monstruo de las preguntas', 'Sos el Monstruo de las preguntas', '👹', ['Te comiste el examen entero.', 'Las preguntas te tienen miedo a vos.'], 'monster~0.9'],
    ['Campana de la victoria', 'Sos la Campana de la victoria', '🔔', ['Sonás cuando alguien hace historia. Hoy sonaste vos.', 'Tan, tan: diez.'], 'gong~0.8']
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
  rot.seen = rot.seen || []; if (!rot.seen.includes(name)) rot.seen.push(name);
  const c = l.chars.find((x) => x[0] === name);
  const pool = c[3].concat(l.jokes);
  let fresh = pool.filter((j) => !rot.used.includes(j));
  if (!fresh.length) { rot.used = rot.used.filter((j) => !pool.includes(j)); fresh = pool; }
  const joke = fresh[Math.floor(Math.random() * fresh.length)];
  rot.used.push(joke); if (rot.used.length > 300) rot.used = rot.used.slice(-300);
  store.set('profe-rot2', rot);
  return { name: 'Nivel ' + c[0], sos: c[1], emoji: c[2], sound: charSound(c[4], c[0]), joke };
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
    else if (Array.isArray(rows)) { settings.access = null; save(); } // el servidor no lo conoce: tiene que pedir acceso
    // La clave de Claude vive solo en el servidor y en el teléfono del administrador: si este dispositivo no es del admin, se borra.
    if (Array.isArray(rows) && settings.key && !(a && a.is_admin)) { settings.key = ''; save(); }
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
// Las novedades de otros se cuentan de vez en cuando: solo al terminar un examen, como mucho 1 vez cada 20 minutos
// y no siempre (1 de cada 3, más o menos). Lo que no se cuenta queda guardado para otra vez.
function gossip() {
  rankingRows().catch(() => {});
  const last = store.get('profe-chisme-at', 0);
  if (Date.now() - last < 20 * 60 * 1000 || Math.random() > 0.35) return '';
  const said = gossipNow();
  if (said) store.set('profe-chisme-at', Date.now());
  return said;
}
function gossipNow() {
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
  let fact;
  if (a == null) fact = pickOne([`${n} empezó a estudiar ${tp}. Todavía no rindió nada. Se hace el misterioso.`, `${n} arrancó con ${tp}. Viene con todo, o eso dice.`]);
  else if (prevAvg != null && o.avg > prevAvg) fact = `${n} subió en ${tp}. Ahora tiene ${a} y está en el ${L}. Se está poniendo las pilas.`;
  else if (prevAvg != null && o.avg < prevAvg) fact = `${n} bajó un poquito en ${tp}. Ahora tiene ${a}, en el ${L}. Pobre, pasale un mate.`;
  else if (mine && o.avg > mine.avg) fact = `${n} ya está en el ${L} en ${tp}, con ${a}. Y vos ahí, en el ${mine.level}…`;
  else if (mine && o.avg < mine.avg) fact = `en ${tp} le estás ganando a ${n}, que está en el ${L} con ${a}. Hacete el humilde.`;
  else fact = pickOne([`${n} está estudiando ${tp} y ya sacó ${a}. Está en el ${L}.`, `${n} anda con ${tp}. Sacó ${a} y quedó en el ${L}. Ya se la cree, ¿viste?`]);
  return `${rotPick('open', GOSSIP_OPEN)} ${fact} ${rotPick('close', GOSSIP_CLOSE)}`;
}
// Distintas formas de arrancar y cerrar la confidencia; rotan sin repetirse hasta usarlas todas.
const GOSSIP_OPEN = [
  'Te cuento una cosa, pero no te quiero decir nada…', 'Psst… no sé si debería contarte esto, pero…', 'Esto queda entre nosotros, ¿eh?…',
  'Shh, acercate que nadie escuche…', 'Me llegó un rumor… no sé si es cierto, pero…', 'No es que yo ande hablando de los demás, pero…',
  'Mirá, yo no soy de contar cosas, pero…', 'Un pajarito me contó que…', 'Te lo digo bajito, porque si se entera…',
  'Ay, no te puedo contar… bueno, te cuento:', 'No lo vas a creer, pero…', 'Agarrate de la silla:',
];
const GOSSIP_CLOSE = [
  'Yo no te dije nada, ¿eh?', 'Vos hacete el que no sabe.', 'Pero de mí no salió.', 'Borrá esto de tu memoria.',
  'Si te preguntan, yo estaba durmiendo.', 'Y no me mires así, que yo solo informo.', 'Ni una palabra a nadie.', 'Shh… seguimos con lo nuestro.',
];
function rotPick(key, list) {
  const st = store.get('profe-chisme-rot', {});
  let bag = (st[key] || []).filter((x) => list.includes(x));
  if (!bag.length) bag = list.slice();
  const x = bag[Math.floor(Math.random() * bag.length)];
  st[key] = bag.filter((y) => y !== x); store.set('profe-chisme-rot', st);
  return x;
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
  if (view.type === 'final') s.finalBest = Math.max(s.finalBest ?? 0, score);
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
  const isFinal = view.type === 'final', justDone = view.unlocked && courseDone(s);
  const msg = isFinal ? (ok ? '¡Aprobaste el examen final del curso! 🎓' : 'Todavía no. Repasá las etapas y rendilo de nuevo.')
    : ok ? (justDone ? '¡Terminaste todo el curso! Ahora te toca el examen final.' : view.unlocked ? '¡Terminaste la etapa! Se habilitó la siguiente.' : view.score >= 8 ? '¡Excelente!' : '¡Muy bien!') : 'Todavía no. Repetí el módulo y probá de nuevo.';
  app.innerHTML = `
    <div class="result-screen ${ok ? 'pass' : 'fail'}">
      <div class="result-inner">
        <div class="result-topic">${isMod ? esc(m.title) : isFinal ? esc(cfg.name) + ' · ' + esc(s.topic) : esc(cfg.name) + ' · ' + esc(st.title)}</div>
        <div class="result-emoji"><span class="anim-loop ${animOf(view.lv.sound)}">${view.lv.emoji}</span></div>
        <div class="result-label">${settings.name ? esc(settings.name) + ", sacaste" : "Sacaste"}</div>
        <div class="result-num">${fmt(view.score)}</div>
        <div class="result-level">${esc(view.lv.sos)}</div>
        <div class="result-joke">${esc(view.joke)}</div>
        ${view.gossip ? `<div class="result-gossip">🗣️ ${esc(view.gossip)}</div>` : ''}
        ${view.feedback ? `<div class="result-joke" style="font-style:normal">${esc(view.feedback)}</div>` : ""}
        <div class="result-msg">${msg}</div>
        <div class="result-sub"><span>Corrección <b>${fmt(view.correct)}</b></span><span>Claridad <b>${fmt(view.clarity)}</b></span></div>
        ${justDone ? '<button class="block result-btn" id="toFinal">🎓 Rendir el examen final →</button>' : ''}
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
  const tf = document.getElementById('toFinal'); if (tf) tf.onclick = () => startExam(s, s.stages.length - 1, 'final', tf);
  if (tf) tf.innerHTML = '<span>' + tf.innerHTML + '</span>';
  const ag = document.getElementById('again'); if (ag) ag.onclick = () => isFinal ? go('subject', { sid: s.id }, false) : go('examMenu', { sid: s.id, si: view.si }, false);
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
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !window.__reloaded) { window.__needReload = true; reloadIfIdle(); } });
  // En la compu la pestaña queda abierta días: busca versión nueva cada 10 minutos y al volver a la pestaña.
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  setInterval(check, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
render();
// Precarga la voz natural en segundo plano, así la primera lectura no se demora.
setTimeout(() => { if (settings.engine === 'piper' && settings.piperVoice) piperSessionFor(settings.piperVoice).catch(() => {}); }, 2500);
