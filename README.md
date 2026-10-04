# Trench Tanks

A lightweight 2-player artillery game (Pocket Tanks–style), built with plain
HTML5 Canvas + vanilla JS. No build step. Play on one device (hot-seat),
**against a bot** (Easy / Medium / Hard), or **online, browser-to-browser over WebRTC**.

## Structure

```
trench-tanks/
├── index.html          Markup for the online bar, mode/draft/battle screens, chat, script includes
├── css/
│   └── styles.css      All styling
└── js/
    ├── weapons.js       TT.WEAPONS: the weapon catalogue (id, category, radius, effect); points per category
    ├── deterministic.js TT.Det: seeded random + browser-identical sin/cos (keeps online games in sync)
    ├── terrain.js       TT.Terrain: heightmap generation, lookup, crater destruction
    ├── effects.js       TT.Effects: per-weapon shell looks and impact bursts (visual only)
    ├── bot.js           TT.Bot: difficulty levels, weapon choice, aiming  <- tune the bot here
    ├── game.js          TT.Game: rules (checkMove), moves (applyMove), rendering, physics, turns
    ├── protocol.js      TT.Protocol: every network message + strict validation, chat sanitizing
    ├── net-config.js    TT.NET_CONFIG: STUN/TURN servers, timeouts  <- edit this for TURN
    ├── net.js           TT.Net: PeerJS/WebRTC connection, 2-player limit, heartbeat
    └── online.js        TT.Online: keeps both games in sync, lobby UI, chat
```

Files share a small `TT` namespace on `window` instead of ES modules, so it
still runs by double-clicking `index.html`. The only external dependency is
PeerJS, loaded from a CDN (pinned to 1.5.4).

## Flow

0. **Mode select** (`#modeScreen`): 2 players, Online game, or 1 player vs bot.
   Opening a `?room=` link skips this and joins the online game.
1. **Weapon draft** (`#selectScreen`): players take turns picking from a shared pool.
2. **Start battle** generates terrain and begins turn 1 (Player 1 / red goes first).
3. Players alternate shots. **Each weapon fires exactly once** and there is no
   unlimited backup shell, so a match is always 20 shots (10 each).
   - **Teleport** (✨ button or **T**), once per round: on your turn, before
     firing, your tank jumps 10–25% of the screen width left or right (random)
     and settles on the ground there. You still fire that turn. Spots off screen
     or on top of the opponent are skipped. The bot never teleports.
4. Tanks can't be destroyed. Blasts only reshape the ground. After the 20th shot,
   **the higher score wins** (or it's a draw).
5. "Rematch" and "New terrain" restart the round with the full drafted loadout.
   "Choose weapons again" returns to the draft.

### Scoring

A shot that touches the opponent's tank always scores its category's full
points. What a near miss earns depends on the category (`shotPoints()` in
`js/game.js`). Hitting your own tank scores nothing.

| Category    | Touches the tank | Near miss |
| ----------- | ---------------- | --------- |
| Shooters    | 100              | 0: they must touch the tank |
| Magical     | 75               | Up to 22 if a blast lands within 60 px, falling to 0 (Beaver: 0) |
| Attackers   | 50               | `(1 - distance / 150px) × 50`, so 0 at 150 px or more |
| Dirt movers | 0                | 0 (they reshape terrain to block or expose tanks) |

For Triple Threat and Meteor Storm, the nearest of their blasts counts.

Special weapons:

- **Dirt movers** (4): Sandbag Shell and Landfill add dirt, Trench Digger and
  Quarry Blast remove it. Added dirt piles on top of whatever is there. A tank
  under it stays where it is and gets buried (drawn faded), so normal shells hit
  the dirt first. A tank only moves when the ground under it is dug away: then
  it drops onto the new surface.
- **Burner** (magic): scores like any shot. If its blast reaches the opponent's
  tank, the tank catches fire for a few seconds. Otherwise the ground burns.
- **Burrowing Beaver** (magic): flies the normal arc but passes straight through
  hills and dirt without changing them, so it can reach a buried tank. It scores
  full magic points (75) on a direct hit and 0 otherwise.

Points are set in `TT.CATEGORY_MAX_POINTS` (`js/weapons.js`). A weapon's `radius`
sets its crater size. Its `damage` value is no longer used, since there's no health.

Every action (pick, fire, rematch…) is a small **move** object such as
`{ type: 'fire', weapon: 'warhead', angle: 45, power: 60 }`. `TT.Game.checkMove()`
holds the rules, and `applyMove()` is the only thing that changes the game.

## Bot (1 player)

You are always Player 1 and the bot is Player 2. The bot aims by test-firing
invisible shells with the game's real physics (`traceMiss()` in `game.js`),
so it can always find the perfect angle and power. Each level then spoils
that shot on purpose (settings in `TT.Bot.LEVELS`, `js/bot.js`):

| Level  | Max aim error (angle / power) | Picks its highest-scoring weapon |
| ------ | ----------------------------- | -------------------------- |
| Easy   | ±12° / ±15                    | 20% of the time            |
| Medium | ±6° / ±7.5                    | 60% of the time            |
| Hard   | ±2.2° / ±2.8                  | always                     |

For each shot the bot draws two random numbers from -1 to 1 and multiplies
them by its level's max error: one shifts the angle, the other the power.
Shells fly with no wind, so this is the only reason the bot misses.
Measured over 1,200 shots per level on random maps ("typical miss" is the
median distance from your tank to where the shell lands, counting shells that
fly off the edge as landing where they would come down):

| Level  | Direct hit | Within 40 px | Typical miss |
| ------ | ---------- | ------------ | ------------ |
| Easy   | 6%         | 14%          | 157 px       |
| Medium | 14%        | 27%          | 77 px        |
| Hard   | 34%        | 66%          | 26 px        |

To make a level easier or harder, change its numbers in `js/bot.js`. To change
how long it "thinks" before moving, edit `TT.Bot.TIMING`.

## Online play

### How it works

```
 Player 1 (host)                         Player 2 (guest)
 ───────────────                         ────────────────
 Create online game
   -> room id = crypto.randomUUID()
   -> registers "trench-tanks-<id>"  ◄── PeerJS signaling server ──►  opens ?room=<id>
                                         (only swaps offer/answer/ICE)
          ◄════════ RTCDataChannel (direct, or via TURN relay) ════════►
            join / joined, ping / pong, hello / sync, intent / move, chat
```

- **Roles:** the host is Player 1 (red, moves first). The guest is Player 2 (blue).
- **Host is the referee.** The guest's actions are sent as an `intent`. The host
  checks them with `checkMove`, then broadcasts them as a numbered `move`
  (or replies `reject`). The guest re-checks every move it receives too.
- **Only moves are sent, never the board.** Both browsers run the same
  deterministic physics: seeded terrain, a fixed 1/60 s timestep, and
  Taylor-series sin/cos instead of `Math.sin`, whose last digit can differ between browsers.
- **Max 2 players.** The host admits one guest. Anyone else gets "room is full".
  The same guest can reconnect thanks to a secret token kept in `sessionStorage`.
- **Untrusted input.** `TT.Protocol.parse()` rejects non-JSON, oversized
  messages, unknown types, extra or missing fields and out-of-range values.
  Floods over 40 messages/s are dropped. Chat is cleaned and rendered with
  `textContent`, so HTML is shown as text and never runs.
- **Heartbeat.** A ping goes out every 2 s. If nothing arrives for 10 s, the
  connection counts as dead.
- **Resume.** The host saves its move log in `sessionStorage`. After a refresh or
  reconnect, the guest says how many moves it has and the host sends the rest.
  These are replayed instantly, so the game continues where it left off.
- **Live aim preview.** While it's your turn, small `aim` messages (at most
  about 8 per second) show your opponent your barrel angle, power and weapon as
  you adjust them. They are previews only: they never change the game, aren't
  saved, and are ignored if they come from the player who isn't on turn.
- **Switching tabs is safe.** Shells move by real time, not by drawn frames.
  If a tab is hidden mid-shot, the shot lands immediately, and a backup timer
  keeps shells moving if the browser pauses animation. This matters online:
  the host can't referee the next move until its own shot has landed.

### TURN setup (needed for strict mobile/corporate networks)

STUN works out of the box, but some networks block direct connections. For
those, add a TURN relay in `js/net-config.js`:

- **Open Relay (Metered, free tier):** sign up at
  https://www.metered.ca/tools/openrelay/ and paste your app's credentials URL
  into `TURN_CREDENTIALS_URL`.
- **Your own / other provider:** uncomment the `turn:` entry in `ICE_SERVERS`
  and fill in the host, username and credential.
- **Cloudflare TURN:** its credentials must be generated server-side with an API
  token, so you'd need a tiny Cloudflare Worker that returns the `iceServers`
  JSON. Point `TURN_CREDENTIALS_URL` at that Worker.

Note: anything in front-end code is public, so use TURN credentials that are
usage-limited or short-lived.

### Testing

**Two tabs/windows, one computer**

1. Open `index.html` (double-click it, or serve the folder with `npx serve .`).
2. Click **🌐 Online game**, then **Copy link**.
3. Paste the link into a *second window* (put both side by side). It connects
   automatically and both status dots turn green.
4. Draft weapons: picks alternate between the windows. The host clicks **Start
   battle**, and then you take turns firing.

Try the failure cases:

| Try this | Expected |
| --- | --- |
| Open the link in a 3rd window | "This room is full" |
| Refresh the guest window mid-game | "Opponent left", then it rejoins and the game resumes |
| Close the host window | Guest: "The host left the game." Reopen the host's tab (Ctrl+Shift+T) and press **Reconnect** on the guest |
| Change one character of the room id | "Room not found" |
| Type `?room=abc` | "This room link is invalid" |
| Send `<img src=x onerror=alert(1)>` in chat | Shown as plain text, no alert |
| DevTools > Network > Offline on one side | After about 10 s both sides show "Connection lost" |
| Drag the angle/power sliders on your turn | The other window's barrel and sliders follow along |
| Fire, then switch to another tab or app straight away | The other player still gets their turn and can fire |

Use separate windows rather than background tabs if you want to watch both
animations. A hidden tab skips the animation and lands shots instantly, but
the game state stays the same.

**Two devices (phone + laptop)**

The link must be reachable from both devices, so host the folder somewhere:

- **Easiest:** push it to GitHub Pages, Netlify or Cloudflare Pages (free, HTTPS).
- **Same Wi-Fi:** run `npx serve .` and open `http://<your-PC-LAN-IP>:3000` on
  both devices. The room link then uses that address.

If the devices are on different networks (e.g. phone on mobile data) and the
dot stays blue until "Connection timed out", configure TURN (above).

## Extending it

- Add a weapon: append an object to `TT.WEAPONS` in `js/weapons.js`.
- Change terrain shape: edit `generate()` in `js/terrain.js` (keep using the
  `rand` argument, not `Math.random`, or online games will desync).
- Add a move type: add its shape to `MOVES` in `js/protocol.js`, a rule in
  `checkMove()` and a case in `applyMove()` in `js/game.js`.
