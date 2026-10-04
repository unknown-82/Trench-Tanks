// Net: the WebRTC connection between the two browsers, via PeerJS.
//
// PeerJS's free signaling server only introduces the browsers (it passes the
// offer/answer/ICE candidates). After that, every message travels directly
// browser-to-browser over an RTCDataChannel (or through your TURN relay).
//
//   Host:  registers the room id "trench-tanks-<uuid>" and waits.
//   Guest: connects to that id and sends { type:'join', token }.
//   Host:  admits ONE guest. Anyone else gets { type:'error', code:'room_full' }.
//
// This file knows nothing about the game: it just connects, keeps the
// connection alive (ping/pong) and hands validated messages to online.js.
window.TT = window.TT || {};
TT.Net = (function () {
  "use strict";
  const C = TT.NET_CONFIG;
  const ID_PREFIX = 'trench-tanks-'; // keeps our room ids apart from other apps on the shared server

  let role = null;          // 'host' | 'guest' | null
  let roomId = null;
  let peer = null;          // our link to the signaling server
  let conn = null;          // the ONE admitted connection to the opponent
  let guestToken = null;    // host: secret token of the admitted guest (lets them reconnect)
  let myToken = null;       // guest: our secret token
  let session = 0;          // bumped on leave/restart so stale callbacks do nothing
  let joinTimer = null, pingTimer = null, retryTimer = null;
  let lastSeen = 0, idRetries = 0, iceCache = null;
  const rate = { start: 0, count: 0 };
  let cb = {};

  function on(handlers) { cb = handlers; }
  function emit(name, arg) { if (cb[name]) cb[name](arg); }
  function status(state, text) { if (cb.status) cb.status(state, text); }

  // ---- ICE servers (STUN + TURN) ----
  async function getIceServers() {
    if (iceCache) return iceCache;
    const list = C.ICE_SERVERS.slice();
    if (C.TURN_CREDENTIALS_URL) {
      try {
        const res = await fetch(C.TURN_CREDENTIALS_URL);
        const extra = await res.json();
        if (Array.isArray(extra)) {
          list.push(...extra.filter(s => s && (typeof s.urls === 'string' || Array.isArray(s.urls))));
        }
      } catch (e) {
        console.warn('[net] Could not fetch TURN credentials, continuing with STUN only.', e);
      }
    }
    return (iceCache = list);
  }

  // ---- Peer (signaling) ----
  async function startPeer() {
    const mySession = ++session;
    clearTimers();
    dropConn();
    if (peer) { peer.destroy(); peer = null; }
    const PeerCtor = window.Peer;
    if (!PeerCtor) return status('error', 'Could not load PeerJS. Check your internet connection and reload.');

    status('connecting', role === 'host' ? 'Opening room…' : 'Looking for the room…');
    const iceServers = await getIceServers();
    if (mySession !== session) return; // user left while we were waiting

    const options = Object.assign({ debug: 1, config: { iceServers } }, C.PEER_SERVER || {});
    const p = role === 'host' ? new PeerCtor(ID_PREFIX + roomId, options) : new PeerCtor(options);
    peer = p;

    p.on('open', () => {
      if (p !== peer) return;
      idRetries = 0;
      if (role === 'guest') connectToHost();
      else if (!conn) status('waiting', 'Waiting for opponent… send them the link below.');
    });
    p.on('connection', c => {
      if (p === peer && role === 'host') onIncoming(c); else c.close();
    });
    p.on('disconnected', () => {
      // Lost the signaling server (NOT the opponent). Reconnect so joins keep working.
      retryTimer = setTimeout(() => {
        if (p === peer && !p.destroyed && p.disconnected) p.reconnect();
      }, 2000);
    });
    p.on('error', err => { if (p === peer) onPeerError(err); });
  }

  function onPeerError(err) {
    console.warn('[net] PeerJS error:', err.type, err);
    switch (err.type) {
      case 'peer-unavailable': // guest: nobody is hosting this room right now
        clearTimeout(joinTimer);
        return status('error', 'Room not found. The host may have closed the page. Ask for a new link, or click Reconnect.');
      case 'unavailable-id':   // host: server still remembers our old id (e.g. right after a reload)
        if (idRetries++ < 5) {
          status('connecting', 'Reopening room…');
          retryTimer = setTimeout(startPeer, 2000);
          return;
        }
        return status('error', 'This room is already open in another tab or window.');
      case 'browser-incompatible':
        return status('error', 'This browser does not support WebRTC. Try a recent Chrome, Firefox, Safari or Edge.');
      case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
        if (conn) return; // still connected to the opponent directly, ignore
        return status('error', 'Cannot reach the connection server. Check your internet, then click Reconnect.');
      default:
        if (!conn) status('error', `Connection error (${err.type}). Click Reconnect to try again.`);
    }
  }

  // ---- Guest side ----
  function connectToHost() {
    status('connecting', 'Connecting to host…');
    const c = peer.connect(ID_PREFIX + roomId, { reliable: true, serialization: 'raw' });
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      if (c === conn) return;
      c.close();
      status('error', 'Connection timed out. The host may be offline, or a strict network is blocking WebRTC (see TURN setup). Click Reconnect.');
    }, C.CONNECT_TIMEOUT_MS);

    c.on('open', () => sendOn(c, { type: 'join', token: myToken }));
    c.on('data', raw => {
      if (c === conn) return onData(raw);
      const msg = TT.Protocol.parse(raw);
      if (!msg) return;
      if (msg.type === 'joined') {
        clearTimeout(joinTimer);
        adopt(c);
      } else if (msg.type === 'error') {
        clearTimeout(joinTimer);
        c.close();
        status('error', 'This room is full: two players are already playing.');
      }
    });
    c.on('close', () => { if (c === conn) lost('The host left the game.'); });
    c.on('error', e => { console.warn('[net] connection error', e); if (c === conn) lost('Connection error.'); });
  }

  // ---- Host side ----
  function onIncoming(c) {
    // A new browser must introduce itself with { type:'join' } before anything else.
    const timer = setTimeout(() => { if (c !== conn) c.close(); }, C.JOIN_TIMEOUT_MS);
    c.on('data', raw => {
      if (c === conn) return onData(raw);
      const msg = TT.Protocol.parse(raw);
      if (!msg || msg.type !== 'join') return;
      clearTimeout(timer);
      // Max 2 players. The seat is taken unless this is the same guest coming
      // back (same secret token), e.g. after a refresh or network drop.
      if (conn && msg.token !== guestToken) {
        sendOn(c, { type: 'error', code: 'room_full' });
        setTimeout(() => c.close(), 1000);
        return;
      }
      dropConn(); // replace the guest's old, stale connection if there was one
      guestToken = msg.token;
      sendOn(c, { type: 'joined' });
      adopt(c);
    });
    c.on('close', () => {
      clearTimeout(timer);
      if (c === conn) lost('Opponent left. They can rejoin with the same link.');
    });
    c.on('error', () => { if (c === conn) lost('Connection to opponent failed.'); });
  }

  // ---- Shared ----
  function adopt(c) {
    conn = c;
    lastSeen = Date.now();
    startHeartbeat();
    status('connected', 'Connected');
    emit('connected');
  }

  function onData(raw) {
    // Flood protection: ignore anything beyond N messages per second.
    const now = Date.now();
    if (now - rate.start > 1000) { rate.start = now; rate.count = 0; }
    if (++rate.count > C.MAX_MESSAGES_PER_SECOND) return;

    const msg = TT.Protocol.parse(raw);
    if (!msg) { console.warn('[net] Ignored malformed message'); return; }
    lastSeen = now;
    switch (msg.type) {
      case 'ping': send({ type: 'pong', t: msg.t }); return;
      case 'pong': emit('latency', Math.max(0, now - msg.t)); return;
      case 'bye':  lost(role === 'host' ? 'Opponent left. They can rejoin with the same link.' : 'The host left the game.'); return;
      case 'join': case 'joined': case 'error': return; // only valid during the handshake
      default:     emit('message', msg);
    }
  }

  // Heartbeat: ping every couple of seconds. Every message (including the
  // pong reply) counts as "alive". Silence for too long = dead connection.
  function startHeartbeat() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!conn) return;
      if (Date.now() - lastSeen > C.HEARTBEAT_TIMEOUT_MS) {
        lost('Connection lost: no reply from opponent.');
        return;
      }
      send({ type: 'ping', t: Date.now() });
    }, C.HEARTBEAT_INTERVAL_MS);
  }

  // The opponent connection ended (they left, timed out, or errored).
  function lost(reason) {
    if (!conn) return;
    dropConn();
    status('disconnected', reason);
    emit('disconnected', reason);
  }

  // Close the current connection without reporting anything.
  function dropConn() {
    const c = conn;
    conn = null;
    clearInterval(pingTimer);
    if (c) { try { c.close(); } catch (e) { /* already closed */ } }
  }

  function clearTimers() {
    clearTimeout(joinTimer); clearTimeout(retryTimer); clearInterval(pingTimer);
  }

  function sendOn(c, msg) {
    if (!c || !c.open) return false;
    c.send(JSON.stringify(msg));
    return true;
  }
  function send(msg) { return sendOn(conn, msg); }

  function loadToken(room) {
    const key = 'tt-guest-token-' + room;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && TT.Protocol.isId(saved)) return saved;
    } catch (e) { /* storage blocked: fine, we just can't resume */ }
    const token = TT.Online.newId();
    try { sessionStorage.setItem(key, token); } catch (e) { /* ignore */ }
    return token;
  }

  // ---- Public API ----
  function host(room) { role = 'host'; roomId = room; idRetries = 0; startPeer(); }
  function join(room) { role = 'guest'; roomId = room; myToken = loadToken(room); startPeer(); }
  function reconnect() { if (role) { idRetries = 0; startPeer(); } }

  // Opponent broke the rules: hang up and show why.
  function kick(reason) { lost(reason); status('error', reason); }

  function sayBye() { send({ type: 'bye' }); }

  function leave() {
    sayBye();
    session++;
    clearTimers();
    dropConn();
    if (peer) { peer.destroy(); peer = null; }
    role = null; roomId = null; guestToken = null;
  }

  return { on, host, join, reconnect, leave, kick, send, sayBye, isConnected: () => !!conn };
})();
