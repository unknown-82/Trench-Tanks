// Online: connects the game rules (TT.Game) to the connection (TT.Net).
// Same pattern as Trench Tanks: the host keeps the official move log, the
// guest's actions are only requests the host checks and echoes back.
window.TT = window.TT || {};
TT.Online = (function () {
  "use strict";
  const Game = TT.Game, Net = TT.Net, Protocol = TT.Protocol;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SYNC_CHUNK = 150;

  let role = null;         // null = local/bot, 'host' (Player 1) or 'guest' (Player 2)
  let roomId = null;
  let netState = 'local';
  let latency = null;
  let connected = false;
  let ready = false;
  let pending = false;
  let gameId = null;
  let log = [];
  let count = 0;
  let queue = [];
  let draining = false;
  let el = {};

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function roomUrl() {
    const url = new URL(location.href);
    url.search = '?room=' + roomId;
    return url.toString();
  }
  function canAct() { return connected && ready && !pending; }

  function storageKey() { return 'fc-host-' + roomId; }
  function saveHostState() {
    try { sessionStorage.setItem(storageKey(), JSON.stringify({ gameId, log })); } catch (e) { /* ignore */ }
  }
  function loadHostState() {
    try {
      const data = JSON.parse(sessionStorage.getItem(storageKey()));
      if (data && Protocol.isId(data.gameId) && Array.isArray(data.log) && data.log.every(Protocol.isEntry)) return data;
    } catch (e) { /* missing or corrupt */ }
    return null;
  }

  function init() {
    el = {
      status: document.getElementById('netStatus'),
      bar: document.getElementById('onlineBar'),
      reconnectBtn: document.getElementById('reconnectBtn'),
      leaveBtn: document.getElementById('leaveBtn'),
      roomBox: document.getElementById('roomBox'),
      roomLink: document.getElementById('roomLink'),
      copyBtn: document.getElementById('copyBtn')
    };
    el.reconnectBtn.addEventListener('click', () => Net.reconnect());
    el.leaveBtn.addEventListener('click', leave);
    el.copyBtn.addEventListener('click', copyLink);

    Game.setOnIdle(drain);
    Net.on({ status: showStatus, connected: onConnected, disconnected: onDisconnected, message: onMessage, latency: onLatency });
    window.addEventListener('pagehide', () => Net.sayBye());

    const room = new URLSearchParams(location.search).get('room');
    if (room === null) return updateUI();
    if (!UUID_RE.test(room)) { showStatus('error', 'This room link is invalid.'); return; }
    roomId = room;
    const saved = loadHostState();
    if (saved) resumeAsHost(saved); else startGuest();
  }

  function createGame() {
    role = 'host'; roomId = newId(); gameId = newId(); log = [];
    saveHostState();
    history.replaceState(null, '', roomUrl());
    Game.resetAll();
    updateUI();
    Net.host(roomId);
  }
  function resumeAsHost(saved) {
    role = 'host'; gameId = saved.gameId; log = [];
    Game.resetAll();
    for (const entry of saved.log) {
      if (Game.checkMove(entry.move, entry.by, true)) break;
      Game.applyMove(entry.move, entry.by, { instant: true });
      log.push(entry);
    }
    updateUI();
    Net.host(roomId);
  }
  function startGuest() {
    role = 'guest'; count = 0; gameId = null;
    Game.resetAll();
    updateUI();
    Net.join(roomId);
  }
  function leave() {
    Net.leave();
    try { sessionStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
    role = null; roomId = null; gameId = null;
    connected = ready = pending = false; log = []; count = 0; queue = [];
    history.replaceState(null, '', location.pathname);
    Game.showMenu();
    showStatus('local', '');
  }

  function onConnected() {
    connected = true; ready = false; pending = false; queue = []; latency = null;
    if (role === 'guest') Net.send({ type: 'hello', gameId, count });
    updateUI();
  }
  function onDisconnected(reason) {
    connected = false; ready = false; pending = false; queue = [];
    updateUI();
  }
  function onLatency(ms) { latency = ms; if (netState === 'connected') showStatus('connected'); }

  function onMessage(msg) {
    switch (msg.type) {
      case 'hello': if (role === 'host') sendSync(msg); return;
      case 'reject':
        if (role === 'guest') { pending = false; updateUI(); }
        return;
      case 'intent': if (role !== 'host' || !ready) return; break;
      case 'move': case 'sync': if (role !== 'guest') return; break;
      default: return;
    }
    queue.push(msg);
    drain();
  }

  function drain() {
    if (draining) return;
    draining = true;
    try { while (queue.length && !Game.isBusy()) handle(queue.shift()); }
    finally { draining = false; }
  }

  function handle(msg) {
    if (msg.type === 'intent') {
      const err = Game.checkMove(msg.move, 1);
      if (err) Net.send({ type: 'reject', reason: err });
      else commit(1, msg.move);
    } else if (msg.type === 'move') {
      if (msg.n !== count) return resync();
      if (msg.by === 1) pending = false;
      applyFromHost(msg.by, msg.move, false);
      updateUI();
    } else if (msg.type === 'sync') {
      if (msg.start === 0) { Game.resetAll(); count = 0; gameId = msg.gameId; }
      else if (msg.gameId !== gameId || msg.start !== count) return resync();
      for (const entry of msg.moves) { if (!applyFromHost(entry.by, entry.move, true)) return; }
      if (msg.last) { ready = true; updateUI(); }
    }
  }

  function applyFromHost(by, move, instant) {
    const err = Game.checkMove(move, by, instant);
    if (err) { Net.kick(`Opponent sent an illegal move (${err}). Disconnected.`); return false; }
    Game.applyMove(move, by, { instant });
    count++;
    return true;
  }
  function resync() { ready = false; queue = []; Net.send({ type: 'hello', gameId, count }); updateUI(); }

  function commit(by, move) {
    log.push({ by, move });
    saveHostState();
    Net.send({ type: 'move', n: log.length - 1, by, move });
    Game.applyMove(move, by);
  }
  function sendSync(hello) {
    const from = hello.gameId === gameId && hello.count <= log.length ? hello.count : 0;
    let start = from;
    do {
      const moves = log.slice(start, start + SYNC_CHUNK);
      Net.send({ type: 'sync', gameId, start, moves, last: start + moves.length >= log.length });
      start += moves.length;
    } while (start < log.length);
    ready = true;
    updateUI();
  }

  function submit(move) {
    if (!canAct()) return;
    if (role === 'host') { if (Game.checkMove(move, 0) === null) commit(0, move); }
    else { pending = true; Net.send({ type: 'intent', move }); updateUI(); }
  }

  function showStatus(state, text) {
    netState = state;
    if (state === 'connected') {
      text = `Connected · you are Player ${role === 'host' ? '1' : '2'}` + (latency !== null ? ` · ${latency} ms` : '');
      if (!ready) text = 'Connected · syncing…';
    } else if (state === 'local') {
      text = 'Local game · both players on this device';
    }
    el.status.dataset.state = state;
    el.status.textContent = text;
    updateButtons();
  }
  function updateButtons() {
    el.bar.hidden = role === null && netState !== 'error';
    el.leaveBtn.hidden = role === null && netState !== 'error';
    el.reconnectBtn.hidden = !(role && (netState === 'error' || (role === 'guest' && netState === 'disconnected')));
    el.roomBox.hidden = role !== 'host';
    if (role === 'host') el.roomLink.value = roomUrl();
  }
  function updateUI() {
    if (netState === 'connected') showStatus('connected'); else updateButtons();
    Game.refreshUI();
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(el.roomLink.value); }
    catch (e) { el.roomLink.select(); document.execCommand('copy'); }
    el.copyBtn.textContent = 'Copied!';
    setTimeout(() => { el.copyBtn.textContent = 'Copy link'; }, 1500);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { isActive: () => role !== null, myIndex: () => (role === 'guest' ? 1 : 0), submit, newId, createGame };
})();
