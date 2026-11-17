// Deterministic helpers for online play.
// Online, each browser runs the physics itself from the same small moves, so
// both must compute EXACTLY the same terrain and shell paths. That means
// no Math.random() (use a seeded generator) and no Math.sin/Math.cos (their
// last digit can differ between Chrome, Firefox and Safari).
window.TT = window.TT || {};
TT.Det = (function () {
  "use strict";

  // Seeded random numbers (mulberry32): same seed -> same sequence everywhere.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A fresh random 32-bit seed (works on http:// and file:// too).
  function newSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  // Fisher-Yates shuffle driven by a seeded rng.
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // sin/cos from a Taylor series. Only + - * / are used, and those give
  // bit-identical results in every browser. Accurate for 0..180 degrees.
  function series(x, first, startN) {
    let term = first, sum = first;
    for (let n = startN; n < startN + 40; n += 2) {
      term *= -x * x / (n * (n + 1));
      sum += term;
    }
    return sum;
  }
  function sinDeg(deg) { const x = deg * Math.PI / 180; return series(x, x, 2); }
  function cosDeg(deg) { const x = deg * Math.PI / 180; return series(x, 1, 1); }

  return { rng, newSeed, shuffle, sinDeg, cosDeg };
})();
