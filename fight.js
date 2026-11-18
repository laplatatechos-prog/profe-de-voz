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
      ${me ? '<button class="block soft" id="rndRival" style="margin-top:10px">🎲 Rival sorpresa</button>' : ''}</div>
    ${LEVELS.map((l, li) => `<h2>${l.min >= 6 ? '🌟' : '🌱'} Nota ${fmt(l.min)}</h2><div class="char-grid">${l.chars.map((c) => `<button class="char-card" data-pick="${esc(c[0])}"><span class="char-emoji">${c[2]}</span><span>${esc(c[0])}</span></button>`).join('')}</div>`).join('')}`;
  app.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => {
    const n = b.dataset.pick; audioCtx(); playSfx(charByName(n).sound, true);
    if (!me) go('fightSelect', { me: n }); else go('fight', { a: me.name, b: n });
  });
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
