import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorGeo, merged, placeBox, instanced } from './themes.js';
import * as T from './textures.js';
import { CORRIDOR_HALF as W } from './level.js';

// Extruded profile of a block: shape in (s, y), extruded along x.
function blockGeometry(b, tile, color) {
  if (b.kind === 'ramp') tile = Math.min(tile, 3);
  const top0 = b.y0, top1 = b.y0 + b.slope * (b.s1 - b.s0);
  const shape = new THREE.Shape();
  shape.moveTo(b.s0, b.bottom); shape.lineTo(b.s1, b.bottom); shape.lineTo(b.s1, top1); shape.lineTo(b.s0, top0); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.x1 - b.x0, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(Math.PI / 2);          // local z (depth) -> world x ; local x (s) -> world -z
  g.translate(b.x0, 0, 0);
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i++) uv[i] /= tile;
  return colorGeo(g, color);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const clamp01 = (t) => Math.max(0, Math.min(1, t));
export function railX(r, s) { return r.x0 + (r.x1 - r.x0) * clamp01((s - r.s0) / (r.s1 - r.s0)); }
export function railY(r, s) { return r.y0 + (r.y1 - r.y0) * clamp01((s - r.s0) / (r.s1 - r.s0)); }
export function zipY(z, s) { return z.y0 + (z.y1 - z.y0) * clamp01((s - z.s0) / (z.s1 - z.s0)); }
// Unit cylinder along +Y (0..1) stretched between two world points.
function bar(radius, mat, ax, ay, az, bx, by, bz, segs = 8) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, segs); g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  _a.set(ax, ay, az); _b.set(bx, by, bz); _d.subVectors(_b, _a); const l = _d.length(); _d.normalize();
  m.position.copy(_a); m.scale.set(1, l, 1); m.quaternion.setFromUnitVectors(UP, _d);
  return m;
}

export class World {
  constructor(L, theme, scene, r, q) {
    this.L = L; this.scene = scene; this.theme = theme;
    this.group = new THREE.Group(); scene.add(this.group);
    const M = theme.materials(); this.M = M;

    // ---- track blocks, merged per kind ----
    const byKind = {};
    for (const b of L.blocks) {
      const kind = b.kind in M ? b.kind : 'floor';
      const shade = 0.82 + r.range(0, 0.18);
      const col = new THREE.Color(shade, shade, shade);
      (byKind[kind] ||= []).push(blockGeometry(b, M.tile, col));
    }
    for (const k in byKind) { const m = merged(byKind[k], M[k]); m.receiveShadow = true; this.group.add(m); }
    // floating platforms get support columns down to whatever is below
    const sup = [];
    for (const b of L.blocks) {
      if (b.kind === 'bridge' || b.bottom <= L.baseY - 7) continue;
      for (let s = b.s0 + 4; s < b.s1 - 2; s += 12) for (const x of [b.x0 + 0.8, b.x1 - 0.8]) {
        const f = L.floorAt(x, s, b.bottom - 0.1); const yb = f ? f.y : L.baseY - 9;
        sup.push(placeBox(0.9, b.bottom - yb, 0.9, x, (b.bottom + yb) / 2, -s, 0x3a3f45));
        sup.push(placeBox(1.6, 0.4, 1.6, x, b.bottom - 0.2, -s, 0x2a2f36));
      }
    }
    if (sup.length) this.group.add(merged(sup, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.6, vertexColors: true })));

    // ---- hazards ----
    this.spikesMesh = this.buildSpikes(L.hazards.filter((h) => h.type === 'spikes'));
    this.hurdlesMesh = this.buildHurdles(L.hazards.filter((h) => h.type === 'hurdle'));
    this.lasers = this.buildLasers(L.hazards.filter((h) => h.type === 'laser'));
    this.drones = this.buildDrones(L.hazards.filter((h) => h.type === 'drone'));
    this.boosts = this.buildBoosts(L.boosts);
    this.bolts = this.buildBolts(L.bolts);
    this.pillarsMesh = this.buildPillars(L.hazards.filter((h) => h.type === 'pillar'));
    this.buildRails(L.rails);
    this.buildZips(L.zips);
    this.pads = this.buildPads(L.pads);
    this.rings = this.buildRings(L.rings);
    this.gates = this.buildGates(L.checkpoints, L.finishS, L);
    this.t = 0;
  }

  buildSpikes(list) {
    const geos = [];
    for (const h of list) {
      const base = new THREE.BoxGeometry(h.x1 - h.x0, 0.25, h.s1 - h.s0); base.translate((h.x0 + h.x1) / 2, h.y + 0.12, -(h.s0 + h.s1) / 2); geos.push(colorGeo(base, 0x444444));
      const rows = Math.max(1, Math.round((h.s1 - h.s0) / 0.9));
      for (let x = h.x0 + 0.45; x < h.x1 - 0.2; x += 0.85) for (let rI = 0; rI < rows; rI++) {
        const c = new THREE.ConeGeometry(0.32, 1.0, 5); c.translate(x, h.y + 0.72, -(h.s0 + 0.45 + rI * 0.9)); geos.push(colorGeo(c, 0xffffff));
      }
      h.mesh = true;
    }
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ color: this.M.spike.color, emissive: this.M.spike.emissive, emissiveIntensity: this.M.spike.emissiveIntensity, roughness: 0.45, metalness: 0.5, vertexColors: true }));
    m.castShadow = false; this.group.add(m); return m;
  }

  buildHurdles(list) {
    const geos = [];
    for (const h of list) {
      const g = new THREE.BoxGeometry(h.x1 - h.x0, h.h, h.s1 - h.s0); g.translate((h.x0 + h.x1) / 2, h.y + h.h / 2, -(h.s0 + h.s1) / 2); geos.push(g);
      const top = new THREE.BoxGeometry(h.x1 - h.x0 + 0.2, 0.15, h.s1 - h.s0 + 0.2); top.translate((h.x0 + h.x1) / 2, h.y + h.h + 0.07, -(h.s0 + h.s1) / 2); geos.push(top);
    }
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos, false), this.M.hurdle); m.castShadow = true; this.group.add(m); return m;
  }

  buildLasers(list) {
    const posts = [];
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const beams = [];
    for (const h of list) {
      const hgt = h.tall ? 3.2 : 0.3;
      for (const x of [h.x0, h.x1]) if (Math.abs(x) < W + 0.01) posts.push(placeBox(0.35, 1.6 + (h.tall ? 2.6 : 0), 0.35, x, h.y - 0.6 + (0.8 + (h.tall ? 1.3 : 0)), -h.s, 0x222a33));
      const beam = new THREE.Mesh(new THREE.BoxGeometry(h.x1 - h.x0, hgt, 0.18), beamMat);
      beam.position.set((h.x0 + h.x1) / 2, h.y + (h.tall ? 1.3 : 0), -h.s);
      h.beam = beam; h.on = true; beams.push(h); this.group.add(beam);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(h.x1 - h.x0, hgt + 0.5, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.add(glow);
    }
    if (posts.length) this.group.add(merged(posts, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.7, vertexColors: true })));
    return beams;
  }

  buildDrones(list) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.4, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3b5c, emissiveIntensity: 2.5 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.9 });
    const bodyGeo = new THREE.SphereGeometry(0.7, 12, 10), eyeGeo = new THREE.SphereGeometry(0.24, 8, 8), ringGeo = new THREE.TorusGeometry(1.0, 0.09, 6, 24), finGeo = new THREE.BoxGeometry(0.1, 0.5, 0.9);
    const out = [];
    for (const h of list) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat); body.scale.set(1, 0.75, 1); g.add(body);
      const eye = new THREE.Mesh(eyeGeo, accentMat); eye.position.set(0, 0, 0.6); g.add(eye);
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; g.add(ring);
      for (const sx of [-1, 1]) { const fin = new THREE.Mesh(finGeo, bodyMat); fin.position.set(sx * 0.85, 0.1, -0.3); g.add(fin); }
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), accentMat); light.position.set(0, 0.55, 0); g.add(light);
      g.position.set(h.x, h.y, -h.s); g.castShadow = true;
      h.group = g; h.ring = ring; h.hit = 0; h.px = h.x;
      this.group.add(g); out.push(h);
    }
    return out;
  }

  buildBoosts(list) {
    const tex = T.texChevron();
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1a1a, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.5, roughness: 0.4, metalness: 0.5 });
    const out = [];
    for (const b of list) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, 0.22, b.s1 - b.s0), mat);
      m.position.set((b.x0 + b.x1) / 2, b.y + 0.1, -(b.s0 + b.s1) / 2);
      b.mesh = m; b.cool = 0; this.group.add(m); out.push(b);
    }
    this.boostMat = mat; this.boostTex = tex;
    return out;
  }

  buildBolts(list) {
    const nut = new THREE.CylinderGeometry(0.55, 0.55, 0.28, 6); nut.rotateX(Math.PI / 2);
    const hole = new THREE.TorusGeometry(0.3, 0.1, 6, 12);
    const geo = mergeGeometries([colorGeo(nut, 0xffc83a), colorGeo(hole, 0xffe7a8)], false);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.8, vertexColors: true });
    const items = list.map((b) => ({ x: b.x, y: b.y, z: -b.s, s: 1 }));
    const im = instanced(geo, mat, items);
    im.frustumCulled = false; this.group.add(im);
    list.forEach((b, i) => { b.i = i; b.taken = false; });
    this.boltMesh = im;
    return list;
  }

  buildPillars(list) {
    const geos = [];
    for (const h of list) {
      const g = new THREE.BoxGeometry(h.x1 - h.x0, h.h, h.s1 - h.s0); g.translate((h.x0 + h.x1) / 2, h.y + h.h / 2, -(h.s0 + h.s1) / 2); geos.push(g);
      const cap = new THREE.BoxGeometry(h.x1 - h.x0 + 0.4, 0.3, h.s1 - h.s0 + 0.4); cap.translate((h.x0 + h.x1) / 2, h.y + h.h + 0.15, -(h.s0 + h.s1) / 2); geos.push(cap);
    }
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos, false), this.M.pillar || this.M.gate); m.castShadow = true; this.group.add(m); return m;
  }

  buildRails(list) {
    const accent = new THREE.Color(this.theme.accent);
    this.railMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, emissive: accent, emissiveIntensity: this.theme.id === 'cyber' ? 1.2 : 0.25, roughness: 0.3, metalness: 0.9 });
    const supMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.7 });
    const sup = [];
    for (const r of list) {
      const m = bar(0.16, this.railMat, r.x0, r.y0, -r.s0, r.x1, r.y1, -r.s1); m.castShadow = true; this.group.add(m);
      const m2 = bar(0.07, this.railMat, r.x0 - 0.35, r.y0 - 0.25, -r.s0, r.x1 - 0.35, r.y1 - 0.25, -r.s1, 6); this.group.add(m2);
      const m3 = bar(0.07, this.railMat, r.x0 + 0.35, r.y0 - 0.25, -r.s0, r.x1 + 0.35, r.y1 - 0.25, -r.s1, 6); this.group.add(m3);
      for (let s = r.s0 + 3; s < r.s1; s += 7) {
        const x = railX(r, s), y = railY(r, s);
        const f = this.L.floorAt(x, s, y - 0.5); const yb = f ? f.y : y - 7;
        sup.push(placeBox(0.22, Math.max(0.5, y - yb), 0.22, x, (y + yb) / 2 - 0.1, -s, 0x2a2f36));
      }
    }
    if (sup.length) this.group.add(merged(sup, supMat));
  }

  buildZips(list) {
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x8a94a0, roughness: 0.4, metalness: 0.9 });
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.6 });
    const trolleyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(this.theme.accent), emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.8 });
    const pyl = [];
    for (const z of list) {
      this.group.add(bar(0.1, cableMat, z.x0, z.y0, -z.s0, z.x1, z.y1, -z.s1, 6));
      for (const [x, y, s] of [[z.x0, z.y0, z.s0], [z.x1, z.y1, z.s1]]) {
        const f = this.L.floorAt(x, s, y - 0.5); const yb = f ? f.y : y - 9;
        pyl.push(placeBox(0.5, y - yb + 1, 0.5, x, (y + yb + 1) / 2, -s, 0x3a3f45));
        pyl.push(placeBox(2.4, 0.3, 0.5, x, y + 0.9, -s, 0xe8c547));
      }
      const tr = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 14), trolleyMat); wheel.rotation.y = Math.PI / 2; wheel.position.y = 0.2; tr.add(wheel);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.7), trolleyMat); body.position.y = -0.35; tr.add(body);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), trolleyMat); handle.position.y = -0.95; tr.add(handle);
      for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), trolleyMat); st.position.set(sx * 0.6, -0.72, 0); tr.add(st); }
      tr.position.set(z.x0, z.y0, -z.s0); this.group.add(tr); z.trolley = tr;
    }
    if (pyl.length) this.group.add(merged(pyl, pylonMat));
  }
  moveTrolley(z, s) { const t = clamp01((s - z.s0) / (z.s1 - z.s0)); z.trolley.position.set(z.x0 + (z.x1 - z.x0) * t, zipY(z, s) + 0.15, -s); }
  parkTrolley(z) { z.parkT = 1.5; }

  buildPads(list) {
    const accent = new THREE.Color(this.theme.accent);
    const base = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.5, metalness: 0.7 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: accent, emissiveIntensity: 0.9, roughness: 0.3 });
    const out = [];
    for (const pad of list) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.5, 24), base); b.position.y = 0.25; g.add(b);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 24), topMat); t.position.y = 0.6; g.add(t);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 6, 32), topMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.52; g.add(ring);
      for (let k = 0; k < 4; k++) { const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 6), base); spring.position.set(Math.cos(k * 1.57) * 1.0, 0.45, Math.sin(k * 1.57) * 1.0); g.add(spring); }
      g.position.set(pad.x, pad.y, -pad.s); this.group.add(g); pad.group = g; pad.top = t; pad.anim = 0; out.push(pad);
    }
    return out;
  }

  buildRings(list) {
    const accent = new THREE.Color(this.theme.accent);
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: accent, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.5 });
    const out = [];
    const geo = new THREE.TorusGeometry(2.3, 0.2, 10, 40);
    for (const ring of list) {
      const m = new THREE.Mesh(geo, this.ringMat.clone()); m.position.set(ring.x, ring.y, -ring.s); this.group.add(m);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.06, 6, 28), m.material); m.add(inner);
      ring.mesh = m; ring.flash = 0; out.push(ring);
    }
    return out;
  }

  buildGates(cps, finishS, L) {
    const out = [];
    const accent = new THREE.Color(this.theme.accent);
    const dimMat = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x335566, emissiveIntensity: 0.8, roughness: 0.3 });
    const litMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: accent, emissiveIntensity: 2.4, roughness: 0.3 });
    const make = (s, y, big, label) => {
      const g = new THREE.Group();
      const h = big ? 9 : 6.5, w = W * 2 + 1;
      for (const x of [-W - 0.2, W + 0.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9), this.M.gate); p.position.set(x, y + h / 2, 0); p.castShadow = true; g.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.9, 1.1), this.M.gate); beam.position.set(0, y + h, 0); g.add(beam);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.25, 0.3), dimMat); glow.position.set(0, y + h - 0.6, 0); g.add(glow);
      const sides = [];
      for (const x of [-W - 0.2, W + 0.2]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.25, h - 1, 0.3), dimMat); st.position.set(x * 0.985, y + h / 2, 0.5); g.add(st); sides.push(st); }
      if (big) {
        const banner = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 2.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: accent, emissiveIntensity: 1.5 }));
        banner.position.set(0, y + h + 1.6, 0); g.add(banner);
      }
      g.position.set(0, 0, -s); this.group.add(g);
      return { group: g, glow, sides, lit: false, s, y, light() { this.lit = true; this.glow.material = litMat; this.sides.forEach((x) => (x.material = litMat)); } };
    };
    cps.forEach((cp, i) => { cp.gate = make(cp.s, cp.y, false); cp.passed = false; out.push(cp.gate); });
    const fy = L.floorAt(0, finishS, 50)?.y ?? 0;
    this.finishGate = make(finishS, fy, true);
    return out;
  }

  update(dt, playerS, camZ) {
    this.t += dt;
    const t = this.t;
    // lasers
    for (const h of this.lasers) {
      if (Math.abs(-h.s - camZ) > 200) continue;
      const phase = ((t / h.period) + h.phase) % 1;
      h.on = phase < h.duty;
      h.beam.visible = h.on;
      h.beam.material.opacity = 0.6 + 0.3 * Math.sin(t * 30 + h.s);
    }
    // drones
    for (const h of this.drones) {
      if (Math.abs(-h.s - camZ) > 200) continue;
      if (h.hit > 0) {
        h.hit -= dt;
        h.group.rotation.x += dt * 9; h.group.rotation.z += dt * 6; h.group.position.y -= dt * 4;
        if (h.hit <= 0) { h.group.rotation.set(0, 0, 0); h.group.position.y = h.y; }
        continue;
      }
      const ph = t * (h.speed / h.range) + h.phase;
      h.px = Math.sin(ph) * h.range * h.dir;
      h.group.position.x = h.px;
      h.group.position.y = h.y + Math.sin(t * 3 + h.phase) * 0.25;
      h.group.rotation.y = Math.cos(ph) * 0.5 * h.dir;
      h.group.rotation.z = -Math.cos(ph) * 0.35;
      h.ring.rotation.z = t * 4;
    }
    // bolts spin
    const bm = this.boltMesh;
    if (bm) {
      let dirty = false;
      for (const b of this.bolts) {
        if (b.taken || Math.abs(-b.s - camZ) > 90) continue;
        _e.set(0, t * 3 + b.s, 0); _q.setFromEuler(_e); _p.set(b.x, b.y + Math.sin(t * 2 + b.s) * 0.15, -b.s); _s.setScalar(1);
        _m.compose(_p, _q, _s); bm.setMatrixAt(b.i, _m); dirty = true;
      }
      if (dirty) bm.instanceMatrix.needsUpdate = true;
    }
    for (const pad of this.pads) {
      if (pad.anim > 0) { pad.anim = Math.max(0, pad.anim - dt * 3); const sq = Math.sin(pad.anim * Math.PI); pad.group.scale.set(1 + sq * 0.25, 1 - sq * 0.5, 1 + sq * 0.25); }
      if (Math.abs(-pad.s - camZ) < 160) pad.top.material.emissiveIntensity = 0.8 + Math.sin(t * 5 + pad.s) * 0.4;
    }
    for (const ring of this.rings) {
      if (Math.abs(-ring.s - camZ) > 220) continue;
      ring.mesh.rotation.z = t * 1.2 + ring.s; ring.mesh.rotation.y = Math.sin(t * 0.8 + ring.s) * 0.25;
      if (ring.flash > 0) { ring.flash = Math.max(0, ring.flash - dt * 3); const f = Math.sin(ring.flash * Math.PI); ring.mesh.scale.setScalar(1 + f * 0.5); ring.mesh.material.emissiveIntensity = 1.6 + f * 4; }
    }
    for (const z of this.L.zips) {
      if (z.parkT > 0) { z.parkT -= dt; if (z.parkT <= 0) z.trolley.position.set(z.x0, z.y0 + 0.15, -z.s0); }
    }
    // boost chevrons scroll
    if (this.boostTex) this.boostTex.offset.y = -t * 1.5;
    if (this.boostMat) this.boostMat.emissiveIntensity = 2 + Math.sin(t * 6) * 0.8;
  }

  takeBolt(b) {
    b.taken = true;
    _m.makeScale(0, 0, 0); this.boltMesh.setMatrixAt(b.i, _m); this.boltMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
