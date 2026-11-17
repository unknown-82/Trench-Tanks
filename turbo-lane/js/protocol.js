// Protocol: every message the two browsers may send each other, and strict
// checks for them. Anything arriving over the network is UNTRUSTED: if it is
// not valid JSON, has an unknown type, extra/missing fields or wrong value
// types, parse() returns null and the message is ignored.
//
// Turbo Lane only ever needs to announce RESULTS over the network: each
// racer dodges obstacles on their own track with no shared resource between
// the two cars, so there's nothing to arbitrate mid-race. Only the outcome
// (crashed / finished, and when) has to reach the other browser.
window.TT = window.TT || {};
TT.Protocol = (function () {
  "use strict";
  const MAX_MESSAGE_CHARS = 8 * 1024;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
  const isStr = max => v => typeof v === 'string' && v.length <= max;
  const isId = v => typeof v === 'string' && /^[a-z0-9-]{1,64}$/i.test(v);
  const isBool = v => typeof v === 'boolean';
  const oneOf = (...allowed) => v => allowed.includes(v);
  const isSeed = isInt(0, 0xFFFFFFFF);

  function shape(fields) {
    const keys = Object.keys(fields);
    return obj => isObj(obj) && Object.keys(obj).length === keys.length + 1 &&
      keys.every(k => has(obj, k) && fields[k](obj[k]));
  }

  // ---- game moves ----
  const MOVES = {
    start:  shape({ seed: isSeed }),                               // host: begin the race
    result: shape({ outcome: oneOf('crash', 'finish'), ms: isInt(0, 1000000) }) // my own car's fate
  };
  const isMove = m => isObj(m) && typeof m.type === 'string' && has(MOVES, m.type) && MOVES[m.type](m);
  const isEntry = e => isObj(e) && Object.keys(e).length === 2 && isInt(0, 1)(e.by) && isMove(e.move);

  // ---- network messages ----
  const MESSAGES = {
    join:   shape({ token: isId }),
    joined: shape({}),
    error:  shape({ code: oneOf('room_full') }),
    ping:   shape({ t: v => typeof v === 'number' && Number.isFinite(v) }),
    pong:   shape({ t: v => typeof v === 'number' && Number.isFinite(v) }),
    bye:    shape({}),
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

  return { parse, isMove, isEntry, isId };
})();
