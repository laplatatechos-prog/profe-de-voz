// ---------- Combate: los personajes de la app se enfrentan (juego de pelea propio, apto para chicos) ----------
// A la derecha: flechas para moverse. A la izquierda: saltar y pegar. Cuando la barra ⭐ está llena, "pegar" tira el golpe especial.
// Cada tanto sale una pregunta relámpago: si la contestás bien, se carga el especial.
const FIGHT_W = 360, FIGHT_H = 230, FLOOR = 190;
const allChars = () => LEVELS.flatMap((l, li) => l.chars.map((c) => ({ name: c[0], sos: c[1], emoji: c[2], sound: charSound(c[4], c[0]), li })));
const charByName = (n) => allChars().find((c) => c.name === n) || allChars()[0];

views.fightSelect = () => {
  setHeader('Combate');
  const list = allChars(), me = view.me ? charByName(view.me) : null;
  app.innerHTML = `
    <div class="card ask-card"><div class="ask-q">🥊 ${me ? 'Ahora elegí a tu rival' : 'Elegí tu personaje'}</div>
      <div class="muted small">${me ? `Vos sos <b>${esc(me.emoji + ' ' + me.name)}</b>. ¿Contra quién peleás?` : 'Los de nivel más alto tienen el golpe especial un poquito más fuerte.'}</div>
      ${me ? '<button class="block soft" id="rndRival" style="margin-top:10px">🎲 Rival sorpresa</button>' : '<button class="block fight-cta" id="toLive" style="margin-top:10px">👥 Pelea en vivo contra una persona</button>'}</div>
    ${LEVELS.map((l, li) => `<h2>${l.min >= 6 ? '🌟' : '🌱'} Nota ${fmt(l.min)}</h2><div class="char-grid">${l.chars.map((c) => `<button class="char-card" data-pick="${esc(c[0])}"><span class="char-emoji">${c[2]}</span><span>${esc(c[0])}</span></button>`).join('')}</div>`).join('')}`;
  app.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => {
    const n = b.dataset.pick; audioCtx(); playSfx(charByName(n).sound, true);
    if (!me) go('fightSelect', { me: n }); else go('fight', { a: me.name, b: n });
  });
  const lv = document.getElementById('toLive'); if (lv) lv.onclick = () => go('fightLiveNew');
  const r = document.getElementById('rndRival');
  if (r) r.onclick = () => { let o; do { o = list[Math.floor(Math.random() * list.length)]; } while (o.name === me.name); go('fight', { a: me.name, b: o.name }); };
};

// Un luchador: emoji grande con vida, especial y animaciones simples.
function fighter(c, x, dir) { return { c, x, y: FLOOR, vy: 0, dir, hp: 100, sp: 0, atk: 0, hurt: 0, cd: 0, win: 0, shot: null }; }
let fightLoop = null;
function stopFight() { if (fightLoop) cancelAnimationFrame(fightLoop); fightLoop = null; window.onkeydown = window.onkeyup = null; }

views.fight = () => {
  setHeader('Combate');
  const A = charByName(view.a), B = charByName(view.b), auto = !!view.replay;
  app.innerHTML = `
    <div class="fight-top"><div class="fight-bar"><b>${esc(view.an || A.name)}</b><i><span id="hpA"></span></i><em><span id="spA"></span></em></div>
      <div class="fight-vs" id="fTime">60</div>
      <div class="fight-bar r"><b>${esc(view.bn || B.name)}</b><i><span id="hpB"></span></i><em><span id="spB"></span></em></div></div>
    <canvas id="fightCv" width="${FIGHT_W}" height="${FIGHT_H}" class="fight-cv"></canvas>
    <div id="fightMsg" class="fight-msg"></div>
    ${auto ? '<div class="muted small" style="text-align:center">Así fue el duelo: cada pregunta es un golpe.</div>' : `
    <div class="fight-pad">
      <div class="fight-left"><button class="fbtn jump" data-k="up">⤒<span>Saltar</span></button><button class="fbtn hit" data-k="hit" id="hitBtn">👊<span>Pegar</span></button></div>
      <div class="fight-right"><button class="fbtn dir" data-k="left">◀</button><button class="fbtn dir" data-k="right">▶</button></div>
    </div>`}
    <button class="block soft" id="fightBack" style="margin-top:10px">${auto ? '⚔️ Volver al duelo' : '🥊 Elegir otros personajes'}</button>`;
  const cv = document.getElementById('fightCv'), g = cv.getContext('2d');
  const P = fighter(A, 80, 1), E = fighter(B, FIGHT_W - 80, -1);
  P.pow = 1 + A.li * 0.04; E.pow = 1 + B.li * 0.04;
  const keys = {}; let t0 = performance.now(), last = t0, over = false, quizAt = t0 + 12000, paused = false, sparks = [];
  const msg = (t, ms = 1400) => { const m = document.getElementById('fightMsg'); if (!m) return; m.textContent = t; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop'); clearTimeout(m._t); m._t = setTimeout(() => { m.textContent = ''; }, ms); };
  const paint = () => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = Math.max(0, v) + '%'; };
    set('hpA', P.hp); set('hpB', E.hp); set('spA', P.sp); set('spB', E.sp);
    const hb = document.getElementById('hitBtn'); if (hb) { hb.classList.toggle('super', P.sp >= 100); hb.firstChild.textContent = P.sp >= 100 ? '⭐' : '👊'; }
  };
  const hitSfx = (big) => { const s = SOUNDS[big ? 'thud' : 'pop']; const c = audioCtx(); if (!c || !s) return; const o = c.createGain(); o.gain.value = big ? .9 : .6; o.connect(c.destination); try { s(c, o, c.currentTime + .01); } catch {} };
  const damage = (to, from, n, special) => {
    if (to.hurt > 0 || over) return;
    to.hp -= n; to.hurt = special ? 30 : 14; to.x += from.dir * (special ? 40 : 16);
    from.sp = Math.min(100, from.sp + (special ? 0 : 12)); to.sp = Math.min(100, to.sp + 6);
    sparks.push({ x: to.x, y: to.y - 50, t: 18, e: special ? '💥' : '✨' });
    hitSfx(special); if (navigator.vibrate) try { navigator.vibrate(special ? 60 : 20); } catch {}
    if (to.hp <= 0) end(from, to);
  };
  const attack = (f, o) => {
    if (f.cd > 0 || f.hurt > 0 || over) return;
    if (f.sp >= 100) { // golpe especial: sale volando el personaje en chiquito, con su ruido
      f.sp = 0; f.cd = 40; f.atk = 16; f.shot = { x: f.x + f.dir * 30, y: f.y - 45, dir: f.dir };
      playSfx(f.c.sound, true); msg(`¡${f === P ? 'Especial' : 'Cuidado: especial'} de ${f.c.name}!`);
      return;
    }
    f.atk = 10; f.cd = 22;
    if (Math.abs(f.x - o.x) < 70 && Math.abs(f.y - o.y) < 60) damage(o, f, 7, false);
  };
  const end = (w, l) => {
    over = true; w.win = 1;
    const youWin = w === P;
    setTimeout(() => {
      const wn = w === P ? (view.an || A.name) : (view.bn || B.name), ln = l === P ? (view.an || A.name) : (view.bn || B.name);
      const head = wn === 'Vos' || (!auto && youWin) ? '¡Ganaste vos!' : `¡Ganó ${wn}!`;
      msg('🏆 ' + head, 6000);
      if (auto || youWin) confetti();
      speak(`{{s:fanfare}} ${head} {{s:${w.c.sound}}} {{p}} {{s:sadtrombone}} ${ln === 'Vos' || (!auto && !youWin) ? '' : ln + ', '}${rotPick('loser', LOSER_JOKES)}`);
    }, 400);
  };
  // la compu pelea sola (y en la repetición del duelo, los dos)
  const ai = (f, o, lvl) => {
    const d = o.x - f.x, dist = Math.abs(d); f.dir = d > 0 ? 1 : -1;
    if (dist > 62) f.x += f.dir * (1.3 + lvl); else if (Math.random() < 0.018 + lvl * 0.02) { attack(f, o); if (!auto) f.cd = Math.max(f.cd, 34); }
    else if (dist < 50 && Math.random() < 0.03) f.x -= f.dir * 14; // a veces retrocede
    if (Math.random() < 0.006 && f.y >= FLOOR) f.vy = -9;
    if (f.sp >= 100 && dist > 90 && Math.random() < 0.05) attack(f, o);
    if (o.shot && Math.abs(o.shot.x - f.x) < 90 && f.y >= FLOOR && Math.random() < 0.08) f.vy = -9; // salta el especial
  };
  // pregunta relámpago: si la contestás bien, se llena tu ⭐
  const quiz = () => {
    paused = true;
    const a = 2 + Math.floor(Math.random() * 8), b = 2 + Math.floor(Math.random() * 8), plus = Math.random() < 0.4, ok = plus ? a + b : a * b;
    const opts = [ok, ok + (Math.random() < 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 3)), ok + 10].sort(() => Math.random() - 0.5);
    const box = document.createElement('div'); box.className = 'fight-quiz';
    box.innerHTML = `<div>⚡ ¡Pregunta relámpago!</div><b>${a} ${plus ? '+' : '×'} ${b} = ?</b><div class="row" style="gap:8px;justify-content:center">${opts.map((o) => `<button data-q="${o}">${o}</button>`).join('')}</div>`;
    cv.parentNode.insertBefore(box, cv.nextSibling);
    box.querySelectorAll('[data-q]').forEach((bt) => bt.onclick = () => {
      const good = +bt.dataset.q === ok; box.remove(); paused = false; last = performance.now();
      if (good) { P.sp = 100; P.hp = Math.min(100, P.hp + 8); msg('¡Bien! Especial cargado ⭐'); playSfx('tada', true); } else { E.sp = Math.min(100, E.sp + 40); msg(`Era ${ok}. ¡La próxima!`); }
    });
  };
  // repetición del duelo: cada pregunta, el que sacó más puntos pega
  const script = (view.replay || []).slice(); let nextEv = t0 + 900;
  const runScript = (now) => {
    if (!script.length || now < nextEv) return;
    const ev = script.shift(), f = ev.by === 'a' ? P : E, o = f === P ? E : P;
    nextEv = now + 1500;
    if (ev.dmg <= 0) return;
    f.x = o.x - f.dir * 60; f.dir = o.x > f.x ? 1 : -1; f.atk = 12;
    if (ev.special) { f.sp = 100; f.cd = 0; f.hurt = 0; attack(f, o); } else { damage(o, f, ev.dmg, false); }
    if (!script.length && !over) setTimeout(() => { if (!over) { const l = P.hp < E.hp ? P : E; damage(l, l === P ? E : P, l.hp, true); } }, 1400);
  };
  const step = (now) => {
    if (view.name !== 'fight' || !document.body.contains(cv)) return stopFight();
    fightLoop = requestAnimationFrame(step);
    if (paused) return;
    const dt = Math.min(2, (now - last) / 16.7); last = now;
    if (!over) {
      if (auto) runScript(now);
      else {
        const sp = 3.2 * dt;
        if (keys.left) { P.x -= sp; } if (keys.right) { P.x += sp; }
        if (keys.up && P.y >= FLOOR) { P.vy = -10; keys.up = false; }
        if (keys.hit) { attack(P, E); keys.hit = false; }
        P.dir = E.x > P.x ? 1 : -1;
        ai(E, P, Math.min(1, B.li / 12));
        if (now > quizAt) { quizAt = now + 15000; quiz(); }
        const left = Math.max(0, 60 - Math.floor((now - t0) / 1000)); const tm = document.getElementById('fTime'); if (tm) tm.textContent = left;
        if (left === 0) { const w = P.hp >= E.hp ? P : E; end(w, w === P ? E : P); }
      }
    }
    for (const f of [P, E]) {
      f.vy += 0.55 * dt; f.y = Math.min(FLOOR, f.y + f.vy * dt); if (f.y >= FLOOR) f.vy = 0;
      f.x = Math.max(30, Math.min(FIGHT_W - 30, f.x));
      f.cd = Math.max(0, f.cd - dt); f.atk = Math.max(0, f.atk - dt); f.hurt = Math.max(0, f.hurt - dt);
      if (f.shot) { f.shot.x += f.shot.dir * 7 * dt; const o = f === P ? E : P;
        if (Math.abs(f.shot.x - o.x) < 34 && Math.abs(f.shot.y - (o.y - 45)) < 45) { damage(o, f, Math.round(20 * f.pow), true); f.shot = null; }
        else if (f.shot.x < -20 || f.shot.x > FIGHT_W + 20) f.shot = null; }
    }
    if (Math.abs(P.x - E.x) < 44 && Math.abs(P.y - E.y) < 40) { const push = (44 - Math.abs(P.x - E.x)) / 2; P.x -= P.dir * push; E.x -= E.dir * push; }
    // dibujo
    g.clearRect(0, 0, FIGHT_W, FIGHT_H);
    const sky = g.createLinearGradient(0, 0, 0, FIGHT_H); sky.addColorStop(0, '#dff3ff'); sky.addColorStop(1, '#fff4e0'); g.fillStyle = sky; g.fillRect(0, 0, FIGHT_W, FIGHT_H);
    g.fillStyle = '#b8e994'; g.fillRect(0, FLOOR + 8, FIGHT_W, FIGHT_H); g.fillStyle = '#78c850'; g.fillRect(0, FLOOR + 8, FIGHT_W, 5);
    g.font = '22px serif'; g.fillText('☁️', 40, 34); g.fillText('☁️', 250, 50); g.fillText('🌳', 8, FLOOR + 4); g.fillText('🌳', FIGHT_W - 32, FLOOR + 4);
    for (const f of [P, E]) {
      g.save(); g.translate(f.x, f.y);
      g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.ellipse(0, FLOOR - f.y + 6, 26, 6, 0, 0, Math.PI * 2); g.fill();
      const bob = f.y < FLOOR ? 0 : Math.sin(now / 160 + (f === P ? 0 : 2)) * 3, lean = f.atk > 0 ? f.dir * 0.35 : f.hurt > 0 ? -f.dir * 0.3 : 0;
      g.fillStyle = '#000'; g.rotate(lean); g.scale(f.dir, 1); if (f.hurt > 0 && Math.floor(f.hurt) % 4 < 2) g.globalAlpha = 0.45;
      g.font = '58px serif'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(f.c.emoji, 0, bob);
      if (f.atk > 0) { g.font = '26px serif'; g.fillText('👊', 36, -18 + bob); }
      if (f.win) { g.scale(f.dir, 1); g.font = '26px serif'; g.fillText('👑', 0, -58); }
      g.restore();
      if (f.shot) { g.font = '34px serif'; g.textAlign = 'center'; g.fillText(f.c.emoji, f.shot.x, f.shot.y + 12); g.font = '18px serif'; g.fillText('✨', f.shot.x - f.shot.dir * 22, f.shot.y + 6); }
    }
    g.fillStyle = '#000'; g.globalAlpha = 1;
    sparks = sparks.filter((s) => (s.t -= dt) > 0); for (const s of sparks) { g.font = '30px serif'; g.textAlign = 'center'; g.fillText(s.e, s.x, s.y); }
    paint();
  };
  // controles: mantener apretado para moverse
  app.querySelectorAll('[data-k]').forEach((b) => {
    const k = b.dataset.k, on = (e) => { e.preventDefault(); audioCtx(); keys[k] = true; b.classList.add('on'); }, off = (e) => { e.preventDefault(); if (k === 'left' || k === 'right') keys[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); b.oncontextmenu = (e) => e.preventDefault();
  });
  const KM = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ' ': 'up', a: 'hit', s: 'hit', Enter: 'hit' };
  window.onkeydown = (e) => { const k = KM[e.key]; if (k && !auto) { keys[k] = true; e.preventDefault(); } };
  window.onkeyup = (e) => { const k = KM[e.key]; if (k === 'left' || k === 'right') keys[k] = false; };
  document.getElementById('fightBack').onclick = () => { stopFight(); if (auto) go('duel', { id: view.duelId }); else go('fightSelect'); };
  stopFight(); fightLoop = requestAnimationFrame(step);
  msg(auto ? '¡Comienza el combate del duelo!' : `${A.emoji} contra ${B.emoji}: ¡a pelear!`, 1800);
};

// Desde un duelo terminado: combate entre el primero y el último, con los personajes que les tocó.
function duelFight(d, rs) {
  const a = rs[0], b = rs[rs.length - 1], ca = duelChar(d, a, rs), cb = duelChar(d, b, rs);
  const n = Math.max(a.cum.length, b.cum.length), ev = [];
  const gap = Math.max(0, a.points - b.points), total = Math.min(100, 30 + gap / 3);
  let prevA = 0, prevB = 0; const raw = [];
  for (let k = 0; k < n; k++) { const pa = (a.cum[k] || prevA) - prevA, pb = (b.cum[k] || prevB) - prevB; prevA += pa; prevB += pb; raw.push(pa - pb); }
  const sumA = raw.filter((x) => x > 0).reduce((s, x) => s + x, 0) || 1, sumB = raw.filter((x) => x < 0).reduce((s, x) => s - x, 0) || 1;
  for (const x of raw) {
    if (x > 0) ev.push({ by: 'a', dmg: Math.max(4, Math.round((x / sumA) * total)), special: x >= 80 });
    else if (x < 0) ev.push({ by: 'b', dmg: Math.max(3, Math.round((-x / sumB) * Math.min(total * 0.8, 70))), special: -x >= 80 });
  }
  if (!ev.length) ev.push({ by: 'a', dmg: 10 });
  go('fight', { a: ca.name, b: cb.name, an: a.me ? 'Vos' : a.name, bn: b.me ? 'Vos' : b.name, replay: ev, duelId: d.id });
}

// ---------- Sabiduría: el personaje y su fuerza salen de lo que aprendiste y comprobaste ----------
// Cada tema vale según su complejidad (no es lo mismo inteligencia artificial que hacer un sándwich) y según lo que aprobaste.
async function topicCx(s) {
  if (s.cx) return s.cx;
  try { const j = await askJSON('Calificás qué tan complejo es aprender un tema.', `Tema: "${s.topic}". Del 1 (muy simple, como hacer un sándwich) al 10 (muy complejo, como inteligencia artificial o física cuántica). Forma: {"cx": número}`, 60, FAST_MODEL);
    s.cx = Math.max(1, Math.min(10, Math.round(+j.cx || 5))); save(); } catch { return 5; }
  return s.cx;
}
function wisdom() {
  let w = 0;
  for (const s of subjects) {
    const mods = s.stages.flatMap((st) => st.modules || []), passed = mods.filter((m) => (modBest(m) || 0) >= PASS).length;
    const avg = subjAvg(s); if (avg == null) continue;
    w += (avg / 10) * (s.cx || 5) * (0.4 + 0.6 * (mods.length ? passed / mods.length : 0)) + (courseDone(s) ? (s.cx || 5) : 0);
  }
  return Math.round(w * 10) / 10;
}
// 10 escalones: con más sabiduría se desbloquean personajes de niveles más altos y pegás más fuerte.
const WIS_STEPS = [0, 3, 7, 12, 18, 26, 36, 50, 70, 95];
const wisLevel = (w = wisdom()) => WIS_STEPS.filter((x) => w >= x).length - 1;
const wisPower = (lv) => 1 + lv * 0.08;

// ---------- Pelea en vivo entre dos personas: al mejor de 3 rondas, con preguntas ----------
// Contestar bien = le tirás tu poder al otro. Contestar mal o tarde = perdés vida vos.
const FIGHT_TAG = '🥊 ';
const isFightDuel = (d) => String(d.topic || '').startsWith(FIGHT_TAG);
const FQ_T = 10, HIT = 12, MISS = 8;
views.fightLiveNew = () => {
  setHeader('Pelea en vivo');
  // la primera vez se califica qué tan complejo es cada tema (una sola vez por tema)
  if (!view.cxAsked) { view.cxAsked = true; const V0 = view; Promise.all(subjects.filter((s) => !s.cx).slice(0, 8).map(topicCx)).then((r) => { if (r.length && view === V0) render(); }); }
  const lv = wisLevel();
  app.innerHTML = `<div class="card ask-card"><div class="ask-q">👥 Pelea en vivo</div>
    <div class="muted small">Al mejor de 3 rondas. Salen preguntas: si contestás bien le tirás tu poder; si contestás mal o se acaba el tiempo, perdés vida vos. Tu sabiduría es <b>${fmt(wisdom())}</b> (escalón ${lv + 1} de 10): pegás ${Math.round((wisPower(lv) - 1) * 100)} % más fuerte.</div>
    <div class="muted small" style="margin-top:10px">¿A quién desafiás?</div><div class="sug-wrap" id="fRivals">Cargando…</div>
    <div class="muted small" style="margin-top:10px"><b>¿Cuál es la consecuencia?</b> Es obligatoria.</div>
    <div class="duel-norm">🤝 Nunca violencia, someter ni humillar a nadie. Lo importante es la voluntad, el conocimiento y el criterio.</div>
    <input id="fBet" class="ask-input" maxlength="120" style="margin-top:6px" placeholder="Ej: el que pierde ordena la pieza">
    <button class="block" id="fGo" style="margin-top:12px">🥊 Desafiar a pelear</button><div id="fMsg" class="muted small" style="margin-top:8px"></div></div>`;
  let rival = null;
  sbRpc('duel_players', { p_player: settings.playerId }).then((ps) => {
    const box = document.getElementById('fRivals'); if (!box) return;
    box.innerHTML = (ps || []).length ? ps.map((p) => `<button class="chip" data-fr="${p.id}">👤 ${esc(p.name)}</button>`).join('') : 'Todavía no hay nadie aprobado para pelear.';
    box.querySelectorAll('[data-fr]').forEach((b) => b.onclick = () => { rival = ps.find((p) => p.id === b.dataset.fr); box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); });
  }).catch(() => {});
  document.getElementById('fGo').onclick = async () => {
    const msg = document.getElementById('fMsg'), btn = document.getElementById('fGo'), bet = document.getElementById('fBet').value.trim();
    if (!settings.name) return (msg.textContent = 'Primero poné tu nombre en Inicio.');
    if (!rival) return (msg.textContent = 'Elegí a quién desafiás.');
    if (bet.length < 3) return (msg.innerHTML = '<span class="err">Poné la consecuencia: sin desafío no hay pelea.</span>');
    btn.disabled = true; msg.textContent = 'Revisando la consecuencia…';
    const why = await badBet(bet);
    if (why) { btn.disabled = false; msg.innerHTML = `<div class="duel-norm bad">🚫 Esa consecuencia no va. Nada de violencia, someter ni humillar a nadie.</div>`; return; }
    msg.textContent = 'Armando las preguntas de la pelea…';
    try {
      const j = await askJSON('Sos un maestro que arma preguntas rápidas de opción múltiple para un juego de pelea.',
        `Armá 30 preguntas de cultura general y escuela (matemática, lengua, ciencias, geografía, historia, animales), de fácil a media, MUY cortas (máximo 12 palabras), cada una con 3 opciones cortas y una sola correcta. ${Q_RULE} Forma: {"qs":[{"q":"...","o":["...","...","..."],"a":0}]}`, 3500, FAST_MODEL);
      const qs = (j.qs || []).filter((x) => x && x.q && Array.isArray(x.o) && x.o.length === 3 && x.a >= 0 && x.a < 3).slice(0, 30);
      if (qs.length < 10) throw new Error('No pude armar las preguntas. Probá de nuevo.');
      const id = await sbRpc('create_duel4', { p_bet: bet, p_player: settings.playerId, p_name: settings.name, p_topic: FIGHT_TAG + 'Pelea en vivo', p_diff: 'basico', p_questions: qs, p_target: rival.id, p_target2: null });
      if (!id) throw new Error('No pude crear la pelea.');
      if (typeof notifyDuel === 'function') notifyDuel(id);
      toast(`Listo: ${rival.name} va a ver tu desafío en Competencia.`);
      go('fightLive', { id });
    } catch (e) { btn.disabled = false; msg.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
};

// Estado de la pelea: se arma igual en los dos teléfonos a partir de la lista de jugadas (mensajes del duelo).
function fightState(evs, meName) {
  const st = { players: {}, order: [], round: 1, wins: {}, hp: {}, over: null, log: [] };
  for (const e of evs) {
    const p = e.name;
    if (e.t === 'j') { if (!st.players[p] && st.order.length < 2) { st.order.push(p); st.wins[p] = 0; st.hp[p] = 100; } if (st.players[p] || st.order.includes(p)) st.players[p] = { ch: e.ch, pw: Math.min(1.8, Math.max(1, +e.pw || 1)), me: e.me }; continue; }
    if (e.t !== 'a' || st.over || !st.players[p] || e.r !== st.round || st.order.length < 2) continue;
    const o = st.order.find((x) => x !== p);
    if (e.ok) { const dmg = Math.round(HIT * st.players[p].pw / Math.sqrt(st.players[o].pw)); st.hp[o] -= dmg; st.log.push({ by: p, to: o, dmg, ok: true, id: e.id }); }
    else { st.hp[p] -= MISS; st.log.push({ by: p, to: p, dmg: MISS, ok: false, id: e.id }); }
    const ko = st.order.find((x) => st.hp[x] <= 0);
    if (ko) { const w = st.order.find((x) => x !== ko); st.wins[w]++; st.log.push({ round: st.round, winner: w, id: e.id + 0.5 });
      if (st.wins[w] >= 2) st.over = w; else { st.round++; st.order.forEach((x) => (st.hp[x] = 100)); } }
  }
  return st;
}
let flPoll = null;
function stopLive() { if (flPoll) clearInterval(flPoll); flPoll = null; stopFight(); }
views.fightLive = () => {
  setHeader('Pelea en vivo');
  stopLive();
  const V = view; V.arena = false; V.drawn = false; V.evs = V.evs || []; V.last = V.last || 0; V.sent = V.sent || 0;
  const send = (obj) => { const q = (V.queue = V.queue || []); q.push(obj); pump(); };
  const pump = () => { if (V.pumping || !V.queue.length) return; V.pumping = true;
    sbRpc('send_chat', { p_player: settings.playerId, p_room: V.id, p_text: '§F' + JSON.stringify(V.queue[0]) })
      .then(() => { V.queue.shift(); }).catch(() => {}).finally(() => { setTimeout(() => { V.pumping = false; pump(); }, 2100); }); };
  const pull = () => sbRpc('get_chat', { p_player: settings.playerId, p_room: V.id, p_after: V.last }).then((xs) => {
    if (view !== V) return;
    const fresh = xs && xs.length;
    if (fresh) { V.last = xs[xs.length - 1].id;
      for (const m of xs) if (String(m.text).startsWith('§F')) { try { V.evs.push({ ...JSON.parse(m.text.slice(2)), name: m.name, me: m.me, id: m.id }); } catch {} } }
    if (fresh || !V.drawn) { V.drawn = true; draw(); }
  }).catch(() => {});
  const myLv = wisLevel(), pw = wisPower(myLv);
  const draw = () => {
    if (view !== V) return;
    const st = fightState(V.evs), me = Object.keys(st.players).find((n) => st.players[n].me), other = st.order.find((n) => n !== me);
    if (!me) { // elegir personaje: solo los de tu escalón de sabiduría para abajo
      app.innerHTML = `<div class="card ask-card"><div class="ask-q">🥊 Elegí tu personaje para pelear</div>
        <div class="muted small">Tu sabiduría (lo que aprendiste y aprobaste, según lo difícil de cada tema) te deja usar personajes hasta el nivel ${myLv + 1}. Estudiá más y se desbloquean más fuertes.</div></div>
        ${LEVELS.slice(0, myLv + 1).map((l) => `<h2>Nota ${fmt(l.min)}</h2><div class="char-grid">${l.chars.map((c) => `<button class="char-card" data-lc="${esc(c[0])}"><span class="char-emoji">${c[2]}</span><span>${esc(c[0])}</span></button>`).join('')}</div>`).join('')}`;
      app.querySelectorAll('[data-lc]').forEach((b) => b.onclick = () => { V.evs.push({ t: 'j', ch: b.dataset.lc, pw, name: settings.name, me: true, id: 1e15 }); send({ t: 'j', ch: b.dataset.lc, pw }); playSfx(charByName(b.dataset.lc).sound, true); draw(); });
      return;
    }
    if (!other) { app.innerHTML = `<div class="card ask-card" style="text-align:center"><div style="font-size:64px">${charByName(st.players[me].ch).emoji}</div><div class="ask-q">Esperando a tu rival…</div><p class="muted">Cuando entre y elija su personaje, arranca la pelea. Le llega el aviso en Competencia.</p></div>`; return; }
    if (!V.arena) arena(st, me, other);
    V.update(st, me, other);
  };
  // la arena con los dos personajes, vidas, rondas y la pregunta
  const arena = (st, me, other) => {
    V.arena = true;
    const A = charByName(st.players[me].ch), B = charByName(st.players[other].ch);
    app.innerHTML = `
      <div class="fight-top"><div class="fight-bar"><b>Vos ${'⭐'.repeat(0)}<span id="wA"></span></b><i><span id="hpA"></span></i></div>
        <div class="fight-vs" id="fRound">R1</div>
        <div class="fight-bar r"><b><span id="wB"></span> ${esc(other)}</b><i><span id="hpB"></span></i></div></div>
      <canvas id="fightCv" width="${FIGHT_W}" height="${FIGHT_H}" class="fight-cv"></canvas>
      <div id="fightMsg" class="fight-msg"></div>
      <div id="fQ" class="card fight-live-q"></div>
      <button class="block soft" id="fightOut" style="margin-top:10px">⚔️ Volver a Competencia</button>`;
    document.getElementById('fightOut').onclick = () => { stopLive(); stack.length = 0; view = { name: 'home' }; go('compete'); };
    const cv = document.getElementById('fightCv'), g = cv.getContext('2d');
    const P = fighter(A, 90, 1), E = fighter(B, FIGHT_W - 90, -1); let sparks = [], seen = new Set(), qi = 0, qT = null, qStart = 0, lastRound = 1, done = false;
    const order = seeded(V.id + '|' + settings.playerId); const qs = (V.qs || []).slice(); for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(order() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
    qs.forEach((q, i) => { const idx = [0, 1, 2].sort(() => order() - 0.5); qs[i] = { q: q.q, o: idx.map((k) => q.o[k]), a: idx.indexOf(q.a) }; });
    const msg = (t, ms = 1500) => { const m = document.getElementById('fightMsg'); if (!m) return; m.textContent = t; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop'); clearTimeout(m._t); m._t = setTimeout(() => { m.textContent = ''; }, ms); };
    const ask = () => {
      const box = document.getElementById('fQ'); if (!box || done) return;
      const q = qs[qi % qs.length]; qStart = Date.now();
      box.innerHTML = `<div class="between"><b>❓ ${esc(q.q)}</b><span class="fq-t" id="fqT">${FQ_T}</span></div><div class="fq-opts">${q.o.map((o, k) => `<button data-fo="${k}">${esc(o)}</button>`).join('')}</div>`;
      clearInterval(qT); qT = setInterval(() => { const left = FQ_T - Math.floor((Date.now() - qStart) / 1000); const t = document.getElementById('fqT'); if (t) t.textContent = Math.max(0, left); if (left <= 0) answer(-1); }, 250);
      box.querySelectorAll('[data-fo]').forEach((b) => b.onclick = () => answer(+b.dataset.fo));
    };
    const answer = (k) => {
      clearInterval(qT); const q = qs[qi % qs.length], ok = k === q.a; qi++;
      const st = fightState(V.evs); send({ t: 'a', ok, r: st.round });
      msg(ok ? '¡Bien! Le tirás tu poder ⭐' : k < 0 ? '¡Se acabó el tiempo! Perdés vida' : `No: era "${q.o[q.a]}". Perdés vida`);
      if (ok) { P.atk = 14; P.shot = { x: P.x + 30, y: P.y - 45, dir: 1, fake: true }; playSfx(A.sound, true); } else { P.hurt = 16; playSfx('thud', true); }
      setTimeout(ask, 900);
    };
    V.update = (st, me2, other2) => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = Math.max(0, v) + '%'; };
      set('hpA', st.hp[me2]); set('hpB', st.hp[other2]);
      document.getElementById('wA').textContent = ' ' + '🏆'.repeat(st.wins[me2]); document.getElementById('wB').textContent = '🏆'.repeat(st.wins[other2]) + ' ';
      document.getElementById('fRound').textContent = 'R' + Math.min(3, st.round);
      for (const L of st.log) { if (seen.has(L.id)) continue; seen.add(L.id);
        if (L.winner) { msg(L.winner === me2 ? `🏆 ¡Ganaste la ronda ${L.round}!` : `Ronda ${L.round} para ${L.winner}`, 2200); continue; }
        if (L.by === other2 && L.ok) { E.atk = 14; E.shot = { x: E.x - 30, y: E.y - 45, dir: -1, fake: true }; setTimeout(() => { P.hurt = 18; sparks.push({ x: P.x, y: P.y - 50, t: 18, e: '💥' }); }, 500); playSfx(B.sound, true); }
        else if (L.by === other2 && !L.ok) { E.hurt = 14; }
        else if (L.by === me2 && L.ok) setTimeout(() => { E.hurt = 18; sparks.push({ x: E.x, y: E.y - 50, t: 18, e: '💥' }); }, 500);
      }
      if (st.round !== lastRound) { lastRound = st.round; }
      if (st.over && !done) {
        done = true; clearInterval(qT); const box = document.getElementById('fQ'); const won = st.over === me2;
        (won ? P : E).win = 1;
        if (box) box.innerHTML = `<div style="text-align:center;font-size:22px;font-weight:900">${won ? '🏆 ¡Ganaste la pelea!' : `🏆 Ganó ${esc(st.over)}`}</div>${V.bet ? `<div class="duel-bet" style="margin-top:8px">🎲 Consecuencia: ${esc(V.bet)} · le toca a ${won ? esc(other2) : 'vos'}</div>` : ''}`;
        if (won) confetti();
        speak(won ? `{{s:fanfare}} Ganaste la pelea. {{s:${A.sound}}}` : `{{s:fanfare}} Ganó ${st.over}. {{p}} {{s:sadtrombone}} ${cap1(rotPick('loser', LOSER_JOKES))} {{p}} ${rotPick('irony', IRONY)}`);
        // queda anotado en Mis duelos
        sbRpc('duel_join', { p_id: V.id, p_player: settings.playerId, p_name: settings.name }).then(() => sbRpc('duel_progress', { p_id: V.id, p_player: settings.playerId, p_name: settings.name, p_points: st.wins[me2] * 100 + Math.max(0, st.hp[me2]), p_avg: 0, p_seconds: 0, p_answers: [], p_done: true })).catch(() => {});
      }
    };
    const loop = (now) => {
      if (view !== V || !document.body.contains(cv)) return stopLive();
      fightLoop = requestAnimationFrame(loop);
      for (const f of [P, E]) { f.atk = Math.max(0, f.atk - 1); f.hurt = Math.max(0, f.hurt - 1);
        if (f.shot) { f.shot.x += f.shot.dir * 9; if ((f.shot.dir > 0 && f.shot.x > E.x - 10) || (f.shot.dir < 0 && f.shot.x < P.x + 10)) f.shot = null; } }
      g.clearRect(0, 0, FIGHT_W, FIGHT_H);
      const sky = g.createLinearGradient(0, 0, 0, FIGHT_H); sky.addColorStop(0, '#ffe8f0'); sky.addColorStop(1, '#e8f7ff'); g.fillStyle = sky; g.fillRect(0, 0, FIGHT_W, FIGHT_H);
      g.fillStyle = '#c7ecff'; g.fillRect(0, FLOOR + 8, FIGHT_W, FIGHT_H); g.fillStyle = '#74b9ff'; g.fillRect(0, FLOOR + 8, FIGHT_W, 5);
      g.fillStyle = '#000'; g.font = '22px serif'; g.fillText('🏟️', FIGHT_W / 2 - 12, 36);
      for (const f of [P, E]) { g.save(); g.translate(f.x + (f.atk > 0 ? f.dir * 10 : 0), f.y); g.fillStyle = '#000'; g.rotate(f.hurt > 0 ? -f.dir * 0.3 : 0); g.scale(f.dir, 1);
        if (f.hurt > 0 && f.hurt % 4 < 2) g.globalAlpha = 0.45;
        g.font = '62px serif'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(f.c.emoji, 0, Math.sin(now / 170 + f.dir) * 3);
        if (f.win) { g.scale(f.dir, 1); g.font = '26px serif'; g.fillText('👑', 0, -62); } g.restore();
        if (f.shot) { g.font = '34px serif'; g.textAlign = 'center'; g.fillText(f.c.emoji, f.shot.x, f.shot.y + 12); } }
      sparks = sparks.filter((s) => (s.t -= 1) > 0); for (const s of sparks) { g.font = '30px serif'; g.textAlign = 'center'; g.fillText(s.e, s.x, s.y); }
    };
    fightLoop = requestAnimationFrame(loop);
    msg('¡A pelear! Contestá rápido', 2000); setTimeout(ask, 1200);
  };
  const load = () => sbRpc('get_duel', { p_id: V.id, p_player: settings.playerId }).then((d) => { if (!d) throw 0; V.qs = d.questions; V.bet = d.bet; pull(); })
    .catch(() => { app.innerHTML = '<p class="muted">No encontré esa pelea.</p>'; });
  app.innerHTML = '<p class="muted">Entrando a la pelea…</p>';
  load(); flPoll = setInterval(() => { if (view !== V) return stopLive(); pull(); }, 1200);
};
const cap1 = (x) => x.charAt(0).toUpperCase() + x.slice(1);
