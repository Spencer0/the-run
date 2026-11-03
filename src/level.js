// Level data + procedural chunk generator.
// Coordinates: the run goes toward -Z. Everything is described in "s" (distance run, s = -z),
// x (lateral, 0 = centre line) and y (height). Routes branch: chunks may lay floor anywhere in x,
// and the walkable extent at each s (L.extentAt) drives the invisible side walls and the scenery.

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

export const CORRIDOR_HALF = 11;
const W = CORRIDOR_HALF;
const EXT_STEP = 2;

export class LevelData {
  constructor(index) {
    this.index = index;
    this.blocks = [];      // { x0, x1, s0, s1, y0, slope, bottom, kind }
    this.hazards = [];     // spikes | drone | laser | hurdle | pillar
    this.bolts = [];       // { x, s, y }
    this.boosts = [];      // { x0, x1, s0, s1, y }
    this.pads = [];        // bounce pads { x, s, y, power }
    this.rails = [];       // grind rails { x0, x1, s0, s1, y0, y1 }
    this.zips = [];        // ziplines { x0, x1, s0, s1, y0, y1 }
    this.rings = [];       // dash rings { x, s, y, vy }
    this.checkpoints = []; // { s, y, x }
    this.pits = [];        // { s0, s1 } stretches with no full-width floor (void / water visuals)
    this.finishS = 0;
    this.baseY = 0;
    this.extent = null;
  }
  addBlock(b) {
    b.slope = b.slope || 0;
    b.kind = b.kind || 'floor';
    b.bottom = b.bottom ?? (b.kind === 'bridge' ? b.y0 - 0.6 : this.baseY - 8);
    this.blocks.push(b);
    return b;
  }
  topOf(b, s) { return b.y0 + b.slope * (s - b.s0); }
  floorAt(x, s, yRef) {
    let best = null, bestY = -Infinity;
    const bl = this.blocks;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (s < b.s0 || s > b.s1 || x < b.x0 || x > b.x1) continue;
      const top = this.topOf(b, s);
      if (top <= yRef && top > bestY) { bestY = top; best = b; }
    }
    return best ? { y: bestY, block: best } : null;
  }
  wallAt(x, s, y) {
    const bl = this.blocks;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (s < b.s0 || s > b.s1 || x < b.x0 || x > b.x1) continue;
      const top = this.topOf(b, s);
      if (top > y + 0.55 && b.bottom < y + 1.4) return { block: b, top };
    }
    return null;
  }
  computeExtent() {
    const n = Math.ceil(this.length / EXT_STEP) + 2;
    const ext = new Float32Array(n).fill(W);
    const mark = (s0, s1, e) => { for (let i = Math.max(0, Math.floor(s0 / EXT_STEP)); i <= Math.min(n - 1, Math.ceil(s1 / EXT_STEP)); i++) ext[i] = Math.max(ext[i], e); };
    for (const b of this.blocks) mark(b.s0, b.s1, Math.max(Math.abs(b.x0), Math.abs(b.x1)));
    for (const r of this.rails) mark(r.s0, r.s1, Math.max(Math.abs(r.x0), Math.abs(r.x1)) + 2);
    for (const z of this.zips) mark(z.s0, z.s1, Math.max(Math.abs(z.x0), Math.abs(z.x1)) + 2);
    // smooth outward so walls never pinch a route
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = ext[i]; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n) m = Math.max(m, ext[j]); } out[i] = m; }
    this.extent = out;
  }
  extentAt(s) {
    if (!this.extent) return W;
    const i = Math.max(0, Math.min(this.extent.length - 1, Math.round(s / EXT_STEP)));
    return this.extent[i];
  }
}

// ---------- chunk builders ----------
function floor(ctx, len, opts = {}) {
  const b = ctx.L.addBlock({ x0: opts.x0 ?? -W, x1: opts.x1 ?? W, s0: ctx.s, s1: ctx.s + len, y0: opts.y ?? ctx.y, kind: opts.kind || 'floor', bottom: opts.bottom });
  if (opts.y === undefined) ctx.s += len;
  return b;
}
function boltLine(ctx, s0, count, spacing, x, yFn, y) {
  for (let i = 0; i < count; i++) {
    const s = s0 + i * spacing;
    ctx.L.bolts.push({ x, s, y: yFn ? yFn(i / Math.max(1, count - 1), s) : (y ?? ctx.y) + 1.2 });
  }
}
function pit(ctx, s0, s1) { ctx.L.pits.push({ s0, s1 }); }

export const CHUNKS = {
  run(ctx, len = 40) {
    floor(ctx, len);
    if (ctx.r.chance(0.7)) boltLine(ctx, ctx.s - len + 8, 5, 4, ctx.r.range(-6, 6));
    if (ctx.r.chance(0.5)) ctx.L.boosts.push({ x0: -3, x1: 3, s0: ctx.s - len + 20, s1: ctx.s - len + 25, y: ctx.y });
  },

  gap(ctx) {
    const { r, tier } = ctx;
    floor(ctx, 26);
    const width = Math.min(50, 14 + tier * 3.5 + r.range(0, 6));
    const s0 = ctx.s; pit(ctx, s0, s0 + width);
    boltLine(ctx, s0 - 2, 6, (width + 4) / 5, r.range(-4, 4), (t) => ctx.y + 1.4 + Math.sin(t * Math.PI) * 3.5);
    ctx.s += width;
    floor(ctx, 18);
  },

  rampPlatform(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 18);
    const rise = 5 + Math.min(6, tier * 0.8) + r.range(0, 2);
    const len = rise / 0.42;
    L.addBlock({ x0: -W, x1: W, s0: ctx.s, s1: ctx.s + len, y0: ctx.y, slope: rise / len, kind: 'ramp' });
    ctx.s += len; ctx.y += rise;
    const plat = floor(ctx, 24 + r.range(0, 16), { kind: 'platform' });
    boltLine(ctx, plat.s0 + 5, 5, 3.5, 0);
    if (tier > 2 && r.chance(0.5)) {
      const width = Math.min(34, 12 + tier * 2.5 + r.range(0, 4));
      pit(ctx, ctx.s, ctx.s + width);
      ctx.s += width; ctx.y = Math.max(L.baseY, ctx.y - rise * r.range(0.4, 1));
      floor(ctx, 22);
    } else { ctx.y -= rise; floor(ctx, 22); }
  },

  bigRampJump(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 30);
    const rise = 4 + r.range(0, 2), len = rise / 0.38;
    L.addBlock({ x0: -W, x1: W, s0: ctx.s, s1: ctx.s + len, y0: ctx.y, slope: rise / len, kind: 'ramp' });
    ctx.s += len;
    const width = Math.min(66, 24 + tier * 4 + r.range(0, 8));
    pit(ctx, ctx.s, ctx.s + width);
    boltLine(ctx, ctx.s + 4, 7, (width - 6) / 6, 0, (t) => ctx.y + rise + 2 + Math.sin(t * Math.PI) * 7 - t * rise * 0.6);
    L.rings.push({ x: 0, s: ctx.s + width * 0.45, y: ctx.y + rise + 6, vy: 6 });
    ctx.s += width;
    ctx.y = ctx.y + (r.chance(0.5) ? 0 : rise * 0.5);
    floor(ctx, 26, { kind: ctx.y > L.baseY + 1 ? 'platform' : 'floor' });
  },

  spikes(ctx) {
    const { r, tier, L } = ctx;
    const len = 50, start = ctx.s;
    floor(ctx, len);
    const rows = 2 + Math.min(3, Math.floor(tier / 1.5));
    for (let i = 0; i < rows; i++) {
      const s = start + 12 + i * ((len - 18) / rows);
      if (r.chance(0.35)) L.hazards.push({ type: 'spikes', x0: -W + 0.5, x1: W - 0.5, s0: s, s1: s + 2.2, y: ctx.y });
      else {
        const hole = r.range(-W + 4, W - 4), holeW = Math.max(3.4, 7 - tier * 0.5);
        L.hazards.push({ type: 'spikes', x0: -W + 0.5, x1: hole - holeW / 2, s0: s, s1: s + 2.6, y: ctx.y });
        L.hazards.push({ type: 'spikes', x0: hole + holeW / 2, x1: W - 0.5, s0: s, s1: s + 2.6, y: ctx.y });
        boltLine(ctx, s - 3, 3, 3, hole);
      }
    }
  },

  drones(ctx) {
    const { r, tier, L } = ctx;
    const len = 54, start = ctx.s;
    floor(ctx, len);
    const n = 2 + Math.min(3, Math.floor(tier / 1.2));
    for (let i = 0; i < n; i++) {
      const s = start + 14 + i * ((len - 20) / n);
      L.hazards.push({ type: 'drone', s, y: ctx.y + 1.3, x: r.range(-3, 3), range: W - 3, speed: 5 + tier * 1.4 + r.range(0, 3), phase: r.range(0, 6.28), dir: r.sign() });
    }
    boltLine(ctx, start + 10, 6, 5, r.range(-5, 5));
  },

  lasers(ctx) {
    const { r, tier, L } = ctx;
    const len = 54, start = ctx.s;
    floor(ctx, len);
    const n = 2 + Math.min(3, Math.floor(tier / 1.3));
    for (let i = 0; i < n; i++) {
      const s = start + 12 + i * ((len - 16) / n);
      if (r.chance(0.65)) L.hazards.push({ type: 'laser', s, x0: -W, x1: W, y: ctx.y + 1.0, period: 2.6 - Math.min(1, tier * 0.12), duty: 0.6, phase: r.range(0, 1) });
      else {
        const gapX = r.range(-W + 4, W - 4), gw = Math.max(3.8, 7 - tier * 0.4);
        L.hazards.push({ type: 'laser', s, x0: -W, x1: gapX - gw / 2, y: ctx.y + 1.0, period: 99, duty: 1, phase: 0, tall: true });
        L.hazards.push({ type: 'laser', s, x0: gapX + gw / 2, x1: W, y: ctx.y + 1.0, period: 99, duty: 1, phase: 0, tall: true });
      }
    }
  },

  hurdles(ctx) {
    const { r, tier, L } = ctx;
    const len = 54, start = ctx.s;
    floor(ctx, len);
    const n = 3 + Math.min(3, Math.floor(tier / 1.2));
    for (let i = 0; i < n; i++) {
      const s = start + 12 + i * ((len - 16) / n);
      const w = r.range(5, 9), x = r.range(-W + w / 2 + 0.5, W - w / 2 - 0.5);
      L.hazards.push({ type: 'hurdle', x0: x - w / 2, x1: x + w / 2, s0: s, s1: s + 1.6, y: ctx.y, h: 1.5 + Math.min(1, tier * 0.1) });
    }
  },

  bridges(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 20);
    const len = 46 + tier * 5, s0 = ctx.s;
    pit(ctx, s0, s0 + len);
    const n = tier > 2 ? 2 : 3, bw = Math.max(2.4, 4.4 - tier * 0.25);
    const xs = n === 2 ? [-5, 5] : [-7, 0, 7];
    for (const x of xs) L.addBlock({ x0: x - bw / 2, x1: x + bw / 2, s0: s0 - 1, s1: s0 + len + 1, y0: ctx.y, kind: 'bridge' });
    boltLine(ctx, s0 + 6, 6, (len - 12) / 5, r.pick(xs));
    if (tier > 1.5) L.hazards.push({ type: 'drone', s: s0 + len * 0.55, y: ctx.y + 1.3, x: 0, range: 7, speed: 4 + tier, phase: 0, dir: 1 });
    ctx.s += len;
    floor(ctx, 22);
  },

  boost(ctx) {
    const { L } = ctx;
    floor(ctx, 36);
    const s = ctx.s - 26;
    L.boosts.push({ x0: -3, x1: 3, s0: s, s1: s + 5, y: ctx.y });
    boltLine(ctx, s + 8, 7, 3.6, 0);
  },

  stepsDown(ctx) {
    const { L } = ctx;
    for (let i = 0; i < 3; i++) { floor(ctx, 10); ctx.y = Math.max(L.baseY, ctx.y - 2.2); }
    floor(ctx, 16);
  },

  weave(ctx) {
    const { r, L, tier } = ctx;
    floor(ctx, 16);
    const seg = 16, n = 4, s0 = ctx.s;
    pit(ctx, s0, s0 + seg * n);
    let side = r.sign();
    for (let i = 0; i < n; i++) {
      const halfW = Math.max(4, 7 - tier * 0.4), cx = side * (W - halfW);
      L.addBlock({ x0: cx - halfW, x1: cx + halfW, s0: s0 + i * seg - 1, s1: s0 + (i + 1) * seg + 1, y0: ctx.y, kind: 'platform' });
      boltLine(ctx, s0 + i * seg + 3, 3, 3, cx);
      side = -side;
    }
    ctx.s = s0 + seg * n;
    floor(ctx, 18);
  },

  // ---------- branching routes ----------

  // Left/right split over a void. One lane is the fast lane (boost + bolts), the other the safe-but-slow lane.
  fork(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 14);
    const len = 56 + tier * 4, s0 = ctx.s, laneW = 7;
    pit(ctx, s0, s0 + len);
    const fast = r.sign();
    for (const side of [-1, 1]) {
      const cx = side * (W + 1 - laneW / 2 + 2);
      L.addBlock({ x0: cx - laneW / 2, x1: cx + laneW / 2, s0: s0 - 1, s1: s0 + len + 1, y0: ctx.y, kind: 'platform' });
      if (side === fast) {
        L.boosts.push({ x0: cx - 2.5, x1: cx + 2.5, s0: s0 + 10, s1: s0 + 15, y: ctx.y });
        boltLine(ctx, s0 + 18, 8, (len - 24) / 7, cx);
        L.hazards.push({ type: 'spikes', x0: cx - laneW / 2 + 0.3, x1: cx + laneW / 2 - 0.3, s0: s0 + len * 0.6, s1: s0 + len * 0.6 + 2.2, y: ctx.y });
      } else {
        L.hazards.push({ type: 'drone', s: s0 + len * 0.4, y: ctx.y + 1.3, x: cx, range: laneW / 2 - 1.2, speed: 4 + tier, phase: 0, dir: 1 });
        boltLine(ctx, s0 + 24, 3, 4, cx);
      }
    }
    // a thin centre rail for the brave
    L.rails.push({ x0: 0, x1: 0, s0: s0 - 3, s1: s0 + len + 3, y0: ctx.y + 0.3, y1: ctx.y + 0.3 });
    ctx.s = s0 + len;
    floor(ctx, 20);
  },

  // Low road with hazards; a bounce pad at the start fires you up to a high road on one side with bolts and a rail back down.
  highLow(ctx) {
    const { r, tier, L } = ctx;
    const side = r.sign();
    floor(ctx, 12);
    const s0 = ctx.s, len = 90, hi = 9;
    floor(ctx, len);
    // low road hazards
    for (let i = 0; i < 3; i++) {
      const s = s0 + 20 + i * 22;
      if (r.chance(0.5)) L.hazards.push({ type: 'laser', s, x0: -W, x1: W, y: ctx.y + 1.0, period: 2.4, duty: 0.6, phase: r.range(0, 1) });
      else L.hazards.push({ type: 'drone', s, y: ctx.y + 1.3, x: 0, range: W - 3, speed: 6 + tier, phase: r.range(0, 6), dir: r.sign() });
    }
    // bounce pad up
    const px = side * (W - 3);
    L.pads.push({ x: px, s: s0 + 6, y: ctx.y, power: 30 });
    // high road: offset outward so it reads as its own route
    const hx0 = side > 0 ? 4 : -(W + 9), hx1 = side > 0 ? W + 9 : -4;
    L.addBlock({ x0: hx0, x1: hx1, s0: s0 + 22, s1: s0 + 66, y0: ctx.y + hi, kind: 'platform', bottom: ctx.y + hi - 1.5 });
    const hcx = (hx0 + hx1) / 2;
    boltLine(ctx, s0 + 26, 9, 4, hcx, null, ctx.y + hi);
    L.boosts.push({ x0: hcx - 2.5, x1: hcx + 2.5, s0: s0 + 30, s1: s0 + 35, y: ctx.y + hi });
    // rail glides back down to the low road
    L.rails.push({ x0: hcx, x1: side * 4, s0: s0 + 66, s1: s0 + len + 6, y0: ctx.y + hi + 0.3, y1: ctx.y + 1.2 });
    L.rings.push({ x: hcx, s: s0 + 50, y: ctx.y + hi + 4, vy: 5 });
    floor(ctx, 14);
  },

  // Wide open field: pick your own line between pillars, boosts and a bounce pad to a ring.
  wideField(ctx) {
    const { r, tier, L } = ctx;
    const len = 80, ext = 22, s0 = ctx.s;
    // flare in, wide floor, flare out
    L.addBlock({ x0: -ext, x1: ext, s0, s1: s0 + len, y0: ctx.y });
    ctx.s += len;
    const n = 6 + Math.min(6, Math.floor(tier * 1.5));
    for (let i = 0; i < n; i++) {
      const x = r.range(-ext + 3, ext - 3), s = s0 + 12 + r.range(0, len - 24);
      L.hazards.push({ type: 'pillar', x0: x - 1.3, x1: x + 1.3, s0: s, s1: s + 2.6, y: ctx.y, h: 5 });
    }
    for (let i = 0; i < 3; i++) { const x = r.range(-ext + 4, ext - 4), s = s0 + 8 + i * 24; L.boosts.push({ x0: x - 2.5, x1: x + 2.5, s0: s, s1: s + 5, y: ctx.y }); boltLine(ctx, s + 7, 5, 3.5, x); }
    const padX = r.range(-ext + 6, ext - 6);
    L.pads.push({ x: padX, s: s0 + len * 0.45, y: ctx.y, power: 26 });
    L.rings.push({ x: padX, s: s0 + len * 0.45 + 24, y: ctx.y + 9, vy: 4 });
    boltLine(ctx, s0 + len * 0.45 + 6, 6, 3.5, padX, (t) => ctx.y + 3 + Math.sin(t * Math.PI) * 6);
    floor(ctx, 16);
  },

  // Rails over a ravine: three lines at different heights and slopes.
  railRun(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 18);
    const len = 60 + tier * 6, s0 = ctx.s;
    pit(ctx, s0, s0 + len);
    const xs = [-6, 0, 6].sort(() => r.next() - 0.5);
    L.rails.push({ x0: xs[0], x1: xs[0], s0: s0 - 4, s1: s0 + len + 2, y0: ctx.y + 0.3, y1: ctx.y + 0.3 });
    L.rails.push({ x0: xs[1], x1: xs[1] * 0.5, s0: s0 - 4, s1: s0 + len * 0.6, y0: ctx.y + 0.3, y1: ctx.y + 6 });
    L.rails.push({ x0: xs[2], x1: xs[2], s0: s0 + len * 0.3, s1: s0 + len + 2, y0: ctx.y + 5, y1: ctx.y + 1.5 });
    boltLine(ctx, s0 + 8, 6, (len * 0.5) / 5, xs[1], (t) => ctx.y + 1.6 + t * 5.7);
    boltLine(ctx, s0 + len * 0.35, 6, (len * 0.6) / 5, xs[2], (t) => ctx.y + 6.3 - t * 3.5);
    L.rings.push({ x: xs[1] * 0.5, s: s0 + len * 0.72, y: ctx.y + 9, vy: 5 });
    ctx.s = s0 + len;
    floor(ctx, 22);
  },

  // Zipline from a raised deck over a long drop; a narrow side bridge is the alternative.
  zipRun(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 16);
    const rise = 6, rlen = rise / 0.42;
    L.addBlock({ x0: -W, x1: W, s0: ctx.s, s1: ctx.s + rlen, y0: ctx.y, slope: rise / rlen, kind: 'ramp' });
    ctx.s += rlen; ctx.y += rise;
    const deck = floor(ctx, 16, { kind: 'platform' });
    const len = 80 + tier * 6, s0 = ctx.s;
    pit(ctx, s0, s0 + len);
    const zx = r.range(-4, 4), side = -Math.sign(zx || 1);
    L.zips.push({ x0: zx, x1: zx * 0.3, s0: s0 - 6, s1: s0 + len - 4, y0: ctx.y + 2.6, y1: L.baseY + 3.2 });
    boltLine(ctx, s0 + 10, 8, (len - 24) / 7, zx, (t) => ctx.y + 0.4 - t * (ctx.y - L.baseY) );
    // side bridge, lower and slower
    const bx = side * (W - 2.5);
    L.addBlock({ x0: bx - 2, x1: bx + 2, s0: s0 - 1, s1: s0 + len + 1, y0: ctx.y, kind: 'bridge' });
    L.hazards.push({ type: 'spikes', x0: bx - 1.8, x1: bx + 1.8, s0: s0 + len * 0.5, s1: s0 + len * 0.5 + 2, y: ctx.y });
    ctx.s = s0 + len;
    ctx.y = L.baseY;
    floor(ctx, 24);
    L.addBlock({ x0: bx - 2, x1: bx + 2, s0: s0 + len - 1, s1: s0 + len + 6, y0: deck.y0, kind: 'bridge' }); // landing lip for the bridge route
  },

  // Bounce pad to a very high tower with dash rings, then a long fall.
  bounceTower(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 20);
    const s0 = ctx.s, hi = 14;
    L.pads.push({ x: 0, s: s0 - 8, y: ctx.y, power: 36 });
    pit(ctx, s0, s0 + 60);
    L.addBlock({ x0: -6, x1: 6, s0: s0 + 6, s1: s0 + 30, y0: ctx.y + hi, kind: 'platform', bottom: ctx.y + hi - 2 });
    boltLine(ctx, s0 + 8, 6, 3.5, 0, null, ctx.y + hi);
    L.rings.push({ x: 0, s: s0 + 40, y: ctx.y + hi + 2, vy: 7 });
    L.rings.push({ x: 0, s: s0 + 52, y: ctx.y + hi + 1, vy: 4 });
    // low route for those who miss: narrow bridge far to one side
    const bx = r.sign() * (W - 2.5);
    L.addBlock({ x0: bx - 2, x1: bx + 2, s0: s0 - 1, s1: s0 + 61, y0: ctx.y, kind: 'bridge' });
    ctx.s = s0 + 60;
    floor(ctx, 26);
  },

  // Chain of dash rings over a void: jump into the first, ride the rest.
  dashRings(ctx) {
    const { r, tier, L } = ctx;
    floor(ctx, 22);
    const len = 70 + tier * 6, s0 = ctx.s;
    pit(ctx, s0, s0 + len);
    let x = 0;
    for (let i = 0; i < 4; i++) {
      x = Math.max(-8, Math.min(8, x + r.range(-5, 5)));
      L.rings.push({ x, s: s0 + 4 + i * ((len - 8) / 3.6), y: ctx.y + 4 + (i % 2) * 2.5, vy: 7 });
    }
    ctx.s = s0 + len;
    floor(ctx, 24);
  },
};

function checkpoint(ctx) {
  floor(ctx, 26);
  ctx.L.checkpoints.push({ s: ctx.s - 13, y: ctx.y, x: 0 });
}

export function generateLevel(index) {
  const r = makeRng(1337 + index * 7919);
  const L = new LevelData(index);
  const ctx = { L, r, s: 0, y: 0, tier: 0, W, level: index };

  floor(ctx, 60);
  boltLine(ctx, 28, 6, 4, 0);
  L.boosts.push({ x0: -3, x1: 3, s0: 40, s1: 45, y: 0 });

  const sections = 6;
  for (let sec = 0; sec < sections; sec++) {
    ctx.tier = sec * 0.9 + index * 0.8;
    const t = ctx.tier;
    const pool = [];
    const add = (name, w) => { for (let i = 0; i < w; i++) pool.push(name); };
    add('run', 1); add('gap', 2); add('rampPlatform', 2); add('spikes', 2); add('drones', 2); add('hurdles', 1); add('boost', 2); add('weave', 1);
    add('fork', 4); add('highLow', 4); add('wideField', 3); add('railRun', 4); add('dashRings', 3);
    if (t >= 1) { add('bridges', 1); add('lasers', 2); add('zipRun', 4); add('bounceTower', 3); }
    if (t >= 1.8) add('bigRampJump', 3);
    const count = 4 + Math.min(2, Math.floor(sec / 2));
    let last = '', branched = false;
    const branchy = new Set(['fork', 'highLow', 'wideField', 'railRun', 'zipRun', 'bounceTower', 'dashRings']);
    for (let i = 0; i < count; i++) {
      let name = r.pick(pool), guard = 0;
      while ((name === last || (name === 'run' && i === 0)) && guard++ < 10) name = r.pick(pool);
      if (i === count - 1 && !branched) name = r.pick(['fork', 'highLow', 'railRun', 'wideField']);
      if (ctx.y > L.baseY + 9) name = 'stepsDown';
      CHUNKS[name](ctx);
      if (branchy.has(name)) branched = true;
      last = name;
    }
    if (ctx.y > L.baseY + 0.5 && sec < sections - 1) { if (ctx.y > L.baseY + 5) CHUNKS.stepsDown(ctx); else { ctx.y = L.baseY; floor(ctx, 10); } }
    if (sec < sections - 1) checkpoint(ctx);
  }
  floor(ctx, 40);
  L.finishS = ctx.s - 20;
  floor(ctx, 60);
  L.length = ctx.s;
  L.computeExtent();
  return L;
}
