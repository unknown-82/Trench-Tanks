// Art: one hand-drawn line glyph per weapon (inline SVG, drawn with the
// current text colour) plus the few facts the armoury shows about a weapon.
// Presentation only: nothing here changes how a weapon behaves.
window.TT = window.TT || {};
TT.Art = (function () {
  "use strict";

  const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

  // 48x48 artboard, 2px strokes.
  const GLYPHS = {
    // Shooters
    sharpshooter: `<circle cx="24" cy="24" r="13"/>${dot(24, 24, 3)}<path d="M24 5v9M24 34v9M5 24h9M34 24h9"/>`,
    rifleround: `<path d="M13 27l8 8 16-16c2-5 2-9 1-11-2-1-6-1-11 1z"/><path d="M19 21l8 8M14 34l-6 6"/>`,
    marksman: `<path d="M24 5l6 19-6 19-6-19z"/><circle cx="24" cy="24" r="17" stroke-dasharray="4 5"/>${dot(24, 24, 2)}`,
    longbarrel: `<path d="M4 29h9l3-5h27v-6H14l-3 5H4z"/><path d="M36 18v6M30 18v6M43 14v14"/>`,
    pinpoint: `${dot(24, 24, 3)}<path d="M7 7l10 10M41 7L31 17M7 41l10-10M41 41L31 31"/><path d="M13 7H7v6M35 7h6v6M13 41H7v-6M35 41h6v-6"/>`,
    // Dirt movers
    sandbag: `<rect x="5" y="29" width="17" height="10" rx="3"/><rect x="26" y="29" width="17" height="10" rx="3"/><rect x="15.5" y="17" width="17" height="10" rx="3"/><path d="M24 4v8M20 9l4 4 4-4"/>`,
    landfill: `<path d="M4 40c6-15 13-22 20-22s14 7 20 22z"/><path d="M24 4v9M20 10l4 4 4-4M12 40l5-9M36 40l-5-9"/>`,
    trenchdig: `<path d="M4 18h10l5 20h10l5-20h10"/><path d="M24 5v15M19 15l5 5 5-5"/>`,
    quarry: `<path d="M4 15h8v7h7v7h10v-7h7v-7h8"/><path d="M12 40h24M18 35h12"/>`,
    // Attackers
    bigbertha: `<circle cx="22" cy="28" r="13"/><path d="M31 18l4-4c3-3 6-2 8 0M15 27a8 8 0 0 1 6-7"/>${dot(43, 10, 1.6)}`,
    demolisher: `<rect x="8" y="17" width="8" height="24" rx="2"/><rect x="20" y="17" width="8" height="24" rx="2"/><rect x="32" y="17" width="8" height="24" rx="2"/><path d="M5 27h38M24 17v-7l6-5"/>`,
    heavycannon: `<circle cx="24" cy="24" r="10"/><path d="M24 4v5M24 39v5M4 24h5M39 24h5M10 10l3.5 3.5M34.5 34.5L38 38M38 10l-3.5 3.5M13.5 34.5L10 38"/>`,
    warhead: `<path d="M24 4c7 6 9 14 9 26H15c0-12 2-20 9-26z"/><path d="M15 24l-7 11h7M33 24l7 11h-7M20 34v7M28 34v7M24 34v10"/><circle cx="24" cy="17" r="3"/>`,
    siegeshell: `<path d="M16 43V20c0-8 4-13 8-16 4 3 8 8 8 16v23z"/><path d="M16 31h16M16 37h16M24 12v6"/>`,
    // Magical
    triplethreat: `<path d="M24 4l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M11 26l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M37 26l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>`,
    meteorstorm: `<path d="M5 5l9 9M19 4l10 10M33 6l7 7M9 20l6 6"/><circle cx="18" cy="18" r="3.5"/><circle cx="33" cy="18" r="3.5"/><circle cx="42" cy="15" r="2.2"/><circle cx="17" cy="28" r="2.2"/><path d="M5 42h38" stroke-dasharray="3 5"/>`,
    echowisp: `${dot(24, 24, 3.2)}<circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="16" stroke-dasharray="7 6"/>`,
    comet: `<circle cx="32" cy="31" r="8"/><path d="M26 25L5 6M24 33L7 21M33 22L21 5"/>`,
    burner: `<path d="M24 4c2 8 12 12 12 24a12 12 0 0 1-24 0c0-6 4-8 5-13 3 2 4 5 4 8 3-4 3-12 3-19z"/><path d="M24 40a5 5 0 0 0 5-5c0-3-3-4-5-8-2 4-5 5-5 8a5 5 0 0 0 5 5z"/>`,
    beaver: `<path d="M24 45L14 23h20z"/><path d="M16.500 28l14-3M19 34l10-3M21.500 40l5-2"/><rect x="14" y="11" width="20" height="12" rx="3"/><path d="M20 11V5M28 11V5"/>`
  };

  function glyph(id) {
    return `<svg class="glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[id] || GLYPHS.sharpshooter}</svg>`;
  }

  const category = id => TT.CATEGORIES.find(c => c.id === id) || {};
  const maxPoints = w => TT.CATEGORY_MAX_POINTS[w.category] || 0;

  // What the weapon does when it lands, in two or three words.
  function payload(w) {
    const fx = w.effect || {};
    switch (fx.type) {
      case 'mound': return 'Adds dirt';
      case 'cluster': return `Cluster x${fx.count}`;
      case 'double': return 'Double blast';
      case 'burn': return 'Incendiary';
      case 'tunnel': return 'Tunnels';
      default: return w.category === 'dirt' ? 'Digs dirt' : 'Single blast';
    }
  }

  const BIGGEST_RADIUS = Math.max(...TT.WEAPONS.map(w => w.radius));

  return { glyph, category, maxPoints, payload, BIGGEST_RADIUS };
})();
