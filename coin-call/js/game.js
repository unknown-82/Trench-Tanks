// Coin Call: pick a coin, watch the shuffle, call the slot it lands in.
//
// Same "host is the referee" pattern as Trench Tanks (see js/online.js):
// only small moves travel the network ({type:'pick'|'round'|'guess'}), both
// browsers compute the shuffle themselves from a shared seed, and the host's
// move log is the one source of truth.
window.TT = window.TT || {};
TT.Game = (function () {
  "use strict";
  const COLORS = TT.Protocol.COLORS;
  const N = COLORS.length;
  const ROUNDS = 5;

  let phase = 'menu';   // menu | pick | shuffle | guess | reveal | done
  let mode = null;      // 'local' | 'bot' | null (null + TT.Online active = online)
  let botLevel = 'medium';
  let scores = [0, 0];
  let roundNum = 0;
  let picks = [null, null];
  let guesses = [null, null];
  let seed = null;
  let after = null;     // after[slot] = color index now sitting there
  let destOf = null;    // destOf[colorIndex] = slot it ended up in
  let visual = [0, 1, 2, 3, 4];
  let busy = false;
  let onIdle = null;
  let el = {};

  function colorIndex(color) { return COLORS.indexOf(color); }
  function isOnline() { return !!(window.TT.Online && TT.Online.isActive()); }
  function isAuthority() { return !isOnline() || TT.Online.myIndex() === 0; }

  function later(fn, ms, instant) { if (instant) fn(); else setTimeout(fn, ms); }

  // ---- rules ----
  function checkMove(move, by) {
    if (by !== 0 && by !== 1) return 'bad seat';
    switch (move.type) {
      case 'pick':
        if (phase !== 'pick') return 'not picking now';
        if (picks[by] != null) return 'already picked';
        return null;
      case 'round':
        if (by !== 0) return 'only the host starts a round';
        if (phase !== 'pick') return 'not ready to shuffle';
        if (picks[0] == null || picks[1] == null) return 'both players must pick first';
        return null;
      case 'guess':
        if (phase !== 'guess') return 'not guessing now';
        if (guesses[by] != null) return 'already guessed';
        if (move.pos < 0 || move.pos >= N) return 'bad slot';
        return null;
      default:
        return 'unknown move';
    }
  }

  function applyMove(move, by, opts) {
    const instant = !!(opts && opts.instant);
    if (move.type === 'pick') {
      picks[by] = move.color;
      refreshUI();
      maybeStartRound();
    } else if (move.type === 'round') {
      seed = move.seed;
      const rand = TT.Det.rng(seed);
      after = TT.Det.shuffle([0, 1, 2, 3, 4], rand);
      destOf = [0, 1, 2, 3, 4].map(c => after.indexOf(c));
      guesses = [null, null];
      phase = 'shuffle';
      busy = true;
      refreshUI();
      runShuffleAnim(instant, () => {
        phase = 'guess';
        busy = false;
        refreshUI();
        maybeBotGuess();
        if (onIdle) onIdle();
      });
    } else if (move.type === 'guess') {
      guesses[by] = move.pos;
      refreshUI();
      if (guesses[0] != null && guesses[1] != null) resolveRound(instant);
    }
  }

  function resolveRound(instant) {
    phase = 'reveal';
    const correct = [0, 1].map(seat => destOf[colorIndex(picks[seat])] === guesses[seat]);
    correct.forEach((ok, seat) => { if (ok) scores[seat]++; });
    el.coinEls && el.coinEls.forEach(d => d.classList.remove('flipped'));
    refreshUI(correct);
    later(() => {
      roundNum++;
      if (roundNum >= ROUNDS) {
        phase = 'done';
        refreshUI();
        if (onIdle) onIdle();
      } else {
        picks = [null, null];
        guesses = [null, null];
        visual = [0, 1, 2, 3, 4];
        phase = 'pick';
        refreshUI();
        maybeBotPick();
        if (onIdle) onIdle();
      }
    }, 2200, instant);
  }

  // Only the authority (host online, or the single local/bot instance) ever
  // decides to shuffle. Everyone else just waits for the 'round' move.
  function maybeStartRound() {
    if (picks[0] == null || picks[1] == null) return;
    if (!isAuthority()) return;
    const move = { type: 'round', seed: TT.Det.newSeed() };
    if (isOnline()) TT.Online.submit(move);
    else if (!checkMove(move, 0)) applyMove(move, 0);
  }

  // ---- bot (seat 1, local play only) ----
  function maybeBotPick() {
    if (mode !== 'bot' || isOnline()) return;
    if (phase !== 'pick' || picks[1] != null) return;
    later(() => {
      const color = COLORS[Math.floor(Math.random() * N)];
      const move = { type: 'pick', color };
      if (!checkMove(move, 1)) applyMove(move, 1);
    }, 400 + Math.random() * 500, false);
  }
  function maybeBotGuess() {
    if (mode !== 'bot' || isOnline()) return;
    if (phase !== 'guess' || guesses[1] != null) return;
    const chance = { easy: 0.2, medium: 0.5, hard: 0.85 }[botLevel] || 0.5;
    later(() => {
      const correctSlot = destOf[colorIndex(picks[1])];
      let pos = correctSlot;
      if (Math.random() >= chance) {
        do { pos = Math.floor(Math.random() * N); } while (pos === correctSlot);
      }
      const move = { type: 'guess', pos };
      if (!checkMove(move, 1)) applyMove(move, 1);
    }, 700 + Math.random() * 900, false);
  }

  // ---- shuffle animation (cosmetic only; the final arrangement is fixed by `after`) ----
  function runShuffleAnim(instant, done) {
    if (instant) {
      visual = after.slice();
      positionCoins();
      setFlipped(true);
      done();
      return;
    }
    setFlipped(false);
    let steps = 5;
    (function step() {
      if (steps-- > 0) {
        const i = Math.floor(Math.random() * N), j = Math.floor(Math.random() * N);
        const t = visual[i]; visual[i] = visual[j]; visual[j] = t;
        positionCoins();
        setTimeout(step, 420);
      } else {
        visual = after.slice();
        positionCoins();
        setTimeout(() => { setFlipped(true); setTimeout(done, 450); }, 460);
      }
    })();
  }

  function ensureCoinDOM() {
    if (el.coinEls) return;
    el.coinEls = COLORS.map(color => {
      const d = document.createElement('div');
      d.className = 'coin';
      d.dataset.color = color;
      d.innerHTML = '<div class="face face-front"></div><div class="face face-back">?</div>';
      el.coinTrack.appendChild(d);
      return d;
    });
  }
  function positionCoins() {
    const step = 76, total = N * 64 + (N - 1) * 12;
    const trackW = el.coinTrack.clientWidth || total;
    const startX = Math.max(0, (trackW - total) / 2);
    el.coinEls.forEach((d, c) => { d.style.left = (startX + visual.indexOf(c) * step) + 'px'; });
  }
  function setFlipped(flag) { el.coinEls.forEach(d => d.classList.toggle('flipped', flag)); }

  function ensureSlotButtons() {
    if (el.slotBtns) return;
    el.slotBtns = COLORS.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'slotBtn';
      b.innerHTML = (i + 1) + '<small>slot</small>';
      b.addEventListener('click', () => onSlotActivate(i, 'click'));
      el.slotRow.appendChild(b);
      return b;
    });
  }

  // ---- input routing ----
  // Local/bot: a click is always Player 1 (seat 0); number keys 1-5 are
  // Player 2 (seat 1). Online: a click always means "my own seat", and the
  // keyboard shortcut is ignored since each player has their own device.
  function resolveSeat(source) {
    if (isOnline()) return source === 'click' ? TT.Online.myIndex() : null;
    if (mode === 'bot') return source === 'click' ? 0 : null;
    if (mode === 'local') return source === 'click' ? 0 : 1;
    return null;
  }
  function onSlotActivate(slot, source) {
    if (phase !== 'pick' && phase !== 'guess') return;
    const seat = resolveSeat(source);
    if (seat == null) return;
    const move = phase === 'pick' ? { type: 'pick', color: COLORS[slot] } : { type: 'guess', pos: slot };
    tryAct(move, seat);
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

  // ---- screens ----
  function label(seat) { return isOnline() ? `Player ${seat + 1}${TT.Online.myIndex() === seat ? ' (you)' : ''}` : `Player ${seat + 1}`; }

  function resetAll() {
    phase = 'pick'; scores = [0, 0]; roundNum = 0;
    picks = [null, null]; guesses = [null, null];
    seed = null; after = null; destOf = null; visual = [0, 1, 2, 3, 4]; busy = false;
    showPlay();
  }

  function showMenu() {
    mode = null;
    el.modeScreen.hidden = false; el.playScreen.hidden = true; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'menu';
  }
  function showPlay() {
    el.modeScreen.hidden = true; el.playScreen.hidden = false; el.doneScreen.hidden = true;
    document.body.dataset.screen = 'play';
    ensureCoinDOM(); ensureSlotButtons(); setFlipped(false); positionCoins();
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
  function startBot(level) { mode = 'bot'; botLevel = level; resetAll(); maybeBotPick(); }

  function promptText(correct) {
    if (phase === 'pick') {
      if (isOnline()) {
        const mine = TT.Online.myIndex();
        return picks[mine] != null ? 'Picked. Waiting for opponent…' : 'Pick your coin.';
      }
      const p1 = picks[0] != null ? 'picked' : 'click a coin';
      const p2 = picks[1] != null ? 'picked' : 'press 1-5';
      return `Player 1: ${p1} · Player 2: ${p2}`;
    }
    if (phase === 'shuffle') return 'Watch closely…';
    if (phase === 'guess') {
      if (isOnline()) {
        const mine = TT.Online.myIndex();
        return guesses[mine] != null ? 'Called it. Waiting for opponent…' : 'Call the slot your coin is in.';
      }
      const p1 = guesses[0] != null ? 'called' : 'click a slot';
      const p2 = guesses[1] != null ? 'called' : 'press 1-5';
      return `Player 1: ${p1} · Player 2: ${p2}`;
    }
    if (phase === 'reveal' && correct) {
      return `Player 1: ${correct[0] ? 'Correct!' : 'Missed.'} · Player 2: ${correct[1] ? 'Correct!' : 'Missed.'}`;
    }
    return '—';
  }

  function refreshUI(correct) {
    if (!el.scoreP1) return;
    if (phase === 'done') { showDone(); return; }
    el.scoreP1.textContent = scores[0];
    el.scoreP2.textContent = scores[1];
    el.seatP1.classList.toggle('active', phase === 'pick' && picks[0] == null || phase === 'guess' && guesses[0] == null);
    el.seatP2.classList.toggle('active', phase === 'pick' && picks[1] == null || phase === 'guess' && guesses[1] == null);
    el.roundNum.textContent = `Round ${Math.min(roundNum + 1, ROUNDS)} / ${ROUNDS}`;
    el.prompt.textContent = promptText(correct);
    if (el.coinEls) {
      el.coinEls.forEach(d => d.classList.toggle('flipped', phase === 'guess'));
    }
  }

  // ---- public API (also used by online.js) ----
  function setOnIdle(fn) { onIdle = fn; }
  function isBusy() { return busy; }

  function init() {
    el = {
      app: document.getElementById('app'),
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
      seatP1: document.getElementById('seatP1'),
      seatP2: document.getElementById('seatP2'),
      roundNum: document.getElementById('roundNum'),
      prompt: document.getElementById('prompt'),
      coinTrack: document.getElementById('coinTrack'),
      slotRow: document.getElementById('slotRow'),
      resultTitle: document.getElementById('resultTitle'),
      finalP1: document.getElementById('finalP1'),
      finalP2: document.getElementById('finalP2'),
      rematchBtn: document.getElementById('rematchBtn')
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
      if (isOnline()) return; // online uses "Leave" in the uplink bar
      showMenu();
    }));
    el.rematchBtn.addEventListener('click', () => { if (!isOnline()) resetAll(); });
    document.addEventListener('keydown', e => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key >= '1' && e.key <= String(N)) onSlotActivate(Number(e.key) - 1, 'key');
    });
    showMenu();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    checkMove, applyMove, resetAll, refreshUI, showMenu, showPlay,
    setOnIdle, isBusy, isOnline, ROUNDS
  };
})();
