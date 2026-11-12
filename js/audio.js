// Audio: the one place sound is made. Everything is synthesised live with the
// Web Audio API (no sound files, so nothing to download or license).
//
//   ambient bed   ->  musicBus  \
//   sound effects ->  sfxBus     >-> master -> compressor -> speakers
//   echoes        ->  reverb    /
//
// Sounds are tied to what really happens: the game announces events on TT.Bus
// ("fire", "impact", "turn"...) and this file answers them. Buttons get their
// hover/click sounds from one listener on the document.
// Browsers only allow sound after a click, so nothing starts until unlock().
window.TT = window.TT || {};
TT.Audio = (function () {
  "use strict";
  const Bus = TT.Bus;
  const STORE = 'tt-audio';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const prefs = Object.assign({ master: 0.8, music: 0.5, sfx: 0.85, muted: false }, loadPrefs());
  let ctx = null;
  let master, musicBus, sfxBus, musicSend, sfxSend, noiseBuf;
  let scene = 'menu';

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE)) || {};
      const out = {};
      ['master', 'music', 'sfx'].forEach(k => { if (typeof p[k] === 'number') out[k] = clamp(p[k], 0, 1); });
      if (typeof p.muted === 'boolean') out.muted = p.muted;
      return out;
    } catch (e) { return {}; }
  }
  function savePrefs() { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) { /* storage blocked */ } }

  // ------------------------------------------------------------ engine --
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); // keeps big blasts from clipping
    comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain();
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);

    // reverb: a burst of fading noise, used as the "room" of the range
    const verb = ctx.createConvolver();
    verb.buffer = impulse(2.8);
    const wet = ctx.createGain(); wet.gain.value = 0.6;
    verb.connect(wet); wet.connect(master);
    musicSend = ctx.createGain(); musicSend.connect(verb);
    sfxSend = ctx.createGain(); sfxSend.connect(verb);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    applyVolumes(0);
    startBed();
    return true;
  }

  function impulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  function applyVolumes(smooth) {
    if (!ctx) return;
    const t = ctx.currentTime, tau = smooth === 0 ? 0.001 : 0.04;
    master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.master, t, tau);
    musicBus.gain.setTargetAtTime(prefs.music, t, tau);
    musicSend.gain.setTargetAtTime(prefs.music, t, tau);
    sfxBus.gain.setTargetAtTime(prefs.sfx, t, tau);
    sfxSend.gain.setTargetAtTime(prefs.sfx, t, tau);
  }

  const ready = () => !!ctx && ctx.state === 'running' && !prefs.muted;

  // Send a finished sound to its bus, optionally panned and with some echo.
  function route(node, o) {
    const music = o.bus === 'music';
    let last = node;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      last.connect(p);
      last = p;
    }
    last.connect(music ? musicBus : sfxBus);
    if (o.verb) {
      const send = ctx.createGain();
      send.gain.value = o.verb;
      last.connect(send);
      send.connect(music ? musicSend : sfxSend);
    }
    return last;
  }
  // Quick rise to `peak`, then fade to silence over `dur` seconds.
  function envelope(g, t, attack, dur, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }
  // One pitched note. f2 = glide to this pitch.
  function tone(o) {
    const t = ctx.currentTime + (o.t || 0), attack = o.attack || 0.005;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + attack + (o.glide || o.dur));
    envelope(g, t, attack, o.dur, o.gain || 0.1);
    osc.connect(g);
    const end = route(g, o);
    osc.start(t);
    osc.stop(t + attack + o.dur + 0.05);
    osc.onended = () => { g.disconnect(); end.disconnect(); };
  }
  // One burst of filtered noise. f2 = sweep the filter to this frequency.
  function noise(o) {
    const t = ctx.currentTime + (o.t || 0), attack = o.attack || 0.003;
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    filt.type = o.type || 'lowpass';
    filt.frequency.setValueAtTime(o.f, t);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t + attack + o.dur);
    filt.Q.value = o.q || 0.7;
    envelope(g, t, attack, o.dur, o.gain || 0.1);
    src.connect(filt); filt.connect(g);
    const end = route(g, o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + o.dur + 0.05);
    src.onended = () => { g.disconnect(); end.disconnect(); };
  }

  // The same sound can't retrigger faster than `ms` (no machine-gun hovers).
  const lastPlayed = {};
  function gate(key, ms) {
    const t = performance.now();
    if (lastPlayed[key] && t - lastPlayed[key] < ms) return false;
    lastPlayed[key] = t;
    return true;
  }

  // Left/right position on the battlefield -> stereo position.
  const panOf = (x, width) => clamp((x / (width || 900)) * 2 - 1, -1, 1) * 0.8;

  // ------------------------------------------------------ sound effects --
  const SFX = {
    // -- interface --
    hover() { if (gate('hover', 55)) tone({ f: 1900, f2: 2400, dur: 0.035, gain: 0.05 }); },
    click() {
      tone({ type: 'square', f: 520, f2: 260, dur: 0.06, gain: 0.09 });
      noise({ type: 'highpass', f: 3200, dur: 0.02, gain: 0.07 });
    },
    tick(o) {
      if (!gate('tick', 36)) return;
      tone({ f: 700 + (o.value || 0) * 900, dur: 0.026, gain: 0.075 * (o.gain || 1) });
      noise({ type: 'highpass', f: 5200, dur: 0.008, gain: 0.03 * (o.gain || 1) });
    },
    select() {
      tone({ type: 'triangle', f: 660, dur: 0.09, gain: 0.12 });
      tone({ type: 'triangle', f: 990, t: 0.07, dur: 0.18, gain: 0.12, verb: 0.35 });
      noise({ type: 'bandpass', f: 2400, dur: 0.05, gain: 0.03 });
    },
    confirm() {
      noise({ f: 400, f2: 4200, dur: 0.38, gain: 0.07 });
      tone({ type: 'sawtooth', f: 110, f2: 220, dur: 0.36, gain: 0.07 });
      [440, 554.4, 659.3, 880].forEach((f, i) => tone({ type: 'triangle', f, t: 0.1 + i * 0.045, dur: 0.5, gain: 0.07, verb: 0.45 }));
    },
    back() {
      tone({ type: 'triangle', f: 520, f2: 260, dur: 0.14, gain: 0.1 });
      tone({ f: 260, f2: 130, t: 0.05, dur: 0.18, gain: 0.08 });
    },
    deny() {
      tone({ type: 'square', f: 140, dur: 0.11, gain: 0.06 });
      tone({ type: 'square', f: 105, t: 0.1, dur: 0.14, gain: 0.06 });
    },
    panel() {
      noise({ type: 'bandpass', f: 600, f2: 2600, q: 1.2, dur: 0.16, gain: 0.07 });
      tone({ f: 300, f2: 900, dur: 0.14, gain: 0.05 });
    },
    transition() {
      if (!gate('transition', 250)) return;
      noise({ type: 'bandpass', f: 300, f2: 3400, q: 0.9, dur: 0.45, gain: 0.09, verb: 0.3 });
      tone({ f: 90, f2: 42, dur: 0.5, gain: 0.2 });
    },
    boot() {
      tone({ f: 60, f2: 240, dur: 1.3, gain: 0.2, verb: 0.4 });
      noise({ f: 200, f2: 6000, dur: 1.1, gain: 0.05, verb: 0.3 });
      [220, 329.6, 440, 659.3].forEach((f, i) => tone({ f, t: 0.5 + i * 0.13, attack: 0.05, dur: 1.7, gain: 0.07, verb: 0.7 }));
      tone({ type: 'triangle', f: 1318.5, t: 1.1, dur: 0.6, gain: 0.05, verb: 0.7 });
    },
    // -- armoury --
    pick(o) {
      const k = o.mine ? 1 : 0.75, g = o.mine ? 1 : 0.6;
      noise({ type: 'bandpass', f: 2800, q: 2, dur: 0.035, gain: 0.07 * g });
      tone({ type: 'square', f: 170 * k, f2: 110 * k, dur: 0.06, gain: 0.07 * g });
      tone({ type: 'triangle', f: 440 * k, f2: 660 * k, t: 0.03, dur: 0.09, gain: 0.1 * g });
      tone({ f: 1320 * k, t: 0.09, dur: 0.22, gain: 0.06 * g, verb: 0.4 });
    },
    shuffle() {
      for (let i = 0; i < 10; i++) {
        noise({ type: 'bandpass', f: rnd(1800, 3600), q: 2, t: i * 0.035, dur: 0.02, gain: 0.05 });
        tone({ type: 'triangle', f: 400 + i * 70, t: i * 0.035, dur: 0.04, gain: 0.05 });
      }
      tone({ f: 1320, t: 0.4, dur: 0.3, gain: 0.07, verb: 0.5 });
    },
    armed() { // both loadouts are full
      [329.6, 440, 659.3].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.08, dur: 0.4, gain: 0.08, verb: 0.5 }));
    },
    // -- fire control --
    weapon() { // a new shell is racked
      noise({ type: 'bandpass', f: 1800, q: 2, dur: 0.03, gain: 0.1 });
      tone({ type: 'square', f: 180, f2: 120, dur: 0.06, gain: 0.07 });
      tone({ type: 'triangle', f: 1320, t: 0.05, dur: 0.08, gain: 0.05 });
    },
    fire(o) {
      const pan = o.pan || 0;
      switch (o.cat) {
        case 'attacker': // heavy launch
          tone({ f: 78, f2: 30, dur: 0.6, gain: 0.55, pan: pan * 0.5 });
          noise({ f: 900, f2: 120, dur: 0.55, gain: 0.32, pan, verb: 0.45 });
          tone({ type: 'sawtooth', f: 240, f2: 60, dur: 0.4, gain: 0.1, pan });
          noise({ type: 'highpass', f: 2500, dur: 0.05, gain: 0.16, pan });
          break;
        case 'dirt': // mortar thump
          tone({ f: 150, f2: 55, dur: 0.26, gain: 0.42, pan: pan * 0.5 });
          noise({ type: 'bandpass', f: 420, q: 1.4, dur: 0.18, gain: 0.2, pan });
          noise({ f: 300, dur: 0.3, gain: 0.12, pan, verb: 0.3 });
          break;
        case 'magic': // rising shimmer
          tone({ f: 420, f2: 1680, dur: 0.32, gain: 0.15, pan, verb: 0.5 });
          [880, 1174.7, 1568, 2093].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.045, dur: 0.18, gain: 0.06, pan, verb: 0.5 }));
          noise({ type: 'bandpass', f: 5000, q: 1.5, dur: 0.2, gain: 0.04, pan });
          tone({ f: 95, f2: 50, dur: 0.25, gain: 0.25, pan: pan * 0.5 });
          break;
        default: // shooter: rail crack
          noise({ type: 'highpass', f: 1800, dur: 0.07, gain: 0.28, pan });
          tone({ type: 'sawtooth', f: 1900, f2: 160, dur: 0.22, gain: 0.13, pan });
          tone({ f: 110, f2: 42, dur: 0.28, gain: 0.4, pan: pan * 0.5 });
          noise({ type: 'bandpass', f: 900, f2: 300, dur: 0.3, gain: 0.1, pan, verb: 0.35 });
      }
    },
    // Layered blast: crack, body, sub-bass, punch, then falling debris.
    boom(o) {
      const size = o.size == null ? 0.5 : o.size, pan = o.pan || 0, t = o.t || 0, flavor = o.flavor || 'fire';
      const g = 0.32 + size * 0.5, len = 0.5 + size * 1.1, dirt = flavor === 'dirt';
      if (!dirt) noise({ t, type: 'highpass', f: 2200, dur: 0.04, gain: g * 0.5, pan });
      noise({ t, f: (dirt ? 1100 : 2600) - size * 600, f2: 70, dur: len, gain: g, pan, verb: 0.5 });
      tone({ t, f: (95 - size * 30) * rnd(0.92, 1.08), f2: 26, dur: len * 0.8, gain: g * 1.1, pan: pan * 0.5 });
      tone({ t, type: 'triangle', f: 180, f2: 40, dur: 0.25, gain: g * 0.4, pan });
      const bits = Math.round((dirt ? 8 : 4) + size * 8);
      for (let i = 0; i < bits; i++) {
        noise({ t: t + rnd(0.12, 0.3 + len), type: 'bandpass', f: dirt ? rnd(400, 1500) : rnd(1500, 5000), q: 3,
          dur: rnd(0.03, 0.07), gain: rnd(0.03, 0.09), pan: clamp(pan + rnd(-0.3, 0.3), -1, 1) });
      }
      if (flavor === 'plasma') {
        tone({ t, type: 'sawtooth', f: 1400, f2: 200, dur: 0.18, gain: 0.09, pan });
        tone({ t, f: 2400, dur: 0.3, gain: 0.04, pan, verb: 0.6 });
      } else if (flavor === 'magic') {
        [1318.5, 1760, 2637, 3520].forEach((f, i) =>
          tone({ t: t + i * 0.03, f: f * pick([1, 1, 1.5]), dur: rnd(0.5, 0.9), gain: 0.045, pan, verb: 0.7 }));
      }
    },
    chomp(o) { // the Beaver surfacing under a tank
      const pan = o.pan || 0;
      [0, 0.07, 0.14].forEach(t => {
        tone({ t, type: 'square', f: 300, f2: 140, dur: 0.05, gain: 0.12, pan });
        noise({ t, type: 'bandpass', f: 1400, q: 2, dur: 0.04, gain: 0.12, pan });
      });
      tone({ f: 120, f2: 50, dur: 0.3, gain: 0.3, pan: pan * 0.5 });
    },
    miss() { // the shell left the range
      tone({ f: 620, f2: 190, dur: 0.3, gain: 0.05, verb: 0.5 });
      noise({ t: 0.25, f: 300, dur: 0.5, gain: 0.05, verb: 0.6 });
    },
    burn(o) { // crackling fire for o.ms milliseconds
      const secs = (o.ms || 4000) / 1000, pan = o.pan || 0;
      noise({ f: 520, attack: 0.3, dur: secs, gain: 0.035, pan });
      for (let i = 0; i < secs * 14; i++) {
        noise({ t: rnd(0, secs), type: 'bandpass', f: rnd(1200, 4200), q: 2, dur: rnd(0.02, 0.05), gain: rnd(0.012, 0.045), pan });
      }
    },
    score(o) {
      const t = 0.14; // just after the blast's first hit
      if (!o.points) { tone({ t, f: 220, f2: 180, dur: 0.12, gain: 0.05 }); return; }
      const notes = [659.3, 880, 1174.7, 1568].slice(0, o.points >= 75 ? 3 : o.points >= 30 ? 2 : 1);
      notes.forEach((f, i) => tone({ type: 'triangle', f, t: t + i * 0.07, dur: 0.2, gain: 0.09, verb: 0.45 }));
      if (o.direct) { // metal ringing: a direct hit on the hull
        [311, 466, 698, 1046].forEach(f => tone({ f, dur: 0.4, gain: 0.07, pan: o.pan || 0, verb: 0.4 }));
        noise({ type: 'highpass', f: 4000, dur: 0.03, gain: 0.1, pan: o.pan || 0 });
        tone({ type: 'triangle', f: 2093, t: t + 0.24, dur: 0.3, gain: 0.07, verb: 0.6 });
      }
    },
    turn(o) {
      const pan = o.current === 0 ? -0.4 : 0.4;
      if (o.solo && !o.mine) { tone({ type: 'triangle', f: 392, dur: 0.16, gain: 0.07, pan, verb: 0.3 }); return; }
      tone({ type: 'triangle', f: 587.3, dur: 0.1, gain: 0.08, pan, verb: 0.3 });
      tone({ type: 'triangle', f: 880, t: 0.09, dur: 0.2, gain: 0.08, pan, verb: 0.4 });
    },
    teleport(o) {
      const pan = o.pan || 0;
      tone({ f: 300, f2: 2400, dur: 0.22, gain: 0.12, pan, verb: 0.5 });
      tone({ f: 2400, f2: 500, t: 0.2, dur: 0.3, gain: 0.1, pan, verb: 0.5 });
      noise({ type: 'bandpass', f: 3000, f2: 800, q: 1.5, dur: 0.4, gain: 0.05, pan });
      tone({ f: 80, f2: 40, t: 0.2, dur: 0.3, gain: 0.25, pan: pan * 0.5 });
    },
    drive(o) {
      const pan = o.pan || 0, secs = Math.max(0.12, (o.moved || 0) / 40);
      if (o.moved) {
        noise({ f: 240, attack: 0.05, dur: secs, gain: 0.1, pan });
        tone({ type: 'triangle', f: 70, f2: 96, attack: 0.05, dur: secs, gain: 0.08, pan });
        for (let t = 0; t < secs; t += 0.085) noise({ t, type: 'bandpass', f: 900, q: 2, dur: 0.02, gain: 0.03, pan });
      }
      if (o.blocked) {
        tone({ t: o.moved ? secs : 0, type: 'square', f: 110, f2: 70, dur: 0.1, gain: 0.08, pan });
        noise({ t: o.moved ? secs : 0, type: 'bandpass', f: 600, q: 1.5, dur: 0.06, gain: 0.08, pan });
      }
    },
    deploy() { // a round begins
      noise({ type: 'bandpass', f: 250, f2: 3000, dur: 0.6, gain: 0.08, verb: 0.4 });
      [220, 329.6, 440, 659.3, 880].forEach((f, i) => tone({ type: 'triangle', f, t: 0.15 + i * 0.07, dur: 0.3, gain: 0.07, verb: 0.5 }));
      tone({ f: 55, f2: 110, dur: 0.7, gain: 0.2 });
    },
    victory() {
      [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => {
        tone({ type: 'sawtooth', f, t: i * 0.13, dur: 0.32, gain: 0.05, verb: 0.5 });
        tone({ type: 'triangle', f, t: i * 0.13, dur: 0.4, gain: 0.09, verb: 0.5 });
      });
      [523.3, 659.3, 784, 1046.5, 1318.5].forEach(f => tone({ type: 'triangle', f, t: 0.72, attack: 0.02, dur: 2.2, gain: 0.07, verb: 0.7 }));
      tone({ f: 65.4, t: 0.72, dur: 2, gain: 0.3 });
      noise({ t: 0.72, type: 'highpass', f: 5000, dur: 1.4, gain: 0.03, verb: 0.6 });
    },
    defeat() {
      [220, 261.6, 311.1].forEach((f, i) => tone({ type: 'triangle', f, f2: f * 0.5, t: i * 0.05, glide: 2.2, dur: 2.2, gain: 0.08, verb: 0.6 }));
      tone({ f: 880, f2: 55, dur: 1.5, gain: 0.05, verb: 0.5 }); // systems winding down
      tone({ f: 55, f2: 30, t: 0.2, dur: 2, gain: 0.3 });
      noise({ f: 2400, f2: 90, dur: 1.8, gain: 0.07, verb: 0.5 });
    },
    stalemate() {
      [440, 523.3].forEach(f => tone({ type: 'triangle', f, attack: 0.03, dur: 1.4, gain: 0.08, verb: 0.6 }));
      tone({ f: 73.4, dur: 1.4, gain: 0.25 });
    },
    // -- uplink --
    linkUp() { [660, 880, 1320].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.09, dur: 0.14, gain: 0.09, verb: 0.4 })); },
    linkDown() {
      [660, 440, 277.2].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.11, dur: 0.18, gain: 0.09, verb: 0.4 }));
      noise({ t: 0.3, type: 'bandpass', f: 1800, f2: 300, dur: 0.4, gain: 0.06 });
    },
    sonar() { tone({ f: 1100, dur: 0.7, gain: 0.05, verb: 0.8 }); tone({ f: 1650, t: 0.02, dur: 0.4, gain: 0.02, verb: 0.8 }); },
    message() { tone({ f: 1174.7, dur: 0.07, gain: 0.06 }); tone({ f: 1568, t: 0.07, dur: 0.12, gain: 0.06, verb: 0.3 }); }
  };

  function play(name, opts) {
    if (!ready() || !SFX[name]) return;
    try { SFX[name](opts || {}); } catch (e) { console.warn('[audio] ' + name, e); }
  }

  // ---- the shell's whistle: one voice that follows it across the sky ----
  let whistle = null;
  function flightStart(pan) {
    flightStop();
    if (!ready()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), g = ctx.createGain();
    const osc = ctx.createOscillator(), og = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    filt.type = 'bandpass'; filt.Q.value = 7; filt.frequency.value = 2400;
    osc.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.15);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.02, t + 0.15);
    if (panner.pan) panner.pan.value = pan;
    src.connect(filt); filt.connect(g); g.connect(panner);
    osc.connect(og); og.connect(panner);
    panner.connect(sfxBus);
    const send = ctx.createGain(); send.gain.value = 0.3;
    panner.connect(send); send.connect(sfxSend);
    src.start(t, Math.random()); osc.start(t);
    whistle = { src, osc, filt, g, og, panner, send };
  }
  // Pitch falls as the shell comes down (the classic incoming whistle) and
  // the sound moves across the speakers with it.
  function flightMove(e) {
    if (!whistle) return;
    const t = ctx.currentTime, f = clamp(1500 - e.vy * 1.6, 380, 2600);
    whistle.osc.frequency.setTargetAtTime(f, t, 0.06);
    whistle.filt.frequency.setTargetAtTime(f * 1.5, t, 0.06);
    if (whistle.panner.pan) whistle.panner.pan.setTargetAtTime(panOf(e.x, e.width), t, 0.05);
  }
  function flightStop() {
    const w = whistle;
    if (!w) return;
    whistle = null;
    const t = ctx.currentTime;
    [w.g, w.og].forEach(g => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.03); });
    w.src.stop(t + 0.2); w.osc.stop(t + 0.2);
    w.osc.onended = () => { w.panner.disconnect(); w.send.disconnect(); };
  }

  // ------------------------------------------------------- ambient bed --
  // Always-running layers; a "scene" only changes how loud each one is.
  //   drone = low reactor tone, pad = slow chord, hum = machinery, wind = open range
  const SCENES = {
    menu:   { drone: 0.50, pad: 1.00, hum: 0.6, wind: 0.0, bells: [5, 9],   pulse: 2.4 },
    draft:  { drone: 0.55, pad: 0.60, hum: 0.9, wind: 0.0, bells: [7, 12],  pulse: 1.2 },
    battle: { drone: 0.65, pad: 0.22, hum: 0.3, wind: 1.0, bells: [14, 22], pulse: 0 }
  };
  let bed = null;

  function loopNoise(filterType, freq, q) {
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter();
    src.buffer = noiseBuf; src.loop = true;
    filt.type = filterType; filt.frequency.value = freq; filt.Q.value = q;
    src.connect(filt);
    src.start(0, Math.random());
    return filt;
  }
  // A slow wobble added to an audio parameter.
  function lfo(rate, depth, param) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = rate; g.gain.value = depth;
    osc.connect(g); g.connect(param);
    osc.start();
  }
  function layer(level) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(musicBus);
    const send = ctx.createGain(); send.gain.value = level;
    g.connect(send); send.connect(musicSend);
    return g;
  }

  function startBed() {
    bed = { drone: layer(0.15), pad: layer(0.7), hum: layer(0.1), wind: layer(0.25), nextBell: 0, nextPulse: 0 };

    const droneFilt = ctx.createBiquadFilter();
    droneFilt.type = 'lowpass'; droneFilt.frequency.value = 240; droneFilt.Q.value = 2;
    lfo(0.05, 110, droneFilt.frequency);
    [[55, 'sawtooth', 0.05], [55.35, 'sawtooth', 0.05], [82.4, 'sawtooth', 0.028], [55, 'sine', 0.1]].forEach(([f, type, level]) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.value = f; g.gain.value = level;
      osc.connect(g); g.connect(droneFilt);
      osc.start();
    });
    droneFilt.connect(bed.drone);

    // A minor add9, each voice breathing at its own pace
    [220, 261.63, 329.63, 392, 493.88].forEach((f, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = f; osc.detune.value = rnd(-7, 7);
      g.gain.value = 0.014;
      lfo(0.03 + i * 0.013, 0.011, g.gain);
      osc.connect(g); g.connect(bed.pad);
      osc.start();
    });

    const hum = loopNoise('bandpass', 118, 9), humGain = ctx.createGain();
    humGain.gain.value = 0.22;
    lfo(6.5, 0.05, humGain.gain); // a slight mechanical flutter
    hum.connect(humGain); humGain.connect(bed.hum);

    const wind = loopNoise('bandpass', 520, 0.9), windGain = ctx.createGain();
    windGain.gain.value = 0.03;
    lfo(0.07, 260, wind.frequency);
    lfo(0.11, 0.016, windGain.gain);
    wind.connect(windGain); windGain.connect(bed.wind);

    setScene(scene);
    setInterval(schedule, 400);
  }

  function setScene(name) {
    scene = SCENES[name] ? name : 'menu';
    if (!bed) return;
    const s = SCENES[scene], t = ctx.currentTime;
    ['drone', 'pad', 'hum', 'wind'].forEach(k => bed[k].gain.setTargetAtTime(s[k], t, 1.2));
    bed.nextBell = Math.min(bed.nextBell || Infinity, t + 2);
    bed.nextPulse = t + 1;
  }

  // Sparse notes on top of the bed, queued a little ahead of time.
  const BELL_NOTES = [440, 523.25, 659.25, 783.99, 880, 1046.5, 1318.5];
  function schedule() {
    if (!bed || ctx.state !== 'running') return;
    const s = SCENES[scene], t = ctx.currentTime;
    if (bed.nextBell < t) bed.nextBell = t + rnd(1, 3);
    if (bed.nextBell < t + 1) {
      const at = bed.nextBell - t, f = pick(BELL_NOTES), pan = rnd(-0.6, 0.6);
      tone({ bus: 'music', f, t: at, attack: 0.02, dur: 2.6, gain: 0.03, pan, verb: 0.9 });
      tone({ bus: 'music', f: f * 2.01, t: at, attack: 0.02, dur: 1.2, gain: 0.008, pan, verb: 0.9 });
      bed.nextBell += rnd(s.bells[0], s.bells[1]);
    }
    if (s.pulse && bed.nextPulse < t + 1) {
      const at = Math.max(0, bed.nextPulse - t);
      [0, 0.3, 0.6].forEach((d, i) => tone({ bus: 'music', f: 110, t: at + d, dur: 0.16, gain: 0.07 / (i + 1), verb: 0.5 }));
      bed.nextPulse = Math.max(bed.nextPulse, t) + s.pulse * 2;
    }
  }
  // Pull the music down for a moment (victory / defeat cue), then let it return.
  function duck(seconds) {
    if (!bed) return;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(prefs.music * 0.25, t, 0.15);
    musicBus.gain.setTargetAtTime(prefs.music, t + seconds, 0.8);
  }

  // --------------------------------------------------------- public API --
  function unlock() {
    if (!ctx && !build()) return;
    if (ctx.state === 'suspended') ctx.resume().then(() => Bus.emit('audio'));
    Bus.emit('audio');
  }
  function setVolume(key, value) {
    if (!(key in prefs) || key === 'muted') return;
    prefs[key] = clamp(value, 0, 1);
    savePrefs();
    applyVolumes();
  }
  function setMuted(muted) {
    prefs.muted = !!muted;
    savePrefs();
    applyVolumes();
    if (prefs.muted) flightStop();
    Bus.emit('audio');
  }

  // -------------------------------------------------- what triggers what --
  // Buttons: one listener for the whole page. data-snd picks the sound
  // ("none" = the game event that follows makes the sound instead).
  let hovered = null;
  document.addEventListener('pointerover', e => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (b === hovered) return;
    hovered = b;
    if (b && !b.disabled && e.pointerType !== 'touch') play('hover');
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    const snd = b.dataset.snd || 'click';
    if (snd !== 'none') play(snd);
  }, true);

  Bus.on('booted', ({ sound }) => { if (sound) setTimeout(() => play('boot'), 60); });
  Bus.on('screen', ({ phase, changed }) => {
    setScene(phase);
    if (changed) play('transition');
  });
  Bus.on('pick', ({ mine, done }) => { play('pick', { mine }); if (done) setTimeout(() => play('armed'), 220); });
  Bus.on('random', () => play('shuffle'));
  Bus.on('round', ({ quiet }) => { if (!quiet) play('deploy'); });

  // dials: a tick whose pitch follows the value that moved
  let lastAim = { angle: null, power: null };
  Bus.on('aim', ({ remote }) => {
    const a = document.getElementById('angle'), p = document.getElementById('power');
    if (!a || !p) return;
    const angle = Number(a.value), power = Number(p.value);
    const gain = remote ? 0.4 : 1;
    if (lastAim.angle !== null && angle !== lastAim.angle) play('tick', { value: angle / 180, gain });
    else if (lastAim.power !== null && power !== lastAim.power) play('tick', { value: (power - 10) / 90, gain });
    lastAim = { angle, power };
  });
  Bus.on('hud', () => { // a new turn restores that player's last aim silently
    const a = document.getElementById('angle'), p = document.getElementById('power');
    if (a && p) lastAim = { angle: Number(a.value), power: Number(p.value) };
  });

  Bus.on('fire', ({ weapon, x, width, quiet }) => {
    if (quiet) return;
    const pan = panOf(x, width);
    play('fire', { cat: weapon.category, pan });
    flightStart(pan);
  });
  Bus.on('flight', flightMove);
  Bus.on('land', flightStop);
  Bus.on('impact', ({ weapon, spots, width }) => {
    if (weapon.id === 'beaver') { play('chomp', { pan: panOf(spots[0].x, width) }); return; }
    const fx = (weapon.effect || {}).type;
    const flavor = { shooter: 'plasma', dirt: 'dirt', magic: 'magic' }[weapon.category] || 'fire';
    const size = clamp(weapon.radius / 60, 0.12, 1);
    spots.forEach((s, i) => {
      // matches when each blast appears on screen (js/effects.js)
      let t = 0;
      if (weapon.id === 'meteorstorm') t = 0.24 + i * 0.11;
      else if (fx === 'cluster') t = i * 0.09;
      else if (fx === 'double') t = i * 0.33;
      play('boom', { size, pan: panOf(s.x, width), t, flavor });
    });
  });
  Bus.on('miss', ({ quiet }) => { if (!quiet) play('miss'); });
  Bus.on('burn', ({ ms, x, width }) => play('burn', { ms, pan: panOf(x, width) }));
  Bus.on('score', ({ points, direct, x, width, quiet }) => { if (!quiet) play('score', { points, direct, pan: panOf(x, width) }); });
  Bus.on('turn', e => { if (e.changed && !e.quiet) setTimeout(() => play('turn', e), 450); });
  Bus.on('teleport', ({ x, width }) => play('teleport', { pan: panOf(x, width) }));
  Bus.on('drive', ({ moved, blocked, x, width }) => play('drive', { moved, blocked, pan: panOf(x, width) }));
  Bus.on('gameover', ({ winner, solo, won, quiet }) => {
    if (quiet) return;
    duck(3.5);
    setTimeout(() => play(winner === -1 ? 'stalemate' : solo && !won ? 'defeat' : 'victory'), 500);
  });

  // uplink
  let sonar = null;
  Bus.on('net', ({ state }) => {
    clearInterval(sonar);
    sonar = null;
    if (state === 'waiting') { // slow ping while the room waits for an opponent
      play('sonar');
      sonar = setInterval(() => play('sonar'), 2600);
    }
  });
  Bus.on('net:connected', () => play('linkUp'));
  Bus.on('net:disconnected', () => play('linkDown'));
  Bus.on('chat', ({ who }) => { if (who === 'Opponent') play('message'); });

  // No sound from a tab nobody is looking at.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { flightStop(); ctx.suspend(); }
    else ctx.resume();
  });

  return {
    unlock, play, setVolume, setMuted, setScene,
    prefs: () => Object.assign({}, prefs),
    isUnlocked: () => !!ctx,
    contextState: () => (ctx ? ctx.state : 'off')
  };
})();
