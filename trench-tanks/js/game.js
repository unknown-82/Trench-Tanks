window.TT = window.TT || {};

TT.Game = (function () {
  "use strict";
  const GRAVITY = 260; // px/s^2
  const H = 506;
  // Arena width follows the screen's shape (set per round, same for both
  // online players); never narrower than the classic 900.
  const MIN_W = 900, MAX_W = 1800;
  let W = MIN_W;
  const Terrain = TT.Terrain;
  const WEAPONS = TT.WEAPONS;
  const CATEGORIES = TT.CATEGORIES;
  const Det = TT.Det;

  let canvas, ctx;
  // The world is always W×H (keeps shots identical online); the view scales it
  // to fit the stage above the floating aim panel and fills the rest with scenery.
  let view = { w: W, h: H, scale: 1, ox: 0, oy: 0, dpr: 1 };
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
  const MAX_DRIVES = 4, DRIVE_STEP = 30; // drive attempts per player per round, px per attempt
  let drivesLeft = [MAX_DRIVES, MAX_DRIVES];
  const TOTAL_PICKS = WEAPONS.length; // 20, split 10/10 by alternating picks
  let onIdle = null;         // called when a shot animation ends (online.js uses it)

  let el = {};

  // Tell the presentation layers (HUD, sound, scenery) what just happened.
  // They only listen: nothing they do can change the game (see js/bus.js).
  function emit(name, data) { if (TT.Bus) TT.Bus.emit(name, data); }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function weaponById(id) { return WEAPONS.find(w => w.id === id); }
  const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  function isBusy() { return projectiles.length > 0; }
  // A tank still rolling to where its drive already put it (animation only).
  function isDriving() { return !!players && players.some(p => p.anim); }

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
    const resizer = new ResizeObserver(resizeCanvas);
    resizer.observe(canvas.parentElement);
    resizer.observe(document.getElementById('aimPanel'));

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
      driveLeft: document.getElementById('driveLeft'),
      driveRight: document.getElementById('driveRight'),
      drivesLeft: document.getElementById('drivesLeft'),
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
    el.startBtn.addEventListener('click', startRound);
    el.randomBtn.addEventListener('click', () => act({ type: 'random', seed: Det.newSeed() }));
    el.angle.addEventListener('input', () => { el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); });
    el.power.addEventListener('input', () => { el.powerVal.textContent = el.power.value; draw(); aimChanged(); });
    el.weaponSelect.addEventListener('change', aimChanged);
    requestAnimationFrame(idleFrame);
    // Switching tab/app mid-shot: finish the shot now instead of freezing.
    document.addEventListener('visibilitychange', () => { if (document.hidden) skipFlight(); });
    el.fireBtn.addEventListener('click', fire);
    el.teleportBtn.addEventListener('click', teleport);
    el.driveLeft.addEventListener('click', () => drive(-1));
    el.driveRight.addEventListener('click', () => drive(1));
    el.newTerrainBtn.addEventListener('click', startRound);
    el.restartBtn.addEventListener('click', () => act({ type: 'redraft' }));
    el.rematchBtn.addEventListener('click', startRound);

    window.addEventListener('keydown', onKey);
  }

  // ---- Moves: the only way the game state changes ----
  // Locally a move is applied straight away. Online it goes through
  // TT.Online so both browsers apply the same moves in the same order.
  function act(move) {
    if (isOnline()) { TT.Online.submit(move); return; }
    const by = move.type === 'pick' ? draftTurn : ['fire', 'teleport', 'drive'].includes(move.type) ? current : 0;
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
        if (!isIntIn(move.width, MIN_W, MAX_W)) return 'bad arena width';
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
      case 'drive':
        if (phase !== 'battle' || gameOver || isBusy()) return 'cannot move right now';
        if (current !== by) return 'not your turn';
        if (drivesLeft[by] <= 0) return 'no moves left this round';
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
        newRound(move.seed, move.width, instant);
        break;
      case 'redraft': backToSelect(); break;
      case 'fire': fireShot(by, move.weapon, move.angle, move.power, instant); break;
      case 'teleport': teleportTank(by, move.seed, instant); break;
      case 'drive': driveTank(by, move.dir, instant); break;
    }
  }

  function showScreen(p) {
    const changed = phase !== p;
    phase = p;
    el.modeScreen.hidden = p !== 'menu';
    el.selectScreen.hidden = p !== 'draft';
    el.gameScreen.hidden = p !== 'battle';
    document.body.classList.toggle('battle', p === 'battle');
    document.body.dataset.screen = p;
    emit('screen', { phase: p, changed });
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
    emit('aim', { remote: true });
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
      section.style.setProperty('--wcolor', cat.color);
      const points = TT.CATEGORY_MAX_POINTS[cat.id] || 0;
      section.innerHTML = `<div class="catHead"><h3>${cat.name}</h3>` +
        `<span class="catPts">${points ? 'up to ' + points + ' pts' : 'no score'}</span></div>` +
        `<p class="catBlurb">${cat.blurb}</p>`;
      const grid = document.createElement('div');
      grid.className = 'weaponGrid';
      WEAPONS.filter(w => w.category === cat.id).forEach(w => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'weaponCard';
        btn.dataset.id = w.id;
        btn.dataset.snd = 'none'; // the pick itself makes the sound
        btn.style.setProperty('--wcolor', cat.color);
        btn.innerHTML = `<span class="wicon">${TT.Art.glyph(w.id)}</span><strong>${w.name}</strong>` +
          `<span class="wdesc">${w.desc}</span><span class="wrad"><b>${w.radius}</b>blast</span>`;
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
    emit('random');
  }

  function choosePick(by, id) {
    inventory[by].push(id);
    const totalTaken = inventory[0].length + inventory[1].length;
    draftTurn = totalTaken >= TOTAL_PICKS ? null : 1 - by;
    if (draftTurn === null) loadout = inventory.map(list => list.slice());
    updateDraftUI();
    emit('pick', { by, id, mine: isMe(by), done: draftTurn === null });
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
      if (owner !== -1) { btn.querySelector('.wdesc').textContent = takenText(owner); btn.dataset.owner = owner; }
      btn.disabled = owner !== -1 || draftTurn === null || !canControl(draftTurn);
    });
    if (draftTurn === null) {
      el.draftPrompt.textContent = 'Both units are fully armed (10 weapons each).';
    } else if (!isSolo()) {
      el.draftPrompt.textContent = `Player ${draftTurn + 1}, choose your weapon`;
    } else {
      el.draftPrompt.textContent = isMe(draftTurn) ? 'Your pick: choose a weapon' : `${label(draftTurn)} is picking…`;
    }
    const guest = isOnline() && !isMe(0);
    el.startBtn.disabled = draftTurn !== null || !canControl(0);
    el.startBtn.textContent = guest ? 'Waiting for the host to start…' : 'Start mission';
    el.randomBtn.hidden = guest;
    el.randomBtn.disabled = !canControl(0);
    el.pickSummary.textContent =
      `${label(0)}: ${inventory[0].length}/10 picked   ·   ${label(1)}: ${inventory[1].length}/10 picked`;
    document.querySelectorAll('.menuBtn').forEach(b => { b.hidden = isOnline(); }); // online uses "Leave"
    emit('draft');
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
  // The arena is as wide as this screen's battlefield (above the aim panel)
  // at the fixed height H. Works before the battle screen is first shown.
  function arenaWidth() {
    const bar = document.getElementById('onlineBar');
    const panel = document.getElementById('aimPanel');
    // Before the first battle the console isn't on screen yet: use its usual height.
    const stacked = window.innerWidth <= 760 || (window.innerWidth <= 900 && window.innerHeight > 520);
    const panelH = panel.offsetHeight || (stacked ? 190 : 120);
    const h = window.innerHeight - (bar.offsetHeight || 0) - panelH - 20;
    const w = Math.round(H * window.innerWidth / Math.max(1, h));
    return Math.max(MIN_W, Math.min(MAX_W, w));
  }
  function startRound() { act({ type: 'round', seed: Det.newSeed(), width: arenaWidth() }); }

  // The seed makes terrain identical on both online players' screens.
  function newRound(seed, width, instant) {
    W = width;
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
    drivesLeft = [MAX_DRIVES, MAX_DRIVES];
    lastSettings = [{ angle: 45, power: 60 }, { angle: 45, power: 60 }];
    el.angle.value = lastSettings[0].angle;
    el.power.value = lastSettings[0].power;
    projectiles = [];
    popups = [];
    fires = [];
    TT.Effects.clear();
    gameOver = false;
    el.banner.style.display = 'none';
    resizeCanvas(); // the arena width may have changed
    emit('round', { quiet: !!instant });
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
    const myTurn = phase === 'battle' && !gameOver && !isBusy() && !isDriving() && canControl(current);
    el.fireBtn.disabled = el.angle.disabled = el.power.disabled = el.weaponSelect.disabled = !myTurn;
    el.teleportBtn.disabled = !myTurn || teleportUsed[current];
    el.teleportBtn.textContent = teleportUsed[current] ? 'Teleport used' : 'Teleport';
    el.drivesLeft.textContent = players ? drivesLeft[current] : MAX_DRIVES;
    el.driveLeft.disabled = el.driveRight.disabled = !myTurn || !drivesLeft[current];
    const guest = isOnline() && !isMe(0);
    el.newTerrainBtn.hidden = el.rematchBtn.hidden = el.restartBtn.hidden = guest;
    el.newTerrainBtn.disabled = isBusy() || !canControl(0);
    el.rematchBtn.disabled = el.restartBtn.disabled = !canControl(0);
    el.bannerNote.textContent = guest ? 'Waiting for the host to start the next round…' : '';
    emit('hud');
    if (phase === 'battle') scheduleBot();
  }

  // A read-only snapshot of the game for the HUD, sound and scenery.
  function state() {
    const inBattle = phase === 'battle' && !!players;
    return {
      phase, mode: isOnline() ? 'online' : mode, botLevel, online: isOnline(), solo: isSolo(),
      labels: [label(0), label(1)], me: [isMe(0), isMe(1)],
      draftTurn, total: TOTAL_PICKS,
      inventory: inventory.map(list => list.slice()),
      loadout: loadout.map(list => list.slice()),
      current: inBattle ? current : 0,
      gameOver: !!gameOver, busy: isBusy(),
      myTurn: inBattle && !gameOver && !isBusy() && !isDriving() && canControl(current),
      dir: inBattle ? players[current].dir : 1,
      scores: inBattle ? players.map(p => p.score) : [0, 0],
      drives: drivesLeft.slice(), maxDrives: MAX_DRIVES, teleportUsed: teleportUsed.slice(),
      tanks: inBattle ? players.map(p => ({ x: p.x, y: p.y })) : null,
      world: { w: W, h: H }, view
    };
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
  // The canvas holds only the playfield (ridges, ground, units, shells and
  // bursts) on a transparent background. The sky behind it is its own layer,
  // painted by js/scene.js, so it can drift with the pointer.
  const TAU = Math.PI * 2;

  function resizeCanvas() {
    const box = canvas.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Keep the playable ground clear of the console; scenery runs underneath it.
    const panel = document.getElementById('aimPanel');
    const fitH = Math.max(box.height * 0.4, box.height - panel.offsetHeight - 20);
    const scale = Math.min(box.width / W, fitH / H);
    view = { w: box.width, h: box.height, scale, dpr,
      ox: (box.width - W * scale) / 2, oy: fitH - H * scale };
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    emit('view', { w: box.width, h: box.height, scale, horizon: view.oy + H * 0.47 * scale });
    draw();
  }

  // Visible area in world coordinates (wider/taller than W×H on most screens).
  function viewRect() {
    const left = -view.ox / view.scale, top = -view.oy / view.scale;
    return { left, top, right: left + view.w / view.scale, bottom: top + view.h / view.scale };
  }

  // '#rrggbb' + alpha -> 'rgba(r,g,b,a)'
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  // Faint survey grid inside the ground (scenery only).
  let gridPattern = null;
  function groundGrid() {
    if (gridPattern) return gridPattern;
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const t = c.getContext('2d');
    t.strokeStyle = 'rgba(110,190,255,0.09)';
    t.lineWidth = 1;
    t.beginPath(); t.moveTo(0.5, 0); t.lineTo(0.5, 40); t.moveTo(0, 0.5); t.lineTo(40, 0.5); t.stroke();
    t.fillStyle = 'rgba(170,225,255,0.24)';
    t.fillRect(0, 0, 2, 2);
    for (let i = 0; i < 26; i++) { // grit
      t.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(150,180,255,0.05)';
      t.fillRect(Math.random() * 40, Math.random() * 40, 1.2, 1.2);
    }
    gridPattern = ctx.createPattern(c, 'repeat');
    return gridPattern;
  }

  // Two ridges of dark alien rock behind the battlefield, each with thin spires
  // and a faint lit rim. Scenery only, so plain Math.sin is fine here.
  const RIDGES = [
    [H * 0.5, 34, 0.0031, 'rgba(10,14,32,0.9)', 'rgba(140,165,255,0.12)'],
    [H * 0.6, 26, 0.0052, 'rgba(6,9,20,0.97)', 'rgba(90,200,255,0.09)']
  ];
  function ridgeY(x, base, amp, freq) {
    const spire = Math.max(0, Math.sin(x * freq * 23 + base)) ** 10;
    return base - amp * (Math.sin(x * freq * 6.283) * 0.6 + Math.sin(x * freq * 15.1 + 1.7) * 0.4) - spire * amp * 0.9;
  }
  function drawBackdrop() {
    const r = viewRect();
    RIDGES.forEach(([base, amp, freq, fill, rim]) => {
      const top = new Path2D();
      for (let x = Math.floor(r.left); x <= r.right + 4; x += 4) top.lineTo(x, ridgeY(x, base, amp, freq));
      const body = new Path2D(top);
      body.lineTo(r.right + 4, r.bottom); body.lineTo(r.left, r.bottom); body.closePath();
      ctx.fillStyle = fill;
      ctx.fill(body);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1;
      ctx.stroke(top);
    });
  }

  function drawTerrain() {
    const heights = Terrain.all();
    const r = viewRect();
    const surf = new Path2D();
    surf.moveTo(r.left, heights[0]);
    for (let x = 0; x < W; x++) surf.lineTo(x, heights[x]);
    surf.lineTo(r.right, heights[W - 1]);
    const body = new Path2D(surf);
    body.lineTo(r.right, r.bottom); body.lineTo(r.left, r.bottom); body.closePath();

    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, '#1b2442');
    g.addColorStop(0.5, '#0d1224');
    g.addColorStop(1, '#05060d');
    ctx.fillStyle = g;
    ctx.fill(body);

    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = groundGrid();
    ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    // energy seeping down from the surface
    ctx.lineJoin = 'round';
    ctx.translate(0, 9);
    ctx.strokeStyle = 'rgba(59,232,255,0.10)'; ctx.lineWidth = 20; ctx.stroke(surf);
    ctx.translate(0, 14);
    ctx.strokeStyle = 'rgba(169,123,255,0.07)'; ctx.lineWidth = 22; ctx.stroke(surf);
    ctx.restore();

    // glowing crust along the top edge: soft halo, bright line, white-hot core
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(59,232,255,0.10)'; ctx.lineWidth = 6; ctx.stroke(surf);
    ctx.strokeStyle = 'rgba(59,232,255,0.42)'; ctx.lineWidth = 2; ctx.stroke(surf);
    ctx.strokeStyle = 'rgba(220,250,255,0.75)'; ctx.lineWidth = 0.8; ctx.stroke(surf);
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
  function poly(points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
  }
  function line(x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function angleForPlayer(p) {
    return (players[current] === p && !projectiles.length) ? Number(el.angle.value) : 35;
  }
  // How far the hull leans on the slope it's standing on.
  function tankTilt(x) { return Math.max(-1, Math.min(1, Math.atan(-groundGrade(x, 1)))); }

  // '#rrggbb' mixed toward white by k (0 = unchanged, 1 = white)
  function tint(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const mix = v => Math.round(v + (255 - v) * k);
    return `rgb(${mix(n >> 16 & 255)},${mix(n >> 8 & 255)},${mix(n & 255)})`;
  }

  // Hull and treads tilt with the slope; the barrel keeps the true aim angle
  // and its tip lines up with where makeShell launches the shell. The hull is
  // 30 px wide: the same width the scoring zones are measured against.
  // The unit must read at a glance against busy scenery: a dark pocket behind
  // it, a hull in the unit's own bright colour, and a white rim.
  function drawTank(p) {
    const pos = tankPos(p);
    const tilt = tankTilt(pos.x);
    const rad = angleForPlayer(p) * Math.PI / 180;
    const active = p === players[current] && !gameOver;
    const blink = active && Math.sin(performance.now() / 160) > 0;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (isBuried(p)) ctx.globalAlpha = 0.4; // faint: it's under the dirt

    // dark pocket, then the unit's own light on the ground
    const pocket = ctx.createRadialGradient(0, -9, 6, 0, -9, 36);
    pocket.addColorStop(0, 'rgba(2,3,10,0.7)');
    pocket.addColorStop(1, 'rgba(2,3,10,0)');
    ctx.fillStyle = pocket;
    ctx.beginPath(); ctx.arc(0, -9, 36, 0, TAU); ctx.fill();
    ctx.save();
    ctx.rotate(tilt);
    ctx.scale(1, 0.3);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
    pool.addColorStop(0, rgba(p.color, active ? 0.6 : 0.35));
    pool.addColorStop(1, rgba(p.color, 0));
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
    ctx.restore();

    if (!active && !gameOver) { // the waiting unit keeps a small marker overhead
      ctx.fillStyle = rgba(p.color, 0.8);
      ctx.beginPath();
      ctx.moveTo(-4, -38); ctx.lineTo(4, -38); ctx.lineTo(0, -33);
      ctx.closePath();
      ctx.fill();
    }

    // barrel, pivoting on the turret
    const px = Math.sin(tilt) * 11, py = -Math.cos(tilt) * 11;
    const bx = Math.cos(rad) * p.dir, by = -Math.sin(rad);
    const tx = px + bx * 22, ty = py + by * 22;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#03040a'; ctx.lineWidth = 6.4; line(px, py, tx, ty);
    ctx.strokeStyle = tint(p.color, 0.25); ctx.lineWidth = 3.8; line(px, py, tx, ty);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.9; line(px + bx * 4, py + by * 4, tx - bx * 5, ty - by * 5);
    ctx.strokeStyle = '#03040a'; ctx.lineWidth = 7.2; line(tx - bx * 4.5, ty - by * 4.5, tx, ty); // muzzle brake
    ctx.strokeStyle = tint(p.color, 0.5); ctx.lineWidth = 4.6; line(tx - bx * 3.6, ty - by * 3.6, tx - bx * 0.9, ty - by * 0.9);
    if (active) {
      ctx.save();
      ctx.shadowColor = p.color; ctx.shadowBlur = 9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(tx, ty, 1.5, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.rotate(tilt);
    ctx.scale(p.dir, 1); // the hull's nose points at the opponent
    const rim = 'rgba(255,255,255,0.92)';
    // treads and road wheels
    ctx.fillStyle = '#05060c';
    roundRect(-15, -6.5, 30, 6.5, 3.2);
    ctx.fill();
    ctx.strokeStyle = tint(p.color, 0.45); ctx.lineWidth = 0.9; ctx.stroke();
    const spin = pos.x / 2 * p.dir; // wheels roll as the unit drives (radius 2)
    const sx = Math.cos(spin) * 1.7, sy = Math.sin(spin) * 1.7;
    [-10, -3.5, 3.5, 10].forEach(wx => {
      ctx.fillStyle = tint(p.color, 0.2);
      ctx.beginPath(); ctx.arc(wx, -3.2, 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#05060c'; ctx.lineWidth = 0.8;
      line(wx - sx, -3.2 - sy, wx + sx, -3.2 + sy);
    });

    // armoured hull in the unit's colour, glowing a little
    let shade = ctx.createLinearGradient(0, -12, 0, -6);
    shade.addColorStop(0, tint(p.color, 0.3));
    shade.addColorStop(1, p.color);
    ctx.shadowColor = p.color; ctx.shadowBlur = active ? 14 : 9;
    ctx.fillStyle = shade;
    poly([[-14, -6.2], [-13.5, -9.6], [-8, -12], [9, -12], [14.5, -8.8], [14.5, -6.2]]);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rim; ctx.lineWidth = 0.9; ctx.stroke();
    // turret
    shade = ctx.createLinearGradient(0, -17.5, 0, -12);
    shade.addColorStop(0, tint(p.color, 0.6));
    shade.addColorStop(1, tint(p.color, 0.15));
    ctx.fillStyle = shade;
    poly([[-6.5, -12], [-4.5, -17.5], [4, -17.5], [8, -12]]);
    ctx.fill(); ctx.stroke();
    // panel line, reactor core, antenna beacon
    ctx.strokeStyle = 'rgba(3,4,10,0.6)'; ctx.lineWidth = 1.1;
    line(-12.4, -8.1, 13.2, -8.1);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0.5, -14.7, 1.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 0.7;
    line(-5, -17.5, -8, -24.5);
    ctx.fillStyle = blink || !active ? tint(p.color, 0.4) : 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(-8, -24.5, 1.3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Targeting overlay on the unit whose turn it is: an elevation arc, the
  // bearing the barrel is on, and a vector whose length follows the power.
  // It only shows the two numbers already on the console (angle and power);
  // it does not predict where the shell lands. Kept thin and clear of the hull
  // so it never hides the unit.
  function drawReticle() {
    if (gameOver || projectiles.length) return;
    const p = players[current], pos = tankPos(p);
    const tilt = tankTilt(pos.x);
    const px = pos.x + Math.sin(tilt) * 11, py = pos.y - Math.cos(tilt) * 11;
    const deg = Number(el.angle.value), power = Number(el.power.value);
    const rad = deg * Math.PI / 180;
    const bx = Math.cos(rad) * p.dir, by = -Math.sin(rad);
    const t = performance.now() / 1000;
    const R = 42;

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(p.color, 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, R, Math.PI, 0); ctx.stroke();
    for (let a = 0; a <= 180; a += 45) {
      const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
      line(px + c * R, py - s * R, px + c * (R + 4), py - s * (R + 4));
    }
    // swept from level (facing the opponent) up to the barrel
    ctx.strokeStyle = rgba(p.color, 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(px, py, R, p.dir === 1 ? 0 : Math.PI, Math.atan2(by, bx), p.dir === 1);
    ctx.stroke();

    // power vector, starting beyond the muzzle
    const start = 30, len = 14 + power * 0.9;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -t * 26;
    ctx.lineWidth = 1.2;
    line(px + bx * start, py + by * start, px + bx * (start + len), py + by * (start + len));
    ctx.setLineDash([]);
    const ex = px + bx * (start + len + 6), ey = py + by * (start + len + 6);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(t * 1.3);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, -3, 6, 6);
    ctx.restore();

    // marker bobbing over the unit to say "your move"
    const cy = pos.y - 44 + Math.sin(t * 3) * 2.5;
    ctx.fillStyle = tint(p.color, 0.3);
    ctx.beginPath();
    ctx.moveTo(pos.x - 5, cy); ctx.lineTo(pos.x + 5, cy); ctx.lineTo(pos.x, cy + 6);
    ctx.closePath();
    ctx.fill();

    if (view.scale >= 0.7) { // too small to read on a shrunken arena
      ctx.font = '700 9px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${deg}° / ${power}`, ex + bx * 6, Math.max(viewRect().top + 12, ey + by * 6 - 8));
    }
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
      case 'dirt': // canister of regolith with a hazard band, tumbling
        ctx.rotate(-angle + pr.steps * 0.2);
        ctx.fillStyle = '#3a4258';
        roundRect(-7, -4.5, 14, 9, 2.5);
        ctx.fill();
        ctx.fillStyle = pr.color;
        ctx.fillRect(-2.5, -4.5, 5, 9);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.7;
        line(-6, -3.4, 6, -3.4);
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
      default: // shooter: white-hot plasma bolt
        ctx.shadowColor = pr.color; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.quadraticCurveTo(3, -3.2, -7, -2.6);
        ctx.lineTo(-7, 2.6);
        ctx.quadraticCurveTo(3, 3.2, 8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(1.5, 0, 4, 1.4, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Magic and attacker shells have their own look (js/effects.js); the rest
  // get a glowing tail plus their category's shape.
  function drawProjectiles() {
    projectiles.forEach(pr => {
      if (TT.Effects.drawShell(ctx, pr, pr.y >= Terrain.heightAt(pr.x))) return;
      const dirt = pr.weapon.category === 'dirt';
      TT.Effects.tail(ctx, pr, pr.color, dirt ? 3 : 5, dirt ? 14 : 30);
      if (!dirt) TT.Effects.tail(ctx, pr, '#ffffff', 1.6, 12);
      drawShellShape(pr);
    });
  }

  function drawPopups() {
    popups.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.font = '700 16px Orbitron, Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = p.color; ctx.shadowBlur = 10;
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.shadowBlur = 0;
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
      ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 14;
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

  let lastDraw = 0;
  function draw() {
    if (!players) return;
    lastDraw = performance.now();
    const { scale, dpr, ox, oy } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    drawBackdrop();
    drawTerrain();
    players.forEach(drawTank);
    drawReticle();
    drawFires();
    drawProjectiles();
    TT.Effects.draw(ctx);
    drawPopups();
  }

  // Keeps the targeting overlay and unit lights moving between shots (about
  // 30 fps). It does nothing while a shot or burst is already redrawing, when
  // the tab is hidden, or when the player asked for reduced motion.
  const calmMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function idleFrame(now) {
    requestAnimationFrame(idleFrame);
    if (calmMotion || phase !== 'battle' || document.hidden || !players || gameOver) return;
    if (now - lastDraw > 30) draw();
  }

  function spawnPopup(x, y, points) {
    showPopup(x, y, `+${Math.round(points)}`, points > 0 ? '#7dffc0' : '#ffffffaa');
  }
  function showPopup(x, y, text, color) {
    popups.push({ x, y, text, alpha: 1, color });
    animateEffects();
  }
  // The weapon's impact burst (js/effects.js), one spot per blast.
  function playImpact(weapon, spots) {
    TT.Effects.impact(weapon, spots);
    animateEffects();
    emit('impact', { weapon, spots, width: W });
  }
  const FIRE_MS = 4000;
  function startFire(spot) {
    fires.push(Object.assign({ until: performance.now() + FIRE_MS }, spot));
    animateEffects();
    emit('burn', { onTank: spot.player !== undefined, ms: FIRE_MS, width: W,
      x: spot.player !== undefined ? players[spot.player].x : spot.x });
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
      if (players) players.forEach(p => {
        if (p.anim && (now - p.anim.start) / 1000 * DRIVE_SPEED >= p.anim.path.length - 1) {
          p.anim = null;
          refreshControls();
        }
      });
      draw();
      if (popups.length || fires.length || TT.Effects.active() || isDriving()) requestAnimationFrame(step);
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
  // Scoring zones, measured as the real distance from the middle of the blast
  // to the spot the opponent's tank stands on (the drawn hull is 30 px wide).
  // Points follow what you SEE: the white ring every blast draws is its true
  // edge. See shotShare() for the zones.
  const HULL_HALF = 15;       // half the drawn hull width
  const DEAD_CENTRE = 5;      // this close to the middle: full points
  const EDGE_SHARE = 0.8;     // landing right at the hull's edge: 80%
  const GRAZE_SHARE = 0.3;    // blast only just reaching the hull: 30%
  const NEAR_MISS = TT.NEAR_MISS_PX; // px past the blast's reach that still score a little
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
    stopDriving();
    inventory[by].splice(inventory[by].indexOf(weapon.id), 1); // each weapon fires once
    lastSettings[by] = { angle: angleDeg, power };
    const shell = makeShell(players[by], weapon, angleDeg, power);
    projectiles = [shell];
    const quiet = instant || document.hidden;
    emit('fire', { by, weapon, x: shell.x, y: shell.y, width: W, quiet });

    // Replays, and hidden tabs (where animation is paused), resolve the
    // whole flight at once. Same fixed steps = same result.
    if (quiet) {
      while (!stepShot(true));
      draw();
      return;
    }
    TT.Effects.muzzle(shell.x, shell.y, Math.atan2(shell.vy, shell.vx), shell.color);
    animateEffects();
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

  function drive(dir) {
    if (!canControl(current)) return;
    act({ type: 'drive', dir });
  }
  // The tank rolls one px at a time along the ground, up to DRIVE_STEP px, and
  // stops where it can't go on: a hill too steep to climb, a sudden spike or
  // ledge, the arena edge or the other tank. Pure terrain maths, so both online
  // players get the same end point. Every attempt costs a move, even if it goes nowhere.
  //
  // Like a real vehicle, steepness is judged over the tank's whole length (the
  // hill under its tracks), so smooth hills are climbable up to MAX_GRADE; a
  // sudden jump in the ground right in front of it (crater rim, dirt wall, or
  // the tank being buried) stops it however gentle the hill around it is.
  const TANK_HALF = 12;     // half the track length, px
  const MAX_GRADE = 1.6;    // steepest climb under the tracks: rise per px (~58°)
  const MAX_STEP = 4;       // a bigger rise in 1 px is a spike the tank can't mount
  const MAX_DROP = 5;       // a bigger fall in 1 px is a ledge it won't drive off
  const DRIVE_SPEED = 40;   // px/s, animation only
  // How much the ground rises per px over the tank's length, heading `dir`.
  function groundGrade(x, dir) {
    return (Terrain.heightAt(x - dir * TANK_HALF) - Terrain.heightAt(x + dir * TANK_HALF)) / (2 * TANK_HALF);
  }
  function drivePath(by, dir) {
    const p = players[by], other = players[1 - by].x;
    const path = [{ x: p.x, y: p.y }];
    let { x, y } = p, blocked = null;
    for (let i = 0; i < DRIVE_STEP; i++) {
      const nx = x + dir, ny = Terrain.heightAt(nx);
      if (nx < TANK_MARGIN || nx > W - TANK_MARGIN) blocked = 'edge';
      else if (Math.abs(nx - other) <= TANK_GAP) blocked = 'too close';
      else if (y - ny > MAX_STEP) blocked = isBuried(p) && i === 0 ? 'buried' : 'too bumpy';
      else if (ny - y > MAX_DROP) blocked = 'ledge';
      else if (groundGrade(nx, dir) > MAX_GRADE) blocked = 'too steep';
      if (blocked) break;
      x = nx; y = ny;
      path.push({ x, y });
    }
    return { path, blocked };
  }
  function driveTank(by, dir, instant) {
    const p = players[by];
    const { path, blocked } = drivePath(by, dir);
    drivesLeft[by]--;
    Object.assign(p, path[path.length - 1]);
    if (!instant) {
      // hidden tabs pause animation, so there the tank just arrives
      if (path.length > 1 && !document.hidden) {
        const anim = { path, start: performance.now() };
        p.anim = anim;
        animateEffects();
        // Backup: if the browser stops drawing frames (window covered), the roll
        // still ends on time, so the controls never stay locked.
        setTimeout(() => {
          if (p.anim === anim) { p.anim = null; refreshControls(); draw(); }
        }, (path.length - 1) / DRIVE_SPEED * 1000 + 300);
      }
      if (blocked) showPopup(p.x, p.y - 30, path.length > 1 ? blocked : `stuck: ${blocked}`, '#ffffffaa');
      emit('drive', { by, moved: path.length - 1, blocked, x: p.x, width: W });
    }
    refreshControls();
    draw();
  }
  // Where to draw a tank: partway along its drive while it's still rolling.
  function tankPos(p) {
    if (!p.anim) return p;
    const { path, start } = p.anim;
    const t = Math.min(path.length - 1, (performance.now() - start) / 1000 * DRIVE_SPEED);
    const a = path[Math.floor(t)], b = path[Math.ceil(t)], k = t - Math.floor(t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  function stopDriving() { if (players) players.forEach(p => { p.anim = null; }); }

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
    stopDriving();
    teleportUsed[by] = true;
    const from = { x: p.x, y: p.y };
    p.x = spots[Math.floor(Det.rng(seed)() * spots.length)];
    placeOnGround(p);
    if (!instant) {
      TT.Effects.warp(from.x, from.y - 9, p.x, p.y - 9);
      showPopup(p.x, p.y - 34, 'warp', '#d9c8ff');
      emit('teleport', { by, x: p.x, width: W });
    }
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
    const pr = projectiles[0];
    if (pr) emit('flight', { x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, width: W, height: H });
    draw();
  }

  function endFlight(f) {
    clearInterval(f.timer);
    flight = null;
    emit('land');
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
    if (flight) { clearInterval(flight.timer); emit('land'); }
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
        scoreShot(pr, hit, 0, pr.x, pr.y, quiet);
      }
      else {
        if (!quiet) showPopup(Math.max(40, Math.min(W - 40, pr.x)), H - 20, 'missed', '#ffffffaa');
        emit('miss', { by: current, weapon: pr.weapon, quiet: !!quiet });
      }
    } else if (hit !== 'oob') resolveImpact(pr, hit, quiet);
    else emit('miss', { by: current, weapon: pr.weapon, quiet: !!quiet });
    projectiles = [];
    endOfVolley(quiet);
    return true;
  }

  function resolveImpact(pr, hit, quiet) {
    const w = pr.weapon;
    const impactX = Math.max(0, Math.min(W - 1, pr.x));
    const fx = (w.effect || {}).type;
    const target = players[1 - current];

    // Where each blast goes off: on the ground as it was when the shell landed.
    // The distance to the tank is measured now, before the blast moves anything.
    const blasts = blastXs(w, impactX).map(bx => ({ x: bx, y: Terrain.heightAt(bx) }));
    const dist = blastDistance(blasts, target);

    // Tanks can't be destroyed: blasts only reshape the ground. Dirt piles on
    // top of a tank (burying it), and a tank falls if the ground under it goes.
    blasts.forEach(b => (fx === 'mound' ? Terrain.mound : Terrain.crater)(b.x, w.radius));
    players.forEach(settleTank);
    // y = the new ground (where the burst plays), y0 = the blast's centre (its true edge is drawn around it)
    if (!quiet) playImpact(w, blasts.map(b => ({ x: b.x, y: Terrain.heightAt(b.x), y0: b.y })));

    // Burner: the opponent's tank catches fire if the blast reaches it,
    // otherwise the ground where it landed burns for a moment.
    if (fx === 'burn' && !quiet) {
      const reached = hit === 'tank' || dist <= HULL_HALF + w.radius;
      startFire(reached ? { player: 1 - current } : { x: impactX, y: Terrain.heightAt(impactX) });
    }
    scoreShot(pr, hit, dist, impactX, pr.y, quiet);
  }

  // How far the nearest blast is from the opponent's tank, in px. This is the
  // real straight-line distance (left-right AND up-down) from the middle of the
  // blast to the spot the tank is standing on. So a blast at the foot of a
  // cliff is far from a tank on top of it, and dirt piled over a buried tank
  // really does shield it.
  // Math.sqrt gives the same result in every browser (terrain.js relies on
  // that too), so both online players get the same distance.
  function blastDistance(blasts, tank) {
    let nearest = Infinity;
    for (const b of blasts) {
      const dx = b.x - tank.x, dy = b.y - tank.y;
      nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
    }
    return nearest;
  }

  // Share of the category's points for a blast `dist` px from the tank:
  //   on the hull (within HULL_HALF px)    100% at the middle -> 80% at its edge
  //   blast reaches the hull               80% -> 30% as it only just grazes it
  //                                        (reach = HULL_HALF + blast radius)
  //   near miss (up to NEAR_MISS px more)  30% -> 0, fading with distance
  //   further away                         0
  // There is no sudden drop anywhere: the closer the blast, the more it scores.
  function shotShare(dist, radius) {
    const reach = HULL_HALF + radius;
    if (dist <= DEAD_CENTRE) return 1;
    if (dist <= HULL_HALF) return 1 - (1 - EDGE_SHARE) * (dist - DEAD_CENTRE) / (HULL_HALF - DEAD_CENTRE);
    if (dist <= reach) return EDGE_SHARE - (EDGE_SHARE - GRAZE_SHARE) * (dist - HULL_HALF) / radius;
    if (dist <= reach + NEAR_MISS) return GRAZE_SHARE * (1 - (dist - reach) / NEAR_MISS);
    return 0;
  }

  // Points for a shot whose nearest blast went off `dist` px from the tank.
  // `hit` is 'tank' when the shell itself touched the opponent's tank, which
  // always earns the category's full points. The Beaver leaves no blast, so it
  // only scores on a direct hit; dirt movers never score. Rounded to the nearest 5.
  function shotPoints(w, hit, dist) {
    const max = TT.CATEGORY_MAX_POINTS[w.category] || 0;
    if (!max) return 0;
    if (hit === 'tank') return max;
    if ((w.effect || {}).type === 'tunnel') return 0;
    return Math.round(shotShare(dist, w.radius) * max / 5) * 5;
  }

  function scoreShot(pr, hit, dist, x, y, quiet) {
    const points = shotPoints(pr.weapon, hit, dist);
    players[current].score += Math.round(points);
    if (!quiet) spawnPopup(x, y, points);
    emit('score', { by: current, points, max: TT.CATEGORY_MAX_POINTS[pr.weapon.category] || 0,
      direct: hit === 'tank', dist: hit === 'tank' ? 0 : Math.round(dist), weapon: pr.weapon, x, width: W, quiet: !!quiet });
  }

  // The match always lasts until both players have fired all their weapons.
  function endOfVolley(quiet) {
    if (!inventory[0].length && !inventory[1].length) { updateHUD(); endGame(quiet); return; }
    const before = current;
    if (inventory[1 - current].length) current = 1 - current;
    el.angle.value = lastSettings[current].angle;
    el.power.value = lastSettings[current].power;
    updateHUD();
    emit('turn', { current, changed: current !== before, mine: isMe(current), solo: isSolo(), quiet: !!quiet });
  }

  function endGame(quiet) {
    gameOver = true;
    const [a, b] = [players[0].score, players[1].score];
    const winner = a > b ? 0 : b > a ? 1 : -1;
    const result = winner === -1 ? "It's a draw!" : isSolo() && isMe(winner) ? 'You win!' : `${label(winner)} wins!`;
    el.bannerText.textContent = `${result} ${a} – ${b}`;
    el.banner.style.display = 'flex';
    refreshControls();
    emit('gameover', { winner, scores: [a, b], solo: isSolo(),
      won: winner !== -1 && isSolo() && isMe(winner), quiet: !!quiet });
  }

  function onKey(e) {
    if (phase !== 'battle') return;
    if (e.target.matches && e.target.matches('input[type=text], textarea')) return; // typing in chat
    if (gameOver || isBusy() || isDriving() || !canControl(current)) return;
    // A focused slider or weapon list already moves itself with the arrows
    if (e.code.startsWith('Arrow') && e.target.matches && e.target.matches('input[type=range], select')) return;
    if (e.code === 'Space') { e.preventDefault(); fire(); }
    else if (e.code === 'KeyT') teleport();
    else if (e.code === 'KeyA') drive(-1);
    else if (e.code === 'KeyD') drive(1);
    else if (e.code === 'ArrowUp') { e.preventDefault(); el.power.value = Math.min(100, Number(el.power.value) + 2); el.powerVal.textContent = el.power.value; draw(); aimChanged(); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); el.power.value = Math.max(10, Number(el.power.value) - 2); el.powerVal.textContent = el.power.value; draw(); aimChanged(); }
    else if (e.code === 'ArrowLeft') { el.angle.value = Math.max(0, Number(el.angle.value) - 2); el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); }
    else if (e.code === 'ArrowRight') { el.angle.value = Math.min(180, Number(el.angle.value) + 2); el.angleVal.textContent = el.angle.value + '°'; draw(); aimChanged(); }
  }

  // ---- Live aim preview (online) ----
  // While it's your turn, tell the opponent how you're aiming so their screen
  // shows your barrel, power and weapon moving. Preview only: not a move.
  function aimChanged() {
    emit('aim', { remote: false });
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
    emit('aim', { remote: true });
  }

  return {
    init, checkMove, applyMove, isBusy, resetAll, refreshUI, showMenu, showRemoteAim, state,
    redraw: draw,
    setOnIdle: fn => { onIdle = fn; }
  };
})();

document.addEventListener('DOMContentLoaded', TT.Game.init);
