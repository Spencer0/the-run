// Level data + procedural chunk generator.
// Coordinates: the run goes toward -Z. We describe everything in "s" (distance run, s = -z),
// x (lateral, 0 = centre of the corridor) and y (height).

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

export class LevelData {
  constructor(index) {
    this.index = index;
    this.blocks = [];      // { x0, x1, s0, s1, y0, slope, bottom, kind }
    this.hazards = [];     // spikes | drone | laser | hurdle
    this.bolts = [];       // { x, s, y }
    this.boosts = [];      // { x0, x1, s0, s1, y }
    this.checkpoints = []; // { s, y, x }
    this.props = [];       // generator-driven decorations { type, x, s, y, rot, scale }
    this.pits = [];        // { s0, s1 } stretches with no main floor (for water / void visuals)
    this.finishS = 0;
    this.baseY = 0;
  }
  addBlock(b) {
    b.slope = b.slope || 0;
    b.kind = b.kind || 'floor';
    // Slabs reach well below the base level so nothing can be seen "under" the track from inside a ravine.
    b.bottom = b.kind === 'bridge' ? (b.bottom ?? b.y0 - 0.6) : Math.min(b.bottom ?? Infinity, this.baseY - 8);
    this.blocks.push(b);
    return b;
  }
  topOf(b, s) { return b.y0 + b.slope * (s - b.s0); }
  // Highest block under (x, s) whose top is at or below yRef.
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
  // A block whose body the player (feet at y, height ~1.6) would run into.
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
}

// ---------- chunk builders ----------
// ctx: { L, r, s, y, tier, W, level }
const W = CORRIDOR_HALF;

function floor(ctx, len, opts = {}) {
  const { L } = ctx;
  const b = L.addBlock({ x0: opts.x0 ?? -W, x1: opts.x1 ?? W, s0: ctx.s, s1: ctx.s + len, y0: ctx.y, kind: opts.kind || 'floor', bottom: opts.bottom });
  ctx.s += len;
  return b;
}

function boltLine(ctx, s0, count, spacing, x, yFn) {
  for (let i = 0; i < count; i++) {
    const s = s0 + i * spacing;
    ctx.L.bolts.push({ x, s, y: yFn ? yFn(i / Math.max(1, count - 1), s) : ctx.y + 1.2 });
  }
}

export const CHUNKS = {
  run(ctx, len = 40) {
    floor(ctx, len);
    if (ctx.r.chance(0.6)) boltLine(ctx, ctx.s - len + 8, 5, 3, ctx.r.range(-6, 6));
    ctx.L.props.push({ type: 'edge', s0: ctx.s - len, s1: ctx.s, y: ctx.y });
  },

  gap(ctx) {
    const { r, tier, L } = ctx;
    const runup = 26;
    floor(ctx, runup);
    const width = Math.min(30, 9 + tier * 2.6 + r.range(0, 4));
    const s0 = ctx.s;
    L.pits.push({ s0, s1: s0 + width });
    // arc of bolts over the gap
    boltLine(ctx, s0 - 2, 6, (width + 4) / 5, r.range(-4, 4), (t) => ctx.y + 1.4 + Math.sin(t * Math.PI) * 3.2);
    ctx.s += width;
    L.props.push({ type: 'gapEdge', s: s0, y: ctx.y, side: 'far' });
    L.props.push({ type: 'gapEdge', s: ctx.s, y: ctx.y, side: 'near' });
    floor(ctx, 18);
  },

  rampPlatform(ctx) {
    // ramp up, platform, then a drop back down (or a gap jump off the end at higher tiers)
    const { r, tier, L } = ctx;
    floor(ctx, 18);
    const rise = 5 + Math.min(6, tier * 0.8) + r.range(0, 2);
    const len = rise / 0.42;
    L.addBlock({ x0: -W, x1: W, s0: ctx.s, s1: ctx.s + len, y0: ctx.y, slope: rise / len, kind: 'ramp', bottom: ctx.y - 2 });
    L.props.push({ type: 'rampSide', s0: ctx.s, s1: ctx.s + len, y0: ctx.y, y1: ctx.y + rise });
    ctx.s += len; ctx.y += rise;
    const platLen = 24 + r.range(0, 16);
    const plat = floor(ctx, platLen, { kind: 'platform', bottom: ctx.y - rise - 2 });
    boltLine(ctx, plat.s0 + 5, 5, 3.5, 0);
    if (tier > 2 && r.chance(0.5)) {
      // launch off the end over a gap
      const width = Math.min(26, 8 + tier * 2 + r.range(0, 4));
      L.pits.push({ s0: ctx.s, s1: ctx.s + width });
      ctx.s += width; ctx.y -= rise * r.range(0.4, 1);
      ctx.y = Math.max(L.baseY, ctx.y);
      floor(ctx, 22);
    } else {
      // step down
      L.props.push({ type: 'dropEdge', s: ctx.s, y: ctx.y });
      ctx.y -= rise;
      floor(ctx, 22);
    }
  },

  bigRampJump(ctx) {
    // the signature move: steep ramp + gap, momentum decides if you make the far ledge.
    const { r, tier, L } = ctx;
    floor(ctx, 30);
    const rise = 4 + r.range(0, 2);
    const len = rise / 0.38;
    L.addBlock({ x0: -W, x1: W, s0: ctx.s, s1: ctx.s + len, y0: ctx.y, slope: rise / len, kind: 'ramp', bottom: ctx.y - 2 });
    L.props.push({ type: 'rampSide', s0: ctx.s, s1: ctx.s + len, y0: ctx.y, y1: ctx.y + rise });
    ctx.s += len;
    const width = Math.min(44, 16 + tier * 3.2 + r.range(0, 6));
    L.pits.push({ s0: ctx.s, s1: ctx.s + width });
    boltLine(ctx, ctx.s + 4, 7, (width - 6) / 6, 0, (t) => ctx.y + rise + 2 + Math.sin(t * Math.PI) * 6 - t * rise * 0.6);
    ctx.s += width;
    const landY = ctx.y + (r.chance(0.5) ? 0 : rise * 0.5);
    ctx.y = landY;
    floor(ctx, 26, { kind: landY > L.baseY + 1 ? 'platform' : 'floor', bottom: L.baseY - 2 });
  },

  spikes(ctx) {
    const { r, tier, L } = ctx;
    const len = 46;
    const start = ctx.s;
    floor(ctx, len);
    const rows = 2 + Math.min(3, Math.floor(tier / 1.5));
    for (let i = 0; i < rows; i++) {
      const s = start + 12 + i * ((len - 18) / rows);
      if (r.chance(0.35)) {
        // full-width strip: must jump
        L.hazards.push({ type: 'spikes', x0: -W + 0.5, x1: W - 0.5, s0: s, s1: s + 2.2, y: ctx.y });
      } else {
        // lanes with a hole
        const hole = r.range(-W + 4, W - 4), holeW = Math.max(3.2, 6.5 - tier * 0.5);
        L.hazards.push({ type: 'spikes', x0: -W + 0.5, x1: hole - holeW / 2, s0: s, s1: s + 2.6, y: ctx.y });
        L.hazards.push({ type: 'spikes', x0: hole + holeW / 2, x1: W - 0.5, s0: s, s1: s + 2.6, y: ctx.y });
        boltLine(ctx, s - 3, 3, 3, hole);
      }
    }
  },

  drones(ctx) {
    const { r, tier, L } = ctx;
    const len = 50, start = ctx.s;
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
    const len = 48, start = ctx.s;
    floor(ctx, len);
    const n = 2 + Math.min(3, Math.floor(tier / 1.3));
    for (let i = 0; i < n; i++) {
      const s = start + 12 + i * ((len - 16) / n);
      const low = r.chance(0.65);
      if (low) {
        // knee-height beam across the whole corridor: jump it
        L.hazards.push({ type: 'laser', s, x0: -W, x1: W, y: ctx.y + 1.0, period: 2.4 - Math.min(1, tier * 0.12), duty: 0.62, phase: r.range(0, 1) });
      } else {
        // a wall of beams with a gap: steer through it
        const gapX = r.range(-W + 4, W - 4), gw = Math.max(3.5, 6.5 - tier * 0.4);
        L.hazards.push({ type: 'laser', s, x0: -W, x1: gapX - gw / 2, y: ctx.y + 1.0, period: 99, duty: 1, phase: 0, tall: true });
        L.hazards.push({ type: 'laser', s, x0: gapX + gw / 2, x1: W, y: ctx.y + 1.0, period: 99, duty: 1, phase: 0, tall: true });
      }
    }
  },

  hurdles(ctx) {
    const { r, tier, L } = ctx;
    const len = 50, start = ctx.s;
    floor(ctx, len);
    const n = 3 + Math.min(3, Math.floor(tier / 1.2));
    for (let i = 0; i < n; i++) {
      const s = start + 12 + i * ((len - 16) / n);
      const w = r.range(5, 9);
      const x = r.range(-W + w / 2 + 0.5, W - w / 2 - 0.5);
      L.hazards.push({ type: 'hurdle', x0: x - w / 2, x1: x + w / 2, s0: s, s1: s + 1.6, y: ctx.y, h: 1.5 + Math.min(1, tier * 0.1) });
    }
  },

  bridges(ctx) {
    // long ravine crossed by narrow beams, one of them has a bolt trail
    const { r, tier, L } = ctx;
    floor(ctx, 20);
    const len = 36 + tier * 4;
    const s0 = ctx.s;
    L.pits.push({ s0, s1: s0 + len });
    const n = tier > 2 ? 2 : 3;
    const bw = Math.max(2.4, 4.2 - tier * 0.25);
    const xs = n === 2 ? [-5, 5] : [-7, 0, 7];
    for (const x of xs) {
      L.addBlock({ x0: x - bw / 2, x1: x + bw / 2, s0: s0 - 1, s1: s0 + len + 1, y0: ctx.y, kind: 'bridge', bottom: ctx.y - 0.6 });
    }
    boltLine(ctx, s0 + 6, 6, (len - 12) / 5, r.pick(xs));
    if (tier > 1.5) L.hazards.push({ type: 'drone', s: s0 + len * 0.55, y: ctx.y + 1.3, x: 0, range: 7, speed: 4 + tier, phase: 0, dir: 1 });
    ctx.s += len;
    floor(ctx, 22);
  },

  boost(ctx) {
    const { r, L } = ctx;
    floor(ctx, 34);
    const s = ctx.s - 24;
    L.boosts.push({ x0: -3, x1: 3, s0: s, s1: s + 5, y: ctx.y });
    boltLine(ctx, s + 8, 6, 3.4, 0);
  },

  stepsDown(ctx) {
    const { L } = ctx;
    const n = 3;
    for (let i = 0; i < n; i++) {
      floor(ctx, 10, { bottom: L.baseY - 2 });
      L.props.push({ type: 'dropEdge', s: ctx.s, y: ctx.y });
      ctx.y = Math.max(L.baseY, ctx.y - 2.2);
    }
    floor(ctx, 16);
  },

  weave(ctx) {
    // alternating half-width floors over the void: steer, don't jump
    const { r, L, tier } = ctx;
    floor(ctx, 16);
    const seg = 14, n = 4;
    const s0 = ctx.s;
    L.pits.push({ s0, s1: s0 + seg * n });
    let side = r.sign();
    for (let i = 0; i < n; i++) {
      const halfW = Math.max(4, 7 - tier * 0.4);
      const cx = side * (W - halfW);
      L.addBlock({ x0: cx - halfW, x1: cx + halfW, s0: s0 + i * seg - 1, s1: s0 + (i + 1) * seg + 1, y0: ctx.y, kind: 'platform', bottom: ctx.y - 2 });
      boltLine(ctx, s0 + i * seg + 3, 3, 3, cx);
      side = -side;
    }
    ctx.s = s0 + seg * n;
    floor(ctx, 18);
  },
};

function checkpoint(ctx) {
  const { L } = ctx;
  floor(ctx, 26);
  const s = ctx.s - 13;
  L.checkpoints.push({ s, y: ctx.y, x: 0 });
}

export function generateLevel(index) {
  const r = makeRng(1337 + index * 7919);
  const L = new LevelData(index);
  const ctx = { L, r, s: 0, y: 0, tier: 0, W, level: index };

  // Starting apron
  floor(ctx, 60);
  L.props.push({ type: 'start', s: 4, y: 0 });
  boltLine(ctx, 30, 6, 4, 0);

  const sections = 6; // 5 gates + finish
  for (let sec = 0; sec < sections; sec++) {
    ctx.tier = sec * 0.9 + index * 0.8;
    const t = ctx.tier;
    const pool = [];
    const add = (name, w) => { for (let i = 0; i < w; i++) pool.push(name); };
    add('run', 2); add('gap', 4); add('rampPlatform', 3); add('spikes', 3); add('drones', 3);
    add('hurdles', 2); add('boost', 2); add('weave', 2);
    if (t >= 1) { add('bridges', 2); add('lasers', 3); }
    if (t >= 1.8) add('bigRampJump', 4);
    const count = 4 + Math.min(3, Math.floor(sec / 2));
    let last = '';
    for (let i = 0; i < count; i++) {
      let name = r.pick(pool);
      let guard = 0;
      while ((name === last || (name === 'run' && i === 0)) && guard++ < 10) name = r.pick(pool);
      if (ctx.y > L.baseY + 9) name = 'stepsDown';
      CHUNKS[name](ctx);
      last = name;
    }
    if (ctx.y > L.baseY + 0.5 && sec < sections - 1) { ctx.y > L.baseY + 5 ? CHUNKS.stepsDown(ctx) : (L.props.push({ type: 'dropEdge', s: ctx.s, y: ctx.y }), ctx.y = L.baseY, floor(ctx, 10)); }
    if (sec < sections - 1) checkpoint(ctx);
  }
  floor(ctx, 40);
  L.finishS = ctx.s - 20;
  L.props.push({ type: 'finish', s: L.finishS, y: ctx.y });
  floor(ctx, 60); // overrun
  L.length = ctx.s;
  return L;
}
