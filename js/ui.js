// UI: the combat interface around the game. It LISTENS to the game (TT.Bus)
// and redraws the HUD from TT.Game.state(). When the player uses a dial or the
// weapon bay it writes the value into the game's own <input>/<select> and fires
// the normal 'input'/'change' event, so the game logic is the same as before.
window.TT = window.TT || {};
TT.UI = (function () {
  "use strict";
  const Bus = TT.Bus, Art = TT.Art;
  const $ = id => document.getElementById(id);
  const weaponById = id => TT.WEAPONS.find(w => w.id === id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const state = () => TT.Game.state();
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let el = {};

  // Restart a CSS animation that is tied to a class.
  function replay(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }
  function play(name, opts) { if (TT.Audio) TT.Audio.play(name, opts); }

  // ---------------------------------------------------------------- boot --
  function initBoot() {
    // This click is also what lets the browser start audio (mute is in Audio settings).
    $('bootStart').addEventListener('click', () => {
      TT.Audio.unlock();
      document.body.classList.add('booted');
      Bus.emit('booted', { sound: true });
    });
  }

  // ------------------------------------------------------------ command --
  function initMenu() {
    // real numbers from the bot's settings, shown under each difficulty
    document.querySelectorAll('[data-level-info]').forEach(node => {
      const level = TT.Bot.LEVELS[node.dataset.levelInfo];
      if (level) node.textContent = `aim ±${level.angleError}°`;
    });

    // cards lean toward the pointer
    document.querySelectorAll('.modeCard').forEach(card => {
      card.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        const r = card.getBoundingClientRect();
        const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
        card.style.setProperty('--ry', ((u - 0.5) * 9).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - v) * 7).toFixed(2) + 'deg');
        card.style.setProperty('--mx', (u * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (v * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });

    // join an online game by pasting its link (same as opening the link)
    $('joinForm').addEventListener('submit', e => {
      e.preventDefault();
      const found = $('joinInput').value.match(UUID_RE);
      if (!found) {
        $('joinNote').textContent = 'That is not a room link. Paste the whole link the host sent you.';
        play('deny');
        return;
      }
      $('joinNote').textContent = '';
      const url = new URL(location.href);
      url.search = '?room=' + found[0].toLowerCase();
      url.hash = '';
      location.href = url.toString();
    });
  }

  // ------------------------------------------------------------ armoury --
  let inspected = null;
  function inspect(id) {
    const w = weaponById(id);
    if (!w || inspected === id) return;
    inspected = id;
    const cat = Art.category(w.category), pts = Art.maxPoints(w);
    $('inspector').style.setProperty('--wcolor', cat.color);
    $('inspClass').textContent = cat.name;
    $('inspName').textContent = w.name;
    $('inspDesc').textContent = w.desc;
    $('inspBlast').textContent = w.radius ? w.radius + ' px' : 'none';
    $('inspBlastBar').style.width = (w.radius / Art.BIGGEST_RADIUS * 100) + '%';
    $('inspPts').textContent = pts ? pts + ' pts' : 'none';
    $('inspPtsBar').style.width = pts + '%';
    $('inspPayload').textContent = Art.payload(w);
    if (TT.Holo) TT.Holo.preview(w, cat.color);
  }

  function initArmory() {
    const pool = $('weaponPool');
    const over = e => { const card = e.target.closest('.weaponCard'); if (card) inspect(card.dataset.id); };
    pool.addEventListener('pointerover', over);
    pool.addEventListener('focusin', over);
    $('uplinkCopy').addEventListener('click', () => {
      $('copyBtn').click();
      $('uplinkCopy').textContent = 'Link copied';
      setTimeout(() => { $('uplinkCopy').textContent = 'Copy room link'; }, 1500);
    });
    ['loadP1', 'loadP2'].forEach(id => {
      const slots = $(id).querySelector('.slots');
      for (let i = 0; i < 10; i++) slots.appendChild(Object.assign(document.createElement('div'), { className: 'slot' }));
    });
  }

  function renderDraft() {
    const s = state();
    document.body.dataset.online = s.online ? '1' : '0';
    if (s.phase === 'draft' && s.draftTurn !== null) document.body.dataset.pick = s.draftTurn;
    else delete document.body.dataset.pick;
    $('missionTag').textContent = s.online ? 'Online combat'
      : s.mode === 'bot' ? `AI combat · ${TT.Bot.LEVELS[s.botLevel].name}` : 'Local combat';

    ['loadP1', 'loadP2'].forEach((id, i) => {
      const box = $(id), list = s.inventory[i];
      box.querySelector('.loadName').textContent = s.labels[i];
      box.querySelector('.loadCount').textContent = `${list.length}/10`;
      box.querySelectorAll('.slot').forEach((slot, j) => {
        const wid = list[j] || '';
        if (slot.dataset.id === wid) return; // unchanged: don't replay its animation
        slot.dataset.id = wid;
        slot.classList.toggle('full', !!wid);
        const w = wid && weaponById(wid);
        slot.innerHTML = w ? Art.glyph(wid) : '';
        slot.title = w ? w.name : '';
        if (w) slot.style.setProperty('--wcolor', Art.category(w.category).color);
      });
    });
  }

  // ---------------------------------------------------------------- HUD --
  const shown = [0, 0]; // score currently displayed, counts up to the real one
  function showScore(i, target) {
    const node = el.scoreNum[i];
    if (shown[i] === target) return; // already there, or counting up to it
    if (target < shown[i]) { shown[i] = target; node.textContent = target; return; } // new round
    const from = shown[i], t0 = performance.now();
    shown[i] = target;
    replay(node, 'bump');
    (function step(now) {
      if (shown[i] !== target) return; // a newer score took over
      const k = Math.min(1, (now - t0) / 600);
      node.textContent = Math.round(from + (target - from) * (1 - (1 - k) * (1 - k)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // A row of `count` segments; those from `left` onward are marked as used up.
  function segments(node, count, left, extra) {
    if (node.children.length !== count) {
      node.innerHTML = '';
      for (let i = 0; i < count; i++) node.appendChild(document.createElement('i'));
    }
    [...node.children].forEach((seg, i) => {
      seg.className = extra ? extra(i) : (i >= left ? 'spent' : '');
    });
  }

  function renderHud() {
    const s = state();
    document.body.dataset.online = s.online ? '1' : '0';
    if (s.phase !== 'battle') return;
    const b = document.body;
    b.dataset.turn = s.current;
    s.myTurn ? b.dataset.myturn = '1' : delete b.dataset.myturn;
    s.gameOver ? b.dataset.over = '1' : delete b.dataset.over;

    [0, 1].forEach(i => {
      showScore(i, s.scores[i]);
      segments(el.ammo[i], s.loadout[i].length || 10, s.inventory[i].length);
      el.ammo[i].setAttribute('aria-label', `${s.inventory[i].length} shells left`);
    });
    const fired = s.loadout[0].length + s.loadout[1].length - s.inventory[0].length - s.inventory[1].length;
    segments($('shotTrack'), s.total, 0, i => i < fired ? 'done' : (i === fired && !s.gameOver ? 'now' : ''));
    segments($('drivePips'), s.maxDrives, s.drives[s.current]);

    if (s.tanks) {
      const me = s.tanks[s.current], them = s.tanks[1 - s.current];
      const alt = Math.round(me.y - them.y); // + = the target sits higher than you
      $('telRange').textContent = Math.round(Math.abs(them.x - me.x)) + ' px';
      $('telAlt').textContent = (alt > 0 ? '+' : '') + alt + ' px';
    }
    syncAim();
    renderWeapon();
  }

  // ---- dials: mirror the game's hidden sliders ----
  function syncAim() {
    const s = state();
    const angle = Number(el.angle.value), power = Number(el.power.value);
    $('angleArc').style.strokeDasharray = `${angle} 180`;
    $('angleNeedle').setAttribute('transform', `rotate(${-angle} 60 62)`);
    // the dial mirrors with the unit, so the needle always matches its barrel
    el.angleDial.querySelector('.dialFlip').setAttribute('transform', s.dir === -1 ? 'translate(120 0) scale(-1 1)' : '');
    $('powerArc').style.strokeDasharray = `${power - 10} 90`;
    el.angleDial.setAttribute('aria-valuenow', angle);
    el.powerDial.setAttribute('aria-valuenow', power);
    el.angleDial.classList.toggle('off', el.angle.disabled);
    el.powerDial.classList.toggle('off', el.power.disabled);
    el.angleDial.querySelectorAll('.nudge').forEach(n => { n.disabled = el.angle.disabled; });
    el.powerDial.querySelectorAll('.nudge').forEach(n => { n.disabled = el.power.disabled; });
  }

  function setInput(input, value) {
    if (input.disabled) return;
    const v = clamp(Math.round(value), Number(input.min), Number(input.max));
    if (v === Number(input.value)) return;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Drag (or scroll) on a dial. toValue(dx, dy) gets the pointer's offset
  // from the dial's centre, with dy pointing up.
  function bindDial(dial, input, toValue) {
    const svg = dial.querySelector('svg');
    let dragging = false;
    const fromPointer = e => {
      const r = svg.getBoundingClientRect();
      setInput(input, toValue(e.clientX - (r.left + r.width / 2), (r.top + r.height * 62 / 70) - e.clientY));
    };
    dial.addEventListener('pointerdown', e => {
      if (e.target.closest('.nudge') || input.disabled) return;
      dragging = true;
      dial.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    dial.addEventListener('pointermove', e => { if (dragging) fromPointer(e); });
    const stop = () => { dragging = false; };
    dial.addEventListener('pointerup', stop);
    dial.addEventListener('pointercancel', stop);
    dial.addEventListener('wheel', e => {
      if (input.disabled) return;
      e.preventDefault();
      setInput(input, Number(input.value) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });

    // +/- buttons: one step per press, repeating while held
    dial.querySelectorAll('.nudge').forEach(btn => {
      const step = Number(btn.dataset.step);
      let timer = null;
      const nudge = () => setInput(input, Number(input.value) + step);
      const release = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        nudge();
        release();
        timer = setTimeout(() => { timer = setInterval(nudge, 55); }, 320);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, release));
      btn.addEventListener('click', e => { if (e.detail === 0) nudge(); }); // keyboard
    });
  }

  // Upper half-plane angle of the pointer, 0 (right) .. 180 (left).
  function halfAngle(dx, dy) {
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    return a < 0 ? (dx >= 0 ? 0 : 180) : a;
  }

  // ---- weapon bay: mirrors the game's hidden <select> ----
  let shownWeapon = null;
  function weaponIds() { return [...el.weaponSelect.options].map(o => o.value); }

  function renderWeapon() {
    const ids = weaponIds(), id = el.weaponSelect.value, w = weaponById(id);
    const off = el.weaponSelect.disabled || !ids.length;
    el.wpnCard.disabled = off;
    $('wpnPrev').disabled = $('wpnNext').disabled = off || ids.length < 2;
    $('wpnCount').textContent = ids.length;
    if (off) closeTray();
    if (!w) {
      $('wpnName').textContent = 'Magazine empty';
      $('wpnMeta').textContent = 'No weapons left';
      $('wpnGlyph').innerHTML = '';
      shownWeapon = null;
      return;
    }
    const cat = Art.category(w.category), pts = Art.maxPoints(w);
    el.wpnCard.style.setProperty('--wcolor', cat.color);
    $('wpnName').textContent = w.name;
    $('wpnMeta').textContent = `Blast ${w.radius} · ${pts ? pts + ' pts' : 'no score'} · ${Art.payload(w)}`;
    el.wpnCard.title = `${cat.name}: ${w.desc}`;
    if (shownWeapon !== id) {
      shownWeapon = id;
      $('wpnGlyph').innerHTML = Art.glyph(id);
      replay($('wpnGlyph'), 'swap');
    }
    if (!el.wpnTray.hidden) renderTray();
  }

  function chooseWeapon(id) {
    if (el.weaponSelect.disabled || el.weaponSelect.value === id) return;
    el.weaponSelect.value = id;
    el.weaponSelect.dispatchEvent(new Event('change', { bubbles: true }));
    play('weapon');
    renderWeapon();
  }
  function stepWeapon(dir) {
    const ids = weaponIds();
    if (ids.length < 2) return;
    chooseWeapon(ids[(ids.indexOf(el.weaponSelect.value) + dir + ids.length) % ids.length]);
  }

  function renderTray() {
    el.wpnTray.innerHTML = '';
    weaponIds().forEach(id => {
      const w = weaponById(id), cat = Art.category(w.category), pts = Art.maxPoints(w);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wpnChip';
      chip.dataset.snd = 'none';
      chip.setAttribute('role', 'option');
      chip.setAttribute('aria-selected', id === el.weaponSelect.value);
      chip.style.setProperty('--wcolor', cat.color);
      chip.innerHTML = `${Art.glyph(id)}<b></b><i></i>`;
      chip.querySelector('b').textContent = w.name;
      chip.querySelector('i').textContent = pts ? pts : '—';
      chip.title = `${cat.name}: ${w.desc}`;
      chip.addEventListener('click', () => { chooseWeapon(id); closeTray(); });
      el.wpnTray.appendChild(chip);
    });
  }
  function openTray() {
    if (el.wpnCard.disabled) return;
    renderTray();
    el.wpnTray.hidden = false;
    el.wpnCard.setAttribute('aria-expanded', 'true');
  }
  function closeTray() {
    if (el.wpnTray.hidden) return;
    el.wpnTray.hidden = true;
    el.wpnCard.setAttribute('aria-expanded', 'false');
  }

  function initConsole() {
    bindDial(el.angleDial, el.angle, (dx, dy) => halfAngle(state().dir === -1 ? -dx : dx, dy));
    bindDial(el.powerDial, el.power, (dx, dy) => 10 + (180 - halfAngle(dx, dy)) / 180 * 90);
    el.wpnCard.addEventListener('click', () => (el.wpnTray.hidden ? openTray() : closeTray()));
    $('wpnPrev').addEventListener('click', () => stepWeapon(-1));
    $('wpnNext').addEventListener('click', () => stepWeapon(1));
    document.addEventListener('pointerdown', e => {
      if (!el.wpnTray.hidden && !e.target.closest('.consWeapon')) closeTray();
    });

    // the sky drifts a little against the pointer (parallax)
    const stage = $('stage'), world = $('world');
    let queued = false, px = 0, py = 0;
    stage.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = stage.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5;
      py = (e.clientY - r.top) / r.height - 0.5;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        world.style.setProperty('--px', px.toFixed(3));
        world.style.setProperty('--py', py.toFixed(3));
      });
    });
  }

  // Shake the battlefield (never the HUD) and flash where a big blast lands.
  function onImpact({ weapon, spots }) {
    const world = $('world'), v = state().view;
    world.style.setProperty('--shake', Math.min(11, 2 + weapon.radius / 7).toFixed(1) + 'px');
    replay(world, 'shake');
    if (weapon.category === 'attacker' || weapon.id === 'comet') {
      const flash = $('impactFlash');
      flash.style.setProperty('--fx', ((v.ox + spots[0].x * v.scale) / v.w * 100).toFixed(1) + '%');
      flash.style.setProperty('--fy', ((v.oy + spots[0].y * v.scale) / v.h * 100).toFixed(1) + '%');
      replay(flash, 'go');
    }
  }

  // ------------------------------------------------------------ debrief --
  // Per-round numbers, counted from the game's own fire / score events.
  let stats = [];
  function resetStats() { stats = [0, 1].map(() => ({ shots: 0, scoring: 0, direct: 0, best: 0, total: 0 })); }
  resetStats();

  function renderDebrief({ winner, scores, solo, won }) {
    const s = state();
    const banner = $('banner'), title = $('resultTitle');
    const draw = winner === -1;
    banner.dataset.result = draw ? 'draw' : solo ? (won ? 'win' : 'lose') : 'p' + (winner + 1);
    $('resultKicker').textContent = draw ? 'Stalemate' : solo && !won ? 'Mission failed' : 'Mission complete';
    title.textContent = draw ? 'Draw' : solo ? (won ? 'Victory' : 'Defeat') : `${s.labels[winner]} wins`;
    title.style.fontSize = title.textContent.length > 8 ? 'clamp(1.5rem,5.4vw,2.8rem)' : '';
    ['resultP1', 'resultP2'].forEach((id, i) => {
      const st = stats[i], col = $(id);
      col.classList.toggle('winner', winner === i);
      col.innerHTML = '<h3></h3><div class="big"></div><dl>' +
        '<dt>Scoring shots</dt><dd></dd><dt>Direct hits</dt><dd></dd><dt>Best shot</dt><dd></dd><dt>Average per shot</dt><dd></dd></dl>';
      col.querySelector('h3').textContent = s.labels[i];
      col.querySelector('.big').textContent = scores[i];
      const dd = col.querySelectorAll('dd');
      dd[0].textContent = `${st.scoring} / ${st.shots}`;
      dd[1].textContent = st.direct;
      dd[2].textContent = st.best ? '+' + st.best : '—';
      dd[3].textContent = st.shots ? Math.round(st.total / st.shots) : '—';
    });
  }

  // ----------------------------------------------------- uplink + comms --
  const NET_TITLES = {
    waiting: 'Awaiting opponent', connecting: 'Establishing uplink',
    disconnected: 'Uplink lost', error: 'Uplink error', connected: 'Uplink established'
  };
  function onNet({ state: net, text, role }) {
    document.body.dataset.net = net;
    document.body.dataset.role = role || '';
    document.body.dataset.online = role ? '1' : '0';
    $('uplinkTitle').textContent = NET_TITLES[net] || '';
    $('uplinkText').textContent = text || '';
  }

  function initChat() {
    const chat = $('chat'), toggle = $('chatToggle');
    toggle.addEventListener('click', () => {
      const collapsed = chat.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      if (!collapsed) $('chatUnread').hidden = true;
    });
    Bus.on('chat', ({ who }) => {
      if (who === 'Opponent' && chat.classList.contains('collapsed')) $('chatUnread').hidden = false;
    });
  }

  // ----------------------------------------------------------- settings --
  function initSettings() {
    const A = TT.Audio, panel = $('settings');
    const rows = [['volMaster', 'master'], ['volMusic', 'music'], ['volSfx', 'sfx']];
    const refresh = () => {
      const p = A.prefs();
      rows.forEach(([id, key]) => {
        $(id).value = Math.round(p[key] * 100);
        $(id + 'Out').textContent = Math.round(p[key] * 100);
      });
      $('muteBtn').setAttribute('aria-pressed', String(p.muted));
      $('muteBtn').textContent = p.muted ? 'Unmute' : 'Mute all';
      $('enableAudioBtn').hidden = A.isUnlocked();
      $('audioState').textContent = !A.isUnlocked() ? 'Audio is off. Turn it on to hear the range.'
        : p.muted ? 'Audio is muted.' : 'Audio is on. All sound is synthesised live in your browser.';
      document.body.dataset.audio = A.isUnlocked() && !p.muted ? 'on' : 'off';
    };
    rows.forEach(([id, key]) => $(id).addEventListener('input', () => {
      A.setVolume(key, Number($(id).value) / 100);
      refresh();
      if (key !== 'music') play('tick', { value: Number($(id).value) / 100 });
    }));
    $('muteBtn').addEventListener('click', () => { A.setMuted(!A.prefs().muted); refresh(); play('click'); });
    $('enableAudioBtn').addEventListener('click', () => { A.unlock(); refresh(); });
    const open = () => { refresh(); panel.hidden = false; $('settingsClose').focus(); };
    const close = () => { panel.hidden = true; };
    document.querySelectorAll('.audioBtn').forEach(btn => btn.addEventListener('click', open));
    $('settingsClose').addEventListener('click', close);
    panel.addEventListener('pointerdown', e => { if (e.target === panel) close(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!panel.hidden) close(); else closeTray();
    });
    Bus.on('audio', refresh);
    refresh();
  }

  // ---------------------------------------------------------------- init --
  function init() {
    el = {
      angle: $('angle'), power: $('power'), weaponSelect: $('weaponSelect'),
      angleDial: $('angleDial'), powerDial: $('powerDial'),
      wpnCard: $('wpnCard'), wpnTray: $('wpnTray'),
      scoreNum: [$('scoreNumP1'), $('scoreNumP2')],
      ammo: [$('ammoP1'), $('ammoP2')]
    };
    initBoot();
    initMenu();
    initArmory();
    initConsole();
    initChat();
    initSettings();
  }

  // The game tells us what happened; we only redraw.
  Bus.on('screen', ({ changed }) => { if (changed) replay($('wipe'), 'go'); closeTray(); });
  Bus.on('draft', renderDraft);
  Bus.on('pick', ({ id, mine }) => { if (mine) inspect(id); });
  Bus.on('hud', renderHud);
  Bus.on('aim', () => { syncAim(); renderWeapon(); });
  Bus.on('round', () => {
    resetStats();
    shown[0] = shown[1] = 0;
    el.scoreNum.forEach(node => { node.textContent = '0'; });
  });
  Bus.on('fire', ({ by }) => { stats[by].shots++; closeTray(); });
  Bus.on('score', ({ by, points, direct }) => {
    const st = stats[by];
    st.total += points;
    if (points > 0) st.scoring++;
    if (direct) st.direct++;
    st.best = Math.max(st.best, points);
  });
  Bus.on('turn', ({ changed, quiet }) => { if (changed && !quiet) replay($('turnInfo'), 'swap'); });
  Bus.on('impact', onImpact);
  Bus.on('gameover', renderDebrief);
  Bus.on('net', onNet);

  document.addEventListener('DOMContentLoaded', init);

  return { inspect };
})();
