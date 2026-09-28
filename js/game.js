window.TT = window.TT || {};

TT.Game = (function () {
  "use strict";
  const GRAVITY = 260; // px/s^2
  const W = 900, H = 506;
  const Terrain = TT.Terrain;
  const WEAPONS = TT.WEAPONS;
  const CATEGORIES = TT.CATEGORIES;

  let canvas, ctx;
  let players, current, projectiles, gameOver, wind, popups;
  let inventory = [[], []];  // weapon ids each player drafted and hasn't used yet
  let lastSettings = [{ angle: 45, power: 60 }, { angle: 45, power: 60 }]; // each player's own last aim
  let draftTurn = 0;         // whose turn it is to pick (0 or 1), null once pool is empty
  const TOTAL_PICKS = WEAPONS.length; // 20, split 10/10 by alternating picks

  let el = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function weaponById(id) { return id === TT.FALLBACK_WEAPON.id ? TT.FALLBACK_WEAPON : WEAPONS.find(w => w.id === id); }

  function init() {
    canvas = document.getElementById('c');
    ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;

    el = {
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
      newTerrainBtn: document.getElementById('newTerrainBtn'),
      turnFlag: document.getElementById('turnFlag'),
      weaponSelect: document.getElementById('weaponSelect'),
      windVal: document.getElementById('windVal'),
      banner: document.getElementById('banner'),
      bannerText: document.getElementById('bannerText'),
      restartBtn: document.getElementById('restartBtn'),
      rematchBtn: document.getElementById('rematchBtn'),
      healthBars: [
        document.querySelector('#p1 .healthbar i'),
        document.querySelector('#p2 .healthbar i')
      ],
      scoreEls: [
        document.getElementById('scoreP1'),
        document.getElementById('scoreP2')
      ]
    };

    buildWeaponPool();
    updateDraftUI();

    el.startBtn.addEventListener('click', startMatch);
    el.randomBtn.addEventListener('click', randomDistribute);
    el.angle.addEventListener('input', () => { el.angleVal.textContent = el.angle.value + '°'; draw(); });
    el.power.addEventListener('input', () => { el.powerVal.textContent = el.power.value; });
    el.fireBtn.addEventListener('click', fire);
    el.newTerrainBtn.addEventListener('click', () => { if (!projectiles.length) newRound(true); });
    el.restartBtn.addEventListener('click', backToSelect);
    el.rematchBtn.addEventListener('click', () => newRound(true));

    window.addEventListener('keydown', onKey);
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
        btn.addEventListener('click', () => choosePick(w.id, btn));
        grid.appendChild(btn);
      });
      section.appendChild(grid);
      el.weaponPool.appendChild(section);
    });
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randomDistribute() {
    const ids = shuffled(WEAPONS.map(w => w.id));
    inventory = [ids.slice(0, TOTAL_PICKS / 2), ids.slice(TOTAL_PICKS / 2)];
    draftTurn = null;
    el.weaponPool.querySelectorAll('.weaponCard').forEach(btn => {
      const ownerIdx = inventory[0].includes(btn.dataset.id) ? 0 : 1;
      btn.disabled = true;
      btn.classList.add('taken');
      btn.querySelector('.wdesc').textContent = `Taken by Player ${ownerIdx + 1}`;
    });
    updateDraftUI();
  }

  function choosePick(id, btn) {
    if (draftTurn === null || btn.disabled) return;
    inventory[draftTurn].push(id);
    btn.disabled = true;
    btn.classList.add('taken');
    btn.querySelector('.wdesc').textContent = `Taken by Player ${draftTurn + 1}`;
    const totalTaken = inventory[0].length + inventory[1].length;
    draftTurn = totalTaken >= TOTAL_PICKS ? null : (draftTurn === 0 ? 1 : 0);
    updateDraftUI();
  }

  function updateDraftUI() {
    if (draftTurn === null) {
      el.draftPrompt.textContent = 'Both players are fully armed (10 weapons each).';
      el.startBtn.disabled = false;
    } else {
      el.draftPrompt.textContent = `Player ${draftTurn + 1}, choose your weapon`;
      el.startBtn.disabled = true;
    }
    el.pickSummary.textContent =
      `Player 1: ${inventory[0].length}/10 picked   ·   Player 2: ${inventory[1].length}/10 picked`;
  }

  function startMatch() {
    if (draftTurn !== null) return;
    el.selectScreen.style.display = 'none';
    el.gameScreen.style.display = 'block';
    newRound(true);
  }

  function backToSelect() {
    el.banner.style.display = 'none';
    el.gameScreen.style.display = 'none';
    el.selectScreen.style.display = 'block';
    inventory = [[], []];
    draftTurn = 0;
    buildWeaponPool();
    updateDraftUI();
  }

  // ---- Match lifecycle ----
  function newRound(freshTerrain) {
    if (freshTerrain) Terrain.generate(W, H);
    wind = Math.round((Math.random() * 2 - 1) * 40);
    players = [
      { x: W * 0.12, y: 0, health: 100, score: 0, color: cssVar('--p1'), dark: cssVar('--p1-dark'), dir: 1 },
      { x: W * 0.88, y: 0, health: 100, score: 0, color: cssVar('--p2'), dark: cssVar('--p2-dark'), dir: -1 }
    ];
    players.forEach(settleTank);
    current = 0;
    lastSettings = [{ angle: 45, power: 60 }, { angle: 45, power: 60 }];
    el.angle.value = lastSettings[0].angle;
    el.power.value = lastSettings[0].power;
    projectiles = [];
    popups = [];
    gameOver = false;
    el.banner.style.display = 'none';
    el.fireBtn.disabled = false;
    updateHUD();
    draw();
  }

  function settleTank(p) { p.y = Terrain.heightAt(p.x); }

  function updateHUD() {
    el.healthBars[0].style.width = Math.max(0, players[0].health) + '%';
    el.healthBars[1].style.width = Math.max(0, players[1].health) + '%';
    el.scoreEls[0].textContent = `${players[0].score} pts`;
    el.scoreEls[1].textContent = `${players[1].score} pts`;
    el.turnFlag.textContent = `Player ${current + 1}'s`;
    el.windVal.textContent = (wind > 0 ? '+' : '') + Math.round(wind) + (wind > 0 ? ' →' : wind < 0 ? ' ←' : '');
    el.angleVal.textContent = el.angle.value + '°';
    el.powerVal.textContent = el.power.value;
    populateWeaponSelect();
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
    const fallbackOpt = document.createElement('option');
    fallbackOpt.value = TT.FALLBACK_WEAPON.id;
    fallbackOpt.textContent = `${TT.FALLBACK_WEAPON.icon} ${TT.FALLBACK_WEAPON.name} (unlimited)`;
    el.weaponSelect.appendChild(fallbackOpt);
    if ([...el.weaponSelect.options].some(o => o.value === previous)) el.weaponSelect.value = previous;
  }

  function currentWeapon() {
    return weaponById(el.weaponSelect.value || TT.FALLBACK_WEAPON.id);
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
    const groundY = Terrain.heightAt(p.x);
    ctx.save();
    ctx.translate(p.x, groundY);
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

  function drawProjectiles() {
    projectiles.forEach(pr => {
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

  function draw() {
    drawSky();
    drawTerrain();
    players.forEach(drawTank);
    drawProjectiles();
    drawPopups();
  }

  function spawnPopup(x, y, points) {
    popups.push({ x, y, text: `+${Math.round(points)}`, alpha: 1, color: points > 0 ? '#c9ff8a' : '#ffffffaa' });
    animatePopups();
  }

  let popupAnimating = false;
  function animatePopups() {
    if (popupAnimating) return;
    popupAnimating = true;
    let last = performance.now();
    requestAnimationFrame(function step(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      popups.forEach(p => { p.y -= 40 * dt; p.alpha -= dt * 0.9; });
      popups = popups.filter(p => p.alpha > 0);
      draw();
      if (popups.length) requestAnimationFrame(step);
      else popupAnimating = false;
    });
  }

  // ---- Firing & physics ----
  function clampInputs() {
    el.angle.value = Math.max(0, Math.min(180, Number(el.angle.value)));
    el.power.value = Math.max(10, Math.min(100, Number(el.power.value)));
  }

  // One trajectory formula for EVERY weapon: launch speed depends only on
  // power, gravity and wind are constant. Weapons differ only in what happens
  // on impact, so the same angle + power always lands in the same place.
  const SPEED_PER_POWER = 6.5;
  const ACCURACY_RANGE = 150; // px from the opponent that still earns points

  function makeShell(shooter, weapon, angleDeg, power) {
    const angle = angleDeg * Math.PI / 180;
    const speed = power * SPEED_PER_POWER;
    const groundY = Terrain.heightAt(shooter.x);
    return {
      x: shooter.x + Math.cos(angle) * 24 * shooter.dir,
      y: groundY - 14 - Math.sin(angle) * 24,
      vx: Math.cos(angle) * speed * shooter.dir,
      vy: -Math.sin(angle) * speed,
      color: (CATEGORIES.find(c => c.id === weapon.category) || {}).color || '#ffe08a',
      weapon, trail: [], done: false
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

  function fire() {
    if (gameOver || projectiles.length) return;
    clampInputs();
    const shooter = players[current];
    const weapon = currentWeapon();
    const angleDeg = Number(el.angle.value);
    const power = Number(el.power.value);

    if (weapon.id !== TT.FALLBACK_WEAPON.id) {
      const idx = inventory[current].indexOf(weapon.id);
      if (idx !== -1) inventory[current].splice(idx, 1);
    }

    projectiles = [makeShell(shooter, weapon, angleDeg, power)];

    el.fireBtn.disabled = true;
    // Fixed timestep keeps results identical regardless of frame rate.
    const dt = 1 / 60;
    requestAnimationFrame(function step() {
      const pr = projectiles[0];
      pr.vx += wind * dt;
      pr.vy += GRAVITY * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.trail.push({ x: pr.x, y: pr.y });
      if (pr.trail.length > 40) pr.trail.shift();

      let hit = null;
      if (pr.x < -20 || pr.x > W + 20 || pr.y > H + 40) hit = 'oob';
      else if (pr.y >= Terrain.heightAt(pr.x)) hit = 'ground';
      else {
        for (const p of players) {
          const dx = pr.x - p.x, dy = pr.y - (Terrain.heightAt(p.x) - 8);
          if (dx * dx + dy * dy < 16 * 16) { hit = 'tank'; break; }
        }
      }

      if (!hit) { draw(); requestAnimationFrame(step); return; }

      if (hit !== 'oob') resolveImpact(pr, hit);
      projectiles = [];
      draw();
      endOfVolley();
    });
  }

  function resolveImpact(pr, hit) {
    const w = pr.weapon;
    const impactX = Math.max(0, Math.min(W - 1, pr.x));
    const isMound = w.effect && w.effect.type === 'mound';
    const damage = [0, 0];

    blastXs(w, impactX).forEach(bx => {
      (isMound ? Terrain.mound : Terrain.crater)(bx, w.radius);
      players.forEach((p, idx) => {
        const dist = Math.abs(p.x - bx);
        if (dist < w.radius + 12) {
          damage[idx] += Math.round((1 - dist / (w.radius + 12)) * w.damage);
        }
      });
    });
    players.forEach((p, idx) => { p.health = Math.max(0, p.health - damage[idx]); });
    players.forEach(settleTank);

    // Score uses the same accuracy formula for every weapon; only the
    // category's max points differ (dirt movers are worth 0).
    const maxPoints = TT.CATEGORY_MAX_POINTS[w.category] || 0;
    const target = players[1 - current];
    const dist = hit === 'tank' ? 0 : Math.abs(target.x - impactX);
    const points = Math.max(0, 1 - dist / ACCURACY_RANGE) * maxPoints;
    players[current].score += Math.round(points);
    spawnPopup(impactX, pr.y, points);
  }

  function endOfVolley() {
    updateHUD();
    const loser = players.find(p => p.health <= 0);
    if (loser) { endGame(); return; }
    lastSettings[current] = { angle: Number(el.angle.value), power: Number(el.power.value) };
    current = 1 - current;
    el.angle.value = lastSettings[current].angle;
    el.power.value = lastSettings[current].power;
    el.fireBtn.disabled = false;
    updateHUD();
  }

  function endGame() {
    gameOver = true;
    el.fireBtn.disabled = true;
    const winner = players[0].health <= 0 ? 2 : 1;
    el.bannerText.textContent = `Player ${winner} wins!`;
    el.banner.style.display = 'flex';
  }

  function onKey(e) {
    if (el.selectScreen.style.display !== 'none') return;
    if (gameOver || projectiles.length) return;
    if (e.code === 'Space') { e.preventDefault(); fire(); }
    else if (e.code === 'ArrowUp') { el.power.value = Math.min(100, Number(el.power.value) + 2); el.powerVal.textContent = el.power.value; }
    else if (e.code === 'ArrowDown') { el.power.value = Math.max(10, Number(el.power.value) - 2); el.powerVal.textContent = el.power.value; }
    else if (e.code === 'ArrowLeft') { el.angle.value = Math.max(0, Number(el.angle.value) - 2); el.angleVal.textContent = el.angle.value + '°'; draw(); }
    else if (e.code === 'ArrowRight') { el.angle.value = Math.min(180, Number(el.angle.value) + 2); el.angleVal.textContent = el.angle.value + '°'; draw(); }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', TT.Game.init);
