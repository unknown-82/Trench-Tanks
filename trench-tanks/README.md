# Trench Tanks

A lightweight 2-player artillery game (Pocket Tanks–style), built with plain
HTML5 Canvas + vanilla JS. No build step. Play on one device (hot-seat),
**against a bot** (Easy / Medium / Hard), or **online, browser-to-browser over WebRTC**.

## Structure

```
trench-tanks/
├── index.html          Markup for the boot screen, uplink bar, command deck / armoury / battle screens, comms, settings
├── css/
│   └── styles.css      The design system (colour, type and motion tokens) and all styling
└── js/
    Game (rules and state)
    ├── weapons.js       TT.WEAPONS: the weapon catalogue (id, category, radius, effect); points per category
    ├── deterministic.js TT.Det: seeded random + browser-identical sin/cos (keeps online games in sync)
    ├── terrain.js       TT.Terrain: heightmap generation, lookup, crater destruction
    ├── bot.js           TT.Bot: difficulty levels, weapon choice, aiming  <- tune the bot here
    ├── game.js          TT.Game: rules (checkMove), moves (applyMove), battlefield rendering, physics, turns
    ├── protocol.js      TT.Protocol: every network message + strict validation, chat sanitizing
    ├── net-config.js    TT.NET_CONFIG: STUN/TURN servers, timeouts  <- edit this for TURN
    ├── net.js           TT.Net: PeerJS/WebRTC connection, 2-player limit, heartbeat
    ├── online.js        TT.Online: keeps both games in sync, uplink bar, chat
    Presentation (looks and sound only; never changes the game)
    ├── bus.js           TT.Bus: tiny event channel. The game emits, the files below listen
    ├── art.js           TT.Art: one line glyph per weapon + the facts the armoury shows
    ├── effects.js       TT.Effects: shell looks, impact bursts, muzzle flash, teleport warp
    ├── ui.js            TT.UI: HUD, dials, weapon bay, armoury inspector, debrief, settings
    ├── scene.js         TT.Scene: the sky behind the battlefield (planet, skyline, dust)
    ├── holo.js          TT.Holo: the 3D holograms (menu backdrop, rotating weapon preview)
    └── audio.js         TT.Audio: every sound, synthesised with the Web Audio API
```

Files share a small `TT` namespace on `window` instead of ES modules, so it
still runs by double-clicking `index.html`. The only external dependencies are
PeerJS (CDN, pinned to 1.5.4) and two Google Fonts (Orbitron, Rajdhani).

## Interface

The game is presented as "Combat OS", the control system of a weapons range in
2089. Everything below is presentation: rules, physics, bot and networking are
the same as before.

```
 game.js / online.js ──emit──► TT.Bus ──► ui.js     redraws the HUD from TT.Game.state()
 (what happened:                     ├──► audio.js  plays the matching sound
  fire, impact, score,               ├──► scene.js  sky, dust
  turn, gameover, net…)              └──► holo.js   3D holograms
```

- **The game only announces events.** Listeners cannot change the game, and an
  error in one is caught in `bus.js` and logged. Shots replayed after a refresh
  or reconnect are marked `quiet`, so they update stats but make no sound.
- **Controls drive the game's own inputs.** The elevation dial, power dial and
  weapon bay write into the hidden `<input id="angle">`, `<input id="power">`
  and `<select id="weaponSelect">` and fire the normal `input` / `change`
  event. `game.js` still reads those three elements, exactly as before.
- **Two units, two colours.** Unit A (Player 1) is amber and Unit B (Player 2)
  is violet (`--p1` / `--p2` in `css/styles.css`, read by `game.js`). Cyan is
  the neutral interface colour and orange marks firing.
- **3D without a library.** `holo.js` contains a small projector (rotate, then
  divide by depth) and draws glowing wireframes on a 2D canvas. Light is drawn
  additively, so nothing needs depth sorting.
- **The battlefield is layered.** `#sky` (painted once per resize), `#c` (the
  game canvas, transparent above the ground) and `#motes` (drifting dust).
  Only these shake on impact, never the HUD.
- **Units stand out.** Each unit is drawn in its own bright colour with a white
  rim over a dark pocket, and the sky layer is dimmed, so the two units are the
  brightest things on the battlefield.
- **Targeting overlay.** The arc and vector on the active unit show the angle
  and power already on the console. It does not predict where a shell lands.
- **Debrief stats** (scoring shots, direct hits, best shot, average) are counted
  from the game's own `fire` and `score` events.
- **Not shown, because the game has no such thing:** health, wind, ammunition
  types and player names.

### Audio

All sound is synthesised live (oscillators and filtered noise), so there are no
audio files to download or license. `audio.js` is the only file that makes
sound.

| Layer | What it is |
| --- | --- |
| Ambient bed | Low reactor drone, a slow chord, machinery hum and, in battle, wind. Each screen only changes how loud each layer is |
| Interface | Hover, click, select, confirm, back, dial ticks. One listener on the document; a button's `data-snd` picks the sound (`none` = the game event that follows makes it) |
| Combat | A launch sound per weapon category, a whistle that follows the shell across the speakers and drops in pitch as it falls, layered blasts sized by the weapon's radius, score chimes, turn cues |
| Uplink | Waiting ping, connected, connection lost, chat message |

Browsers only allow sound after a click, so audio starts from the boot screen's
**Initialize systems** button. Mute and volume are under **Audio**. Master,
music and effects volume and mute are saved in `localStorage` (`tt-audio`).
Sound stops while the tab is hidden.

### Screen sizes

| Width | Console layout |
| --- | --- |
| over 900 px | One row: weapon bay, dials and fire, mobility |
| 761 to 900 px (tablet) | Dials and fire on top, weapon bay and mobility below |
| up to 760 px (phone) | Everything stacked |

Short landscape screens (under 520 px tall) keep the one-row console with a
slimmer HUD. `prefers-reduced-motion` turns off the animated scenery.

## Flow

0. **Command deck** (`#modeScreen`): Local combat (2 players), AI combat (1 player
   vs bot) or Online combat. Opening a `?room=` link, or pasting one into the
   Online card, skips this and joins that online game.
1. **Armoury** (`#selectScreen`): players take turns picking from a shared pool.
2. **Start mission** generates terrain and begins turn 1 (Player 1 / Unit A goes first).
   The arena is as wide as the host's screen (900–1800 px wide, 506 px tall).
3. Players alternate shots. **Each weapon fires exactly once** and there is no
   unlimited backup shell, so a match is always 20 shots (10 each).
   - **Teleport** (button or **T**), once per round: on your turn, before
     firing, your tank jumps 10–25% of the screen width left or right (random)
     and settles on the ground there. You still fire that turn. Spots off screen
     or on top of the opponent are skipped. The bot never teleports.
   - **Move** (the arrows under Mobility, or **A** / **D**), 4 tries per round:
     on your turn, your tank drives up to 30 px left or right along the ground.
     It stops early at a slope too steep to climb, a sharp drop, the arena edge
     or the other tank (a buried tank can't drive out). Every try uses one move,
     even if the tank can't budge. The bars between the arrows are the moves
     you have left. You still fire that turn. The bot never moves.
4. Tanks can't be destroyed. Blasts only reshape the ground. After the 20th shot,
   **the higher score wins** (or it's a draw).
5. "Replay mission" and "New terrain" restart the round with the full drafted
   loadout. "Choose weapons again" returns to the armoury.

### Scoring

A shot that touches the opponent's tank always scores its category's full
points. Otherwise the score follows what you see: it depends on the **real
distance** from the middle of the blast to the spot the opponent's tank is
standing on (`blastDistance()`, `shotShare()` and `shotPoints()` in
`js/game.js`). Hitting your own tank scores nothing.

The distance is a straight line, so height counts as well as left-right:
a blast at the foot of a cliff is far from a tank on top of it, and dirt piled
over a buried tank really does shield it. It is measured at the moment the
blast goes off, before the crater forms.

| How far the blast is from the tank             | Share of the category's points |
| ---------------------------------------------- | ------------------------------ |
| Within 5 px                                    | 100% |
| On the hull (up to 15 px)                      | 100% → 80% at the hull's edge |
| Off the hull, but the blast still reaches it   | 80% → 30% as it only just grazes it (reach = 15 px + blast radius) |
| Near miss (up to 45 px beyond the reach)       | 30% → 0, fading with distance |
| Further away                                   | 0 |

There is no sudden drop anywhere: the closer the blast, the more it scores.

On screen, every scoring blast draws two rings around its middle: a **white
ring** at its true blast radius (if it touches the tank, the shot is in the
80% → 30% zone or better) and a **faint outer ring** at the near-miss limit.
The other burst effects never draw a hard edge bigger than the real blast.

| Category    | Full points | Notes |
| ----------- | ----------- | ----- |
| Shooters    | 100         | e.g. landing at the front of the tank ≈ +80, just beside it ≈ +60, a near miss +5 to +30 |
| Magical     | 75          | Beaver: only a direct hit scores (it leaves no blast) |
| Attackers   | 50          | Their big blasts reach the tank from further away |
| Dirt movers | 0           | They reshape terrain to block or expose tanks |

Points are rounded to the nearest 5.
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

Points are set in `TT.CATEGORY_MAX_POINTS` and the near-miss distance in
`TT.NEAR_MISS_PX` (both in `js/weapons.js`). A weapon's `radius` sets its
crater size and its reach. Its `damage` value is no longer used, since there's no health.

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

- **Roles:** the host is Player 1 (Unit A, amber, moves first). The guest is Player 2 (Unit B, violet).
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
2. On the **Online combat** card click **Create room**, then **Copy link**.
3. Paste the link into a *second window* (put both side by side). It connects
   automatically and both status dots turn green.
4. Draft weapons: picks alternate between the windows. The host clicks **Start
   mission**, and then you take turns firing.

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
| Drag the elevation/power dials on your turn | The other window's barrel and dials follow along |
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
dot stays cyan until "Connection timed out", configure TURN (above).

## Extending it

- Add a weapon: append an object to `TT.WEAPONS` in `js/weapons.js`.
- Change terrain shape: edit `generate()` in `js/terrain.js` (keep using the
  `rand` argument, not `Math.random`, or online games will desync).
- Add a move type: add its shape to `MOVES` in `js/protocol.js`, a rule in
  `checkMove()` and a case in `applyMove()` in `js/game.js`.
