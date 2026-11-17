// Scene: the alien sky behind the battlefield and the dust drifting in front
// of it. Scenery only. The game canvas (#c) is transparent where there is no
// ground, so this layer shows through and can move a little with the pointer.
//   #sky    painted once per resize: space, nebulae, a ringed planet, the
//           facility's skyline along the horizon
//   #motes  ~45 drifting dust specks, redrawn about 30 times a second
window.TT = window.TT || {};
TT.Scene = (function () {
  "use strict";
  const Bus = TT.Bus;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let sky, sctx, motes, mctx, world;
  let size = { w: 0, h: 0, horizon: 0, scale: 1 };
  let active = false, looping = false, painted = false, lastFrame = 0;
  let dust = [];

  // Fixed pseudo-random numbers, so the sky looks the same after every resize.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  }

  function glow(c, x, y, r, color) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  function paintSpace(c, w, h, hz, R) {
    const k = clamp(hz / h, 0.25, 0.92);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#02030a');
    g.addColorStop(k * 0.45, '#070b1e');
    g.addColorStop(k * 0.8, '#15123f');
    g.addColorStop(k * 0.96, '#2a2374');
    g.addColorStop(k, '#2f7ea8');
    g.addColorStop(Math.min(1, k + 0.05), '#0a0f26');
    g.addColorStop(1, '#04050c');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    c.globalCompositeOperation = 'lighter';
    [[0.2, 0.3, 0.42, 'rgba(120,70,255,0.17)'], [0.6, 0.1, 0.46, 'rgba(40,150,255,0.10)'],
     [0.9, 0.5, 0.3, 'rgba(255,100,40,0.07)']].forEach(([u, v, r, color]) =>
      glow(c, u * w, v * hz, r * Math.max(w, h), color));

    for (let i = 0; i < 280; i++) {
      const x = R() * w, y = Math.pow(R(), 1.5) * hz, r = 0.3 + R() * 1.1, a = 0.25 + R() * 0.65;
      const tint = R();
      c.fillStyle = tint < 0.12 ? `rgba(255,190,140,${a})` : tint < 0.3 ? `rgba(150,225,255,${a})` : `rgba(255,255,255,${a})`;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      if (r > 1.25) { // the brightest get a glint
        c.strokeStyle = `rgba(200,235,255,${a * 0.5})`;
        c.lineWidth = 0.6;
        c.beginPath(); c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  function ringHalf(c, cx, cy, r, front) {
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.32);
    [[1.95, 3.5, 'rgba(170,150,255,0.30)'], [1.72, 7, 'rgba(110,200,255,0.20)'], [1.5, 2, 'rgba(255,255,255,0.26)']].forEach(([k, lw, color]) => {
      c.strokeStyle = color;
      c.lineWidth = lw * r / 90;
      c.beginPath();
      c.ellipse(0, 0, r * k, r * k * 0.22, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
      c.stroke();
    });
    c.restore();
  }

  function paintPlanet(c, w, h, hz) {
    const r = Math.min(w, h, 900) * 0.16, cx = w * 0.7, cy = Math.max(r * 1.25, hz - Math.max(h * 0.3, r * 2.1));
    glow(c, cx, cy, r * 2.3, 'rgba(110,90,255,0.20)');
    ringHalf(c, cx, cy, r, false);
    const body = c.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.1, cx, cy, r);
    body.addColorStop(0, '#b9adff');
    body.addColorStop(0.5, '#6652d6');
    body.addColorStop(1, '#2a1f78');
    c.fillStyle = body;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.save(); // cloud bands, then the night side
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.clip();
    [[-0.45, 0.10, 'rgba(200,190,255,0.16)'], [-0.12, 0.06, 'rgba(60,220,255,0.12)'],
     [0.2, 0.13, 'rgba(20,10,60,0.30)'], [0.5, 0.07, 'rgba(210,170,255,0.12)']].forEach(([y, t, color]) => {
      c.fillStyle = color;
      c.beginPath(); c.ellipse(cx, cy + y * r, r * 1.1, t * r, -0.32, 0, TAU); c.fill();
    });
    const night = c.createRadialGradient(cx - r * 0.6, cy - r * 0.6, r * 0.85, cx - r * 0.6, cy - r * 0.6, r * 2);
    night.addColorStop(0, 'rgba(0,0,0,0)');
    night.addColorStop(1, 'rgba(3,3,16,0.9)');
    c.fillStyle = night;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.restore();
    c.strokeStyle = 'rgba(160,220,255,0.55)'; // lit rim of atmosphere
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.85, Math.PI * 1.75); c.stroke();
    ringHalf(c, cx, cy, r, true);

    const mr = Math.min(w, h) * 0.032, mx = w * 0.19, my = Math.max(mr * 2, hz - h * 0.44); // a small moon
    const moon = c.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, mr * 0.1, mx, my, mr);
    moon.addColorStop(0, '#e6eeff');
    moon.addColorStop(0.6, '#8f9cc0');
    moon.addColorStop(1, '#1a2040');
    glow(c, mx, my, mr * 3, 'rgba(150,190,255,0.15)');
    c.fillStyle = moon;
    c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
  }

  // The weapons facility: towers, lit windows, beacons and two energy spires.
  function paintSkyline(c, w, h, hz, R, scale) {
    const unit = clamp(scale * 0.95, 0.5, 1.4);
    const base = hz + 10 * unit;
    c.globalCompositeOperation = 'lighter';
    const band = c.createLinearGradient(0, hz - h * 0.1, 0, hz + h * 0.05);
    band.addColorStop(0, 'rgba(59,232,255,0)');
    band.addColorStop(0.7, 'rgba(59,232,255,0.20)');
    band.addColorStop(1, 'rgba(120,90,255,0)');
    c.fillStyle = band;
    c.fillRect(0, hz - h * 0.1, w, h * 0.15);
    c.globalCompositeOperation = 'source-over';

    // orbital tether climbing out of the atmosphere
    const tx = w * 0.36;
    const tether = c.createLinearGradient(0, 0, 0, base);
    tether.addColorStop(0, 'rgba(150,230,255,0)');
    tether.addColorStop(1, 'rgba(150,230,255,0.55)');
    c.strokeStyle = tether;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(tx + w * 0.03, 0); c.lineTo(tx, base); c.stroke();
    for (let i = 1; i < 6; i++) {
      const k = i / 6;
      c.fillStyle = `rgba(190,240,255,${0.15 + k * 0.5})`;
      c.fillRect(tx + w * 0.03 * (1 - k) - 1.5, base * k - 1.5, 3, 3);
    }

    let x = -10;
    while (x < w + 10) {
      const tw = (8 + R() * 30) * unit, th = (10 + Math.pow(R(), 2.4) * 150) * unit;
      const top = base - th;
      const body = c.createLinearGradient(0, top, 0, base);
      body.addColorStop(0, '#0e1430');
      body.addColorStop(1, '#04060e');
      c.fillStyle = body;
      c.beginPath();
      const notch = R() < 0.4 ? tw * 0.3 : 0; // some towers taper
      c.moveTo(x, base); c.lineTo(x, top + notch); c.lineTo(x + notch, top);
      c.lineTo(x + tw - notch, top); c.lineTo(x + tw, top + notch); c.lineTo(x + tw, base);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(120,170,255,0.20)';
      c.lineWidth = 0.6;
      c.stroke();
      for (let wy = top + 5 * unit; wy < base - 4; wy += 5 * unit) { // windows
        if (R() < 0.55) continue;
        c.fillStyle = R() < 0.25 ? 'rgba(255,150,60,0.75)' : 'rgba(110,230,255,0.6)';
        c.fillRect(x + 2 + R() * Math.max(1, tw - 6), wy, 1.6 * unit, 1.2 * unit);
      }
      if (th > 70 * unit) { // tall ones carry a mast and beacon
        const mx = x + tw / 2, mtop = top - (10 + R() * 22) * unit;
        c.strokeStyle = 'rgba(160,190,255,0.5)';
        c.beginPath(); c.moveTo(mx, top); c.lineTo(mx, mtop); c.stroke();
        c.globalCompositeOperation = 'lighter';
        glow(c, mx, mtop, 9 * unit, R() < 0.5 ? 'rgba(255,90,60,0.85)' : 'rgba(80,230,255,0.85)');
        c.globalCompositeOperation = 'source-over';
      }
      x += tw + R() * 16 * unit;
    }

    c.globalCompositeOperation = 'lighter';
    [0.12, 0.88].forEach(u => { // energy spires firing into the sky
      const sx = u * w, sh = Math.min(h * 0.3, 260 * unit);
      const beam = c.createLinearGradient(0, base - sh, 0, base);
      beam.addColorStop(0, 'rgba(59,232,255,0)');
      beam.addColorStop(1, 'rgba(59,232,255,0.55)');
      c.fillStyle = beam;
      c.fillRect(sx - 1.5 * unit, base - sh, 3 * unit, sh);
      const haze = c.createLinearGradient(0, base - sh, 0, base);
      haze.addColorStop(0, 'rgba(59,232,255,0)');
      haze.addColorStop(1, 'rgba(59,232,255,0.10)');
      c.fillStyle = haze;
      c.fillRect(sx - 12 * unit, base - sh, 24 * unit, sh);
      glow(c, sx, base - 4 * unit, 36 * unit, 'rgba(120,240,255,0.5)');
    });
    c.globalCompositeOperation = 'source-over';
  }

  function paint() {
    const { w, h, horizon } = size;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sky.width = Math.round(w * dpr);
    sky.height = Math.round(h * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = seeded(2089);
    paintSpace(sctx, w, h, horizon, R);
    paintPlanet(sctx, w, h, horizon);
    paintSkyline(sctx, w, h, horizon, R, size.scale);
    world.style.setProperty('--horizon', Math.round(horizon) + 'px');

    motes.width = Math.round(w);
    motes.height = Math.round(h);
    dust = Array.from({ length: Math.round(clamp(w / 28, 18, 46)) }, () => ({
      x: Math.random() * w, y: Math.random() * h, z: 0.3 + Math.random() * 0.7,
      phase: Math.random() * TAU, tint: Math.random()
    }));
    painted = true;
    if (calm) drawDust(0);
  }

  function drawDust(dt) {
    const { w, h } = size, t = performance.now() / 1000;
    mctx.clearRect(0, 0, w, h);
    dust.forEach(d => {
      d.x += (5 + 14 * d.z) * dt;
      d.y += (Math.sin(t * 0.6 + d.phase) * 5 - 3 * d.z) * dt;
      if (d.x > w + 4) d.x = -4;
      if (d.y < -4) d.y = h + 4;
      const a = (0.12 + 0.38 * d.z) * (0.6 + 0.4 * Math.sin(t * 1.7 + d.phase));
      mctx.fillStyle = d.tint < 0.2 ? `rgba(190,160,255,${a})` : d.tint < 0.6 ? `rgba(120,230,255,${a})` : `rgba(255,255,255,${a})`;
      mctx.beginPath(); mctx.arc(d.x, d.y, 0.6 + d.z * 1.3, 0, TAU); mctx.fill();
    });
  }

  function frame(now) {
    if (!active || calm) { looping = false; return; }
    requestAnimationFrame(frame);
    if (document.hidden || !painted || now - lastFrame < 32) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    drawDust(dt);
  }

  let queued = false;
  Bus.on('view', v => {
    if (Math.abs(v.w - size.w) < 1 && Math.abs(v.h - size.h) < 1 && Math.abs(v.horizon - size.horizon) < 2) return;
    size = { w: v.w, h: v.h, horizon: v.horizon, scale: v.scale || 1 };
    if (queued || !sky) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  });
  Bus.on('screen', ({ phase }) => {
    active = phase === 'battle';
    if (active && !looping && !calm) { looping = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    sky = document.getElementById('sky');
    motes = document.getElementById('motes');
    world = document.getElementById('world');
    sctx = sky.getContext('2d');
    mctx = motes.getContext('2d');
  });

  return {};
})();
