// Protocol: every message the two browsers may send each other, and strict
// checks for them. Anything arriving over the network is UNTRUSTED: if it is
// not valid JSON, has an unknown type, extra/missing fields or wrong value
// types, parse() returns null and the message is ignored.
window.TT = window.TT || {};
TT.Protocol = (function () {
  "use strict";
  const MAX_MESSAGE_CHARS = 8 * 1024;
  const COLORS = ['cyan', 'orange', 'violet', 'lime', 'pink'];

  // ---- tiny validators ----
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
  const isStr = max => v => typeof v === 'string' && v.length <= max;
  const isId = v => typeof v === 'string' && /^[a-z0-9-]{1,64}$/i.test(v);
  const isBool = v => typeof v === 'boolean';
  const oneOf = (...allowed) => v => allowed.includes(v);
  const isSeed = isInt(0, 0xFFFFFFFF);

  // An object with `type` plus EXACTLY these fields, each passing its check.
  function shape(fields) {
    const keys = Object.keys(fields);
    return obj => isObj(obj) && Object.keys(obj).length === keys.length + 1 &&
      keys.every(k => has(obj, k) && fields[k](obj[k]));
  }

  // ---- game moves (what a player does) ----
  const MOVES = {
    pick:  shape({ color: oneOf(...COLORS) }),          // choose which coin is yours, this round
    round: shape({ seed: isSeed }),                     // host: shuffle the coins and start guessing
    guess: shape({ pos: isInt(0, COLORS.length - 1) })  // call the slot your coin ended up in
  };
  const isMove = m => isObj(m) && typeof m.type === 'string' && has(MOVES, m.type) && MOVES[m.type](m);
  const isEntry = e => isObj(e) && Object.keys(e).length === 2 && isInt(0, 1)(e.by) && isMove(e.move);

  // ---- network messages ----
  const MESSAGES = {
    // connection layer (net.js)
    join:   shape({ token: isId }),
    joined: shape({}),
    error:  shape({ code: oneOf('room_full') }),
    ping:   shape({ t: v => typeof v === 'number' && Number.isFinite(v) }),
    pong:   shape({ t: v => typeof v === 'number' && Number.isFinite(v) }),
    bye:    shape({}),
    // game layer (online.js)
    hello:  shape({ gameId: v => v === null || isId(v), count: isInt(0, 1e5) }),
    sync:   shape({ gameId: isId, start: isInt(0, 1e5), last: isBool,
                    moves: v => Array.isArray(v) && v.length <= 200 && v.every(isEntry) }),
    move:   shape({ n: isInt(0, 1e5), by: isInt(0, 1), move: isMove }),
    intent: shape({ move: isMove }),
    reject: shape({ reason: isStr(200) })
  };

  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return null;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return null; }
    if (!isObj(msg) || typeof msg.type !== 'string' || !has(MESSAGES, msg.type)) return null;
    return MESSAGES[msg.type](msg) ? msg : null;
  }

  return { parse, isMove, isEntry, isId, COLORS };
})();
