// Level data + procedural generator for a winding 3D course.
// Everything lives in world space (x, z on the ground, y up). Floors are rotated rectangles
// ("blocks") laid along a spine that turns, climbs and opens into plazas, so the player can
// move freely in any direction. Heading angle a: forward = (sin a, -cos a), right = (cos a, sin a).

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

export const HALF = 14; // default half-width of the road

// Local coordinates of a point relative to a rotated rect: u lateral (right), v along (forward)
export function localUV(b, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return [dx * b.rx + dz * b.rz, dx * b.fx + dz * b.fz];
}
export function setFrame(b) { b.rx = Math.cos(b.ang); b.rz = Math.sin(b.ang); b.fx = Math.sin(b.ang); b.fz = -Math.cos(b.ang); return b; }

export class LevelData {
  constructor(index) {
    this.index = index;
    this.blocks = [];   // floors { cx, cz, hw, hl, ang, y0, slope, bottom, kind }
    this.solids = [];   // walls / pillars / hurdles { cx, cz, hw, hl, ang, y, h, kind }
    this.spikes = [];   // { cx, cz, hw, hl, ang, y }
    this.drones = [];   // { ax, az, bx, bz, y, speed, phase }
    this.lasers = [];   // { ax, az, bx, bz, y, tall, period, duty, phase }
    this.boosts = [];   // dash panels { x, z, y, ang }
    this.pads = [];     // { x, z, y, power }
    this.rails = [];    // { ax, ay, az, bx, by, bz }
    this.zips = [];     // { ax, ay, az, bx, by, bz }
    this.rings = [];    // { x, y, z, dx, dz, vy }
    this.bolts = [];    // { x, y, z }
    this.checkpoints = []; // { x, z, y, ang, hw }
    this.segments = []; // road pieces for scenery { x, z, ang, len, hw, y, kind }
    this.start = { x: 0, z: 0, y: 0, ang: 0 };
    this.finish = null;
    this.baseY = 0;
    this.bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  addBlock(b) {
    b.slope = b.slope || 0; b.kind = b.kind || 'floor';
    b.bottom = b.bottom ?? (b.kind === 'bridge' ? b.y0 - 0.6 : this.baseY - 8);
    setFrame(b); this.blocks.push(b);
    this.bounds.minX = Math.min(this.bounds.minX, b.cx - 60); this.bounds.maxX = Math.max(this.bounds.maxX, b.cx + 60);
    this.bounds.minZ = Math.min(this.bounds.minZ, b.cz - 60); this.bounds.maxZ = Math.max(this.bounds.maxZ, b.cz + 60);
    return b;
  }
  topOf(b, v) { return b.y0 + b.slope * (v + b.hl); }
  floorAt(x, z, yRef) {
    let best = null, bestY = -Infinity, bestV = 0;
    const bl = this.blocks;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      const dx = x - b.cx, dz = z - b.cz;
      const u = dx * b.rx + dz * b.rz; if (u < -b.hw || u > b.hw) continue;
      const v = dx * b.fx + dz * b.fz; if (v < -b.hl || v > b.hl) continue;
      const top = b.y0 + b.slope * (v + b.hl);
      if (top <= yRef && top > bestY) { bestY = top; best = b; bestV = v; }
    }
    return best ? { y: bestY, block: best, v: bestV } : null;
  }
  // Any floor or solid whose body the player would run into at height y. Returns the block and its top.
  wallAt(x, z, y) {
    const bl = this.blocks;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      const dx = x - b.cx, dz = z - b.cz;
      const u = dx * b.rx + dz * b.rz; if (u < -b.hw || u > b.hw) continue;
      const v = dx * b.fx + dz * b.fz; if (v < -b.hl || v > b.hl) continue;
      const top = b.y0 + b.slope * (v + b.hl);
      if (top > y + 0.55 && b.bottom < y + 1.4) return { block: b, top, u, v };
    }
    const so = this.solids;
    for (let i = 0; i < so.length; i++) {
      const b = so[i];
      const dx = x - b.cx, dz = z - b.cz;
      const u = dx * b.rx + dz * b.rz; if (u < -b.hw || u > b.hw) continue;
      const v = dx * b.fx + dz * b.fz; if (v < -b.hl || v > b.hl) continue;
      const top = b.y + b.h;
      if (top > y + 0.55 && b.y < y + 1.4) return { block: b, top, u, v, solid: true };
    }
    return null;
  }
  // distance test against the road for scenery placement
  nearRoad(x, z, margin) {
    for (const s of this.segments) {
      const dx = x - s.cx, dz = z - s.cz;
      const u = dx * s.rx + dz * s.rz, v = dx * s.fx + dz * s.fz;
      if (Math.abs(u) < s.hw + margin && Math.abs(v) < s.hl + margin) return true;
    }
    return false;
  }
}

// ---------- chunk helpers (local frame of the cursor) ----------
const F = (ctx) => ({ fx: Math.sin(ctx.a), fz: -Math.cos(ctx.a), rx: Math.cos(ctx.a), rz: Math.sin(ctx.a) });
const P = (ctx, u, v) => { const f = F(ctx); return [ctx.x + f.rx * u + f.fx * v, ctx.z + f.rz * u + f.fz * v]; };
function rect(ctx, u0, u1, v0, v1, y, opts = {}) {
  const [cx, cz] = P(ctx, (u0 + u1) / 2, (v0 + v1) / 2);
  return ctx.L.addBlock({ cx, cz, hw: (u1 - u0) / 2, hl: (v1 - v0) / 2, ang: ctx.a, y0: y, slope: opts.slope || 0, kind: opts.kind, bottom: opts.bottom });
}
function solid(ctx, u0, u1, v0, v1, y, h, kind) {
  const [cx, cz] = P(ctx, (u0 + u1) / 2, (v0 + v1) / 2);
  ctx.L.solids.push(setFrame({ cx, cz, hw: (u1 - u0) / 2, hl: (v1 - v0) / 2, ang: ctx.a, y, h, kind }));
}
function spikes(ctx, u0, u1, v0, v1, y) {
  const [cx, cz] = P(ctx, (u0 + u1) / 2, (v0 + v1) / 2);
  ctx.L.spikes.push(setFrame({ cx, cz, hw: (u1 - u0) / 2, hl: (v1 - v0) / 2, ang: ctx.a, y }));
}
function drone(ctx, u0, v0, u1, v1, y, speed, phase) {
  const [ax, az] = P(ctx, u0, v0), [bx, bz] = P(ctx, u1, v1);
  ctx.L.drones.push({ ax, az, bx, bz, y, speed, phase });
}
function laser(ctx, u0, u1, v, y, tall, period, duty, phase) {
  const [ax, az] = P(ctx, u0, v), [bx, bz] = P(ctx, u1, v);
  ctx.L.lasers.push({ ax, az, bx, bz, y, tall, period, duty, phase });
}
function boost(ctx, u, v, y, dAng = 0) { const [x, z] = P(ctx, u, v); ctx.L.boosts.push({ x, z, y, ang: ctx.a + dAng }); }
function pad(ctx, u, v, y, power) { const [x, z] = P(ctx, u, v); ctx.L.pads.push({ x, z, y, power }); }
function rail(ctx, u0, v0, y0, u1, v1, y1) { const [ax, az] = P(ctx, u0, v0), [bx, bz] = P(ctx, u1, v1); ctx.L.rails.push({ ax, ay: y0, az, bx, by: y1, bz }); }
function zip(ctx, u0, v0, y0, u1, v1, y1) { const [ax, az] = P(ctx, u0, v0), [bx, bz] = P(ctx, u1, v1); ctx.L.zips.push({ ax, ay: y0, az, bx, by: y1, bz }); }
function ring(ctx, u, v, y, vy) { const [x, z] = P(ctx, u, v); const f = F(ctx); ctx.L.rings.push({ x, y, z, dx: f.fx, dz: f.fz, vy }); }
function bolt(ctx, u, v, y) { const [x, z] = P(ctx, u, v); ctx.L.bolts.push({ x, y, z }); }
function boltLine(ctx, u, v0, count, spacing, y, yFn) { for (let i = 0; i < count; i++) bolt(ctx, u, v0 + i * spacing, yFn ? yFn(i / Math.max(1, count - 1)) : y + 1.2); }
function boltRing(ctx, u, v, y, rad, n) { for (let i = 0; i < n; i++) bolt(ctx, u + Math.cos(i / n * 6.283) * rad, v + Math.sin(i / n * 6.283) * rad, y + 1.2); }
function segment(ctx, len, hw, kind = 'road') { const [cx, cz] = P(ctx, 0, len / 2); ctx.L.segments.push(setFrame({ cx, cz, x: ctx.x, z: ctx.z, ang: ctx.a, len, hw, hl: len / 2, y: ctx.y, kind })); }
function advance(ctx, len) { const f = F(ctx); ctx.x += f.fx * len; ctx.z += f.fz * len; }
// invisible-but-solid edge walls (rendered as low curbs); pieces inside any skip rect are left out
function walls(ctx, hw, v0, v1, y, skip = []) {
  const [cx0, cz0] = P(ctx, 0, 0);
  const inSkip = (x, z) => skip.some((k) => { const [u, v] = localUV(k, x, z); return Math.abs(u) < k.hw && Math.abs(v) < k.hl; });
  for (let v = v0; v < v1; v += 4) {
    const v2 = Math.min(v1, v + 4);
    for (const side of [-1, 1]) { const [x, z] = P(ctx, side * (hw + 0.5), (v + v2) / 2); if (inSkip(x, z)) continue; solid(ctx, side * (hw + 0.5) - 0.4, side * (hw + 0.5) + 0.4, v, v2, y, 3, 'wall'); }
  }
}
function endWall(ctx, u0, u1, v, y, skip = []) {
  const inSkip = (x, z) => skip.some((k) => { const [uu, vv] = localUV(k, x, z); return Math.abs(uu) < k.hw && Math.abs(vv) < k.hl; });
  for (let u = u0; u < u1; u += 4) { const u2 = Math.min(u1, u + 4); const [x, z] = P(ctx, (u + u2) / 2, v); if (inSkip(x, z)) continue; solid(ctx, u, u2, v - 0.4, v + 0.4, y, 3, 'wall'); }
}
function virtualRect(ctx, u0, u1, v0, v1) { const [cx, cz] = P(ctx, (u0 + u1) / 2, (v0 + v1) / 2); return setFrame({ cx, cz, hw: (u1 - u0) / 2, hl: (v1 - v0) / 2, ang: ctx.a }); }
// road piece: floor plus a scenery segment, overlapping its neighbours a little; walled unless told otherwise
function road(ctx, len, hw = HALF, opts = {}) {
  const head = opts.head ?? (ctx.afterRamp ? 0 : -4), tail = opts.tail ?? 4;
  const b = rect(ctx, -hw, hw, head, len + tail, ctx.y, opts); segment(ctx, len, hw);
  if (opts.walls !== false) walls(ctx, hw, 0, len, ctx.y);
  ctx.afterRamp = false; advance(ctx, len); return b;
}
// sloped piece: exact length, no overlaps; the next road starts flush
function rampPiece(ctx, len, rise, v0 = 0) {
  rect(ctx, -HALF, HALF, v0, v0 + len, ctx.y, { slope: rise / len, kind: 'ramp' }); segment(ctx, len, HALF);
  walls(ctx, HALF, v0, v0 + len, ctx.y + rise / 2); advance(ctx, v0 + len); ctx.y += rise; ctx.afterRamp = true;
}

export const CHUNKS = {
  run(ctx) {
    const { r } = ctx; const len = 50;
    road(ctx, len);
    if (r.chance(0.7)) boltLine(ctx, r.range(-8, 8), -len + 8, 6, 4, ctx.y);
    if (r.chance(0.6)) boost(ctx, r.range(-6, 6), -len + 24, ctx.y);
  },

  // gentle winding road: several short pieces each turning the same way
  curve(ctx) {
    const { r } = ctx; const n = 4 + r.int(0, 2), da = r.sign() * r.range(0.16, 0.26);
    for (let i = 0; i < n; i++) {
      road(ctx, 18, 13);
      if (i % 2 === 0) bolt(ctx, Math.sign(da) * -6, -8, ctx.y + 1.2);
      ctx.a += da;
    }
    boost(ctx, 0, -10, ctx.y);
  },

  // up a hill, across the top, and down the other side (downhill = free speed)
  hill(ctx) {
    const { r } = ctx; const rise = 6 + r.range(0, 4), up = rise / 0.34, down = rise / 0.42;
    road(ctx, 14, HALF, { tail: 0 });
    rampPiece(ctx, up, rise);
    const top = 30 + r.range(0, 20);
    road(ctx, top, HALF, { kind: 'platform' });
    boltLine(ctx, 0, -top + 6, 5, 4, ctx.y);
    rampPiece(ctx, down, -rise, 4);
    road(ctx, 16);
  },

  // a wide open plaza where the road turns; optional nooks reward exploring
  plaza(ctx) {
    const { r, L } = ctx; const hw = 28, len = 60;
    const turn = r.sign() * r.range(0.5, 1.2);
    rect(ctx, -hw, hw, -6, len, ctx.y); segment(ctx, len, hw, 'plaza');
    // pillars and crates to weave through
    const n = 5 + r.int(0, 4);
    for (let i = 0; i < n; i++) {
      const u = r.range(-hw + 5, hw - 5), v = r.range(8, len - 8);
      if (Math.hypot(u, v - len / 2) < 9) continue;
      if (r.chance(0.5)) solid(ctx, u - 1.5, u + 1.5, v - 1.5, v + 1.5, ctx.y, 5 + r.range(0, 3), 'pillar');
      else solid(ctx, u - 2, u + 2, v - 2, v + 2, ctx.y, 2.6, 'crate');
    }
    boltRing(ctx, 0, len / 2, ctx.y, 6, 8);
    // a nook off to one side: a raised ledge with bolts and a pad to get up there
    const side = r.sign();
    const nu = side * (hw + 10);
    rect(ctx, nu - 8, nu + 8, len / 2 - 10, len / 2 + 10, ctx.y + 5, { kind: 'platform', bottom: ctx.y + 3.5 });
    rect(ctx, side > 0 ? hw - 2 : nu + 8 - 1, side > 0 ? nu - 8 + 1 : -hw + 2, len / 2 - 6, len / 2 + 6, ctx.y, { kind: 'platform' }); // walkway out to it
    pad(ctx, side * (hw + 4), len / 2, ctx.y, 24);
    boltRing(ctx, nu, len / 2, ctx.y + 5, 4, 6);
    if (r.chance(0.6)) ring(ctx, nu, len / 2 + 14, ctx.y + 8, 6);
    // dash panels pointing out along the new heading
    const mid = { ...ctx }; advance(mid, len / 2); mid.a += turn;
    boost(mid, -5, 8, ctx.y); boost(mid, 5, 8, ctx.y);
    // walls around the plaza, with gaps for the entry road, the exit road and the walkway to the nook
    const exit = { ...ctx }; advance(exit, len / 2); exit.a += turn;
    const skip = [virtualRect(exit, -HALF - 1, HALF + 1, -2, 60), virtualRect(ctx, -HALF - 1, HALF + 1, -40, 2), virtualRect(ctx, side > 0 ? hw - 3 : nu - 9, side > 0 ? nu + 9 : -hw + 3, len / 2 - 7, len / 2 + 7)];
    walls(ctx, hw, -6, len, ctx.y, skip);
    endWall(ctx, -hw, hw, len + 0.5, ctx.y, skip);
    endWall(ctx, -hw, hw, -6.5, ctx.y, skip);
    // continue from the plaza centre on the new heading
    advance(ctx, len / 2); ctx.a += turn;
  },

  gap(ctx) {
    const { r, tier } = ctx;
    road(ctx, 26);
    const width = Math.min(50, 14 + tier * 3.5 + r.range(0, 6));
    boltLine(ctx, r.range(-4, 4), -2, 6, (width + 4) / 5, ctx.y, (t) => ctx.y + 1.4 + Math.sin(t * Math.PI) * 3.5);
    advance(ctx, width);
    road(ctx, 22);
  },

  rampPlatform(ctx) {
    const { r, tier } = ctx;
    road(ctx, 18, HALF, { tail: 0 });
    const rise = 5 + Math.min(6, tier * 0.8) + r.range(0, 2), len = rise / 0.42;
    rampPiece(ctx, len, rise);
    const plat = 24 + r.range(0, 16);
    road(ctx, plat, HALF, { kind: 'platform' });
    boltLine(ctx, 0, -plat + 5, 5, 3.5, ctx.y);
    if (tier > 2 && r.chance(0.5)) { const width = Math.min(34, 12 + tier * 2.5 + r.range(0, 4)); advance(ctx, width); ctx.y = Math.max(ctx.L.baseY, ctx.y - rise * r.range(0.4, 1)); road(ctx, 22); }
    else { ctx.y -= rise; road(ctx, 22); }
  },

  bigRampJump(ctx) {
    const { r, tier } = ctx;
    road(ctx, 30, HALF, { tail: 0 });
    const rise = 4 + r.range(0, 2), len = rise / 0.38;
    rampPiece(ctx, len, rise); ctx.y -= rise; ctx.afterRamp = false;
    const width = Math.min(66, 24 + tier * 4 + r.range(0, 8));
    boltLine(ctx, 0, 4, 7, (width - 6) / 6, ctx.y, (t) => ctx.y + rise + 2 + Math.sin(t * Math.PI) * 7 - t * rise * 0.6);
    ring(ctx, 0, width * 0.45, ctx.y + rise + 6, 6);
    advance(ctx, width);
    road(ctx, 26);
  },

  spikesRun(ctx) {
    const { r, tier } = ctx; const len = 50;
    road(ctx, len);
    const rows = 2 + Math.min(3, Math.floor(tier / 1.5));
    for (let i = 0; i < rows; i++) {
      const v = -len + 12 + i * ((len - 18) / rows);
      if (r.chance(0.35)) spikes(ctx, -HALF + 0.5, HALF - 0.5, v, v + 2.2, ctx.y);
      else {
        const hole = r.range(-HALF + 5, HALF - 5), hw = Math.max(3.6, 7.5 - tier * 0.5);
        spikes(ctx, -HALF + 0.5, hole - hw / 2, v, v + 2.6, ctx.y); spikes(ctx, hole + hw / 2, HALF - 0.5, v, v + 2.6, ctx.y);
        boltLine(ctx, hole, v - 3, 3, 3, ctx.y);
      }
    }
  },

  dronesRun(ctx) {
    const { r, tier } = ctx; const len = 54;
    road(ctx, len);
    const n = 2 + Math.min(3, Math.floor(tier / 1.2));
    for (let i = 0; i < n; i++) { const v = -len + 14 + i * ((len - 20) / n); drone(ctx, -HALF + 3, v, HALF - 3, v + r.range(-6, 6), ctx.y + 1.3, 5 + tier * 1.4 + r.range(0, 3), r.range(0, 6.28)); }
    boltLine(ctx, r.range(-5, 5), -len + 10, 6, 5, ctx.y);
  },

  lasersRun(ctx) {
    const { r, tier } = ctx; const len = 54;
    road(ctx, len);
    const n = 2 + Math.min(3, Math.floor(tier / 1.3));
    for (let i = 0; i < n; i++) {
      const v = -len + 12 + i * ((len - 16) / n);
      if (r.chance(0.65)) laser(ctx, -HALF, HALF, v, ctx.y + 1.0, false, 2.6 - Math.min(1, tier * 0.12), 0.6, r.range(0, 1));
      else { const g = r.range(-HALF + 5, HALF - 5), gw = Math.max(4, 7.5 - tier * 0.4); laser(ctx, -HALF, g - gw / 2, v, ctx.y + 1.0, true, 99, 1, 0); laser(ctx, g + gw / 2, HALF, v, ctx.y + 1.0, true, 99, 1, 0); }
    }
  },

  hurdlesRun(ctx) {
    const { r, tier } = ctx; const len = 54;
    road(ctx, len);
    const n = 3 + Math.min(3, Math.floor(tier / 1.2));
    for (let i = 0; i < n; i++) { const v = -len + 12 + i * ((len - 16) / n), w = r.range(5, 9), u = r.range(-HALF + w / 2 + 1, HALF - w / 2 - 1); solid(ctx, u - w / 2, u + w / 2, v, v + 1.6, ctx.y, 1.5 + Math.min(1, tier * 0.1), 'hurdle'); }
  },

  bridges(ctx) {
    const { r, tier } = ctx;
    road(ctx, 20);
    const len = 46 + tier * 5, n = tier > 2 ? 2 : 3, bw = Math.max(2.4, 4.4 - tier * 0.25);
    const us = n === 2 ? [-5, 5] : [-7, 0, 7];
    for (const u of us) rect(ctx, u - bw / 2, u + bw / 2, -1, len + 1, ctx.y, { kind: 'bridge' });
    boltLine(ctx, r.pick(us), 6, 6, (len - 12) / 5, ctx.y);
    if (tier > 1.5) drone(ctx, -7, len * 0.55, 7, len * 0.55, ctx.y + 1.3, 4 + tier, 0);
    advance(ctx, len);
    road(ctx, 22);
  },

  weave(ctx) {
    const { r, tier } = ctx;
    road(ctx, 16);
    const seg = 16, n = 4; let side = r.sign();
    for (let i = 0; i < n; i++) { const hw = Math.max(4, 7 - tier * 0.4), cu = side * (HALF - hw); rect(ctx, cu - hw, cu + hw, i * seg - 1, (i + 1) * seg + 1, ctx.y, { kind: 'platform' }); boltLine(ctx, cu, i * seg + 3, 3, 3, ctx.y); side = -side; }
    advance(ctx, seg * n);
    road(ctx, 18);
  },

  fork(ctx) {
    const { r, tier } = ctx;
    road(ctx, 14);
    const len = 56 + tier * 4, lane = 7, fast = r.sign();
    for (const side of [-1, 1]) {
      const cu = side * (HALF + 2 - lane / 2 + 2);
      rect(ctx, cu - lane / 2, cu + lane / 2, -1, len + 1, ctx.y, { kind: 'platform' });
      if (side === fast) { boost(ctx, cu, 12, ctx.y); boltLine(ctx, cu, 18, 8, (len - 24) / 7, ctx.y); spikes(ctx, cu - lane / 2 + 0.3, cu + lane / 2 - 0.3, len * 0.6, len * 0.6 + 2.2, ctx.y); }
      else { drone(ctx, cu - lane / 2 + 1.2, len * 0.4, cu + lane / 2 - 1.2, len * 0.4, ctx.y + 1.3, 4 + tier, 0); boltLine(ctx, cu, 24, 3, 4, ctx.y); }
    }
    rail(ctx, 0, -3, ctx.y + 0.3, 0, len + 3, ctx.y + 0.3);
    advance(ctx, len);
    road(ctx, 20);
  },

  highLow(ctx) {
    const { r, tier } = ctx; const side = r.sign(), len = 90, hi = 9;
    road(ctx, 12);
    const start = { ...ctx };
    road(ctx, len, HALF, { walls: false });
    for (let i = 0; i < 3; i++) { const v = 20 + i * 22; if (r.chance(0.5)) laser(start, -HALF, HALF, v, ctx.y + 1.0, false, 2.4, 0.6, r.range(0, 1)); else drone(start, -HALF + 3, v, HALF - 3, v, ctx.y + 1.3, 6 + tier, r.range(0, 6)); }
    pad(start, side * (HALF - 3), 6, ctx.y, 30);
    const hu0 = side > 0 ? 4 : -(HALF + 9), hu1 = side > 0 ? HALF + 9 : -4, hcu = (hu0 + hu1) / 2;
    rect(start, hu0, hu1, 22, 66, ctx.y + hi, { kind: 'platform', bottom: ctx.y + hi - 1.5 });
    boltLine(start, hcu, 26, 9, 4, ctx.y + hi);
    boost(start, hcu, 32, ctx.y + hi);
    rail(start, hcu, 66, ctx.y + hi + 0.3, side * 4, len + 6, ctx.y + 1.2);
    ring(start, hcu, 50, ctx.y + hi + 4, 5);
    road(ctx, 14);
  },

  wideField(ctx) {
    const { r, tier } = ctx; const len = 80, hw = 24;
    const start = { ...ctx };
    rect(ctx, -hw, hw, -4, len + 4, ctx.y); segment(ctx, len, hw, 'plaza'); advance(ctx, len);
    const n = 6 + Math.min(6, Math.floor(tier * 1.5));
    for (let i = 0; i < n; i++) { const u = r.range(-hw + 3, hw - 3), v = 12 + r.range(0, len - 24); solid(start, u - 1.3, u + 1.3, v, v + 2.6, ctx.y, 5, 'pillar'); }
    for (let i = 0; i < 3; i++) { const u = r.range(-hw + 4, hw - 4), v = 8 + i * 24; boost(start, u, v, ctx.y); boltLine(start, u, v + 7, 5, 3.5, ctx.y); }
    const pu = r.range(-hw + 6, hw - 6);
    pad(start, pu, len * 0.45, ctx.y, 26); ring(start, pu, len * 0.45 + 24, ctx.y + 9, 4);
    boltLine(start, pu, len * 0.45 + 6, 6, 3.5, ctx.y, (t) => ctx.y + 3 + Math.sin(t * Math.PI) * 6);
    road(ctx, 16);
  },

  railRun(ctx) {
    const { r, tier } = ctx;
    road(ctx, 18);
    const len = 60 + tier * 6, us = [-6, 0, 6].sort(() => r.next() - 0.5);
    rail(ctx, us[0], -4, ctx.y + 0.3, us[0], len + 2, ctx.y + 0.3);
    rail(ctx, us[1], -4, ctx.y + 0.3, us[1] * 0.5, len * 0.6, ctx.y + 6);
    rail(ctx, us[2], len * 0.3, ctx.y + 5, us[2], len + 2, ctx.y + 1.5);
    boltLine(ctx, us[1], 8, 6, (len * 0.5) / 5, ctx.y, (t) => ctx.y + 1.6 + t * 5.7);
    ring(ctx, us[1] * 0.5, len * 0.72, ctx.y + 9, 5);
    advance(ctx, len);
    road(ctx, 22);
  },

  zipRun(ctx) {
    const { r, tier, L } = ctx;
    road(ctx, 16, HALF, { tail: 0 });
    const rise = 6, rlen = rise / 0.42;
    rampPiece(ctx, rlen, rise);
    const deckY = ctx.y;
    road(ctx, 16, HALF, { kind: 'platform' });
    const len = 80 + tier * 6, zu = r.range(-4, 4), side = -Math.sign(zu || 1);
    zip(ctx, zu, -6, deckY + 2.6, zu * 0.3, len - 4, L.baseY + 3.2);
    boltLine(ctx, zu, 10, 8, (len - 24) / 7, deckY, (t) => deckY + 0.4 - t * (deckY - L.baseY));
    const bu = side * (HALF - 2.5);
    rect(ctx, bu - 2, bu + 2, -1, len + 1, deckY, { kind: 'bridge' });
    spikes(ctx, bu - 1.8, bu + 1.8, len * 0.5, len * 0.5 + 2, deckY);
    rect(ctx, bu - 2, bu + 2, len - 1, len + 6, deckY, { kind: 'bridge' });
    advance(ctx, len); ctx.y = L.baseY;
    road(ctx, 24);
  },

  bounceTower(ctx) {
    const { r } = ctx; const hi = 14;
    road(ctx, 20);
    pad(ctx, 0, -8, ctx.y, 36);
    rect(ctx, -6, 6, 6, 30, ctx.y + hi, { kind: 'platform', bottom: ctx.y + hi - 2 });
    boltLine(ctx, 0, 8, 6, 3.5, ctx.y + hi);
    ring(ctx, 0, 40, ctx.y + hi + 2, 7); ring(ctx, 0, 52, ctx.y + hi + 1, 4);
    const bu = r.sign() * (HALF - 2.5);
    rect(ctx, bu - 2, bu + 2, -1, 61, ctx.y, { kind: 'bridge' });
    advance(ctx, 60);
    road(ctx, 26);
  },

  dashRings(ctx) {
    const { r, tier } = ctx;
    road(ctx, 22);
    const len = 70 + tier * 6; let u = 0;
    for (let i = 0; i < 4; i++) { u = Math.max(-8, Math.min(8, u + r.range(-5, 5))); ring(ctx, u, 4 + i * ((len - 8) / 3.6), ctx.y + 4 + (i % 2) * 2.5, 7); }
    advance(ctx, len);
    road(ctx, 24);
  },

  // optional side loop: a branch leaves the road, climbs, and a ring drops you back on it ahead
  sideLoop(ctx) {
    const { r } = ctx; const side = r.sign(), len = 70;
    road(ctx, len, HALF, { walls: false });
    const start = { ...ctx }; advance(start, -len);
    const bu = side * (HALF + 12);
    rect(start, side > 0 ? HALF - 2 : bu - 4, side > 0 ? bu + 4 : -HALF + 2, 8, 16, ctx.y, { kind: 'platform' });
    rect(start, bu - 5, bu + 5, 8, 56, ctx.y + 4, { kind: 'platform', bottom: ctx.y + 2.5 });
    rect(start, bu - 5, bu + 5, 8, 20, ctx.y, { kind: 'platform' });
    pad(start, bu, 12, ctx.y, 18);
    boltLine(start, bu, 22, 8, 4, ctx.y + 4);
    boost(start, bu, 30, ctx.y + 4);
    ring(start, bu * 0.5, 66, ctx.y + 9, 6);
    // the ring fires along the road direction, back toward the centre line
    const rg = ctx.L.rings[ctx.L.rings.length - 1]; const f = F(start); const toC = [-side * f.rx * 0.35 + f.fx, -side * f.rz * 0.35 + f.fz]; const n = Math.hypot(toC[0], toC[1]); rg.dx = toC[0] / n; rg.dz = toC[1] / n;
  },
};

function checkpoint(ctx) {
  road(ctx, 30);
  const [x, z] = P(ctx, 0, -15);
  ctx.L.checkpoints.push({ x, z, y: ctx.y, ang: ctx.a, hw: HALF });
}

export function generateLevel(index) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const L = buildLevel(index, attempt);
    if (!selfIntersects(L)) return L;
  }
  return buildLevel(index, 0);
}
function selfIntersects(L) {
  const S = L.segments;
  for (let i = 0; i < S.length; i++) for (let j = i + 4; j < S.length; j++) {
    const a = S[i], b = S[j];
    if (Math.hypot(a.cx - b.cx, a.cz - b.cz) > a.hl + b.hl + a.hw + b.hw + 8) continue;
    // sample points along b's centreline against a (with margin)
    for (let t = -1; t <= 1; t += 0.25) {
      const x = b.cx + b.fx * b.hl * t, z = b.cz + b.fz * b.hl * t;
      const u = (x - a.cx) * a.rx + (z - a.cz) * a.rz, v = (x - a.cx) * a.fx + (z - a.cz) * a.fz;
      if (Math.abs(u) < a.hw + b.hw + 6 && Math.abs(v) < a.hl + 6) return true;
    }
  }
  return false;
}
function buildLevel(index, attempt) {
  const r = makeRng(1337 + index * 7919 + attempt * 101);
  const L = new LevelData(index);
  const ctx = { L, r, x: 0, z: 0, a: 0, y: 0, tier: 0, level: index };
  L.start = { x: 0, z: 0, y: 0, ang: 0 };

  road(ctx, 60, 16);
  boltLine(ctx, 0, -32, 6, 4, 0);
  boost(ctx, 0, -20, 0);

  const sections = 6;
  for (let sec = 0; sec < sections; sec++) {
    ctx.tier = sec * 0.9 + index * 0.8;
    const t = ctx.tier;
    const pool = [];
    const add = (name, w) => { for (let i = 0; i < w; i++) pool.push(name); };
    add('run', 1); add('curve', 4); add('hill', 3); add('plaza', 4); add('gap', 2); add('rampPlatform', 2); add('spikesRun', 2); add('dronesRun', 2); add('hurdlesRun', 1); add('weave', 1);
    add('fork', 3); add('highLow', 3); add('wideField', 2); add('railRun', 3); add('dashRings', 2); add('sideLoop', 3);
    if (t >= 1) { add('bridges', 1); add('lasersRun', 2); add('zipRun', 3); add('bounceTower', 2); }
    if (t >= 1.8) add('bigRampJump', 3);
    const count = 5 + Math.min(2, Math.floor(sec / 2));
    let last = '', turned = false;
    for (let i = 0; i < count; i++) {
      let name = r.pick(pool), guard = 0;
      while ((name === last || (name === 'run' && i === 0)) && guard++ < 10) name = r.pick(pool);
      if (i === count - 1 && !turned) name = r.pick(['plaza', 'curve']);
      if (ctx.y > L.baseY + 9) { ctx.y = L.baseY; road(ctx, 10); }
      CHUNKS[name](ctx);
      if (name === 'plaza' || name === 'curve') turned = true;
      last = name;
    }
    if (ctx.y > L.baseY + 0.5) { const drop = ctx.y - L.baseY; rampPiece(ctx, drop / 0.4, -drop, ctx.afterRamp ? 0 : 4); ctx.y = L.baseY; }
    if (sec < sections - 1) checkpoint(ctx);
  }
  road(ctx, 40);
  const [fx, fz] = P(ctx, 0, -20);
  L.finish = { x: fx, z: fz, y: ctx.y, ang: ctx.a, hw: HALF };
  road(ctx, 40, 18);
  return L;
}
