import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorGeo, merged, placeBox, instanced } from './themes.js';
import * as T from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// rails / zips as 3D segments A->B
export function segLen(r) { return Math.hypot(r.bx - r.ax, r.by - r.ay, r.bz - r.az); }
export function segPoint(r, t) { return [r.ax + (r.bx - r.ax) * t, r.ay + (r.by - r.ay) * t, r.az + (r.bz - r.az) * t]; }
// closest parameter on the 2D (ground) projection of the segment
export function segParam(r, x, z) { const dx = r.bx - r.ax, dz = r.bz - r.az; const l2 = dx * dx + dz * dz || 1; return clamp01(((x - r.ax) * dx + (z - r.az) * dz) / l2); }

// Place a geometry built in a local frame (u -> +x, v -> -z) into the world at (cx, cz) with heading ang.
export function toWorld(geo, cx, cz, ang) { geo.rotateY(-ang); geo.translate(cx, 0, cz); return geo; }

// Extruded profile of a floor block: shape in (v, y), extruded along u, then placed.
function blockGeometry(b, tile, color) {
  if (b.kind === 'ramp') tile = Math.min(tile, 3);
  const top0 = b.y0, top1 = b.y0 + b.slope * b.hl * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-b.hl, b.bottom); shape.lineTo(b.hl, b.bottom); shape.lineTo(b.hl, top1); shape.lineTo(-b.hl, top0); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.hw * 2, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(Math.PI / 2);   // shape x (v) -> world -z, depth -> +x
  g.translate(-b.hw, 0, 0);
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i++) uv[i] /= tile;
  toWorld(g, b.cx, b.cz, b.ang);
  return colorGeo(g, color);
}
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

    const byKind = {};
    for (const b of L.blocks) {
      const kind = b.kind in M ? b.kind : 'floor';
      const shade = 0.82 + r.range(0, 0.18);
      (byKind[kind] ||= []).push(blockGeometry(b, M.tile, new THREE.Color(shade, shade, shade)));
    }
    for (const k in byKind) { const m = merged(byKind[k], M[k]); m.receiveShadow = true; this.group.add(m); }
    // supports under floating platforms
    const sup = [];
    for (const b of L.blocks) {
      if (b.kind === 'bridge' || b.bottom <= L.baseY - 7) continue;
      for (let v = -b.hl + 4; v < b.hl - 2; v += 12) for (const u of [-b.hw + 0.8, b.hw - 0.8]) {
        const x = b.cx + b.rx * u + b.fx * v, z = b.cz + b.rz * u + b.fz * v;
        const f = L.floorAt(x, z, b.bottom - 0.1); const yb = f ? f.y : L.baseY - 9;
        sup.push(placeBox(0.9, b.bottom - yb, 0.9, x, (b.bottom + yb) / 2, z, 0x3a3f45));
        sup.push(placeBox(1.6, 0.4, 1.6, x, b.bottom - 0.2, z, 0x2a2f36));
      }
    }
    if (sup.length) this.group.add(merged(sup, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.6, vertexColors: true })));

    this.buildSpikes(L.spikes);
    this.buildSolids(L.solids);
    this.lasers = this.buildLasers(L.lasers);
    this.drones = this.buildDrones(L.drones);
    this.boosts = this.buildBoosts(L.boosts);
    this.bolts = this.buildBolts(L.bolts);
    this.buildRails(L.rails);
    this.buildZips(L.zips);
    this.pads = this.buildPads(L.pads);
    this.rings = this.buildRings(L.rings);
    this.gates = this.buildGates(L);
    this.t = 0;
  }

  buildSpikes(list) {
    const geos = [];
    for (const h of list) {
      const base = new THREE.BoxGeometry(h.hw * 2, 0.25, h.hl * 2); base.translate(0, h.y + 0.12, 0); geos.push(colorGeo(toWorld(base, h.cx, h.cz, h.ang), 0x444444));
      const rows = Math.max(1, Math.round((h.hl * 2) / 0.9));
      for (let u = -h.hw + 0.45; u < h.hw - 0.2; u += 0.85) for (let k = 0; k < rows; k++) {
        const c = new THREE.ConeGeometry(0.32, 1.0, 5); c.translate(u, h.y + 0.72, -(-h.hl + 0.45 + k * 0.9)); geos.push(colorGeo(toWorld(c, h.cx, h.cz, h.ang), 0xffffff));
      }
    }
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ color: this.M.spike.color, emissive: this.M.spike.emissive, emissiveIntensity: this.M.spike.emissiveIntensity, roughness: 0.45, metalness: 0.5, vertexColors: true }));
    this.group.add(m);
  }

  buildSolids(list) {
    const groups = { pillar: [], crate: [], hurdle: [], wall: [] };
    for (const s of list) {
      if (s.kind === 'wall') {
        const g = new THREE.BoxGeometry(s.hw * 2 + 0.6, 0.7, s.hl * 2 + 0.2); g.translate(0, s.y + 0.35, 0); groups.wall.push(colorGeo(toWorld(g, s.cx, s.cz, s.ang), 0xffffff)); continue;
      }
      const g = new THREE.BoxGeometry(s.hw * 2, s.h, s.hl * 2); g.translate(0, s.y + s.h / 2, 0);
      const cap = new THREE.BoxGeometry(s.hw * 2 + 0.3, 0.25, s.hl * 2 + 0.3); cap.translate(0, s.y + s.h + 0.1, 0);
      (groups[s.kind] || groups.pillar).push(toWorld(g, s.cx, s.cz, s.ang), toWorld(cap, s.cx, s.cz, s.ang));
    }
    const mats = { pillar: this.M.pillar || this.M.gate, crate: this.M.crate || this.M.hurdle, hurdle: this.M.hurdle, wall: this.M.curb || new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7, vertexColors: true }) };
    for (const k in groups) { if (!groups[k].length) continue; const m = new THREE.Mesh(mergeGeometries(groups[k], false), mats[k]); m.castShadow = k !== 'wall'; m.receiveShadow = true; this.group.add(m); }
  }

  buildLasers(list) {
    const posts = [];
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const out = [];
    for (const h of list) {
      const hgt = h.tall ? 3.2 : 0.3, len = Math.hypot(h.bx - h.ax, h.bz - h.az), rotY = -Math.atan2(h.bz - h.az, h.bx - h.ax);
      for (const [x, z] of [[h.ax, h.az], [h.bx, h.bz]]) posts.push(placeBox(0.35, 1.6 + (h.tall ? 2.6 : 0), 0.35, x, h.y - 0.6 + (0.8 + (h.tall ? 1.3 : 0)), z, 0x222a33));
      const beam = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, 0.18), beamMat);
      beam.position.set((h.ax + h.bx) / 2, h.y + (h.tall ? 1.3 : 0), (h.az + h.bz) / 2); beam.rotation.y = rotY;
      const glow = new THREE.Mesh(new THREE.BoxGeometry(len, hgt + 0.5, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.add(glow); h.beam = beam; h.on = true; this.group.add(beam); out.push(h);
    }
    if (posts.length) this.group.add(merged(posts, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.7, vertexColors: true })));
    return out;
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
      g.position.set(h.ax, h.y, h.az); g.castShadow = true;
      h.group = g; h.ring = ring; h.hit = 0; h.px = h.ax; h.pz = h.az; h.len = Math.hypot(h.bx - h.ax, h.bz - h.az) || 1;
      this.group.add(g); out.push(h);
    }
    return out;
  }

  buildBoosts(list) {
    const tex = T.texChevron();
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1a1a, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.5, roughness: 0.4, metalness: 0.5 });
    const out = [];
    for (const b of list) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(5, 0.22, 5), mat);
      m.position.set(b.x, b.y + 0.1, b.z); m.rotation.y = -b.ang;
      b.mesh = m; b.cool = 0; b.rx = Math.cos(b.ang); b.rz = Math.sin(b.ang); b.fx = Math.sin(b.ang); b.fz = -Math.cos(b.ang);
      this.group.add(m); out.push(b);
    }
    this.boostMat = mat; this.boostTex = tex;
    return out;
  }

  buildBolts(list) {
    const nut = new THREE.CylinderGeometry(0.55, 0.55, 0.28, 6); nut.rotateX(Math.PI / 2);
    const hole = new THREE.TorusGeometry(0.3, 0.1, 6, 12);
    const geo = mergeGeometries([colorGeo(nut, 0xffc83a), colorGeo(hole, 0xffe7a8)], false);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.8, vertexColors: true });
    const im = instanced(geo, mat, list.map((b) => ({ x: b.x, y: b.y, z: b.z, s: 1 })));
    im.frustumCulled = false; this.group.add(im);
    list.forEach((b, i) => { b.i = i; b.taken = false; });
    this.boltMesh = im;
    return list;
  }

  buildRails(list) {
    const accent = new THREE.Color(this.theme.accent);
    this.railMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, emissive: accent, emissiveIntensity: this.theme.id === 'cyber' ? 1.2 : 0.25, roughness: 0.3, metalness: 0.9 });
    const sup = [];
    for (const r of list) {
      const len = segLen(r), dx = (r.bx - r.ax) / len, dz = (r.bz - r.az) / len, px = -dz * 0.35, pz = dx * 0.35;
      const m = bar(0.16, this.railMat, r.ax, r.ay, r.az, r.bx, r.by, r.bz); m.castShadow = true; this.group.add(m);
      this.group.add(bar(0.07, this.railMat, r.ax + px, r.ay - 0.25, r.az + pz, r.bx + px, r.by - 0.25, r.bz + pz, 6));
      this.group.add(bar(0.07, this.railMat, r.ax - px, r.ay - 0.25, r.az - pz, r.bx - px, r.by - 0.25, r.bz - pz, 6));
      for (let d = 3; d < len; d += 7) {
        const [x, y, z] = segPoint(r, d / len);
        const f = this.L.floorAt(x, z, y - 0.5); const yb = f ? f.y : y - 7;
        sup.push(placeBox(0.22, Math.max(0.5, y - yb), 0.22, x, (y + yb) / 2 - 0.1, z, 0x2a2f36));
      }
    }
    if (sup.length) this.group.add(merged(sup, new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.7, vertexColors: true })));
  }

  buildZips(list) {
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x8a94a0, roughness: 0.4, metalness: 0.9 });
    const pylonMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.6, vertexColors: true });
    const trolleyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(this.theme.accent), emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.8 });
    const pyl = [];
    for (const z of list) {
      this.group.add(bar(0.1, cableMat, z.ax, z.ay, z.az, z.bx, z.by, z.bz, 6));
      for (const [x, y, zz] of [[z.ax, z.ay, z.az], [z.bx, z.by, z.bz]]) {
        const f = this.L.floorAt(x, zz, y - 0.5); const yb = f ? f.y : y - 9;
        pyl.push(placeBox(0.5, y - yb + 1, 0.5, x, (y + yb + 1) / 2, zz, 0x3a3f45));
        pyl.push(placeBox(2.4, 0.3, 0.5, x, y + 0.9, zz, 0xe8c547, -Math.atan2(z.bz - z.az, z.bx - z.ax)));
      }
      const tr = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 14), trolleyMat); wheel.position.y = 0.2; tr.add(wheel);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.7), trolleyMat); body.position.y = -0.35; tr.add(body);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), trolleyMat); handle.position.y = -0.95; tr.add(handle);
      for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), trolleyMat); st.position.set(sx * 0.6, -0.72, 0); tr.add(st); }
      tr.rotation.y = -Math.atan2(z.bz - z.az, z.bx - z.ax) + Math.PI / 2;
      tr.position.set(z.ax, z.ay + 0.15, z.az); this.group.add(tr); z.trolley = tr;
    }
    if (pyl.length) this.group.add(merged(pyl, pylonMat));
  }
  moveTrolley(z, t) { const [x, y, zz] = segPoint(z, t); z.trolley.position.set(x, y + 0.15, zz); }
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
      g.position.set(pad.x, pad.y, pad.z); this.group.add(g); pad.group = g; pad.top = t; pad.anim = 0; out.push(pad);
    }
    return out;
  }

  buildRings(list) {
    const accent = new THREE.Color(this.theme.accent);
    const geo = new THREE.TorusGeometry(2.3, 0.2, 10, 40), inner = new THREE.TorusGeometry(1.4, 0.06, 6, 28);
    const out = [];
    for (const ring of list) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: accent, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.5 });
      const m = new THREE.Mesh(geo, mat); m.rotation.order = 'YXZ'; m.rotation.y = Math.atan2(ring.dx, ring.dz); m.position.set(ring.x, ring.y, ring.z);
      m.add(new THREE.Mesh(inner, mat)); this.group.add(m);
      ring.mesh = m; ring.flash = 0; out.push(ring);
    }
    return out;
  }

  buildGates(L) {
    const accent = new THREE.Color(this.theme.accent);
    const dimMat = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x335566, emissiveIntensity: 0.8, roughness: 0.3 });
    const litMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: accent, emissiveIntensity: 2.4, roughness: 0.3 });
    const make = (cp, big) => {
      const g = new THREE.Group();
      const h = big ? 9 : 6.5, w = cp.hw * 2 + 1;
      for (const x of [-cp.hw - 0.2, cp.hw + 0.2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9), this.M.gate); p.position.set(x, h / 2, 0); p.castShadow = true; g.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.9, 1.1), this.M.gate); beam.position.set(0, h, 0); g.add(beam);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.25, 0.3), dimMat); glow.position.set(0, h - 0.6, 0); g.add(glow);
      const sides = [];
      for (const x of [-cp.hw - 0.2, cp.hw + 0.2]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.25, h - 1, 0.3), dimMat); st.position.set(x * 0.985, h / 2, 0.5); g.add(st); sides.push(st); }
      if (big) { const banner = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 2.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: accent, emissiveIntensity: 1.5 })); banner.position.set(0, h + 1.6, 0); g.add(banner); }
      g.position.set(cp.x, cp.y, cp.z); g.rotation.y = -cp.ang; this.group.add(g);
      return { group: g, glow, sides, lit: false, light() { this.lit = true; this.glow.material = litMat; this.sides.forEach((x) => (x.material = litMat)); } };
    };
    L.checkpoints.forEach((cp) => { cp.gate = make(cp, false); cp.passed = false; });
    this.finishGate = make(L.finish, true);
  }

  update(dt, camPos) {
    this.t += dt; const t = this.t;
    const near = (x, z, d) => Math.abs(x - camPos.x) < d && Math.abs(z - camPos.z) < d;
    for (const h of this.lasers) {
      if (!near((h.ax + h.bx) / 2, (h.az + h.bz) / 2, 200)) continue;
      h.on = ((t / h.period) + h.phase) % 1 < h.duty; h.beam.visible = h.on; h.beam.material.opacity = 0.6 + 0.3 * Math.sin(t * 30 + h.ax);
    }
    for (const h of this.drones) {
      if (!near(h.ax, h.az, 200)) continue;
      if (h.hit > 0) { h.hit -= dt; h.group.rotation.x += dt * 9; h.group.rotation.z += dt * 6; h.group.position.y -= dt * 4; if (h.hit <= 0) { h.group.rotation.set(0, 0, 0); h.group.position.y = h.y; } continue; }
      const ph = t * (h.speed / h.len) * 2 + h.phase, k = (Math.sin(ph) + 1) / 2;
      h.px = h.ax + (h.bx - h.ax) * k; h.pz = h.az + (h.bz - h.az) * k;
      h.group.position.set(h.px, h.y + Math.sin(t * 3 + h.phase) * 0.25, h.pz);
      h.group.rotation.y = -Math.atan2(h.bz - h.az, h.bx - h.ax) + Math.PI / 2 + Math.cos(ph) * 0.4;
      h.ring.rotation.z = t * 4;
    }
    const bm = this.boltMesh;
    if (bm) {
      let dirty = false;
      for (const b of this.bolts) {
        if (b.taken || !near(b.x, b.z, 90)) continue;
        _e.set(0, t * 3 + b.x, 0); _q.setFromEuler(_e); _p.set(b.x, b.y + Math.sin(t * 2 + b.z) * 0.15, b.z); _s.setScalar(1);
        _m.compose(_p, _q, _s); bm.setMatrixAt(b.i, _m); dirty = true;
      }
      if (dirty) bm.instanceMatrix.needsUpdate = true;
    }
    for (const pad of this.pads) {
      if (pad.anim > 0) { pad.anim = Math.max(0, pad.anim - dt * 3); const sq = Math.sin(pad.anim * Math.PI); pad.group.scale.set(1 + sq * 0.25, 1 - sq * 0.5, 1 + sq * 0.25); }
      if (near(pad.x, pad.z, 160)) pad.top.material.emissiveIntensity = 0.8 + Math.sin(t * 5 + pad.x) * 0.4;
    }
    for (const ring of this.rings) {
      if (!near(ring.x, ring.z, 220)) continue;
      ring.mesh.rotation.z = t * 1.2 + ring.x;
      if (ring.flash > 0) { ring.flash = Math.max(0, ring.flash - dt * 3); const f = Math.sin(ring.flash * Math.PI); ring.mesh.scale.setScalar(1 + f * 0.5); ring.mesh.material.emissiveIntensity = 1.6 + f * 4; }
    }
    for (const z of this.L.zips) if (z.parkT > 0) { z.parkT -= dt; if (z.parkT <= 0) this.moveTrolley(z, 0); }
    if (this.boostTex) this.boostTex.offset.y = -t * 1.5;
    if (this.boostMat) this.boostMat.emissiveIntensity = 2 + Math.sin(t * 6) * 0.8;
  }

  takeBolt(b) { b.taken = true; _m.makeScale(0, 0, 0); this.boltMesh.setMatrixAt(b.i, _m); this.boltMesh.instanceMatrix.needsUpdate = true; }
  dispose() { this.scene.remove(this.group); this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}
