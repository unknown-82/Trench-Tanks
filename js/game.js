window.TT = window.TT || {};

TT.Game = (function () {
  "use strict";
  const GRAVITY = 260; // px/s^2
  const W = 900, H = 506;
  const Terrain = TT.Terrain;
  const WEAPONS = TT.WEAPONS;
  const CATEGORIES = TT.CATEGORIES;
  const Det = TT.Det;

  let canvas, ctx;
  let players, current, gameOver;
  let projectiles = [], popups = [];
  let fires = [];             // Burner flames (visual only): { x, y, player?, until }
  let phase = 'menu';        // 'menu' = mode select, 'draft' = weapon select, 'battle' = game screen
  let mode = 'local';        // 'local' (2 players, one device) or 'bot' (you vs TT.Bot)
  let botLevel = 'medium';   // key of TT.Bot.LEVELS
  let botTimer = null;
  let inventory = [[], []];  // weapon ids each player drafted and hasn't used yet
  let loadout = [[], []];    // the full drafted set, restored at the start of every round
  let lastSettings = [{ angle: 45, power: 60 }, { angle: 45, power: 60 }]; // each player's own last aim
  let draftTurn = 0;         // whose turn it is to pick (0 or 1), null once pool is empty
  let teleportUsed = [false, false]; // each player may teleport once per round
  const TOTAL_PICKS = WEAPONS.length; // 20, split 10/10 by alternating picks
  let onIdle = null;         // called when a shot animation ends (online.js uses it)

  let el = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function weaponById(id) { return WEAPONS.find(w => w.id === id); }
  const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  function isBusy() { return projectiles.length > 0; }

  // ---- Local / bot / online: who may do what on this screen ----
  function isOnline() { return !!(TT.Online && TT.Online.isActive()); }
  function isBotGame() { return mode === 'bot' && !isOnline(); }
  // Only one human at this screen (online or vs bot): say "You" / "Opponent".
  function isSolo() { return isOnline() || isBotGame(); }
  function isMe(idx) {
    if (isOnline()) return TT.Online.myIndex() === idx;
    if (isBotGame()) return idx === 0;
    return true;
  }
  // Can the person at this screen act for player `idx` right now?
  // Online, player 0 is the host, who also controls rematch / new terrain.
  function canControl(idx) { return isMe(idx) && (!isOnline() || TT.Online.canAct()); }
  function label(idx) {
    if (!isSolo()) return `Player ${idx + 1}`;
    if (isMe(idx)) return 'You';
    return isBotGame() ? 'Bot' : 'Opponent';
  }

  function init() {
    canvas = document.getElementById('c');
    ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;

    el = {
      modeScreen: document.getElementById('modeScreen'),
      selectScreen: document.getElementById('selectScreen'),
      gameScreen: document.getElementById('gameScreen'),
      draftPrompt: document.getElementById('draftPrompt'),
      weaponPool: document.getElementById('weaponPool'),
      pickSummary: document.getElementById('pickSummary'),
      startBtn: document.getElementById('startBtn'),
      randomBtn: document.getElementById('randomBtn'),
      angle: document.getElementById('angle'),
      power: document.getElementById('power'),
      angleVal: document.getElementById('angleVal'),
      powerVal: document.getElementById('powerVal'),
      fireBtn: document.getElementById('fireBtn'),
      teleportBtn: document.getElementById('teleportBtn'),
      newTerrainBtn: document.getElementById('newTerrainBtn'),
      turnFlag: document.getElementById('turnFlag'),
      weaponSelect: document.getElementById('weaponSelect'),
      banner: document.getElementById('banner'),
      bannerText: document.getElementById('bannerText'),
      bannerNote: document.getElementById('bannerNote'),
      restartBtn: document.getElementById('restartBtn'),
      rematchBtn: document.getElementById('rematchBtn'),
      nameEls: [
        document.querySelector('#p1 h2'),
        document.querySelector('#p2 h2')
      ],
      ammoEls: [
        document.getElementById('ammoP1'),
        document.getElementById('ammoP2')
      ],
      shotCount: document.getElementById('shotCount'),
      scoreEls: [
        document.getElementById('scoreP1'),
        document.getElementById('scoreP2')
      ]
    };

    buildWeaponPool();
    showScreen('menu');

    // Mode select screen
    document.getElementById('modeLocal').addEventListener('click', () => startMode('local'));
    document.getElementById('modeOnline').addEventListener('click', () => TT.Online.createGame());
    document.querySelectorAll('[data-bot]').forEach(btn =>
      btn.addEventListener('click', () => startMode('bot', btn.dataset.bot)));
    document.querySelectorAll('.menuBtn').forEach(btn => btn.addEventListener('click', showMenu));

    // Every button turns into a small "move" object passed to act().
    el.startBtn.addEventListener('click', () => act({ type: 'round', seed: Det.newSeed() }));
    el.randomBtn.addEventListener('click', () => act({ type: 'random', seed: Det.newSeed() }));
    el.angle.addEventListener('input', () => { el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); });
    el.power.addEventListener('input', () => { el.powerVal.textContent = el.power.value; aimChanged(); });
    el.weaponSelect.addEventListener('change', aimChanged);
    // Switching tab/app mid-shot: finish the shot now instead of freezing.
    document.addEventListener('visibilitychange', () => { if (document.hidden) skipFlight(); });
    el.fireBtn.addEventListener('click', fire);
    el.teleportBtn.addEventListener('click', teleport);
    el.newTerrainBtn.addEventListener('click', () => act({ type: 'round', seed: Det.newSeed() }));
    el.restartBtn.addEventListener('click', () => act({ type: 'redraft' }));
    el.rematchBtn.addEventListener('click', () => act({ type: 'round', seed: Det.newSeed() }));

    window.addEventListener('keydown', onKey);
  }

  // ---- Moves: the only way the game state changes ----
  // Locally a move is applied straight away. Online it goes through
  // TT.Online so both browsers apply the same moves in the same order.
  function act(move) {
    if (isOnline()) { TT.Online.submit(move); return; }
    const by = move.type === 'pick' ? draftTurn : move.type === 'fire' || move.type === 'teleport' ? current : 0;
    if (!isMe(by)) return; // vs bot: you can't move for the bot
    const err = checkMove(move, by);
    if (err) console.info('[game] ' + err);
    else applyMove(move, by);
  }

  // The game rules. Returns null if player `by` may make `move` now,
  // otherwise a short reason. Used for local AND incoming network moves.
  function checkMove(move, by) {
    switch (move.type) {
      case 'pick':
        if (phase !== 'draft' || draftTurn === null || draftTurn !== by) return 'not your pick';
        if (!WEAPONS.some(w => w.id === move.id)) return 'unknown weapon';
        if (inventory[0].includes(move.id) || inventory[1].includes(move.id)) return 'weapon already taken';
        return null;
      case 'random':
        return phase === 'draft' && by === 0 ? null : 'only the host can do that';
      case 'round':
        if (by !== 0) return 'only the host can start a round';
        if (phase === 'draft' && draftTurn !== null) return 'the draft is not finished';
        if (isBusy()) return 'wait for the shot to land';
        return null;
      case 'redraft':
        return phase === 'battle' && by === 0 && !isBusy() ? null : 'only the host can do that';
      case 'fire': {
        if (phase !== 'battle' || gameOver || isBusy()) return 'cannot fire right now';
        if (current !== by) return 'not your turn';
        if (!inventory[by].includes(move.weapon)) return 'you do not have that weapon';
        if (!isIntIn(move.angle, 0, 180) || !isIntIn(move.power, 10, 100)) return 'angle or power out of range';
        return null;
      }
      case 'teleport':
        if (phase !== 'battle' || gameOver || isBusy()) return 'cannot teleport right now';
        if (current !== by) return 'not your turn';
        if (teleportUsed[by]) return 'teleport already used this round';
        return null;
    }
    return 'unknown move';
  }

  // Apply a move that already passed checkMove(). `instant` skips the shot
  // animation (used to replay a game after a refresh or reconnect).
  function applyMove(move, by, opts) {
    const instant = !!(opts && opts.instant);
    switch (move.type) {
      case 'pick': choosePick(by, move.id); break;
      case 'random': randomDistribute(move.seed); break;
      case 'round':
        if (phase === 'draft') showScreen('battle');
        newRound(move.seed);
        break;
      case 'redraft': backToSelect(); break;
      case 'fire': fireShot(by, move.weapon, move.angle, move.power, instant); break;
      case 'teleport': teleportTank(by, move.seed, instant); break;
    }
  }

  function showScreen(p) {
    phase = p;
    el.modeScreen.style.display = p === 'menu' ? 'block' : 'none';
    el.selectScreen.style.display = p === 'draft' ? 'block' : 'none';
    el.gameScreen.style.display = p === 'battle' ? 'block' : 'none';
  }

  // ---- Mode select screen ----
  function startMode(newMode, level) {
    mode = newMode;
    if (level && TT.Bot.LEVELS[level]) botLevel = level;
    resetAll();
  }

  function showMenu() {
    stopBot();
    cancelFlight();
    projectiles = [];
    mode = 'local';
    el.banner.style.display = 'none';
    showScreen('menu');
  }

  // ---- Bot turns (bot is always player 2) ----
  function isBotTurn() {
    if (!isBotGame()) return false;
    if (phase === 'draft') return draftTurn === 1;
    if (phase === 'battle') return current === 1 && !gameOver && !isBusy();
    return false;
  }

  // Safe to call any time: does nothing unless it's the bot's turn.
  function scheduleBot() {
    if (botTimer || !isBotTurn()) return;
    botTimer = setTimeout(botStep, phase === 'draft' ? TT.Bot.TIMING.pickMs : TT.Bot.TIMING.thinkMs);
  }

  function stopBot() { clearTimeout(botTimer); botTimer = null; }

  function botStep() {
    botTimer = null;
    if (!isBotTurn()) return;
    if (phase === 'draft') {
      const free = WEAPONS.map(w => w.id).filter(id => !inventory[0].includes(id) && !inventory[1].includes(id));
      botMove({ type: 'pick', id: TT.Bot.pickDraft(botLevel, free) });
      return;
    }
    const weapon = TT.Bot.chooseWeapon(botLevel, inventory[1]);
    const aim = TT.Bot.aim(botLevel, (angle, power) => traceMiss(1, angle, power, weaponById(weapon)));
    // Show the bot's aim for a moment, then fire.
    el.weaponSelect.value = weapon;
    el.angle.value = aim.angle;
    el.power.value = aim.power;
    el.angleVal.textContent = aim.angle + '°';
    el.powerVal.textContent = aim.power;
    draw();
    botTimer = setTimeout(() => {
      botTimer = null;
      if (isBotTurn()) botMove({ type: 'fire', weapon, angle: aim.angle, power: aim.power });
    }, TT.Bot.TIMING.aimMs);
  }

  function botMove(move) {
    if (checkMove(move, 1) === null) applyMove(move, 1);
  }

  // ---- Weapon draft screen ----
  function buildWeaponPool() {
    el.weaponPool.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const section = document.createElement('div');
      section.className = 'weaponCategory';
      section.innerHTML = `<h3 style="color:${cat.color}">${cat.name}</h3><p class="catBlurb">${cat.blurb}</p>`;
      const grid = document.createElement('div');
      grid.className = 'weaponGrid';
      WEAPONS.filter(w => w.category === cat.id).forEach(w => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'weaponCard';
        btn.dataset.id = w.id;
        btn.style.setProperty('--wcolor', cat.color);
        btn.innerHTML = `<span class="wicon">${w.icon}</span><strong>${w.name}</strong><span class="wdesc">${w.desc}</span>`;
        btn.addEventListener('click', () => act({ type: 'pick', id: w.id }));
        grid.appendChild(btn);
      });
      section.appendChild(grid);
      el.weaponPool.appendChild(section);
    });
  }

  function randomDistribute(seed) {
    const ids = Det.shuffle(WEAPONS.map(w => w.id), Det.rng(seed));
    inventory = [ids.slice(0, TOTAL_PICKS / 2), ids.slice(TOTAL_PICKS / 2)];
    draftTurn = null;
    loadout = inventory.map(list => list.slice());
    updateDraftUI();
  }

  function choosePick(by, id) {
    inventory[by].push(id);
    const totalTaken = inventory[0].length + inventory[1].length;
    draftTurn = totalTaken >= TOTAL_PICKS ? null : 1 - by;
    if (draftTurn === null) loadout = inventory.map(list => list.slice());
    updateDraftUI();
  }

  function takenText(owner) {
    if (!isSolo()) return `Taken by Player ${owner + 1}`;
    return isMe(owner) ? 'Yours' : `Taken by ${label(owner).toLowerCase()}`;
  }

  function updateDraftUI() {
    el.weaponPool.querySelectorAll('.weaponCard').forEach(btn => {
      const id = btn.dataset.id;
      const owner = inventory[0].includes(id) ? 0 : inventory[1].includes(id) ? 1 : -1;
      btn.classList.toggle('taken', owner !== -1);
      if (owner !== -1) btn.querySelector('.wdesc').textContent = takenText(owner);
      btn.disabled = owner !== -1 || draftTurn === null || !canControl(draftTurn);
    });
    if (draftTurn === null) {
      el.draftPrompt.textContent = 'Both players are fully armed (10 weapons each).';
    } else if (!isSolo()) {
      el.draftPrompt.textContent = `Player ${draftTurn + 1}, choose your weapon`;
    } else {
      el.draftPrompt.textContent = isMe(draftTurn) ? 'Your pick: choose a weapon' : `${label(draftTurn)} is picking…`;
    }
    const guest = isOnline() && !isMe(0);
    el.startBtn.disabled = draftTurn !== null || !canControl(0);
    el.startBtn.textContent = guest ? 'Waiting for the host to start…' : 'Start battle';
    el.randomBtn.hidden = guest;
    el.randomBtn.disabled = !canControl(0);
    el.pickSummary.textContent =
      `${label(0)}: ${inventory[0].length}/10 picked   ·   ${label(1)}: ${inventory[1].length}/10 picked`;
    document.querySelectorAll('.menuBtn').forEach(b => { b.hidden = isOnline(); }); // online uses "Leave"
    if (phase === 'draft') scheduleBot();
  }

  function backToSelect() {
    el.banner.style.display = 'none';
    showScreen('draft');
    inventory = [[], []];
    draftTurn = 0;
    buildWeaponPool();
    updateDraftUI();
  }

  // Wipe everything back to an empty draft (new online game / resync).
  function resetAll() {
    stopBot();
    cancelFlight();
    projectiles = [];
    popups = [];
    fires = [];
    TT.Effects.clear();
    gameOver = false;
    backToSelect();
  }

  // ---- Match lifecycle ----
  // The seed makes terrain identical on both online players' screens.
  function newRound(seed) {
    const rand = Det.rng(seed);
    Terrain.generate(W, H, rand);
    players = [
      { x: W * 0.12, y: 0, score: 0, color: cssVar('--p1'), dark: cssVar('--p1-dark'), dir: 1 },
      { x: W * 0.88, y: 0, score: 0, color: cssVar('--p2'), dark: cssVar('--p2-dark'), dir: -1 }
    ];
    players.forEach(placeOnGround);
    inventory = loadout.map(list => list.slice()); // every round: all 10 weapons each
    current = 0;
    teleportUsed = [false, false];
    lastSettings = [{ angle: 45, power: 60 }, { angle: 45, power: 60 }];
    el.angle.value = lastSettings[0].angle;
    el.power.value = lastSettings[0].power;
    projectiles = [];
    popups = [];
    fires = [];
    TT.Effects.clear();
    gameOver = false;
    el.banner.style.display = 'none';
    updateHUD();
    draw();
  }

  // p.y is the bottom of the tank. Usually that's the ground surface, but dirt
  // dropped on a tank piles up ON TOP of it (the tank stays put, buried).
  function placeOnGround(p) { p.y = Terrain.heightAt(p.x); }
  // After a blast: if the ground under a tank was dug away, it falls onto
  // the new surface. Dirt added above it never lifts it.
  function settleTank(p) { p.y = Math.max(p.y, Terrain.heightAt(p.x)); }
  function isBuried(p) { return Terrain.heightAt(p.x) < p.y - 6; }

  function updateHUD() {
    el.ammoEls.forEach((a, i) => { a.textContent = `${inventory[i].length}/${loadout[i].length} weapons left`; });
    const fired = loadout[0].length + loadout[1].length - inventory[0].length - inventory[1].length;
    el.shotCount.textContent = `Shot ${Math.min(fired + 1, TOTAL_PICKS)} of ${TOTAL_PICKS}`;
    el.scoreEls[0].textContent = `${players[0].score} pts`;
    el.scoreEls[1].textContent = `${players[1].score} pts`;
    el.nameEls.forEach((h, i) => {
      if (isBotGame() && i === 1) h.textContent = `Bot (${TT.Bot.LEVELS[botLevel].name})`;
      else h.textContent = `Player ${i + 1}` + (isSolo() && isMe(i) ? ' (you)' : '');
    });
    el.turnFlag.textContent = !isSolo() ? `Player ${current + 1}'s` : isMe(current) ? 'Your' : `${label(current)}'s`;
    el.angleVal.textContent = el.angle.value + '°';
    el.powerVal.textContent = el.power.value;
    populateWeaponSelect();
    refreshControls();
  }

  // Enable only the controls this screen is allowed to use right now.
  function refreshControls() {
    const myTurn = phase === 'battle' && !gameOver && !isBusy() && canControl(current);
    el.fireBtn.disabled = el.angle.disabled = el.power.disabled = el.weaponSelect.disabled = !myTurn;
    el.teleportBtn.disabled = !myTurn || teleportUsed[current];
    el.teleportBtn.textContent = teleportUsed[current] ? '✨ Teleport used' : '✨ Teleport';
    const guest = isOnline() && !isMe(0);
    el.newTerrainBtn.hidden = el.rematchBtn.hidden = el.restartBtn.hidden = guest;
    el.newTerrainBtn.disabled = isBusy() || !canControl(0);
    el.rematchBtn.disabled = el.restartBtn.disabled = !canControl(0);
    el.bannerNote.textContent = guest ? 'Waiting for the host to start the next round…' : '';
    if (phase === 'battle') scheduleBot();
  }

  function refreshUI() {
    updateDraftUI();
    if (phase === 'battle' && players) updateHUD();
  }

  function populateWeaponSelect() {
    const remaining = inventory[current];
    const previous = el.weaponSelect.value;
    el.weaponSelect.innerHTML = '';
    remaining.forEach(id => {
      const w = weaponById(id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${w.icon} ${w.name} — ${w.category}`;
      el.weaponSelect.appendChild(opt);
    });
    if ([...el.weaponSelect.options].some(o => o.value === previous)) el.weaponSelect.value = previous;
  }

  // ---- Rendering ----
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, cssVar('--sky-top'));
    g.addColorStop(0.55, cssVar('--sky-mid'));
    g.addColorStop(1, cssVar('--sky-bot'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTerrain() {
    const heights = Terrain.all();
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, heights[x]);
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
    g.addColorStop(0, cssVar('--ground'));
    g.addColorStop(1, cssVar('--ground-dark'));
    ctx.fillStyle = g;
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function angleForPlayer(p) {
    return (players[current] === p && !projectiles.length) ? Number(el.angle.value) : 35;
  }

  function drawTank(p) {
    const bodyW = 26, bodyH = 12;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (isBuried(p)) ctx.globalAlpha = 0.35; // faint: it's under the dirt
    const rad = angleForPlayer(p) * Math.PI / 180;
    ctx.strokeStyle = p.dark;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH * 0.6);
    ctx.lineTo(Math.cos(rad) * 22 * p.dir, -bodyH * 0.6 - Math.sin(rad) * 22);
    ctx.stroke();
    ctx.fillStyle = p.color;
    roundRect(-bodyW / 2, -bodyH, bodyW, bodyH, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawShellShape(pr) {
    const angle = Math.atan2(pr.vy, pr.vx);
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(angle);
    ctx.fillStyle = pr.color;
    ctx.strokeStyle = pr.color;
    switch (pr.weapon.category) {
      case 'attacker': // missile: body + nose cone + tail fins
        ctx.beginPath();
        ctx.moveTo(9, 0); ctx.lineTo(2, -4); ctx.lineTo(-7, -4);
        ctx.lineTo(-10, -7); ctx.lineTo(-7, 0); ctx.lineTo(-10, 7);
        ctx.lineTo(-7, 4); ctx.lineTo(2, 4); ctx.closePath();
        ctx.fill();
        break;
      case 'dirt': // rough clod of earth, not direction-locked
        ctx.rotate(-angle); // undo rotation, dirt tumbles randomly
        ctx.fillStyle = '#8a6b3d';
        [[0, 0, 5], [3, -2, 3], [-3, 2, 3], [-2, -3, 2.5]].forEach(([dx, dy, r]) => {
          ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fill();
        });
        break;
      case 'magic': // four-point sparkle
        ctx.shadowColor = pr.color; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(2.5, -2.5); ctx.lineTo(9, 0);
        ctx.lineTo(2.5, 2.5); ctx.lineTo(0, 9); ctx.lineTo(-2.5, 2.5);
        ctx.lineTo(-9, 0); ctx.lineTo(-2.5, -2.5); ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      default: // shooter: streamlined bullet capsule
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.quadraticCurveTo(3, -3, -6, -3);
        ctx.lineTo(-6, 3);
        ctx.quadraticCurveTo(3, 3, 7, 0);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
  }

  // Magic and attacker shells have their own look (js/effects.js); the rest
  // get a faint trail plus their category's shape.
  function drawProjectiles() {
    projectiles.forEach(pr => {
      if (TT.Effects.drawShell(ctx, pr, pr.y >= Terrain.heightAt(pr.x))) return;
      ctx.strokeStyle = pr.color + '55';
      ctx.beginPath();
      pr.trail.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
      ctx.stroke();
      drawShellShape(pr);
    });
  }

  function drawPopups() {
    popups.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.font = '700 18px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // Flickering flames on a burning tank (it follows the tank) or on the ground.
  function drawFires() {
    const now = performance.now();
    fires.forEach(f => {
      const p = f.player !== undefined ? players[f.player] : null;
      const x = p ? p.x : f.x, y = p ? p.y - 6 : f.y;
      const fade = Math.min(1, (f.until - now) / 600);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 12;
      for (let i = -2; i <= 2; i++) {
        const h = 14 + Math.random() * 12 - Math.abs(i) * 3;
        ctx.fillStyle = i % 2 ? '#ff7a1a' : '#ffc23d';
        ctx.beginPath();
        ctx.moveTo(x + i * 6 - 5, y);
        ctx.quadraticCurveTo(x + i * 6 - 3, y - h * 0.6, x + i * 6 + (Math.random() - 0.5) * 3, y - h);
        ctx.quadraticCurveTo(x + i * 6 + 3, y - h * 0.6, x + i * 6 + 5, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function draw() {
    if (!players) return;
    drawSky();
    drawTerrain();
    players.forEach(drawTank);
    drawFires();
    drawProjectiles();
    TT.Effects.draw(ctx);
    drawPopups();
  }

  function spawnPopup(x, y, points) {
    showPopup(x, y, `+${Math.round(points)}`, points > 0 ? '#c9ff8a' : '#ffffffaa');
  }
  function showPopup(x, y, text, color) {
    popups.push({ x, y, text, alpha: 1, color });
    animateEffects();
  }
  // The weapon's impact burst (js/effects.js), one spot per blast.
  function playImpact(weapon, spots) {
    TT.Effects.impact(weapon, spots);
    animateEffects();
  }
  const FIRE_MS = 4000;
  function startFire(spot) {
    fires.push(Object.assign({ until: performance.now() + FIRE_MS }, spot));
    animateEffects();
  }

  // Keeps redrawing while popups float, fires burn or impact bursts play.
  let effectsAnimating = false;
  function animateEffects() {
    if (effectsAnimating) return;
    effectsAnimating = true;
    let last = performance.now();
    requestAnimationFrame(function step(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      popups.forEach(p => { p.y -= 40 * dt; p.alpha -= dt * 0.9; });
      popups = popups.filter(p => p.alpha > 0);
      fires = fires.filter(f => f.until > now);
      draw();
      if (popups.length || fires.length || TT.Effects.active()) requestAnimationFrame(step);
      else effectsAnimating = false;
    });
  }

  // ---- Firing & physics ----
  function clampInputs() {
    el.angle.value = Math.max(0, Math.min(180, Number(el.angle.value)));
    el.power.value = Math.max(10, Math.min(100, Number(el.power.value)));
  }

  // One trajectory formula for EVERY weapon: launch speed depends only on
  // power, gravity is constant, and there is no wind or drag. Weapons differ
  // only in what happens on impact, so the same angle + power always lands in
  // the same place. (The Beaver flies the same arc but passes through the
  // ground: see collide().)
  const SPEED_PER_POWER = 6.5;
  const ACCURACY_RANGE = 150; // attackers: px from the opponent that still earns points
  const MAGIC_SPREAD = 60;    // magic: a blast this close (px) still earns a little
  const MAGIC_NEAR_SHARE = 0.3; // ...at most this share of the max points
  const MAX_STEPS = 3000;     // safety net: a shell can't fly forever

  function makeShell(shooter, weapon, angleDeg, power) {
    // Det.cosDeg/sinDeg instead of Math.cos/sin: identical in every browser.
    const cos = Det.cosDeg(angleDeg), sin = Det.sinDeg(angleDeg);
    const speed = power * SPEED_PER_POWER;
    return {
      x: shooter.x + cos * 24 * shooter.dir,
      y: shooter.y - 14 - sin * 24,
      vx: cos * speed * shooter.dir,
      vy: -sin * speed,
      color: (CATEGORIES.find(c => c.id === weapon.category) || {}).color || '#ffe08a',
      weapon, owner: shooter, trail: [], steps: 0,
      tunnel: (weapon.effect || {}).type === 'tunnel'
    };
  }

  // X positions where a weapon's blasts go off, relative to the impact point.
  function blastXs(weapon, impactX) {
    const fx = weapon.effect || {};
    if (fx.type === 'cluster') {
      const xs = [];
      for (let i = 0; i < fx.count; i++) xs.push(impactX + (i - (fx.count - 1) / 2) * fx.spacing);
      return xs;
    }
    if (fx.type === 'double') return [impactX, impactX];
    return [impactX];
  }

  // Fire button / space bar: turn the current aim into a move.
  function fire() {
    if (!canControl(current) || !el.weaponSelect.value) return;
    clampInputs();
    act({
      type: 'fire',
      weapon: el.weaponSelect.value,
      angle: Number(el.angle.value),
      power: Number(el.power.value)
    });
  }

  function fireShot(by, weaponId, angleDeg, power, instant) {
    const weapon = weaponById(weaponId);
    inventory[by].splice(inventory[by].indexOf(weapon.id), 1); // each weapon fires once
    lastSettings[by] = { angle: angleDeg, power };
    projectiles = [makeShell(players[by], weapon, angleDeg, power)];

    // Replays, and hidden tabs (where animation is paused), resolve the
    // whole flight at once. Same fixed steps = same result.
    if (instant || document.hidden) {
      while (!stepShot(true));
      draw();
      return;
    }
    refreshControls();
    startFlight();
  }

  // ---- Teleport: a once-per-round superpower ----
  // On your turn, before firing, jump 10–25% of the screen width left or right
  // of where your tank is now, then settle onto the ground there. You still
  // fire afterwards. The seed travels with the move, so both online players
  // see the tank land in exactly the same spot.
  const TELEPORT_MIN = 0.10, TELEPORT_MAX = 0.25;
  const TANK_MARGIN = 20; // keep the whole tank on screen
  const TANK_GAP = 40;    // never land on top of the opponent

  function teleport() {
    if (!canControl(current) || teleportUsed[current]) return;
    act({ type: 'teleport', seed: Det.newSeed() });
  }

  // Every spot that's on screen and clear of the opponent, on either side.
  // Picking one at random is the same as rolling a random side + distance and
  // re-rolling until it fits, but it can never loop forever.
  function teleportSpots(by) {
    const from = players[by].x, other = players[1 - by].x;
    const spots = [];
    for (const side of [-1, 1]) {
      for (let d = Math.ceil(TELEPORT_MIN * W); d <= Math.floor(TELEPORT_MAX * W); d++) {
        const x = from + side * d;
        if (x >= TANK_MARGIN && x <= W - TANK_MARGIN && Math.abs(x - other) > TANK_GAP) spots.push(x);
      }
    }
    return spots;
  }

  function teleportTank(by, seed, instant) {
    const p = players[by];
    const spots = teleportSpots(by);
    teleportUsed[by] = true;
    p.x = spots[Math.floor(Det.rng(seed)() * spots.length)];
    placeOnGround(p);
    if (!instant) showPopup(p.x, p.y - 30, '✨', '#c9b8ff');
    refreshControls();
    draw();
  }

  // ---- Shot animation ----
  // The shell moves by REAL time (60 physics steps per second), not one step
  // per drawn frame. So it flies at the same speed on every screen, and if the
  // browser pauses or slows animation (tab switched, window covered) the next
  // tick simply catches up. A backup timer keeps it moving even when
  // requestAnimationFrame stops completely. Online this matters: the host
  // can't referee the next move until its own shot has landed.
  const STEP_MS = 1000 / 60;
  let flight = null;         // the shot currently animating, if any

  function startFlight() {
    const f = { start: performance.now(), steps: 0, timer: null };
    flight = f;
    const frame = () => {
      if (flight !== f) return;
      tickFlight(f);
      if (flight === f) requestAnimationFrame(frame);
    };
    f.timer = setInterval(() => { if (flight === f) tickFlight(f); }, 250);
    requestAnimationFrame(frame);
  }

  function tickFlight(f) {
    const due = Math.floor((performance.now() - f.start) / STEP_MS);
    while (f.steps < due) {
      f.steps++;
      if (stepShot(false)) { endFlight(f); return; }
    }
    draw();
  }

  function endFlight(f) {
    clearInterval(f.timer);
    flight = null;
    draw();
    if (onIdle) onIdle(); // online: process moves that arrived meanwhile
  }

  // Tab hidden mid-flight: land the shot right now.
  function skipFlight() {
    const f = flight;
    if (!f) return;
    while (!stepShot(true));
    endFlight(f);
  }

  // Game reset mid-flight: drop the shot without resolving it.
  function cancelFlight() {
    if (flight) clearInterval(flight.timer);
    flight = null;
  }

  // The physics, shared by real shots and the bot's invisible test shots.
  // Move the shell one fixed 1/60 s step.
  function advance(pr) {
    const dt = 1 / 60;
    pr.vy += GRAVITY * dt;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
  }
  // null while flying, otherwise 'oob', 'ground', or the player whose tank was hit.
  // A tunnelling Beaver passes through the ground (and its own tank) and only
  // stops on the opponent, so it can reach a tank buried under dirt.
  function collide(pr) {
    if (++pr.steps > MAX_STEPS || pr.x < -20 || pr.x > W + 20 || pr.y > H + 40) return 'oob';
    if (!pr.tunnel && pr.y >= Terrain.heightAt(pr.x)) return 'ground';
    for (const p of players) {
      if (pr.tunnel && p === pr.owner) continue;
      const dx = pr.x - p.x, dy = pr.y - (p.y - 8);
      if (dx * dx + dy * dy < 16 * 16) return p;
    }
    return null;
  }

  // Bot helper: fly an invisible shell (no damage, no terrain change) and
  // return how many px from the opponent it lands. A Beaver never "lands", so
  // for it this is how close it passes to the opponent's tank.
  function traceMiss(by, angleDeg, power, weapon) {
    const pr = makeShell(players[by], weapon || WEAPONS[0], angleDeg, power);
    const target = players[1 - by];
    let hit = null, closest = Infinity;
    while (!hit) {
      advance(pr);
      hit = collide(pr);
      if (pr.tunnel) closest = Math.min(closest, Math.hypot(pr.x - target.x, pr.y - (target.y - 8)));
    }
    if (hit === target) return 0;
    if (hit === players[by]) return Infinity; // never aim at yourself
    return pr.tunnel ? closest : Math.abs(target.x - pr.x);
  }

  // Advance the real shell one step. Returns true once it has landed.
  function stepShot(quiet) {
    const pr = projectiles[0];
    advance(pr);
    pr.trail.push({ x: pr.x, y: pr.y });
    if (pr.trail.length > 40) pr.trail.shift();

    let hit = collide(pr);
    if (!hit) return false;
    // Only a hit on the OPPONENT's tank counts as a direct hit for points.
    if (typeof hit === 'object') hit = hit === players[1 - current] ? 'tank' : 'ground';

    if (pr.tunnel) {
      // The Beaver leaves the ground untouched. It scores only on a direct hit.
      if (hit === 'tank') {
        if (!quiet) playImpact(pr.weapon, [{ x: pr.x, y: pr.y }]);
        scoreShot(pr, hit, pr.x, pr.y, quiet);
      }
      else if (!quiet) showPopup(Math.max(40, Math.min(W - 40, pr.x)), H - 20, 'missed', '#ffffffaa');
    } else if (hit !== 'oob') resolveImpact(pr, hit, quiet);
    projectiles = [];
    endOfVolley();
    return true;
  }

  function resolveImpact(pr, hit, quiet) {
    const w = pr.weapon;
    const impactX = Math.max(0, Math.min(W - 1, pr.x));
    const fx = (w.effect || {}).type;
    const target = players[1 - current];

    // Tanks can't be destroyed: blasts only reshape the ground. Dirt piles on
    // top of a tank (burying it), and a tank falls if the ground under it goes.
    blastXs(w, impactX).forEach(bx => (fx === 'mound' ? Terrain.mound : Terrain.crater)(bx, w.radius));
    players.forEach(settleTank);
    if (!quiet) playImpact(w, blastXs(w, impactX).map(bx => ({ x: bx, y: Terrain.heightAt(bx) })));

    // Burner: the opponent's tank catches fire if the blast reaches it,
    // otherwise the ground where it landed burns for a moment.
    if (fx === 'burn' && !quiet) {
      const reached = hit === 'tank' || Math.abs(target.x - impactX) <= w.radius + 13;
      startFire(reached ? { player: 1 - current } : { x: impactX, y: Terrain.heightAt(impactX) });
    }
    scoreShot(pr, hit, impactX, pr.y, quiet);
  }

  // Points for a shot that landed at x. `hit` is 'tank' when it touched the
  // opponent's tank, which always earns the category's full points.
  //   shooters: only a touch scores; a near miss is worth nothing
  //   magic:    a near miss (within MAGIC_SPREAD of any of its blasts) gets a
  //             few points; the Beaver still needs a touch
  //   attackers: points fall off over ACCURACY_RANGE px
  //   dirt:     never scores
  function shotPoints(w, hit, x) {
    const max = TT.CATEGORY_MAX_POINTS[w.category] || 0;
    if (hit === 'tank') return max;
    const targetX = players[1 - current].x;
    if (w.category === 'attacker') return Math.max(0, 1 - Math.abs(targetX - x) / ACCURACY_RANGE) * max;
    if (w.category === 'magic' && (w.effect || {}).type !== 'tunnel') {
      const dist = Math.min(...blastXs(w, x).map(bx => Math.abs(targetX - bx)));
      return Math.max(0, 1 - dist / MAGIC_SPREAD) * max * MAGIC_NEAR_SHARE;
    }
    return 0;
  }

  function scoreShot(pr, hit, x, y, quiet) {
    const points = shotPoints(pr.weapon, hit, x);
    players[current].score += Math.round(points);
    if (!quiet) spawnPopup(x, y, points);
  }

  // The match always lasts until both players have fired all their weapons.
  function endOfVolley() {
    if (!inventory[0].length && !inventory[1].length) { updateHUD(); endGame(); return; }
    if (inventory[1 - current].length) current = 1 - current;
    el.angle.value = lastSettings[current].angle;
    el.power.value = lastSettings[current].power;
    updateHUD();
  }

  function endGame() {
    gameOver = true;
    const [a, b] = [players[0].score, players[1].score];
    const winner = a > b ? 0 : b > a ? 1 : -1;
    const result = winner === -1 ? "It's a draw!" : isSolo() && isMe(winner) ? 'You win!' : `${label(winner)} wins!`;
    el.bannerText.textContent = `${result} ${a} – ${b}`;
    el.banner.style.display = 'flex';
    refreshControls();
  }

  function onKey(e) {
    if (phase !== 'battle') return;
    if (e.target.matches && e.target.matches('input[type=text], textarea')) return; // typing in chat
    if (gameOver || isBusy() || !canControl(current)) return;
    if (e.code === 'Space') { e.preventDefault(); fire(); }
    else if (e.code === 'KeyT') teleport();
    else if (e.code === 'ArrowUp') { el.power.value = Math.min(100, Number(el.power.value) + 2); el.powerVal.textContent = el.power.value; aimChanged(); }
    else if (e.code === 'ArrowDown') { el.power.value = Math.max(10, Number(el.power.value) - 2); el.powerVal.textContent = el.power.value; aimChanged(); }
    else if (e.code === 'ArrowLeft') { el.angle.value = Math.max(0, Number(el.angle.value) - 2); el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); }
    else if (e.code === 'ArrowRight') { el.angle.value = Math.min(180, Number(el.angle.value) + 2); el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); }
  }

  // ---- Live aim preview (online) ----
  // While it's your turn, tell the opponent how you're aiming so their screen
  // shows your barrel, power and weapon moving. Preview only: not a move.
  function aimChanged() {
    if (!isOnline() || phase !== 'battle' || gameOver || isBusy() || !canControl(current)) return;
    TT.Online.sendAim({ angle: Number(el.angle.value), power: Number(el.power.value), weapon: el.weaponSelect.value });
  }

  // Show the opponent's aim (sent by online.js). Ignored unless it's really their turn.
  function showRemoteAim(by, aim) {
    if (phase !== 'battle' || gameOver || isBusy() || current !== by || isMe(by)) return;
    if (!inventory[by].includes(aim.weapon)) return;
    el.angle.value = aim.angle;
    el.power.value = aim.power;
    el.weaponSelect.value = aim.weapon;
    el.angleVal.textContent = aim.angle + '°';
    el.powerVal.textContent = aim.power;
    draw();
  }

  return {
    init, checkMove, applyMove, isBusy, resetAll, refreshUI, showMenu, showRemoteAim,
    redraw: draw,
    setOnIdle: fn => { onIdle = fn; }
  };
})();

document.addEventListener('DOMContentLoaded', TT.Game.init);
