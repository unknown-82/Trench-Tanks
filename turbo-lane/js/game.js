// Turbo Lane: three lanes, dodge the traffic, survive 40 seconds.
//
// Unlike the other two games, a car's fate never depends on the other
// player's actions at all (no shared resource between the two tracks), so
// lane-changes never need to cross the network. Each browser is fully
// authoritative for the car it controls and only ever reports the final
// outcome ({type:'result'}) once that car crashes or finishes. The host
// still keeps the official log of those two results, same pattern as the
// other games (see js/online.js) - there's just much less to log here.
window.TT = window.TT || {};
TT.Game = (function () {
  "use strict";
  const RACE_MS = 40000;
  const TRAVEL_MS = 1800;  // time an obstacle takes to reach the car's row
  const LANES = 3;

  let phase = 'menu';   // menu | ready | race | done
  let mode = null;      // 'local' | 'bot' | null (online when TT.Online is active)
  let botLevel = 'medium';
  let seed = null;
  let obstacles = [];
  let carLane = [1, 1];
  let result = [null, null];
  let raceStartedAt = null;
  let raceTimers = [];
  let el = {};

  function now() { return performance.now(); }
  function isOnline() { return !!(window.TT.Online && TT.Online.isActive()); }
  function isAuthority() { return !isOnline() || TT.Online.myIndex() === 0; }
  function isBusy() { return false; } // results never conflict with each other

  // The seats THIS browser drives and detects crashes for: both, for
  // local/bot play; just my own, online (each player is on their own device).
  function controlledSeats() { return isOnline() ? [TT.Online.myIndex()] : [0, 1]; }

  function genObstacles(seedVal) {
    const rand = TT.Det.rng(seedVal);
    const list = [];
    let t = 1200, id = 0;
    while (t < RACE_MS - 1000) {
      t += 550 + rand() * 500;
      list.push({ id, t: Math.round(t), lane: Math.floor(rand() * LANES) });
      id++;
    }
    return list;
  }

  // ---- rules ----
  function checkMove(move, by) {
    if (by !== 0 && by !== 1) return 'bad seat';
    if (move.type === 'start') {
      if (by !== 0) return 'only the host starts the race';
      if (phase !== 'ready') return 'not ready to start';
      return null;
    }
    if (move.type === 'result') {
      if (phase !== 'race') return 'race is not active';
      if (result[by]) return 'already reported';
      return null;
    }
    return 'unknown move';
  }

  function applyMove(move, by) {
    if (move.type === 'start') {
      seed = move.seed;
      obstacles = genObstacles(seed);
      phase = 'race';
      raceStartedAt = now();
      carLane = [1, 1]; result = [null, null];
      setupTrack();
      refreshUI();
    } else if (move.type === 'result') {
      result[by] = { outcome: move.outcome, ms: move.ms };
      if (controlledSeats().includes(by)) {
        if (move.outcome === 'crash' && el.cars[by]) el.cars[by].classList.add('crashed');
      } else if (el.remoteNote) {
        el.remoteNote.textContent = move.outcome === 'crash' ?
          `Opponent crashed at ${(move.ms / 1000).toFixed(1)}s` : 'Opponent finished!';
      }
      refreshUI();
      if (result[0] && result[1]) endRace();
    }
  }

  function reportResult(seat, outcome, ms) {
    if (result[seat]) return;
    tryAct({ type: 'result', outcome, ms }, seat);
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

  // ---- track setup (cosmetic obstacles both sides; crash-detection only for controlled seats) ----
  // `applyMove` always sets `raceStartedAt` to "now" immediately before this
  // runs, whether this is a live start or an instant catch-up replay, so
  // every obstacle is simply scheduled relative to that fresh baseline. A
  // guest who reconnects mid-race sees the race restart locally rather than
  // resuming exactly where the host is - a known simplification, not a
  // desync bug: each car's fate never depends on the other player anyway,
  // and the final result is still validated and logged by the host.
  function setupTrack() {
    clearTracks();
    ensureCars();
    obstacles.forEach(o => {
      raceTimers.push(setTimeout(() => spawnObstacleDOM(o, 0), o.t));
      raceTimers.push(setTimeout(() => spawnObstacleDOM(o, 1), o.t));
    });
    controlledSeats().forEach(seat => {
      obstacles.forEach(o => {
        raceTimers.push(setTimeout(() => {
          if (phase !== 'race' || result[seat]) return;
          if (carLane[seat] === o.lane) reportResult(seat, 'crash', Math.round(now() - raceStartedAt));
        }, o.t + TRAVEL_MS));
      });
      raceTimers.push(setTimeout(() => {
        if (phase !== 'race' || result[seat]) return;
        reportResult(seat, 'finish', RACE_MS);
      }, RACE_MS));
      if (mode === 'bot' && !isOnline() && seat === 1) scheduleBot();
    });
  }

  function scheduleBot() {
    const cfg = { easy: { lead: 150, miss: 0.55 }, medium: { lead: 450, miss: 0.22 }, hard: { lead: 850, miss: 0.06 } }[botLevel]
      || { lead: 450, miss: 0.22 };
    obstacles.forEach(o => {
      const decideAt = o.t - cfg.lead;
      if (decideAt < 0) return;
      raceTimers.push(setTimeout(() => {
        if (phase !== 'race' || result[1]) return;
        if (carLane[1] === o.lane && Math.random() >= cfg.miss) {
          const choices = [0, 1, 2].filter(l => l !== o.lane);
          carLane[1] = choices[Math.floor(Math.random() * choices.length)];
          renderCar(1);
        }
      }, decideAt));
    });
  }

  function clearTracks() { el.trackP1.querySelectorAll('.obstacle,.car,.remoteNote').forEach(n => n.remove()); el.trackP2.querySelectorAll('.obstacle,.car,.remoteNote').forEach(n => n.remove()); }
  function ensureCars() {
    el.cars = [null, null];
    el.remoteNote = null;
    const mine = controlledSeats();
    [0, 1].forEach(seat => {
      const track = seat === 0 ? el.trackP1 : el.trackP2;
      if (mine.includes(seat)) {
        const d = document.createElement('div');
        d.className = 'car';
        d.textContent = '🏎️';
        track.appendChild(d);
        el.cars[seat] = d;
        renderCar(seat);
      } else {
        const note = document.createElement('div');
        note.className = 'remoteNote';
        note.style.display = 'flex';
        note.textContent = 'Opponent racing…';
        track.appendChild(note);
        el.remoteNote = note;
      }
    });
  }
  function renderCar(seat) {
    const d = el.cars[seat];
    if (d) d.style.left = ((carLane[seat] + 0.5) / LANES * 100) + '%';
  }
  function spawnObstacleDOM(o, zone) {
    if (phase !== 'race') return;
    const track = zone === 0 ? el.trackP1 : el.trackP2;
    const d = document.createElement('div');
    d.className = 'obstacle';
    d.style.left = ((o.lane + 0.5) / LANES * 100) + '%';
    d.style.animationDuration = Math.round(TRAVEL_MS * 1.15) + 'ms';
    d.textContent = '🚧';
    d.addEventListener('animationend', () => { if (d.parentNode) d.remove(); });
    track.appendChild(d);
  }

  // ---- input ----
  function changeLane(seat, dir) {
    if (phase !== 'race' || result[seat]) return;
    carLane[seat] = Math.max(0, Math.min(LANES - 1, carLane[seat] + dir));
    renderCar(seat);
  }
  function onKeydown(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (phase !== 'race') return;
    let seat = null, dir = 0;
    if (mode === 'local' && !isOnline()) {
      if (e.key === 'a' || e.key === 'A') { seat = 0; dir = -1; }
      else if (e.key === 'd' || e.key === 'D') { seat = 0; dir = 1; }
      else if (e.key === 'ArrowLeft') { seat = 1; dir = -1; }
      else if (e.key === 'ArrowRight') { seat = 1; dir = 1; }
    } else {
      const mySeat = isOnline() ? TT.Online.myIndex() : 0;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { seat = mySeat; dir = -1; }
      else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { seat = mySeat; dir = 1; }
    }
    if (seat == null || !controlledSeats().includes(seat)) return;
    changeLane(seat, dir);
  }

  // ---- screens ----
  function label(seat) { return isOnline() ? `Player ${seat + 1}${TT.Online.myIndex() === seat ? ' (you)' : ''}` : `Player ${seat + 1}`; }
  function outcomeLabel(r) {
    if (!r) return '—';
    return r.outcome === 'crash' ? `Crashed at ${(r.ms / 1000).toFixed(1)}s` : `Finished (${(r.ms / 1000).toFixed(1)}s)`;
  }
  function computeWinnerText() {
    const r0 = result[0], r1 = result[1];
    if (!r0 || !r1) return 'Race complete';
    if (r0.outcome === 'finish' && r1.outcome === 'finish') return 'Draw — both finished';
    if (r0.outcome === 'finish') return `${label(0)} wins`;
    if (r1.outcome === 'finish') return `${label(1)} wins`;
    if (r0.ms === r1.ms) return 'Draw';
    return r0.ms > r1.ms ? `${label(0)} wins` : `${label(1)} wins`;
  }

  function resetAll() {
    clearInterval(el.timerInterval);
    raceTimers.forEach(clearTimeout); raceTimers = [];
    phase = 'ready'; seed = null; obstacles = []; carLane = [1, 1]; result = [null, null]; raceStartedAt = null;
    showPlay();
  }
  function showMenu() {
    mode = null;
    clearInterval(el.timerInterval);
    raceTimers.forEach(clearTimeout); raceTimers = [];
    el.modeScreen.hidden = false; el.playScreen.hidden = true; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'menu';
  }
  function showPlay() {
    el.modeScreen.hidden = true; el.playScreen.hidden = false; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'play';
    clearTracks();
    if (el.timer) el.timer.textContent = '0:40';
    refreshUI();
  }
  function showDone() {
    el.modeScreen.hidden = true; el.playScreen.hidden = true; el.doneScreen.hidden = false;
    document.body.dataset.screen = 'done';
    el.finalP1.textContent = outcomeLabel(result[0]);
    el.finalP2.textContent = outcomeLabel(result[1]);
    el.resultTitle.textContent = computeWinnerText();
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

  function startTimer() {
    clearInterval(el.timerInterval);
    function tick() {
      if (phase !== 'race') { clearInterval(el.timerInterval); return; }
      const remain = Math.max(0, RACE_MS - (now() - raceStartedAt));
      const s = Math.ceil(remain / 1000);
      el.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if (remain <= 0) clearInterval(el.timerInterval);
    }
    tick();
    el.timerInterval = setInterval(tick, 250);
  }
  function endRace() {
    raceTimers.forEach(clearTimeout); raceTimers = [];
    clearInterval(el.timerInterval);
    phase = 'done';
    refreshUI();
  }

  function refreshUI() {
    if (!el.statP1) return;
    if (phase === 'done') { showDone(); return; }
    el.startBtn.hidden = phase !== 'ready';
    el.startBtn.disabled = !isAuthority();
    if (phase === 'ready') {
      [el.statP1, el.statP2].forEach(s => { s.textContent = 'Ready'; s.removeAttribute('data-outcome'); });
      el.prompt.textContent = isAuthority() ? 'Click Start when ready.' : 'Waiting for the host to start…';
    } else if (phase === 'race') {
      if (!raceStartedAt) return;
      startTimer();
      [0, 1].forEach(seat => {
        const statEl = seat === 0 ? el.statP1 : el.statP2;
        if (result[seat]) { statEl.dataset.outcome = result[seat].outcome; statEl.textContent = outcomeLabel(result[seat]); }
        else statEl.textContent = 'Racing…';
      });
      el.prompt.textContent = (mode === 'local' && !isOnline()) ? 'P1: A / D · P2: ← / →' : 'Steer with A / D or the arrow keys.';
    }
  }

  function setOnIdle() { /* results never need to be queued/gated */ }

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
      statP1: document.getElementById('statP1'),
      statP2: document.getElementById('statP2'),
      timer: document.getElementById('timer'),
      prompt: document.getElementById('prompt'),
      trackP1: document.getElementById('trackP1'),
      trackP2: document.getElementById('trackP2'),
      startBtn: document.getElementById('startBtn'),
      resultTitle: document.getElementById('resultTitle'),
      finalP1: document.getElementById('finalP1'),
      finalP2: document.getElementById('finalP2'),
      rematchBtn: document.getElementById('rematchBtn'),
      timerInterval: null,
      cars: [null, null],
      remoteNote: null
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
    document.addEventListener('keydown', onKeydown);
    showMenu();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { checkMove, applyMove, resetAll, refreshUI, showMenu, showPlay, setOnIdle, isBusy, isOnline };
})();
