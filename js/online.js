// Online: connects the game rules (TT.Game) to the connection (TT.Net).
//
// How the two games stay in sync ("the host is the referee"):
//   * Only small moves are sent, e.g. { type:'fire', weapon:'warhead', angle:45, power:60 }.
//     Each browser runs the same deterministic physics, so the results match.
//   * The host keeps the official, numbered list of moves (the "log").
//   * Host's own action:  check it -> add to log -> send to guest -> apply.
//   * Guest's action is only a request ('intent'). The host checks it with
//     the game rules and either sends it back as an official move or rejects it.
//   * The guest re-checks every move it receives too, never trusting the network.
//   * On (re)connect the guest says how many moves it has, and the host sends
//     the missing ones. So refreshing the page or a dropped connection can resume.
window.TT = window.TT || {};
TT.Online = (function () {
  "use strict";
  const Game = TT.Game, Net = TT.Net, Protocol = TT.Protocol;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SYNC_CHUNK = 150;   // moves per catch-up message (keeps messages small)

  let role = null;          // null = local game, 'host' (Player 1) or 'guest' (Player 2)
  let roomId = null;
  let netState = 'local';
  let latency = null;
  let connected = false;
  let ready = false;        // host: guest said hello / guest: caught up with the host
  let pending = false;      // guest: waiting for the host to confirm our move
  let gameId = null;        // id of the host's move log
  let log = [];             // host only: every move so far, as { by, move }
  let count = 0;            // guest only: how many moves we've applied
  let queue = [];           // moves waiting for the current shot animation to finish
  let draining = false;
  let el = {};

  // ---- helpers ----
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for plain http:// pages, where randomUUID is unavailable.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function roomUrl() {
    const url = new URL(location.href);
    url.search = '?room=' + roomId;
    url.hash = '';
    return url.toString();
  }

  function canAct() { return connected && ready && !pending; }

  // Host keeps its log in sessionStorage so a page refresh doesn't lose the game.
  function storageKey() { return 'tt-host-' + roomId; }
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

  // ---- startup ----
  function init() {
    el = {
      status: document.getElementById('netStatus'),
      bar: document.getElementById('onlineBar'),
      reconnectBtn: document.getElementById('reconnectBtn'),
      leaveBtn: document.getElementById('leaveBtn'),
      roomBox: document.getElementById('roomBox'),
      roomLink: document.getElementById('roomLink'),
      copyBtn: document.getElementById('copyBtn'),
      chat: document.getElementById('chat'),
      chatLog: document.getElementById('chatLog'),
      chatForm: document.getElementById('chatForm'),
      chatInput: document.getElementById('chatInput'),
      chatSend: document.getElementById('chatSend')
    };
    el.reconnectBtn.addEventListener('click', () => Net.reconnect());
    el.leaveBtn.addEventListener('click', leave);
    el.copyBtn.addEventListener('click', copyLink);
    el.chatForm.addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    el.chatInput.maxLength = Protocol.MAX_CHAT_CHARS;

    Game.setOnIdle(drain);
    Net.on({ status: showStatus, connected: onConnected, disconnected: onDisconnected, message: onMessage, latency: onLatency });
    window.addEventListener('pagehide', () => Net.sayBye()); // tell the opponent right away

    const room = new URLSearchParams(location.search).get('room');
    if (room === null) return updateUI(); // normal local game
    if (!UUID_RE.test(room)) {
      showStatus('error', 'This room link is invalid. Check you copied the whole link, or create a new game.');
      return;
    }
    roomId = room;
    const saved = loadHostState();
    if (saved) resumeAsHost(saved); else startGuest();
  }

  function createGame() {
    role = 'host';
    roomId = newId();
    gameId = newId();
    log = [];
    saveHostState();
    history.replaceState(null, '', roomUrl());
    Game.resetAll();
    updateUI();
    Net.host(roomId);
  }

  // Host refreshed the page: rebuild the game by replaying the saved moves instantly.
  function resumeAsHost(saved) {
    role = 'host';
    gameId = saved.gameId;
    log = [];
    Game.resetAll();
    for (const entry of saved.log) {
      if (Game.checkMove(entry.move, entry.by)) break;
      Game.applyMove(entry.move, entry.by, { instant: true });
      log.push(entry);
    }
    Game.redraw();
    updateUI();
    Net.host(roomId);
  }

  function startGuest() {
    role = 'guest';
    count = 0;
    gameId = null;
    Game.resetAll();
    updateUI();
    Net.join(roomId);
  }

  function leave() {
    Net.leave();
    try { sessionStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
    role = null; roomId = null; gameId = null;
    connected = ready = pending = false;
    log = []; count = 0; queue = [];
    history.replaceState(null, '', location.pathname);
    el.chatLog.textContent = '';
    Game.showMenu();
    showStatus('local', '');
  }

  // ---- connection events ----
  function onConnected() {
    connected = true; ready = false; pending = false; queue = []; latency = null;
    if (role === 'guest') Net.send({ type: 'hello', gameId, count });
    addChatLine(null, role === 'host' ? 'Opponent joined.' : 'Connected to host.');
    updateUI();
  }

  function onDisconnected(reason) {
    connected = false; ready = false; pending = false; queue = [];
    addChatLine(null, reason);
    updateUI();
  }

  function onLatency(ms) {
    latency = ms;
    if (netState === 'connected') showStatus('connected');
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'chat':
        addChatLine('Opponent', msg.text);
        return;
      case 'aim':
        if (ready) Game.showRemoteAim(role === 'host' ? 1 : 0, msg);
        return;
      case 'hello':
        if (role === 'host') sendSync(msg);
        return;
      case 'reject':
        if (role === 'guest') { pending = false; addChatLine(null, 'Move rejected: ' + msg.reason); updateUI(); }
        return;
      case 'intent':
        if (role !== 'host' || !ready) return;
        break;
      case 'move': case 'sync':
        if (role !== 'guest') return;
        break;
      default:
        return;
    }
    queue.push(msg);
    drain();
  }

  // Process queued moves, but never while a shell is still flying on screen.
  function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !Game.isBusy()) handle(queue.shift());
    } finally {
      draining = false;
    }
  }

  function handle(msg) {
    if (msg.type === 'intent') {               // host: guest wants to make a move
      const err = Game.checkMove(msg.move, 1);
      if (err) Net.send({ type: 'reject', reason: err });
      else commit(1, msg.move);
    } else if (msg.type === 'move') {          // guest: an official move from the host
      if (msg.n !== count) return resync();
      if (msg.by === 1) pending = false;
      applyFromHost(msg.by, msg.move, false);
      updateUI();
    } else if (msg.type === 'sync') {          // guest: catching up after (re)connecting
      if (msg.start === 0) { Game.resetAll(); count = 0; gameId = msg.gameId; }
      else if (msg.gameId !== gameId || msg.start !== count) return resync();
      for (const entry of msg.moves) {
        if (!applyFromHost(entry.by, entry.move, true)) return;
      }
      if (msg.last) { ready = true; Game.redraw(); updateUI(); }
    }
  }

  // Guest: re-check the host's move with our own copy of the rules.
  function applyFromHost(by, move, instant) {
    const err = Game.checkMove(move, by);
    if (err) {
      // An honest host never sends this. Stop instead of drifting out of sync.
      Net.kick(`Opponent sent an illegal move (${err}). Disconnected.`);
      return false;
    }
    Game.applyMove(move, by, { instant });
    count++;
    return true;
  }

  function resync() {
    ready = false;
    queue = [];
    Net.send({ type: 'hello', gameId, count });
    updateUI();
  }

  // Host: make a move official.
  function commit(by, move) {
    log.push({ by, move });
    saveHostState();
    Net.send({ type: 'move', n: log.length - 1, by, move });
    Game.applyMove(move, by);
  }

  // Host: send the guest every move it's missing (all of them if it's new).
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

  // Live aim preview, at most ~8 messages a second (the latest aim wins).
  let aimTimer = null, aimLatest = null;
  function sendAim(aim) {
    if (!canAct()) return;
    aimLatest = aim;
    if (aimTimer) return;
    aimTimer = setTimeout(() => {
      aimTimer = null;
      if (aimLatest && canAct()) Net.send(Object.assign({ type: 'aim' }, aimLatest));
      aimLatest = null;
    }, 120);
  }

  // Called by TT.Game for every local action while online.
  function submit(move) {
    if (!canAct()) return;
    if (move.type === 'fire') { clearTimeout(aimTimer); aimTimer = null; aimLatest = null; } // the shot says it all
    if (role === 'host') {
      if (Game.checkMove(move, 0) === null) commit(0, move);
    } else {
      pending = true; // controls lock until the host answers
      Net.send({ type: 'intent', move });
      updateUI();
    }
  }

  // ---- UI ----
  function showStatus(state, text) {
    netState = state;
    if (state === 'connected') {
      text = `Connected · you are Player ${role === 'host' ? '1 (red)' : '2 (blue)'}` +
        (latency !== null ? ` · ${latency} ms` : '');
      if (!ready) text = 'Connected · syncing…';
    } else if (state === 'local') {
      text = 'Local game · both players on this device';
    }
    el.status.dataset.state = state;
    el.status.textContent = text;
    updateButtons();
  }

  function updateButtons() {
    // The bar only shows during an online game (or to explain a bad room link).
    el.bar.hidden = role === null && netState !== 'error';
    el.leaveBtn.hidden = role === null && netState !== 'error';
    el.reconnectBtn.hidden = !(role && (netState === 'error' || (role === 'guest' && netState === 'disconnected')));
    el.roomBox.hidden = role !== 'host';
    if (role === 'host') el.roomLink.value = roomUrl();
    el.chat.hidden = role === null;
    el.chatInput.disabled = el.chatSend.disabled = !connected;
  }

  function updateUI() {
    if (netState === 'connected') showStatus('connected'); else updateButtons();
    Game.refreshUI();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.roomLink.value);
    } catch (e) {               // clipboard API needs https; fall back to selecting the text
      el.roomLink.select();
      document.execCommand('copy');
    }
    el.copyBtn.textContent = 'Copied!';
    setTimeout(() => { el.copyBtn.textContent = 'Copy link'; }, 1500);
  }

  // ---- chat ----
  function sendChat() {
    const text = Protocol.cleanText(el.chatInput.value);
    if (!text || !connected) return;
    if (Net.send({ type: 'chat', text })) {
      addChatLine('You', text);
      el.chatInput.value = '';
    }
  }

  // who = null for system notices. Text goes in with textContent, so any HTML
  // or <script> an opponent types is displayed as harmless plain text.
  function addChatLine(who, text) {
    const line = document.createElement('div');
    line.className = who ? 'chatLine' : 'chatLine system';
    if (who) {
      const name = document.createElement('b');
      name.textContent = who + ': ';
      line.appendChild(name);
    }
    line.appendChild(document.createTextNode(Protocol.cleanText(text)));
    el.chatLog.appendChild(line);
    while (el.chatLog.children.length > 60) el.chatLog.firstChild.remove();
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    isActive: () => role !== null,
    myIndex: () => (role === 'guest' ? 1 : 0),
    canAct,
    submit,
    sendAim,
    newId,
    createGame
  };
})();
