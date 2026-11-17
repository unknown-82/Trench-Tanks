// Bot opponent (always Player 2).
//
// The bot aims by test-firing invisible shells with the game's real physics,
// so it can always find the perfect shot. Difficulty decides how much it
// spoils that shot on purpose:
//   angleError   most its angle can be off, in degrees
//   powerError   most its power can be off, in power points
//   weaponSense  chance it picks its highest-scoring weapon instead of a random one
window.TT = window.TT || {};
TT.Bot = (function () {
  "use strict";

  const LEVELS = {
    easy:   { name: 'Easy',   angleError: 12,  powerError: 15,  weaponSense: 0.2 },
    medium: { name: 'Medium', angleError: 6,   powerError: 7.5, weaponSense: 0.6 },
    hard:   { name: 'Hard',   angleError: 2.2, powerError: 2.8, weaponSense: 1 }
  };

  // Pauses so the bot feels like it's thinking (ms).
  const TIMING = { pickMs: 450, thinkMs: 700, aimMs: 600 };

  // Random number from -1 to 1: how much of its max error the bot makes, and in
  // which direction. The bot only plays locally, so Math.random is fine here.
  const chance = () => Math.random() * 2 - 1;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randomItem = arr => arr[Math.floor(Math.random() * arr.length)];

  // How many points a perfect hit with this weapon is worth (shooters score most).
  function weaponScore(id) {
    const w = TT.WEAPONS.find(x => x.id === id);
    return TT.CATEGORY_MAX_POINTS[w.category] || 0;
  }
  function best(ids) { return ids.reduce((a, b) => (weaponScore(b) > weaponScore(a) ? b : a)); }
  function smartOrRandom(level, ids) {
    return Math.random() < LEVELS[level].weaponSense ? best(ids) : randomItem(ids);
  }

  // Draft: choose one weapon from the ones nobody has taken yet.
  function pickDraft(level, freeIds) { return smartOrRandom(level, freeIds); }

  // Battle: choose a weapon from the bot's remaining inventory.
  function chooseWeapon(level, inventoryIds) {
    return smartOrRandom(level, inventoryIds);
  }

  // trace(angle, power) -> how many px from the target the shell lands.
  function aim(level, trace) {
    const L = LEVELS[level];
    // 1. Find the perfect shot.
    //    Start from a random angle so the bot doesn't always shoot the same arc.
    const first = 30 + Math.floor(Math.random() * 31);
    const angles = [first, 45, 35, 55, 25, 65, 20, 75];
    let bestShot = { angle: 45, power: 60, miss: Infinity };
    for (const angle of angles) {
      for (let power = 10; power <= 100; power++) {
        const miss = trace(angle, power);
        if (miss < bestShot.miss) bestShot = { angle, power, miss };
      }
      if (bestShot.miss < 5) break; // good enough, no need to try other arcs
    }
    // 2. Spoil it: shift angle and power by a random share of the level's max error.
    return {
      angle: clamp(Math.round(bestShot.angle + chance() * L.angleError), 0, 180),
      power: clamp(Math.round(bestShot.power + chance() * L.powerError), 10, 100)
    };
  }

  return { LEVELS, TIMING, pickDraft, chooseWeapon, aim };
})();
