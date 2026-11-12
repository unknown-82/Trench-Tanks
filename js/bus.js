// Bus: a tiny event channel between the game and its presentation layers.
// The game (game.js, online.js) only EMITS what happened ("a shot was fired",
// "the turn changed"). The HUD (ui.js), sound (audio.js) and scenery
// (scene.js, holo.js) LISTEN. Listeners can never change the game or break it:
// an error in one is caught here and only logged.
window.TT = window.TT || {};
TT.Bus = (function () {
  "use strict";
  const listeners = {};

  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }

  function emit(name, data) {
    const list = listeners[name];
    if (!list) return;
    for (const fn of list) {
      try { fn(data || {}); } catch (e) { console.warn('[bus] listener for "' + name + '" failed', e); }
    }
  }

  return { on, emit };
})();
