// Shared weapon pool: 20 weapons across 4 categories.
// Every weapon flies the SAME trajectory (only angle + power matter).
// effect.type only changes what happens on impact:
//   (none)   - one crater
//   'mound'  - raises terrain instead of digging (dirt movers)
//   'cluster'- `count` blasts spread `spacing` px apart around the impact
//   'double' - the blast goes off twice at the same spot
window.TT = window.TT || {};
TT.CATEGORIES = [
  { id: 'shooter', name: 'Shooters',    color: '#8ad6ff', blurb: 'Tight blasts, reliable damage.' },
  { id: 'dirt',    name: 'Dirt Movers', color: '#c9a15c', blurb: 'Reshape the battlefield.' },
  { id: 'attacker',name: 'Attackers',   color: '#ff5c5c', blurb: 'Big radius, big damage.' },
  { id: 'magic',   name: 'Magical',     color: '#c98aff', blurb: 'Multi-blast and echo effects.' }
];

TT.WEAPONS = [
  // --- Shooters ---
  { id:'sharpshooter', icon:'🎯', name:'Sharpshooter', category:'shooter', radius:20, damage:50,  desc:'Balanced, accurate round.' },
  { id:'rifleround', icon:'🔫',   name:'Rifle Round',  category:'shooter', radius:16, damage:45,  desc:'Tight blast, steady damage.' },
  { id:'marksman', icon:'🧭',     name:'Marksman',     category:'shooter', radius:18, damage:55,  desc:'Rewards a careful angle.' },
  { id:'longbarrel', icon:'📏',   name:'Long Barrel',  category:'shooter', radius:22, damage:48, desc:'Clean, dependable blast.' },
  { id:'pinpoint', icon:'📍',     name:'Pinpoint',     category:'shooter', radius:12, damage:60, desc:'Tiny radius, needs a direct hit.' },

  // --- Dirt Movers ---
  { id:'dozerround', icon:'🚜', name:'Dozer Round',   category:'dirt', radius:40, damage:5,   effect:{type:'mound'},  desc:'Piles up a low mound.' },
  { id:'sandbag', icon:'🧱',    name:'Sandbag Shell', category:'dirt', radius:50, damage:0,effect:{type:'mound'},  desc:'Pure terrain, no damage.' },
  { id:'trenchdig', icon:'⛏️',  name:'Trench Digger', category:'dirt', radius:60, damage:10, desc:'Carves a wide trench.' },
  { id:'landfill', icon:'🏗️',   name:'Landfill',      category:'dirt', radius:45, damage:0,   effect:{type:'mound'},  desc:'Builds cover fast.' },
  { id:'quarry', icon:'⛰️',     name:'Quarry Blast',  category:'dirt', radius:65, damage:15, desc:'Massive but shallow dig.' },

  // --- Attackers ---
  { id:'bigbertha', icon:'💣',  name:'Big Bertha',   category:'attacker', radius:54, damage:55, desc:'Huge crater.' },
  { id:'demolisher', icon:'🧨', name:'Demolisher',   category:'attacker', radius:48, damage:65,  desc:'Serious single-hit damage.' },
  { id:'heavycannon', icon:'🎆',name:'Heavy Cannon', category:'attacker', radius:44, damage:60, desc:'Reliable heavy hitter.' },
  { id:'warhead', icon:'🚀',    name:'Warhead',      category:'attacker', radius:58, damage:70,  desc:'The biggest single blast.' },
  { id:'siegeshell', icon:'💥', name:'Siege Shell',  category:'attacker', radius:50, damage:62, desc:'Wide, punishing splash.' },

  // --- Magical ---
  { id:'triplethreat', icon:'✨', name:'Triple Threat', category:'magic', radius:20, damage:25, effect:{type:'cluster', count:3, spacing:30},  desc:'Three blasts in a row on impact.' },
  { id:'moonshot', icon:'🌙',     name:'Moon Shot',     category:'magic', radius:30, damage:40,                desc:'Wide, gentle lunar crater.' },
  { id:'meteorstorm', icon:'☄️',  name:'Meteor Storm',  category:'magic', radius:16, damage:15, effect:{type:'cluster', count:5, spacing:34}, desc:'Five small blasts across the ground.' },
  { id:'echowisp', icon:'🧿',   name:'Echo Wisp',   category:'magic', radius:24, damage:35,   effect:{type:'double'},              desc:'The blast repeats at the same spot.' },
  { id:'comet', icon:'🌠',        name:'Comet',         category:'magic', radius:36, damage:50,                desc:'Heavy, punishing impact.' }
];

// Score value per category: how many points a fully accurate hit is worth.
// Dirt movers score nothing since they're for reshaping terrain, not attack.
TT.CATEGORY_MAX_POINTS = { shooter: 100, magic: 75, attacker: 50, dirt: 0 };

// Not part of the draft pool - always available as a fallback so a player
// who has used every drafted weapon can still take a turn.
TT.FALLBACK_WEAPON = {
  id: 'standard', icon: '🔵', name: 'Standard Shell', category: 'shooter',
  radius: 30, damage: 35, desc: 'Unlimited backup round.'
};
