// Fish Catch: one pond, split down the middle. Fish spawn on a schedule
// both browsers compute themselves from a shared seed (same trick Trench
// Tanks uses for terrain) so no network traffic is needed just to show a
// fish swimming. Only the catch attempts travel the wire, and the host is
// the referee for those, same "host log, guest intent" pattern as the other
// games (see js/online.js).
window.TT = window.TT || {};
TT.Game = (function () {
  "use strict";
  const ROUND_MS = 45000;
  const TAIL_MS = 8000;     // no new spawns in the last 8s, let the pond clear
  const LANES = 4;
  const FISH_EMOJI = { 1: '🐟', 2: '🐠', 3: '🐡' };

  let phase = 'menu';   // menu | ready | play | done
  let mode = null;      // 'local' | 'bot' | null (online when TT.Online is active)
  let botLevel = 'medium';
  let scores = [0, 0];
  let seed = null;
  let fish = [];
  let roundStartedAt = null;
  let spawnTimers = [];
  let el = {};

  function now() { return performance.now(); }
  function isOnline() { return !!(window.TT.Online && TT.Online.isActive()); }
  function isAuthority() { return !isOnline() || TT.Online.myIndex() === 0; }
  function isBusy() { return false; } // catches never conflict with each other; nothing to gate

  function formatTime(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Deterministic fish schedule: same seed -> same fish, same spawn times,
  // same lanes, on every browser. Half go to each zone (id parity), so a
  // round is always an even split regardless of luck.
  function genFish(seedVal) {
    const rand = TT.Det.rng(seedVal);
    const list = [];
    const spawnEnd = ROUND_MS - TAIL_MS;
    let t = 0, id = 0;
    while (true) {
      t += 700 + rand() * 800;
      if (t >= spawnEnd) break;
      const r = rand();
      const points = r < 0.6 ? 1 : (r < 0.9 ? 2 : 3);
      list.push({
        id, zone: id % 2, lane: Math.floor(rand() * LANES), points,
        spawnT: Math.round(t), lifespan: Math.round(4500 + rand() * 2500),
        caught: false, el: null
      });
      id++;
    }
    return list;
  }

  // ---- rules ----
  // `instant` means "this is a replay of an already-committed move" (host
  // resuming after a refresh, or a guest catching up via sync) - the timing
  // window below is measured against a freshly-reset `roundStartedAt`, so it
  // can't be checked meaningfully during replay. Skip it then and trust the
  // move, since it was already validated live the first time it was committed.
  function checkMove(move, by, instant) {
    if (by !== 0 && by !== 1) return 'bad seat';
    if (move.type === 'start') {
      if (by !== 0) return 'only the host starts the round';
      if (phase !== 'ready') return 'not ready to start';
      return null;
    }
    if (move.type === 'catch') {
      if (phase !== 'play') return 'round is not active';
      const f = fish[move.id];
      if (!f) return 'no such fish';
      if (f.zone !== by) return 'not your fish';
      if (f.caught) return 'already caught';
      if (!instant) {
        const elapsed = now() - roundStartedAt;
        if (elapsed < f.spawnT - 300 || elapsed > f.spawnT + f.lifespan + 1500) return 'missed the window';
      }
      return null;
    }
    return 'unknown move';
  }

  function applyMove(move, by) {
    if (move.type === 'start') {
      seed = move.seed;
      fish = genFish(seed);
      phase = 'play';
      roundStartedAt = now();
      refreshUI();
      startSpawning();
      startTimer();
      if (mode === 'bot' && !isOnline()) fish.filter(f => f.zone === 1).forEach(scheduleBot);
    } else if (move.type === 'catch') {
      const f = fish[move.id];
      f.caught = true;
      scores[by] += f.points;
      markCaughtDOM(f);
      refreshUI();
    }
  }

  // ---- spawning & rendering (cosmetic; the schedule itself is fixed by `fish`) ----
  // `applyMove` always sets `roundStartedAt` to "now" immediately before this
  // runs (both for a live start and for an instant catch-up replay), so every
  // fish is simply scheduled relative to that fresh baseline. A guest who
  // reconnects mid-round sees the round restart locally rather than resuming
  // exactly where the host is — a known simplification, not a desync bug:
  // scores stay correct because every catch is still validated and logged.
  function startSpawning() {
    fish.forEach(f => {
      if (f.caught) return;
      spawnTimers.push(setTimeout(() => spawnFishDOM(f), f.spawnT));
    });
  }
  function spawnFishDOM(f) {
    if (f.caught || phase !== 'play') return;
    const zoneEl = f.zone === 0 ? el.zoneP1 : el.zoneP2;
    const d = document.createElement('div');
    d.className = 'fish ' + (f.zone === 0 ? 'p1' : 'p2');
    d.dataset.pts = f.points;
    d.style.top = (f.lane * (100 / LANES)) + '%';
    d.style.animationDuration = f.lifespan + 'ms';
    d.textContent = FISH_EMOJI[f.points];
    d.addEventListener('click', () => onFishClick(f));
    d.addEventListener('animationend', () => { if (d.parentNode) d.remove(); });
    zoneEl.appendChild(d);
    f.el = d;
  }
  function markCaughtDOM(f) {
    if (!f.el) return;
    f.el.classList.add('caught');
    const el2 = f.el;
    setTimeout(() => { if (el2.parentNode) el2.remove(); }, 320);
  }

  function onFishClick(f) {
    if (f.caught) return;
    tryAct({ type: 'catch', id: f.id }, f.zone);
  }
  function tryAct(move, seat) {
    if (isOnline()) {
      if (seat !== TT.Online.myIndex()) return;
      TT.Online.submit(move);
      return;
    }
    if (checkMove(move, seat)) return;
    applyMove(move, seat);
  }

  // ---- bot (seat 1, local play only) ----
  function scheduleBot(f) {
    const [minD, maxD] = { easy: [2800, 5500], medium: [1200, 2800], hard: [300, 1300] }[botLevel] || [1200, 2800];
    const missChance = { easy: 0.5, medium: 0.25, hard: 0.08 }[botLevel] || 0.25;
    const reaction = minD + Math.random() * (maxD - minD);
    if (reaction >= f.lifespan) return; // too slow to ever make it
    spawnTimers.push(setTimeout(() => {
      if (f.caught || phase !== 'play' || Math.random() < missChance) return;
      const move = { type: 'catch', id: f.id };
      if (!checkMove(move, 1)) applyMove(move, 1);
    }, f.spawnT + reaction));
  }

  // ---- timer ----
  function startTimer() {
    clearInterval(el.timerInterval);
    function tick() {
      const remain = Math.max(0, ROUND_MS - (now() - roundStartedAt));
      if (el.timer) el.timer.textContent = formatTime(remain);
      if (remain <= 0) { clearInterval(el.timerInterval); endRound(); }
    }
    tick();
    el.timerInterval = setInterval(tick, 250);
  }
  function endRound() {
    spawnTimers.forEach(clearTimeout); spawnTimers = [];
    phase = 'done';
    refreshUI();
  }

  // ---- screens ----
  function label(seat) { return isOnline() ? `Player ${seat + 1}${TT.Online.myIndex() === seat ? ' (you)' : ''}` : `Player ${seat + 1}`; }

  function clearPond() {
    if (el.zoneP1) el.zoneP1.innerHTML = '';
    if (el.zoneP2) el.zoneP2.innerHTML = '';
  }

  function resetAll() {
    clearInterval(el.timerInterval);
    spawnTimers.forEach(clearTimeout); spawnTimers = [];
    phase = 'ready'; scores = [0, 0]; seed = null; fish = []; roundStartedAt = null;
    showPlay();
  }

  function showMenu() {
    mode = null;
    clearInterval(el.timerInterval);
    spawnTimers.forEach(clearTimeout); spawnTimers = [];
    el.modeScreen.hidden = false; el.playScreen.hidden = true; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'menu';
  }
  function showPlay() {
    el.modeScreen.hidden = true; el.playScreen.hidden = false; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'play';
    clearPond();
    if (el.timer) el.timer.textContent = formatTime(ROUND_MS);
    refreshUI();
  }
  function showDone() {
    el.modeScreen.hidden = true; el.playScreen.hidden = true; el.doneScreen.hidden = false;
    document.body.dataset.screen = 'done';
    el.finalP1.textContent = scores[0]; el.finalP2.textContent = scores[1];
    el.resultTitle.textContent = scores[0] === scores[1] ? 'Draw' :
      (scores[0] > scores[1] ? `${label(0)} wins` : `${label(1)} wins`);
    el.rematchBtn.hidden = isOnline();
  }

  function startLocal() { mode = 'local'; resetAll(); }
  function startBot(level) { mode = 'bot'; botLevel = level; resetAll(); }

  function clickStart() {
    if (phase !== 'ready' || !isAuthority()) return;
    const move = { type: 'start', seed: TT.Det.newSeed() };
    if (isOnline()) TT.Online.submit(move);
    else if (!checkMove(move, 0)) applyMove(move, 0);
  }

  function refreshUI() {
    if (!el.scoreP1) return;
    if (phase === 'done') { showDone(); return; }
    el.scoreP1.textContent = scores[0];
    el.scoreP2.textContent = scores[1];
    el.startBtn.hidden = phase !== 'ready';
    el.startBtn.disabled = !isAuthority();
    if (phase === 'ready') {
      el.prompt.textContent = isAuthority() ? 'Click Start when ready.' : 'Waiting for the host to start…';
    } else if (phase === 'play') {
      el.prompt.textContent = 'Tap the fish on your side.';
    }
  }

  function setOnIdle() { /* catches never need to be queued/gated, nothing to idle on */ }

  function init() {
    el = {
      modeScreen: document.getElementById('modeScreen'),
      playScreen: document.getElementById('playScreen'),
      doneScreen: document.getElementById('doneScreen'),
      modeLocal: document.getElementById('modeLocal'),
      modeOnline: document.getElementById('modeOnline'),
      joinForm: document.getElementById('joinForm'),
      joinInput: document.getElementById('joinInput'),
      joinNote: document.getElementById('joinNote'),
      scoreP1: document.getElementById('scoreP1'),
      scoreP2: document.getElementById('scoreP2'),
      timer: document.getElementById('timer'),
      prompt: document.getElementById('prompt'),
      zoneP1: document.getElementById('zoneP1'),
      zoneP2: document.getElementById('zoneP2'),
      startBtn: document.getElementById('startBtn'),
      resultTitle: document.getElementById('resultTitle'),
      finalP1: document.getElementById('finalP1'),
      finalP2: document.getElementById('finalP2'),
      rematchBtn: document.getElementById('rematchBtn'),
      timerInterval: null
    };
    el.modeLocal.addEventListener('click', startLocal);
    document.querySelectorAll('.levelBtn').forEach(b => b.addEventListener('click', () => startBot(b.dataset.bot)));
    el.modeOnline.addEventListener('click', () => TT.Online.createGame());
    el.joinForm.addEventListener('submit', e => {
      e.preventDefault();
      const v = el.joinInput.value.trim();
      if (!v) return;
      try {
        const u = new URL(v, location.href);
        if (!u.searchParams.get('room')) throw new Error('no room');
        location.href = u.toString();
      } catch (err) { el.joinNote.textContent = "That doesn't look like a room link."; }
    });
    document.querySelectorAll('.menuBtn').forEach(b => b.addEventListener('click', () => {
      if (isOnline()) return;
      showMenu();
    }));
    el.startBtn.addEventListener('click', clickStart);
    el.rematchBtn.addEventListener('click', () => { if (!isOnline()) resetAll(); });
    showMenu();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { checkMove, applyMove, resetAll, refreshUI, showMenu, showPlay, setOnIdle, isBusy, isOnline };
})();
