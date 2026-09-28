// Terrain: a heightmap (one y-value per x column). Kept separate from
// rendering/game logic so it can be tested or swapped independently.
window.TT = window.TT || {};
TT.Terrain = (function () {
  let W = 900, H = 506, heights = [];

  function generate(width, height) {
    W = width; H = height;
    const segments = 10;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      points.push(H * 0.5 + Math.random() * H * 0.25);
    }
    heights = new Array(W);
    for (let x = 0; x < W; x++) {
      const segW = W / segments;
      const seg = Math.min(Math.floor(x / segW), segments - 1);
      const t = (x - seg * segW) / segW;
      const s = t * t * (3 - 2 * t); // smoothstep for gentle hills
      heights[x] = points[seg] + (points[seg + 1] - points[seg]) * s;
    }
    return heights;
  }

  function heightAt(x) {
    x = Math.max(0, Math.min(W - 1, Math.round(x)));
    return heights[x];
  }

  function crater(cx, radius) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(W - 1, Math.ceil(cx + radius));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = Math.sqrt(Math.max(0, r2 - dx * dx));
      heights[x] = Math.min(H - 4, heights[x] + dy * 0.9);
    }
  }

  function mound(cx, radius) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(W - 1, Math.ceil(cx + radius));
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = Math.sqrt(Math.max(0, r2 - dx * dx));
      heights[x] = Math.max(H * 0.15, heights[x] - dy * 0.9);
    }
  }

  function all() { return heights; }

  return { generate, heightAt, crater, mound, all };
})();
