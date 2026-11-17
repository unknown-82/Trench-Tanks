// Holo: the 3D holograms. A small hand-written 3D projector draws glowing
// wireframes on a normal 2D canvas (no 3D library, no WebGL needed).
//   1. the command deck backdrop (#holo): a slowly orbiting model of the range
//      where two units trade shells over rolling terrain
//   2. the armoury's rotating weapon preview (#wpnPreview)
// Scenery only: it reads nothing from the game and changes nothing in it.
window.TT = window.TT || {};
TT.Holo = (function () {
  "use strict";
  const Bus = TT.Bus;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CYAN = '59,232,255', VIOLET = '150,120,255', ORANGE = '255,138,42', UNIT_B = '169,123,255';

  // ------------------------------------------------------ 3D projector --
  // World: x = left/right, y = up, z = away from the viewer.
  function camera(yaw, pitch, dist, f, cx, cy) {
    const sy = Math.sin(yaw), cyw = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    return function project(x, y, z) {
      const x1 = x * cyw - z * sy, z1 = x * sy + z * cyw;
      const y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp + dist;
      const k = f / Math.max(0.2, z2);
      return [cx + x1 * k, cy - y2 * k, z2, k];
    };
  }

  // ================================================== 1. range backdrop ==
  const NX = 44, NZ = 20, HALF_X = 11, HALF_Z = 5;
  const UNITS = [{ x: -6.6, z: 0.4, dir: 1, rgb: ORANGE, name: 'UNIT A' }, { x: 6.6, z: -0.4, dir: -1, rgb: UNIT_B, name: 'UNIT B' }];
  let cv, c, w = 0, h = 0, dpr = 1, bg = null;
  let running = false, shownAt = 0, reveal = 0.25, booted = false;
  let look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 };
  let ripples = [], sparks = [], rings = [], motes = [];
  let shot = { from: 0, phase: 'aim', t0: 0, trail: [], target: null, apex: 5.5 };

  function ground(x, z, t) {
    let y = Math.sin(x * 0.55 + 1.3) * 0.55 + Math.sin(x * 0.23 - z * 0.4) * 0.5 + Math.cos(z * 0.7 + x * 0.31) * 0.35;
    y *= 0.75 + 0.25 * Math.sin(z * 0.5);
    for (const r of ripples) { // a shockwave rolling out from each impact
      const age = t - r.t, wave = Math.hypot(x - r.x, z - r.z) - age * 5;
      if (Math.abs(wave) < 1.5) y += Math.cos(wave * 2.1) * 0.4 * (1 - age / 2.2) * (1 - Math.abs(wave) / 1.5);
    }
    return y;
  }

  function boxLines(cx, cy, cz, sx, sy, sz) {
    const v = [];
    for (let i = 0; i < 8; i++) v.push([cx + (i & 1 ? sx : -sx) / 2, cy + (i & 2 ? sy : -sy) / 2, cz + (i & 4 ? sz : -sz) / 2]);
    return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [v[a], v[b]]);
  }
  // A unit, in its own coordinates: x = toward the opponent, y = up.
  const TANK = [].concat(
    boxLines(0, 0.16, 0.48, 1.8, 0.32, 0.28), boxLines(0, 0.16, -0.48, 1.8, 0.32, 0.28), // tracks
    boxLines(0, 0.48, 0, 1.5, 0.3, 0.8),                                                 // hull
    boxLines(-0.12, 0.78, 0, 0.7, 0.3, 0.54),                                            // turret
    [[[0.75, 0.63, 0.4], [1.02, 0.34, 0.4]], [[0.75, 0.63, -0.4], [1.02, 0.34, -0.4]],   // sloped nose
     [[1.02, 0.34, 0.4], [1.02, 0.34, -0.4]], [[-0.4, 0.93, 0.2], [-0.62, 1.55, 0.2]]]); // antenna
  const PIVOT = [0.2, 0.82, 0], BARREL = 1.35;

  // Unit coordinates -> world, standing on the terrain and leaning with it.
  function unitToWorld(u, t) {
    const gy = ground(u.x, u.z, t);
    const slope = Math.atan((ground(u.x + 0.6, u.z, t) - ground(u.x - 0.6, u.z, t)) / 1.2);
    const cs = Math.cos(slope), sn = Math.sin(slope);
    return ([lx, ly, lz]) => {
      const x = lx * u.dir;
      return [u.x + x * cs - ly * sn, gy + x * sn + ly * cs, u.z + lz];
    };
  }
  function muzzle(u, elev, t) {
    return unitToWorld(u, t)([PIVOT[0] + Math.cos(elev) * BARREL, PIVOT[1] + Math.sin(elev) * BARREL, 0]);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = cv.clientWidth; h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    paintBackdrop();
    motes = Array.from({ length: 70 }, () => ({ x: rnd(-HALF_X, HALF_X), y: rnd(0, 7), z: rnd(-HALF_Z, HALF_Z), v: rnd(0.1, 0.45), p: rnd(0, TAU) }));
  }

  // Deep space, a giant planet's limb and stars: painted once, then slid sideways with the camera.
  function paintBackdrop() {
    bg = document.createElement('canvas');
    const bw = Math.ceil(w * 1.25);
    bg.width = bw; bg.height = h;
    const b = bg.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#02030a'); g.addColorStop(0.32, '#070a1c'); g.addColorStop(0.52, '#14123c');
    g.addColorStop(0.6, '#0b0e26'); g.addColorStop(1, '#03040a');
    b.fillStyle = g; b.fillRect(0, 0, bw, h);
    b.globalCompositeOperation = 'lighter';
    [[0.25, 0.3, 0.5, 'rgba(110,70,255,0.16)'], [0.7, 0.2, 0.45, 'rgba(40,150,255,0.10)'], [0.5, 0.56, 0.5, 'rgba(59,232,255,0.07)']].forEach(([u, v, r, col]) => {
      const rg = b.createRadialGradient(u * bw, v * h, 0, u * bw, v * h, r * Math.max(bw, h));
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = rg; b.fillRect(0, 0, bw, h);
    });
    for (let i = 0; i < 240; i++) {
      const a = 0.2 + Math.random() * 0.7;
      b.fillStyle = Math.random() < 0.25 ? `rgba(150,225,255,${a})` : `rgba(255,255,255,${a})`;
      b.beginPath(); b.arc(Math.random() * bw, Math.pow(Math.random(), 1.4) * h * 0.56, 0.3 + Math.random() * 1.1, 0, TAU); b.fill();
    }
    b.globalCompositeOperation = 'source-over';
    // the planet the range orbits: only its lit limb is in view
    const pr = Math.max(bw, h) * 0.7, px = bw * 0.74, py = -pr * 0.8;
    const body = b.createRadialGradient(px, py, pr * 0.6, px, py, pr);
    body.addColorStop(0, '#04051a'); body.addColorStop(0.9, '#0b0a2c'); body.addColorStop(0.975, '#221d6e');
    body.addColorStop(0.995, '#5a52e0'); body.addColorStop(1, 'rgba(150,225,255,0.85)');
    b.fillStyle = body;
    b.beginPath(); b.arc(px, py, pr, 0, TAU); b.fill();
    const halo = b.createRadialGradient(px, py, pr, px, py, pr * 1.07);
    halo.addColorStop(0, 'rgba(110,170,255,0.30)'); halo.addColorStop(1, 'rgba(110,170,255,0)');
    b.fillStyle = halo;
    b.beginPath(); b.arc(px, py, pr * 1.07, 0, TAU); b.fill();
  }

  function path(points) {
    c.beginPath();
    for (let i = 0; i < points.length; i++) i ? c.lineTo(points[i][0], points[i][1]) : c.moveTo(points[i][0], points[i][1]);
  }
  function segments(list, P, style, width) {
    c.strokeStyle = style; c.lineWidth = width;
    c.beginPath();
    for (const [a, b] of list) {
      const p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]);
      c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]);
    }
    c.stroke();
  }
  function glowDot(x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  function drawTerrain(P, t, m) {
    const pts = [];
    for (let j = 0; j <= NZ; j++) {
      const row = [], z = lerp(HALF_Z, -HALF_Z, j / NZ);
      for (let i = 0; i <= NX; i++) {
        const x = lerp(-HALF_X, HALF_X, i / NX);
        row.push(P(x, ground(x, z, t) * m, z));
      }
      pts.push(row);
    }
    const fade = depth => clamp(1.5 - depth / 17, 0.06, 0.85) * m;
    c.lineWidth = 1;
    for (let j = 0; j <= NZ; j++) { // rows: one depth each
      c.strokeStyle = `rgba(${CYAN},${fade(pts[j][NX >> 1][2]) * 0.75})`;
      path(pts[j]); c.stroke();
    }
    for (let i = 0; i <= NX; i++) { // columns: fade from near to far in three steps
      for (let s = 0; s < 3; s++) {
        const a = Math.floor(s * NZ / 3), b = Math.floor((s + 1) * NZ / 3);
        c.strokeStyle = `rgba(${VIOLET},${fade(pts[(a + b) >> 1][i][2]) * 0.55})`;
        c.beginPath();
        for (let j = a; j <= b; j++) j === a ? c.moveTo(pts[j][i][0], pts[j][i][1]) : c.lineTo(pts[j][i][0], pts[j][i][1]);
        c.stroke();
      }
    }
    // survey scan sweeping across the range
    const scan = Math.floor(((t * 0.11) % 1) * (NX + 14)) - 7;
    for (let d = 0; d < 4; d++) {
      const i = scan - d;
      if (i < 0 || i > NX) continue;
      c.strokeStyle = `rgba(200,250,255,${(0.75 - d * 0.2) * m})`;
      c.lineWidth = 1.6 - d * 0.3;
      c.beginPath();
      for (let j = 0; j <= NZ; j++) j ? c.lineTo(pts[j][i][0], pts[j][i][1]) : c.moveTo(pts[j][i][0], pts[j][i][1]);
      c.stroke();
    }
    // boundary pylons with beacons, and the fence of light between them
    const corners = [[-HALF_X, HALF_Z], [HALF_X, HALF_Z], [HALF_X, -HALF_Z], [-HALF_X, -HALF_Z]];
    const tops = corners.map(([x, z]) => [x, ground(x, z, t) * m + 2.6 * m, z]);
    c.lineWidth = 1;
    corners.forEach(([x, z], i) => {
      const a = P(x, ground(x, z, t) * m, z), b = P(...tops[i]), n = P(...tops[(i + 1) % 4]);
      c.strokeStyle = `rgba(${CYAN},${0.55 * m})`;
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.strokeStyle = `rgba(${CYAN},${0.13 * m})`;
      c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(n[0], n[1]); c.stroke();
      const blink = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.6);
      glowDot(b[0], b[1], 5 + 9 * blink, i % 2 ? UNIT_B : ORANGE, (0.35 + 0.55 * blink) * m);
    });
  }

  function drawUnit(u, i, P, t, m) {
    const toWorld = unitToWorld(u, t);
    const lines = TANK.map(([a, b]) => [toWorld(a), toWorld(b)]);
    // the barrel rises while this unit takes aim, and recoils when it fires
    const mine = shot.from === i;
    const aimK = mine && shot.phase === 'aim' ? ease((t - shot.t0) / 1.1) : mine ? 1 : 0;
    const elev = lerp(0.25, 0.85, aimK);
    const pivot = toWorld(PIVOT), tip = muzzle(u, elev, t);
    lines.push([pivot, tip]);
    segments(lines, P, `rgba(${u.rgb},${0.16 * m})`, 4);
    segments(lines, P, `rgba(${u.rgb},${0.95 * m})`, 1.2);

    const base = P(u.x, ground(u.x, u.z, t), u.z), top = P(...toWorld([0, 1.2, 0]));
    // footprint ring on the ground
    const ringPts = [];
    for (let k = 0; k <= 28; k++) {
      const a = k / 28 * TAU, rx = u.x + Math.cos(a) * 1.5, rz = u.z + Math.sin(a) * 1.5;
      ringPts.push(P(rx, ground(rx, rz, t), rz));
    }
    c.strokeStyle = `rgba(${u.rgb},${(0.3 + 0.2 * Math.sin(t * 2.4 + i)) * m})`;
    c.lineWidth = 1;
    path(ringPts); c.stroke();
    glowDot(base[0], base[1], 60 * base[3] / 50, u.rgb, 0.22 * m);

    // call-out label on a leader line
    const lx = top[0] + u.dir * -34, ly = top[1] - 46;
    c.strokeStyle = `rgba(${u.rgb},${0.7 * m})`;
    c.beginPath(); c.moveTo(top[0], top[1] - 4); c.lineTo(lx, ly); c.lineTo(lx + u.dir * -54, ly); c.stroke();
    c.fillStyle = `rgba(${u.rgb},${m})`;
    c.font = '700 10px Orbitron, sans-serif';
    c.textAlign = u.dir === 1 ? 'right' : 'left';
    c.fillText(u.name, lx + u.dir * -2, ly - 5);
    c.fillStyle = `rgba(201,211,230,${0.75 * m})`;
    c.font = '600 10px Rajdhani, sans-serif';
    c.fillText(mine ? (shot.phase === 'aim' ? 'TAKING AIM' : 'SHELL AWAY') : (shot.phase === 'flight' ? 'INCOMING' : 'STANDING BY'), lx + u.dir * -2, ly + 11);
  }

  function updateShot(P, t, m) {
    const from = UNITS[shot.from], to = UNITS[1 - shot.from];
    if (shot.phase === 'aim' && t - shot.t0 > 1.4) {
      shot.phase = 'flight'; shot.t0 = t; shot.trail = [];
      shot.start = muzzle(from, 0.85, t);
      shot.target = [to.x + rnd(-1.3, 1.3), 0, to.z + rnd(-1, 1)];
      shot.apex = rnd(4.6, 6.4);
      const s = P(...shot.start);
      sparks.push({ x: shot.start[0], y: shot.start[1], z: shot.start[2], flash: true, t });
      glowDot(s[0], s[1], 40, from.rgb, 0.8 * m);
    }
    if (shot.phase !== 'flight') return;
    const k = (t - shot.t0) / 2.1;
    if (k >= 1) { // impact: shockwave through the terrain, sparks, expanding ring
      const [x, , z] = shot.target, y = ground(x, z, t);
      ripples.push({ x, z, t });
      rings.push({ x, z, t, rgb: from.rgb });
      for (let i = 0; i < 26; i++) {
        const a = rnd(0, TAU), sp = rnd(1, 4.5);
        sparks.push({ x, y, z, vx: Math.cos(a) * sp, vy: rnd(2.5, 7), vz: Math.sin(a) * sp, t, rgb: Math.random() < 0.5 ? from.rgb : '255,240,210' });
      }
      shot = { from: 1 - shot.from, phase: 'aim', t0: t + 0.5, trail: [], target: null, apex: 5.5 };
      return;
    }
    const x = lerp(shot.start[0], shot.target[0], k), z = lerp(shot.start[2], shot.target[2], k);
    const y = lerp(shot.start[1], ground(shot.target[0], shot.target[2], t), k) + 4 * shot.apex * k * (1 - k);
    shot.trail.push([x, y, z]);
    if (shot.trail.length > 46) shot.trail.shift();
    c.lineCap = 'round';
    for (let i = 1; i < shot.trail.length; i++) {
      const a = P(...shot.trail[i - 1]), b = P(...shot.trail[i]), q = i / shot.trail.length;
      c.strokeStyle = `rgba(${from.rgb},${q * 0.9 * m})`;
      c.lineWidth = 0.6 + q * 2.6;
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    const head = P(x, y, z);
    glowDot(head[0], head[1], 22, from.rgb, 0.9 * m);
    glowDot(head[0], head[1], 6, '255,255,255', m);

    // target lock closing in on the unit under fire
    const tp = P(to.x, ground(to.x, to.z, t) + 0.6, to.z), size = lerp(46, 20, k);
    c.save();
    c.translate(tp[0], tp[1]);
    c.rotate(t * 1.4);
    c.strokeStyle = `rgba(255,255,255,${0.8 * m})`;
    c.lineWidth = 1.2;
    for (let q = 0; q < 4; q++) {
      c.rotate(Math.PI / 2);
      c.beginPath(); c.moveTo(size, size * 0.55); c.lineTo(size, size); c.lineTo(size * 0.55, size); c.stroke();
    }
    c.restore();
  }

  function drawBursts(P, t, m) {
    rings = rings.filter(r => t - r.t < 1.1);
    rings.forEach(r => {
      const k = (t - r.t) / 1.1, rad = ease(k) * 3.2, pts = [];
      for (let i = 0; i <= 30; i++) {
        const a = i / 30 * TAU, x = r.x + Math.cos(a) * rad, z = r.z + Math.sin(a) * rad;
        pts.push(P(x, ground(x, z, t) + 0.05, z));
      }
      c.strokeStyle = `rgba(${r.rgb},${(1 - k) * m})`;
      c.lineWidth = 3 * (1 - k) + 0.5;
      path(pts); c.stroke();
      if (k < 0.35) { const p = P(r.x, ground(r.x, r.z, t) + 0.3, r.z); glowDot(p[0], p[1], 150 * (1 - k / 0.35) + 30, '255,225,180', 0.75 * (1 - k / 0.35) * m); }
    });
    sparks = sparks.filter(s => t - s.t < (s.flash ? 0.2 : 1.3));
    sparks.forEach(s => {
      const age = t - s.t;
      if (s.flash) return;
      const p = P(s.x + s.vx * age, s.y + s.vy * age - 6 * age * age, s.z + s.vz * age);
      c.fillStyle = `rgba(${s.rgb},${(1 - age / 1.3) * m})`;
      c.fillRect(p[0] - 1.2, p[1] - 1.2, 2.4, 2.4);
    });
    ripples = ripples.filter(r => t - r.t < 2.2);
  }

  function drawMotes(P, t, m) {
    motes.forEach(d => {
      const y = (d.y + t * d.v) % 7, p = P(d.x + Math.sin(t * 0.3 + d.p) * 0.4, y, d.z);
      const a = clamp(1.3 - p[2] / 18, 0.05, 0.7) * (0.5 + 0.5 * Math.sin(t * 1.5 + d.p)) * m;
      c.fillStyle = `rgba(190,240,255,${a})`;
      c.fillRect(p[0], p[1], 1.5, 1.5);
    });
  }

  function render(now) {
    if (!w || !h || !bg || !bg.width) { // the page had no size yet (e.g. a background tab)
      if (cv.clientWidth && cv.clientHeight) resize();
      if (!w || !h) return;
    }
    const t = now / 1000;
    if (booted) reveal = Math.max(reveal, clamp((now - shownAt) / 1800, 0.25, 1));
    const m = ease(reveal);
    look.x += (lookTo.x - look.x) * 0.05;
    look.y += (lookTo.y - look.y) * 0.05;
    const yaw = Math.sin(t * 0.12) * 0.36 + look.x * 0.22;
    const pitch = 0.37 + Math.sin(t * 0.17) * 0.03 + look.y * 0.07;
    const narrow = w < 760;
    const P = camera(yaw, pitch, 17, Math.min(w * (narrow ? 1.5 : 1), h * 1.8) * 0.72, w / 2, h * (narrow ? 0.36 : 0.42));

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    const slack = bg.width - w;
    c.drawImage(bg, -slack / 2 - clamp(yaw / 0.6, -1, 1) * slack / 2, 0);
    c.globalCompositeOperation = 'lighter'; // light adds up: no depth sorting needed
    const floor = P(0, -0.4, 0);
    glowDot(floor[0], floor[1], Math.max(w, h) * 0.5, '50,90,220', 0.2 * m);
    drawTerrain(P, t, m);
    drawMotes(P, t, m);
    UNITS.forEach((u, i) => drawUnit(u, i, P, t, m));
    updateShot(P, t, m);
    drawBursts(P, t, m);
  }

  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (document.hidden) return;
    render(now);
  }
  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on && !calm) requestAnimationFrame(loop);
    else if (on) { running = false; render(performance.now()); } // reduced motion: a still frame
  }

  // ================================================ 2. weapon preview ==
  // Each weapon is a "lathe" shape: an outline [along, radius] spun around its
  // long axis into rings and ribs, plus a few extras (fins, satellites, rings).
  const OUTLINES = {
    bullet: [[-1, 0], [-1, 0.26], [-0.86, 0.3], [0.25, 0.3], [0.62, 0.22], [0.9, 0.08], [1, 0]],
    can: [[-0.78, 0], [-0.78, 0.5], [-0.6, 0.56], [0.55, 0.56], [0.72, 0.42], [0.78, 0]],
    missile: [[-1, 0], [-1, 0.2], [-0.85, 0.27], [0.35, 0.27], [0.72, 0.18], [1, 0]],
    crystal: [[-1, 0], [-0.25, 0.5], [0.25, 0.5], [1, 0]],
    flame: [[-0.9, 0], [-0.55, 0.44], [0.05, 0.36], [0.55, 0.17], [1, 0]],
    drill: [[-1, 0], [-1, 0.5], [-0.35, 0.5], [1, 0]],
    ball: Array.from({ length: 9 }, (_, i) => [-Math.cos(Math.PI * i / 8) * 0.62, Math.sin(Math.PI * i / 8) * 0.62])
  };
  const MODELS = {
    sharpshooter: { o: 'bullet' }, rifleround: { o: 'bullet', len: 0.8, fat: 0.8 }, marksman: { o: 'bullet', len: 1.1, fat: 0.9 },
    longbarrel: { o: 'bullet', len: 1.35, fat: 0.8 }, pinpoint: { o: 'bullet', len: 1.1, fat: 0.5 },
    sandbag: { o: 'can', fat: 0.9 }, landfill: { o: 'can', len: 1.1, fat: 1.15 }, trenchdig: { o: 'drill', fat: 0.9 }, quarry: { o: 'can', len: 0.7, fat: 1.25 },
    bigbertha: { o: 'ball', fat: 1.2, len: 1.2 }, demolisher: { o: 'can', len: 1.25, fat: 0.6 }, heavycannon: { o: 'ball' },
    warhead: { o: 'missile', len: 1.15, fins: 4 }, siegeshell: { o: 'bullet', len: 1.2, fat: 1.15 },
    triplethreat: { o: 'crystal', len: 0.7, fat: 0.7, sats: 3 }, meteorstorm: { o: 'ball', fat: 0.6, len: 0.6, sats: 5 },
    echowisp: { o: 'ball', fat: 0.75, len: 0.75, halos: 2 }, comet: { o: 'ball', fat: 0.8, len: 0.8, tail: true },
    burner: { o: 'flame' }, beaver: { o: 'drill', spiral: true }
  };
  let pv = null, pc = null, pvRunning = false, current = null;

  function buildModel(id) {
    const def = MODELS[id] || MODELS.sharpshooter;
    const outline = OUTLINES[def.o], len = def.len || 1, fat = def.fat || 1, sides = def.o === 'crystal' ? 6 : 12;
    const lines = [];
    const ringAt = (x, r) => Array.from({ length: sides + 1 }, (_, k) => [x * len, Math.cos(k / sides * TAU) * r * fat, Math.sin(k / sides * TAU) * r * fat]);
    const hoops = outline.map(([x, r]) => ringAt(x, r));
    hoops.forEach(hoop => { for (let k = 0; k < sides; k++) lines.push([hoop[k], hoop[k + 1]]); });
    for (let i = 1; i < hoops.length; i++) for (let k = 0; k < sides; k++) lines.push([hoops[i - 1][k], hoops[i][k]]);
    for (let f = 0; f < (def.fins || 0); f++) { // tail fins
      const a = f / def.fins * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const pts = [[-0.55, 0.27], [-1.05, 0.72], [-1, 0.2]].map(([x, r]) => [x * len, cs * r, sn * r]);
      lines.push([pts[0], pts[1]], [pts[1], pts[2]]);
    }
    if (def.spiral) { // drill flutes winding round the cone
      let prev = null;
      for (let k = 0; k <= 40; k++) {
        const u = k / 40, x = lerp(-0.35, 1, u), r = 0.5 * (1 - u) * fat, a = u * TAU * 3;
        const p = [x, Math.cos(a) * r, Math.sin(a) * r];
        if (prev) lines.push([prev, p]);
        prev = p;
      }
    }
    if (def.tail) for (let k = 0; k < 7; k++) { // comet tail
      const a = k / 7 * TAU;
      lines.push([[-0.3, Math.cos(a) * 0.4, Math.sin(a) * 0.4], [-1.9, Math.cos(a) * 0.1, Math.sin(a) * 0.1]]);
    }
    return { lines, sats: def.sats || 0, halos: def.halos || 0 };
  }

  function preview(weapon, color) {
    if (!pv) return;
    const n = parseInt(color.slice(1), 16);
    current = { model: buildModel(weapon.id), rgb: `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`, t0: performance.now() };
    if (!pvRunning) { pvRunning = true; requestAnimationFrame(previewLoop); }
  }

  function previewLoop(now) {
    if (!current || document.body.dataset.screen !== 'draft') { pvRunning = false; return; }
    if (!calm) requestAnimationFrame(previewLoop); else pvRunning = false;
    if (document.hidden) return;
    const W = 220, H = 150, t = now / 1000, k = devicePixelRatio > 1 ? 2 : 1;
    if (pv.width !== W * k) { pv.width = W * k; pv.height = H * k; }
    pc.setTransform(k, 0, 0, k, 0, 0);
    pc.clearRect(0, 0, W, H);
    pc.globalCompositeOperation = 'lighter';
    const rgb = current.rgb, grow = ease((now - current.t0) / 450);
    const P = camera(0, 0.3, 4.4, 150, W / 2, H / 2 + 4);
    const spin = t * 0.9, cs = Math.cos(spin), sn = Math.sin(spin), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
    // nose tilted up, then the whole model turns on the pad
    const place = ([x, y, z]) => {
      const x1 = (x * ct - y * st) * grow, y1 = (x * st + y * ct) * grow, z1 = z * grow;
      return [x1 * cs - z1 * sn, y1 + 0.12, x1 * sn + z1 * cs];
    };
    const draw = (lines, alpha, width) => {
      pc.strokeStyle = `rgba(${rgb},${alpha})`; pc.lineWidth = width;
      pc.beginPath();
      lines.forEach(([a, b]) => { const p = P(...place(a)), q = P(...place(b)); pc.moveTo(p[0], p[1]); pc.lineTo(q[0], q[1]); });
      pc.stroke();
    };
    // projector pad under the model
    [1.25, 0.9, 0.5].forEach((r, i) => {
      pc.strokeStyle = `rgba(${rgb},${0.5 - i * 0.14})`; pc.lineWidth = 1;
      pc.beginPath();
      for (let q = 0; q <= 40; q++) { const a = q / 40 * TAU + (i === 1 ? t * 0.6 : 0), p = P(Math.cos(a) * r, -0.95, Math.sin(a) * r); q ? pc.lineTo(p[0], p[1]) : pc.moveTo(p[0], p[1]); }
      if (i === 1) pc.setLineDash([3, 5]);
      pc.stroke(); pc.setLineDash([]);
    });
    const beam = pc.createLinearGradient(0, H * 0.2, 0, H * 0.92);
    beam.addColorStop(0, `rgba(${rgb},0)`); beam.addColorStop(1, `rgba(${rgb},0.16)`);
    pc.fillStyle = beam;
    pc.beginPath(); pc.moveTo(W * 0.22, H * 0.2); pc.lineTo(W * 0.78, H * 0.2); pc.lineTo(W * 0.62, H * 0.9); pc.lineTo(W * 0.38, H * 0.9); pc.fill();

    draw(current.model.lines, 0.2, 3.5);
    draw(current.model.lines, 0.95, 1);
    for (let i = 0; i < current.model.sats; i++) { // companions circling the core
      const a = t * 2 + i / current.model.sats * TAU, p = P(...place([0, Math.cos(a) * 0.95, Math.sin(a) * 0.95]));
      pc.fillStyle = `rgba(255,255,255,0.9)`; pc.beginPath(); pc.arc(p[0], p[1], 2.2, 0, TAU); pc.fill();
      pc.fillStyle = `rgba(${rgb},0.4)`; pc.beginPath(); pc.arc(p[0], p[1], 6, 0, TAU); pc.fill();
    }
    for (let i = 0; i < current.model.halos; i++) { // pulse rings
      const r = 0.8 + ((t * 0.5 + i / current.model.halos) % 1) * 0.7, ring = [];
      for (let q = 0; q < 32; q++) ring.push([[0, Math.cos(q / 32 * TAU) * r, Math.sin(q / 32 * TAU) * r], [0, Math.cos((q + 1) / 32 * TAU) * r, Math.sin((q + 1) / 32 * TAU) * r]]);
      draw(ring, 1.5 - r, 1);
    }
    const scanY = H * 0.2 + ((t * 0.35) % 1) * H * 0.62; // scan line
    pc.fillStyle = `rgba(${rgb},0.35)`;
    pc.fillRect(W * 0.2, scanY, W * 0.6, 1);
  }

  // ---------------------------------------------------------------- setup --
  Bus.on('booted', () => { booted = true; shownAt = performance.now(); });
  Bus.on('screen', ({ phase }) => {
    setRunning(phase === 'menu');
    if (phase === 'draft' && current && !pvRunning) { pvRunning = true; requestAnimationFrame(previewLoop); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    cv = document.getElementById('holo');
    c = cv.getContext('2d');
    pv = document.getElementById('wpnPreview');
    pc = pv.getContext('2d');
    resize();
    let timer = null;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { resize(); if (!running) render(performance.now()); }, 120);
    });
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      lookTo.x = e.clientX / window.innerWidth - 0.5;
      lookTo.y = e.clientY / window.innerHeight - 0.5;
    });
    shot.t0 = performance.now() / 1000 + 1.5;
    render(performance.now()); // first frame, even before the menu shows
  });

  return { preview };
})();
