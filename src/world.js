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

    // ---- hazards ----
    this.spikesMesh = this.buildSpikes(L.hazards.filter((h) => h.type === 'spikes'));
    this.hurdlesMesh = this.buildHurdles(L.hazards.filter((h) => h.type === 'hurdle'));
    this.lasers = this.buildLasers(L.hazards.filter((h) => h.type === 'laser'));
    this.drones = this.buildDrones(L.hazards.filter((h) => h.type === 'drone'));
    this.boosts = this.buildBoosts(L.boosts);
    this.bolts = this.buildBolts(L.bolts);
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
