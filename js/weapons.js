// Shared weapon pool: 20 weapons across 4 categories (must stay even: the draft
// splits it 10/10).
// Every weapon flies the SAME trajectory (only angle + power matter).
// effect.type only changes what happens on impact:
//   (none)   - one crater
//   'mound'  - piles dirt on top instead of digging; tanks underneath get buried
//   'cluster'- `count` blasts spread `spacing` px apart around the impact
//   'double' - the blast goes off twice at the same spot
//   'burn'   - sets the opponent's tank on fire if the blast reaches it
//            (otherwise the ground burns); scores like any other shot
//   'tunnel' - flies straight through the ground, changes nothing on the way,
//            and scores only if it hits the opponent's tank
window.TT = window.TT || {};
TT.CATEGORIES = [
  { id: 'shooter', name: 'Shooters',    color: '#8ad6ff', blurb: 'Tight blasts, reliable damage.' },
  { id: 'dirt',    name: 'Dirt Movers', color: '#c9a15c', blurb: 'Reshape the battlefield.' },
  { id: 'attacker',name: 'Attackers',   color: '#ff5c5c', blurb: 'Big radius, big damage.' },
  { id: 'magic',   name: 'Magical',     color: '#c98aff', blurb: 'Multi-blasts, fire and burrowing beasts.' }
];

TT.WEAPONS = [
  // --- Shooters ---
  { id:'sharpshooter', icon:'🎯', name:'Sharpshooter', category:'shooter', radius:20, damage:50,  desc:'Balanced, accurate round.' },
  { id:'rifleround', icon:'🔫',   name:'Rifle Round',  category:'shooter', radius:16, damage:45,  desc:'Tight blast, steady damage.' },
  { id:'marksman', icon:'🧭',     name:'Marksman',     category:'shooter', radius:18, damage:55,  desc:'Rewards a careful angle.' },
  { id:'longbarrel', icon:'📏',   name:'Long Barrel',  category:'shooter', radius:22, damage:48, desc:'Clean, dependable blast.' },
  { id:'pinpoint', icon:'📍',     name:'Pinpoint',     category:'shooter', radius:12, damage:60, desc:'Tiny radius, needs a direct hit.' },

  // --- Dirt Movers ---
  // 2 add dirt, 2 remove it
  { id:'sandbag', icon:'🧱',    name:'Sandbag Shell', category:'dirt', radius:50, damage:0,  effect:{type:'mound'},  desc:'Drops a pile of sand, burying whatever is under it.' },
  { id:'landfill', icon:'🏗️',   name:'Landfill',      category:'dirt', radius:75, damage:0,  effect:{type:'mound'},  desc:'Dumps a big hill of dirt for cover.' },
  { id:'trenchdig', icon:'⛏️',  name:'Trench Digger', category:'dirt', radius:60, damage:10, desc:'Carves a wide trench.' },
  { id:'quarry', icon:'⛰️',     name:'Quarry Blast',  category:'dirt', radius:65, damage:15, desc:'Massive but shallow dig.' },

  // --- Attackers ---
  { id:'bigbertha', icon:'💣',  name:'Big Bertha',   category:'attacker', radius:54, damage:55, desc:'Huge crater.' },
  { id:'demolisher', icon:'🧨', name:'Demolisher',   category:'attacker', radius:48, damage:65,  desc:'Serious single-hit damage.' },
  { id:'heavycannon', icon:'🎆',name:'Heavy Cannon', category:'attacker', radius:44, damage:60, desc:'Reliable heavy hitter.' },
  { id:'warhead', icon:'🚀',    name:'Warhead',      category:'attacker', radius:58, damage:70,  desc:'The biggest single blast.' },
  { id:'siegeshell', icon:'💥', name:'Siege Shell',  category:'attacker', radius:50, damage:62, desc:'Wide, punishing splash.' },

  // --- Magical ---
  { id:'triplethreat', icon:'✨', name:'Triple Threat', category:'magic', radius:20, damage:25, effect:{type:'cluster', count:3, spacing:30},  desc:'Three blasts in a row on impact.' },
  { id:'meteorstorm', icon:'☄️',  name:'Meteor Storm',  category:'magic', radius:16, damage:15, effect:{type:'cluster', count:5, spacing:34}, desc:'Five small blasts across the ground.' },
  { id:'echowisp', icon:'🧿',   name:'Echo Wisp',   category:'magic', radius:24, damage:35,   effect:{type:'double'},              desc:'The blast repeats at the same spot.' },
  { id:'comet', icon:'🌠',        name:'Comet',         category:'magic', radius:36, damage:50,                desc:'Heavy, punishing impact.' },
  { id:'burner', icon:'🔥',       name:'Burner',        category:'magic', radius:14, damage:0,  effect:{type:'burn'},   desc:'Sets the tank it hits on fire.' },
  { id:'beaver', icon:'🦫',       name:'Burrowing Beaver', category:'magic', radius:0, damage:0, effect:{type:'tunnel'}, desc:'Burrows through hills. Scores only on a direct hit.' }
];

// Score value per category: how many points a fully accurate hit is worth.
// Dirt movers score nothing since they're for reshaping terrain, not attack.
TT.CATEGORY_MAX_POINTS = { shooter: 100, magic: 75, attacker: 50, dirt: 0 };
