// Weapon visuals: how each magic / attacker shell looks in flight and the
// burst it makes on impact. Purely cosmetic: nothing here changes the game,
// so it can use Math.random freely (online, both players see the same shot
// land in the same place, just with slightly different sparks).
window.TT = window.TT || {};
TT.Effects = (function () {
  "use strict";
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = k => 1 - (1 - k) * (1 - k);

  // ---- Drawing helpers ----
  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill();
  }
  function star(ctx, x, y, r, color, points = 4) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = i * Math.PI / points - Math.PI / 2, rr = i % 2 ? r * 0.3 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }
  // Fading, tapering tail along the shell's recent path (world coordinates).
  function tail(ctx, pr, color, width, len = 40) {
    const t = pr.trail.slice(-len);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    for (let i = 1; i < t.length; i++) {
      const k = i / t.length;
      ctx.globalAlpha = k * 0.85;
      ctx.lineWidth = Math.max(0.5, width * k);
      ctx.beginPath(); ctx.moveTo(t[i - 1].x, t[i - 1].y); ctx.lineTo(t[i].x, t[i].y); ctx.stroke();
    }
    ctx.restore();
  }
  // Little smoke puffs left behind every few steps.
  function puffs(ctx, pr, color, every = 5) {
    ctx.save();
    pr.trail.forEach((pt, i) => {
      if (i % every) return;
      const k = i / pr.trail.length;
      ctx.globalAlpha = k * 0.35;
      circle(ctx, pt.x, pt.y, 2 + (1 - k) * 5, color);
    });
    ctx.restore();
  }

  // ---- Shells in flight ----
  // Each draws in local coordinates: origin at the shell, +x = direction of
  // travel. `world` runs first, before that transform (for tails).
  const SHELLS = {
    // Attackers
    bigbertha: { // round black bomb with a sputtering fuse, tumbling
      world: (ctx, pr) => puffs(ctx, pr, '#777'),
      local(ctx, pr, angle) {
        ctx.rotate(-angle + pr.steps * 0.08);
        circle(ctx, 0, 0, 7.5, '#262a38');
        ctx.strokeStyle = '#ff7a1f'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); ctx.stroke();
        circle(ctx, -2.5, -2.5, 2.2, '#7d859c');
        ctx.fillStyle = '#6b6b75'; ctx.fillRect(-2, -10, 4, 3);
        ctx.shadowColor = '#ffb13d'; ctx.shadowBlur = 8;
        star(ctx, 0, -12, rnd(2.5, 4.5), '#ffd36b');
      }
    },
    demolisher: { // stick of dynamite spinning end over end
      world: (ctx, pr) => puffs(ctx, pr, '#aaa', 6),
      local(ctx, pr, angle) {
        ctx.rotate(-angle + pr.steps * 0.35);
        ctx.fillStyle = '#d42a2a'; ctx.fillRect(-8, -3.5, 16, 7);
        ctx.fillStyle = '#7a1414'; ctx.fillRect(-3, -3.5, 1.5, 7); ctx.fillRect(1.5, -3.5, 1.5, 7);
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.quadraticCurveTo(11, -3, 12, 0); ctx.stroke();
        ctx.shadowColor = '#ffb13d'; ctx.shadowBlur = 8;
        star(ctx, 12.5, 0, rnd(2, 4), '#fff1a8');
      }
    },
    heavycannon: { // solid iron cannonball, smoke trail
      world: (ctx, pr) => puffs(ctx, pr, '#999', 4),
      local(ctx) {
        circle(ctx, 0, 0, 6.5, '#3a4055');
        ctx.strokeStyle = '#ff7a1f'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, TAU); ctx.stroke();
        circle(ctx, -2, -2, 2, '#aab2c8');
      }
    },
    warhead: { // rocket with a flickering exhaust flame
      world: (ctx, pr) => { puffs(ctx, pr, '#bbb', 3); tail(ctx, pr, '#ff9a3d', 3, 8); },
      local(ctx) {
        ctx.fillStyle = '#ffd36b';
        ctx.beginPath(); ctx.moveTo(-9, -2.5); ctx.lineTo(-9 - rnd(7, 13), 0); ctx.lineTo(-9, 2.5); ctx.fill();
        ctx.fillStyle = '#e8e8ee'; ctx.fillRect(-9, -3.5, 14, 7);
        ctx.fillStyle = '#d42a2a';
        ctx.beginPath(); ctx.moveTo(5, -3.5); ctx.lineTo(12, 0); ctx.lineTo(5, 3.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-9, -3.5); ctx.lineTo(-12, -7); ctx.lineTo(-5, -3.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-9, 3.5); ctx.lineTo(-12, 7); ctx.lineTo(-5, 3.5); ctx.fill();
      }
    },
    siegeshell: { // long pointed brass artillery shell, glowing hot
      world: (ctx, pr) => tail(ctx, pr, '#ff6a3d', 2.5, 14),
      local(ctx) {
        ctx.shadowColor = '#ff5c5c'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#c9a15c';
        ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(3, -4); ctx.quadraticCurveTo(11, -3, 13, 0);
        ctx.quadraticCurveTo(11, 3, 3, 4); ctx.lineTo(-9, 4); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#8a5a2a'; ctx.fillRect(-6, -4, 2, 8); ctx.fillRect(-1, -4, 2, 8);
      }
    },

    // Magic
    triplethreat: { // three sparkles circling each other
      world: (ctx, pr) => tail(ctx, pr, '#c98aff', 2, 16),
      local(ctx, pr, angle) {
        ctx.rotate(-angle);
        ctx.shadowColor = '#e0b8ff'; ctx.shadowBlur = 10;
        ['#ff8ad8', '#c98aff', '#8ad6ff'].forEach((c, i) => {
          const a = pr.steps * 0.25 + i * TAU / 3;
          star(ctx, Math.cos(a) * 7, Math.sin(a) * 7, 5, c);
        });
      }
    },
    meteorstorm: { // flaming space rock
      world: (ctx, pr) => { tail(ctx, pr, '#ff7a1a', 9, 14); tail(ctx, pr, '#ffd36b', 4, 10); },
      local(ctx, pr) {
        ctx.rotate(pr.steps * 0.15);
        ctx.fillStyle = '#6b4a32';
        ctx.beginPath();
        [[7, 0], [3, -6], [-4, -6], [-7, -1], [-4, 6], [3, 5]].forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath(); ctx.fill();
        circle(ctx, -1, -2, 1.6, '#a0785a');
      }
    },
    echowisp: { // glowing evil-eye orb, with fading "echoes" of itself behind it
      world(ctx, pr) {
        ctx.save();
        pr.trail.forEach((pt, i) => {
          if (i % 8) return;
          ctx.globalAlpha = (i / pr.trail.length) * 0.35;
          circle(ctx, pt.x, pt.y, 6, '#4aa8ff');
        });
        ctx.restore();
      },
      local(ctx, pr, angle) {
        ctx.rotate(-angle);
        ctx.shadowColor = '#4aa8ff'; ctx.shadowBlur = 14 + Math.sin(pr.steps * 0.3) * 5;
        circle(ctx, 0, 0, 8, '#1f4fbf');
        ctx.shadowBlur = 0;
        circle(ctx, 0, 0, 5.5, '#ffffff');
        circle(ctx, 0, 0, 3.8, '#7ec8ff');
        circle(ctx, 0, 0, 1.8, '#0b0b14');
      }
    },
    comet: { // bright head with a long icy tail
      world: (ctx, pr) => { tail(ctx, pr, '#8ad6ff', 12, 40); tail(ctx, pr, '#ffffff', 4, 24); },
      local(ctx) {
        ctx.shadowColor = '#bfe9ff'; ctx.shadowBlur = 18;
        circle(ctx, 0, 0, 6, '#ffffff');
      }
    },
    burner: { // fireball with a short flame tail
      world: (ctx, pr) => tail(ctx, pr, '#ff7a1a', 7, 10),
      local(ctx) {
        ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 14;
        circle(ctx, 0, 0, 6, '#ff7a1a');
        circle(ctx, 1.5, 0, 3, '#ffe08a');
      }
    },
    beaver: { // the beaver itself, faded while it's underground
      local(ctx, pr, angle, underground) {
        ctx.rotate(-angle);
        if (underground) ctx.globalAlpha = 0.5;
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🦫', 0, 0);
      }
    }
  };

  // Draw a shell with its custom look. Returns false if this weapon has none
  // (the game then draws its standard category shape).
  function drawShell(ctx, pr, underground) {
    const look = SHELLS[pr.weapon.id];
    if (!look) return false;
    if (look.world) look.world(ctx, pr);
    const angle = Math.atan2(pr.vy, pr.vx);
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(angle);
    look.local(ctx, pr, angle, underground);
    ctx.restore();
    return true;
  }

  // ---- Impact bursts ----
  // A burst is a list of short-lived parts. Positions follow simple physics
  // from the moment each part appears (x + vx·t, y + vy·t + ½·g·t²).
  let parts = [];
  function add(p) {
    parts.push(Object.assign({ vx: 0, vy: 0, g: 0, delay: 0, flat: 1, born: performance.now() }, p));
  }
  const fireball = (x, y, size, dur, delay = 0) =>
    add({ kind: 'ball', x, y, size, dur, delay, color: '#fff3b0', color2: '#ff7a1a' });
  const flash = (x, y, size, color = '#ffffff', dur = 220, delay = 0) => add({ kind: 'flash', x, y, size, dur, delay, color });
  const ring = (x, y, size, color, dur, opts) => add(Object.assign({ kind: 'ring', x, y, size, color, dur, width: 4 }, opts));
  function sparks(x, y, n, colors, speed, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = opts.up ? rnd(-Math.PI * 0.95, -Math.PI * 0.05) : rnd(0, TAU), s = rnd(speed * 0.4, speed);
      add({ kind: opts.kind || 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: opts.g ?? 300,
        size: rnd(1.5, opts.size || 3), color: pick(colors), dur: rnd(400, opts.dur || 900), delay: opts.delay || 0 });
    }
  }
  function smoke(x, y, n, spread, rise, opts = {}) {
    for (let i = 0; i < n; i++) {
      add({ kind: 'smoke', x: x + rnd(-spread, spread), y: y - rnd(0, opts.height || 10), vx: rnd(-10, 10), vy: -rnd(rise * 0.5, rise),
        size: rnd(6, opts.size || 12), color: opts.color || '#5c5c66', dur: rnd(900, 1600), delay: (opts.delay || 0) + rnd(0, 200) });
    }
  }

  // Each weapon's impact. `spots` = [{x, y}], one per blast. Hard-edged rings
  // never grow past the weapon's real blast radius, so nothing looks like a hit that isn't.
  const IMPACTS = {
    bigbertha(spots) { // huge fireball, black smoke
      const { x, y } = spots[0];
      flash(x, y - 10, 64);
      fireball(x, y - 12, 54, 750);
      sparks(x, y - 5, 24, ['#ffb13d', '#ff7a1a', '#ffe08a'], 260, { up: true });
      smoke(x, y - 20, 10, 30, 45, { color: '#2e2e34', size: 16 });
    },
    demolisher(spots) { // sharp bang, chunks of rock and dirt flying
      const { x, y } = spots[0];
      flash(x, y - 8, 55, '#fff7d6', 160);
      fireball(x, y - 8, 38, 450);
      sparks(x, y - 4, 30, ['#6b4a32', '#8a6b3d', '#55555f', '#a0785a'], 420, { up: true, kind: 'chunk', size: 5, g: 650, dur: 1300 });
      smoke(x, y - 10, 6, 25, 30);
    },
    heavycannon(spots) { // the boom, then a firework shower (🎆)
      const { x, y } = spots[0];
      fireball(x, y - 8, 34, 450);
      sparks(x, y - 60, 46, ['#ff5c5c', '#ffd36b', '#8ad6ff', '#c98aff', '#c9ff8a'], 230, { g: 120, dur: 1400, delay: 180 });
      flash(x, y - 60, 22, '#ffffff', 200, 180);
    },
    warhead(spots) { // the biggest blast: flash, shockwave, fireball, rising smoke column
      const { x, y } = spots[0];
      flash(x, y - 10, 84, '#ffffff', 260);
      ring(x, y - 4, 58, '#ffe08a', 650, { flat: 0.35, width: 6 });
      fireball(x, y - 15, 58, 900);
      fireball(x, y - 55, 38, 900, 250);
      sparks(x, y - 5, 30, ['#ffb13d', '#ff7a1a', '#ffe08a'], 340, { up: true });
      smoke(x, y - 40, 14, 18, 60, { color: '#3a3a42', size: 18, height: 50, delay: 200 });
    },
    siegeshell(spots) { // wide, low splash: twin shockwaves and dust along the ground
      const { x, y } = spots[0];
      flash(x, y - 6, 50, '#ffd6c2', 200);
      ring(x, y - 3, 50, '#ff8a6b', 700, { flat: 0.22, width: 5 });
      ring(x, y - 3, 34, '#ffd36b', 600, { flat: 0.22, width: 4, delay: 140 });
      fireball(x, y - 8, 40, 500);
      smoke(x, y - 4, 12, 50, 20, { color: '#8a6b3d', size: 12, height: 4 });
      sparks(x, y - 4, 20, ['#ff7a1a', '#ffd36b'], 300, { up: true });
    },
    triplethreat(spots) { // three sparkle bursts, one per blast
      const colors = ['#ff8ad8', '#c98aff', '#8ad6ff'];
      spots.forEach(({ x, y }, i) => {
        add({ kind: 'star', x, y: y - 10, size: 22, color: colors[i % 3], dur: 600, delay: i * 90 });
        sparks(x, y - 8, 12, [colors[i % 3], '#ffffff'], 170, { kind: 'twinkle', g: 80, size: 4, delay: i * 90 });
      });
    },
    meteorstorm(spots) { // a meteor streaks down from the sky onto each blast
      spots.forEach(({ x, y }, i) => {
        const delay = i * 110;
        add({ kind: 'streak', x, y, x0: x - 120, y0: y - 320, size: 5, color: '#ff7a1a', dur: 260, delay });
        fireball(x, y - 6, 22, 450, delay + 240);
        sparks(x, y - 4, 10, ['#6b4a32', '#ff7a1a', '#ffd36b'], 200, { up: true, kind: 'chunk', size: 3, g: 500, delay: delay + 240 });
      });
    },
    echowisp(spots) { // a pulse, then its echo
      const { x, y } = spots[0];
      flash(x, y - 10, 34, '#bfe2ff', 250);
      ring(x, y - 10, 24, '#4aa8ff', 550, { width: 4 });
      ring(x, y - 10, 24, '#bfe2ff', 550, { width: 4, delay: 330 });
      flash(x, y - 10, 30, '#bfe2ff', 250, 330);
      sparks(x, y - 10, 14, ['#4aa8ff', '#ffffff'], 140, { kind: 'twinkle', g: 40, size: 3, delay: 330 });
    },
    comet(spots) { // dazzling starburst and icy sparkles
      const { x, y } = spots[0];
      flash(x, y - 10, 54, '#e6f7ff', 300);
      add({ kind: 'star', x, y: y - 12, size: 36, color: '#ffffff', dur: 500 });
      ring(x, y - 8, 36, '#8ad6ff', 600, { width: 4 });
      sparks(x, y - 8, 28, ['#ffffff', '#8ad6ff', '#bfe9ff'], 260, { kind: 'twinkle', g: 120, size: 4, dur: 1100 });
    },
    burner(spots) { // the blast is small; the fire is the point (drawn by the game)
      const { x, y } = spots[0];
      fireball(x, y - 6, 26, 450);
      sparks(x, y - 6, 18, ['#ffb13d', '#ff7a1a', '#ffe08a'], 120, { up: true, g: -60, dur: 1200 });
    },
    beaver(spots) { // pops out of the ground under the tank: wood chips and dirt
      const { x, y } = spots[0];
      add({ kind: 'star', x, y, size: 24, color: '#ffe08a', dur: 350 });
      sparks(x, y, 18, ['#8a6b3d', '#c9a15c', '#6b4a32'], 260, { up: true, kind: 'chunk', size: 4, g: 600 });
    }
  };

  // Weapons without a signature burst use their category's.
  const CATEGORY_IMPACTS = {
    shooter(spots, w) { // tight plasma burst
      const { x, y } = spots[0], r = w.radius;
      flash(x, y - 6, r * 1.6, '#e6fbff', 200);
      ring(x, y - 4, r, '#3be8ff', 420, { flat: 0.4, width: 3 });
      ring(x, y - 6, r * 0.6, '#ffffff', 300, { width: 2 });
      sparks(x, y - 4, 16, ['#3be8ff', '#ffffff', '#9af3ff'], 260, { up: true, size: 2.6, dur: 700 });
      smoke(x, y - 6, 4, r * 0.6, 26, { color: '#2a3350', size: 9 });
    },
    dirt(spots, w) { // regolith thrown up (mound) or blown out (dig)
      const { x, y } = spots[0], r = w.radius, adds = (w.effect || {}).type === 'mound';
      flash(x, y - 6, r * 1.2, adds ? '#ffe9c2' : '#dff6ff', 180);
      ring(x, y - 3, r, '#d8b36a', 620, { flat: 0.22, width: 4 });
      sparks(x, y - 4, 34, ['#8d7a5c', '#d8b36a', '#4a5068', '#b79b6b'], adds ? 260 : 420,
        { up: true, kind: 'chunk', size: 5, g: 620, dur: 1300 });
      smoke(x, y - 4, 14, r, 26, { color: '#6d6455', size: 14, height: 6 });
    }
  };
  const EMBER = { shooter: '#3be8ff', attacker: '#ff7a1f', magic: '#b88cff' };

  function impact(weapon, spots) {
    const fx = IMPACTS[weapon.id] || CATEGORY_IMPACTS[weapon.category];
    if (fx) fx(spots, weapon);
    const ember = EMBER[weapon.category];
    if (!ember || !weapon.radius) return; // dirt movers and the Beaver have no scoring blast
    spots.forEach(({ x, y, y0 }) => {
      const cy = y0 === undefined ? y : y0; // the middle of the blast, where scoring measures from
      // What you see is what scores: the white ring is the blast's true edge
      // (if it touches the tank, that's a solid score); the faint outer ring is
      // the near-miss limit (inside it still scores a little).
      ring(x, cy, weapon.radius, '#ffffff', 700, { width: 2.4 });
      ring(x, cy, weapon.radius + TT.NEAR_MISS_PX, ember, 800, { width: 1, a: 0.4 });
      // the ground keeps glowing for a moment where each blast went off
      add({ kind: 'ember', x, y: y - 2, size: Math.max(22, weapon.radius * 1.1), color: ember, dur: 1700 });
    });
  }

  // Flash and sparks leaving the barrel when a shell is fired.
  function muzzle(x, y, angle, color) {
    flash(x, y, 30, '#ffffff', 150);
    flash(x, y, 54, color, 260);
    ring(x, y, 20, color, 260, { width: 2 });
    for (let i = 0; i < 12; i++) {
      const a = angle + rnd(-0.4, 0.4), sp = rnd(120, 420);
      add({ kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200,
        size: rnd(1.2, 2.6), color: pick([color, '#ffffff']), dur: rnd(180, 420) });
    }
  }

  // Teleport: the unit folds away at (x0, y0) and unfolds at (x1, y1).
  function warp(x0, y0, x1, y1) {
    const violet = '#a97bff', pale = '#e2d6ff';
    add({ kind: 'beam', x: x1, y: y1, x0, y0, size: 3, color: violet, dur: 420 });
    ring(x0, y0, 34, violet, 420, { width: 3 });
    sparks(x0, y0, 14, [violet, pale], 150, { kind: 'twinkle', g: -40, size: 3.5, dur: 700 });
    flash(x1, y1, 60, pale, 320, 120);
    ring(x1, y1, 46, pale, 520, { width: 4, delay: 120 });
    ring(x1, y1, 30, violet, 620, { width: 2, delay: 220 });
    add({ kind: 'star', x: x1, y: y1, size: 30, color: '#ffffff', dur: 450, delay: 120 });
    sparks(x1, y1, 18, [violet, pale, '#ffffff'], 220, { kind: 'twinkle', g: 60, size: 4, delay: 120 });
  }

  function drawPart(ctx, p, age) {
    const k = age / p.dur, t = age / 1000;
    const x = p.x + p.vx * t, y = p.y + p.vy * t + 0.5 * p.g * t * t;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    // light adds up where it overlaps; smoke and debris cover what's behind them
    ctx.globalCompositeOperation = p.kind === 'smoke' || p.kind === 'chunk' ? 'source-over' : 'lighter';
    switch (p.kind) {
      case 'ember': { // slow afterglow on the ground
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.size);
        g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.5 * (1 - k) * (1 - k);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, p.size, p.size * 0.45, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'beam': // a line from (x0, y0) to (x, y) that thins out
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.4, p.size * (1 - k)); ctx.lineCap = 'round';
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x, p.y); ctx.stroke();
        break;
      case 'dot':
        ctx.globalAlpha = 1 - k;
        circle(ctx, x, y, p.size * (1 - k * 0.5), p.color);
        break;
      case 'twinkle':
        ctx.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(age / 40));
        star(ctx, x, y, p.size * (1 - k * 0.4), p.color);
        break;
      case 'chunk':
        ctx.globalAlpha = Math.min(1, (1 - k) * 2);
        ctx.save(); ctx.translate(x, y); ctx.rotate(age / 90);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        break;
      case 'ball': {
        const r = p.size * easeOut(Math.min(1, k * 1.6));
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
        g.addColorStop(0, p.color); g.addColorStop(0.45, p.color2); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill();
        break;
      }
      case 'flash': { // soft glow that fades out from the edges
        const r = p.size * (0.6 + 0.4 * k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = (1 - k) * (1 - k) * 0.9;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        break;
      }
      case 'ring':
        ctx.globalAlpha = (1 - k) * (p.a || 1);
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.5, p.width * (1 - k));
        ctx.beginPath(); ctx.ellipse(x, y, p.size * easeOut(k), p.size * easeOut(k) * p.flat, 0, 0, TAU); ctx.stroke();
        break;
      case 'smoke':
        ctx.globalAlpha = 0.45 * (1 - k);
        circle(ctx, x, y, p.size * (1 + k * 1.5), p.color);
        break;
      case 'star':
        ctx.globalAlpha = 1 - k;
        ctx.shadowColor = p.color; ctx.shadowBlur = 16;
        star(ctx, x, y, p.size * Math.sin(Math.PI * Math.min(1, k * 1.3)), p.color);
        break;
      case 'streak': { // falls from (x0, y0) to (x, y)
        const hx = p.x0 + (p.x - p.x0) * k, hy = p.y0 + (p.y - p.y0) * k;
        const tx = p.x0 + (p.x - p.x0) * Math.max(0, k - 0.2), ty = p.y0 + (p.y - p.y0) * Math.max(0, k - 0.2);
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(255,122,26,0)'); g.addColorStop(1, '#ffd36b');
        ctx.strokeStyle = g; ctx.lineWidth = p.size; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        circle(ctx, hx, hy, p.size, '#6b4a32');
        break;
      }
    }
  }

  function draw(ctx) {
    const now = performance.now();
    parts = parts.filter(p => now - p.born - p.delay < p.dur);
    if (!parts.length) return;
    ctx.save();
    parts.forEach(p => {
      const age = now - p.born - p.delay;
      if (age >= 0) drawPart(ctx, p, age);
    });
    ctx.restore();
  }

  function active() { return parts.length > 0; }
  function clear() { parts = []; }

  return { drawShell, impact, muzzle, warp, tail, draw, active, clear };
})();
