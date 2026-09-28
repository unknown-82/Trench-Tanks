# Trench Tanks

A lightweight, dependency-free 2-player artillery game (Pocket Tanks–style),
built with plain HTML5 Canvas + vanilla JS. No build step — just open
`index.html`.

## Structure

```
trench-tanks/
├── index.html        Markup for both screens (weapon select + game) and script/style includes
├── css/
│   └── styles.css     All styling for both screens
└── js/
    ├── weapons.js      TT.WEAPONS — the weapon catalogue (id, radius, damage, speed, color)
    ├── terrain.js       TT.Terrain — heightmap generation, lookup, and crater destruction
    └── game.js          TT.Game — screen flow, rendering, input, physics, turn logic
```

Files share a small `TT` (TrenchTanks) namespace object on `window` instead of
ES modules, so it runs by double-clicking `index.html` with no local server
or bundler required.

## Flow

1. **Weapon select screen** (`#selectScreen`) — each player picks one of four
   weapons before anything else happens.
2. **Start battle** hides that screen and reveals `#gameScreen`, which
   generates terrain and begins turn 1.
3. Firing, turn switching, and win detection all live in `js/game.js`.
4. "Choose weapons again" returns to the select screen; "Rematch" keeps the
   same loadout and regenerates terrain.

## Extending it

- Add a weapon: append an object to `TT.WEAPONS` in `js/weapons.js`.
- Change terrain shape: edit `generate()` in `js/terrain.js`.
- Add AI/single-player: swap the `fire()` call for `current === 1` with a
  computed angle/power in `js/game.js`.
