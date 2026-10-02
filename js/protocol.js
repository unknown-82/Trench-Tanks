// Protocol: every message the two browsers may send each other, and strict
// checks for them. Anything arriving over the network is UNTRUSTED: if it is
// not valid JSON, has an unknown type, extra/missing fields or wrong value
// types, parse() returns null and the message is ignored.
window.TT = window.TT || {};
TT.Protocol = (function () {
  "use strict";
  const MAX_MESSAGE_CHARS = 32 * 1024;
  const MAX_CHAT_CHARS = 200;

  // ---- tiny validators ----
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
  const isStr = max => v => typeof v === 'string' && v.length <= max;
  const isId = v => typeof v === 'string' && /^[a-z0-9-]{1,64}$/i.test(v);
  const isBool = v => typeof v === 'boolean';
  const isTime = v => typeof v === 'number' && Number.isFinite(v);
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
    pick:    shape({ id: isId }),                       // draft a weapon
    random:  shape({ seed: isSeed }),                   // random weapon split (host)
    round:   shape({ seed: isSeed }),                   // start / rematch / new terrain (host)
    redraft: shape({}),                                 // back to weapon select (host)
    fire:    shape({ weapon: isId, angle: isInt(0, 180), power: isInt(10, 100) })
  };
  const isMove = m => isObj(m) && typeof m.type === 'string' && has(MOVES, m.type) && MOVES[m.type](m);
  // One entry of the host's move log: who made it + the move.
  const isEntry = e => isObj(e) && Object.keys(e).length === 2 && isInt(0, 1)(e.by) && isMove(e.move);

  // ---- network messages ----
  const MESSAGES = {
    // connection layer (net.js)
    join:   shape({ token: isId }),                     // guest -> host: "let me in"
    joined: shape({}),                                  // host -> guest: "you're in"
    error:  shape({ code: oneOf('room_full') }),        // host -> 3rd browser
    ping:   shape({ t: isTime }),                       // heartbeat
    pong:   shape({ t: isTime }),
    bye:    shape({}),                                  // "I'm closing the page"
    // game layer (online.js)
    hello:  shape({ gameId: v => v === null || isId(v), count: isInt(0, 1e6) }),
    sync:   shape({ gameId: isId, start: isInt(0, 1e6), last: isBool,
                    moves: v => Array.isArray(v) && v.length <= 200 && v.every(isEntry) }),
    move:   shape({ n: isInt(0, 1e6), by: isInt(0, 1), move: isMove }),
    intent: shape({ move: isMove }),                    // guest asks host to make a move
    reject: shape({ reason: isStr(200) }),
    aim:    shape({ angle: isInt(0, 180), power: isInt(10, 100), weapon: isId }), // live aim preview
    chat:   shape({ text: isStr(1000) })
  };

  // Raw string from the network -> validated message object, or null.
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return null;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return null; }
    if (!isObj(msg) || typeof msg.type !== 'string' || !has(MESSAGES, msg.type)) return null;
    return MESSAGES[msg.type](msg) ? msg : null;
  }

  // Control characters, zero-width characters and text-direction overrides
  // (used to make text look different from what it is). Built from char
  // codes so the source file stays plain ASCII.
  const BAD_CHARS = new RegExp('[' + [[0x00, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF]]
    .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');

  // Clean chat text: strip control and invisible/direction-flipping characters,
  // collapse whitespace, limit length. Always render the result with
  // textContent (never innerHTML) so "<script>" shows up as plain text.
  function cleanText(text) {
    return String(text)
      .replace(BAD_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CHAT_CHARS);
  }

  return { parse, isMove, isEntry, isId, cleanText, MAX_CHAT_CHARS };
})();
