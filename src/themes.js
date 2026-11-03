import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import { CORRIDOR_HALF as W } from './level.js';

// ---------- shared helpers ----------
export function colorGeo(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
export function merged(geos, material) {
  if (!geos.length) return null;
  const g = mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true; m.matrixAutoUpdate = false;
  return m;
}
export function tileBoxUV(g, w, h, d, tile) {
  // BoxGeometry face order: px, nx, py, ny, pz, nz (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.attributes.uv.array;
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 2; uv[i] *= dims[f][0] / tile; uv[i + 1] *= dims[f][1] / tile; }
  return g;
}
export function placeBox(w, h, d, x, y, z, color, ry = 0, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) tileBoxUV(g, w, h, d, tile);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colorGeo(g, color);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
export function instanced(geo, mat, items) {
  // items: [{x,y,z, rx,ry,rz, sx,sy,sz, color}]
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    _e.set(it.rx || 0, it.ry || 0, it.rz || 0); _q.setFromEuler(_e);
    _p.set(it.x, it.y, it.z); _s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    _m.compose(_p, _q, _s); im.setMatrixAt(i, _m);
    if (it.color !== undefined) im.setColorAt(i, new THREE.Color(it.color));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.receiveShadow = true; im.frustumCulled = true;
  return im;
}

export class SkyDome {
  constructor(opts) {
    this.uniforms = {
      top: { value: new THREE.Color(opts.top) }, mid: { value: new THREE.Color(opts.mid) }, bot: { value: new THREE.Color(opts.bot) },
      sunColor: { value: new THREE.Color(opts.sun || 0x000000) }, sunDir: { value: new THREE.Vector3(...(opts.sunDir || [0, 1, 0])).normalize() },
      flash: { value: 0 }, time: { value: 0 }, stripes: { value: opts.stripes || 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform vec3 top, mid, bot, sunColor, sunDir; uniform float flash, time, stripes; varying vec3 vW;
        void main(){
          vec3 d = normalize(vW - cameraPosition);
          float h = d.y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.4));
          float s = max(dot(d, sunDir), 0.0);
          float disc = smoothstep(0.9975, 0.9995, s);
          if (stripes > 0.5) { disc *= step(0.35, fract((d.y + 0.2) * 55.0 + time * 0.2)); disc = smoothstep(0.985, 0.998, s) * step(0.35, fract((d.y + 0.2) * 48.0)); }
          c += sunColor * (disc * 2.5 + pow(s, 12.0) * 0.35);
          c += vec3(flash) * 0.9;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12), mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
  }
}

export class Rain {
  constructor(count, color, opacity = 0.55, size = 0.14, speed = 46) {
    this.count = count; this.speed = speed;
    this.box = new THREE.Vector3(70, 44, 90);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * this.box.x; pos[i * 3 + 1] = Math.random() * this.box.y; pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity, map: T.texDot(), depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
  }
  update(dt, cam) {
    const a = this.points.geometry.attributes.position.array;
    const cx = cam.position.x, cz = cam.position.z - 38, cy = cam.position.y - 12;
    this.points.position.set(cx, cy, cz);
    for (let i = 0; i < this.count; i++) {
      a[i * 3 + 1] -= this.speed * dt;
      if (a[i * 3 + 1] < 0) { a[i * 3 + 1] += this.box.y; a[i * 3] = (Math.random() - 0.5) * this.box.x; a[i * 3 + 2] = (Math.random() - 0.5) * this.box.z; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class Drift {
  // slow floating motes (fireflies / data particles)
  constructor(count, color, size, rise = 0.6) {
    this.count = count; this.rise = rise; this.t = 0;
    this.box = new THREE.Vector3(60, 24, 120);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * this.box.x; pos[i * 3 + 1] = Math.random() * this.box.y; pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, map: T.texDot(), depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
  }
  update(dt, cam) {
    this.t += dt;
    const a = this.points.geometry.attributes.position.array;
    this.points.position.set(cam.position.x, cam.position.y - 8, cam.position.z - 75);
    for (let i = 0; i < this.count; i++) {
      a[i * 3 + 1] += this.rise * dt; a[i * 3] += Math.sin(this.t * 0.7 + i) * dt * 0.6;
      if (a[i * 3 + 1] > this.box.y) a[i * 3 + 1] -= this.box.y;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = 0.65 + Math.sin(this.t * 2.1) * 0.25;
  }
}

export function waterMaterial(deep, shallow, foam, opacity = 0.9) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(deep) }, shallow: { value: new THREE.Color(shallow) }, foam: { value: new THREE.Color(foam) }, opacity: { value: opacity },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 100 } },
    vertexShader: `
      uniform float time; varying vec3 vW; varying float vH;
      void main(){ vec3 p = position; vec4 w = modelMatrix * vec4(p,1.0);
        float h = sin(w.x*0.12 + time*1.3) * 0.5 + sin(w.z*0.09 - time*0.9) * 0.6 + sin((w.x+w.z)*0.21 + time*1.9) * 0.25;
        w.y += h; vH = h; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 deep, shallow, foam, fogColor; uniform float time, opacity, fogNear, fogFar; varying vec3 vW; varying float vH;
      void main(){
        float t = clamp(vH * 0.6 + 0.5, 0.0, 1.0);
        vec3 c = mix(deep, shallow, t);
        float f = smoothstep(0.75, 1.0, sin(vW.x*0.9 + vW.z*0.7 + time*2.0) * 0.5 + 0.5) * smoothstep(0.6, 1.0, t);
        c = mix(c, foam, f * 0.7);
        vec3 vd = normalize(cameraPosition - vW); float fres = pow(1.0 - max(dot(vd, vec3(0.0,1.0,0.0)), 0.0), 3.0);
        c += fres * 0.25;
        float depth = length(cameraPosition - vW); float fogF = smoothstep(fogNear, fogFar, depth);
        c = mix(c, fogColor, fogF);
        gl_FragColor = vec4(c, opacity);
      }`,
  });
}

function palmCrown() {
  const geos = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.ConeGeometry(0.9, 5.2, 4, 1, true);
    g.scale(1, 1, 0.18);
    g.rotateX(Math.PI / 2 + 0.55 + Math.random() * 0.25); // droop
    g.translate(0, 0, 2.2);
    g.rotateY((i / 8) * Math.PI * 2 + Math.random() * 0.3);
    colorGeo(g, new THREE.Color().setHSL(0.3 + Math.random() * 0.05, 0.55, 0.26 + Math.random() * 0.1));
    geos.push(g);
  }
  for (let i = 0; i < 3; i++) { const c = new THREE.SphereGeometry(0.35, 6, 5); c.translate(Math.cos(i * 2.1) * 0.5, -0.4, Math.sin(i * 2.1) * 0.5); geos.push(colorGeo(c, 0x5a4a22)); }
  return mergeGeometries(geos, false);
}

// ---------- THEME 1: Tropic Thunder ----------
const tropic = {
  id: 'tropic', name: 'Tropic Thunder', blurb: 'Jungle ruins, a storm rolling in, and the recall crew somewhere behind you.',
  swatch: 'linear-gradient(135deg,#1d3b2a,#f0a35e 70%,#ffd27a)',
  sky: { top: 0x1a2a3a, mid: 0xd98a4a, bot: 0x3b3a30, sun: 0xffc080, sunDir: [-0.4, 0.14, -1] },
  fog: { color: 0x7d7a62, near: 60, far: 420 },
  lights: { hemiSky: 0xf0e2c8, hemiGround: 0x3a5a36, hemiI: 1.35, sunColor: 0xffd0a0, sunI: 2.4, sunPos: [28, 42, 26] },
  exposure: 1.0, bloom: 0.35, accent: 0xff7a1a,
  materials() {
    const stone = T.texStone(); const dirt = T.texDirt(); const haz = T.texHazard(256, '#c99a3a', '#3a2f22');
    return {
      floor: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, metalness: 0.02, vertexColors: true }),
      ramp: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.8, metalness: 0.1, vertexColors: true }),
      platform: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9, vertexColors: true }),
      bridge: new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9, vertexColors: true }),
      side: new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, vertexColors: true }),
      spike: new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.5, metalness: 0.4 }),
      hurdle: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.8 }),
      pillar: new THREE.MeshStandardMaterial({ map: stone, color: 0xb0a890, roughness: 0.9 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x5a5244, roughness: 0.8, metalness: 0.2 }),
      tile: 6,
    };
  },
  build(L, scene, r, q, env) {
    const group = new THREE.Group();
    const len = L.length + 200;
    // cliff walls
    const cliffs = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let s = -40; s < len; s += 9) {
        const h = 6 + r.range(0, 7), w = 5 + r.range(0, 3);
        const ext = L.extentAt(s + 4.5);
        const x = side * (ext + 2.6 + r.range(0, 1.5));
        cliffs.push(placeBox(w, h + 14, 9.6, x, h / 2 - 7, -(s + 4.5), new THREE.Color().setHSL(0.22 + r.range(0, 0.1), 0.35, 0.5 + r.range(0, 0.2)), r.range(-0.08, 0.08), 7));
        if (r.chance(0.6)) cliffs.push(placeBox(w + 4, h + 10 + r.range(0, 8), 10, x + side * 6, h / 2 + 2, -(s + 4.5), new THREE.Color().setHSL(0.26, 0.3, 0.42 + r.range(0, 0.15)), 0, 7));
        if (r.chance(0.5)) cliffs.push(placeBox(2.5 + r.range(0, 2), 2 + r.range(0, 2), 3 + r.range(0, 3), x - side * (w / 2 - 0.5), h + 0.5, -(s + r.range(0, 8)), new THREE.Color().setHSL(0.3, 0.45, 0.4 + r.range(0, 0.15)), r.range(0, 1), 3));
      }
    }
    group.add(merged(cliffs, new THREE.MeshStandardMaterial({ map: T.texDirt(), roughness: 1, vertexColors: true })));

    // palms
    const trunks = [], crowns = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let s = -40; s < len; s += 7 + r.range(0, 5)) {
        const x = side * (L.extentAt(s) + 4 + r.range(0, 12)), h = 7 + r.range(0, 6), lean = r.range(-0.2, 0.2);
        const base = 5 + r.range(0, 5);
        trunks.push({ x, y: base, z: -s, rz: lean * -side, rx: r.range(-0.1, 0.1), sx: 1, sy: h / 9, sz: 1, color: new THREE.Color().setHSL(0.08, 0.3, 0.3 + r.range(0, 0.1)) });
        crowns.push({ x: x + Math.sin(lean) * h * side * -1, y: base + h, z: -s, ry: r.range(0, 6.3), s: 0.8 + r.range(0, 0.5) });
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.45, 9, 6); trunkGeo.translate(0, 4.5, 0);
    group.add(instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), trunks));
    group.add(instanced(palmCrown(), new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true, side: THREE.DoubleSide }), crowns));

    // ferns + rocks near the edges
    const ferns = [], rocks = [];
    for (let s = 0; s < len; s += 3) {
      const ext = L.extentAt(s);
      if (r.chance(0.6)) ferns.push({ x: r.sign() * (ext + 0.8 + r.range(0, 1.2)), y: 0.1, z: -s, ry: r.range(0, 6.3), s: 0.8 + r.range(0, 0.8), color: new THREE.Color().setHSL(0.32, 0.5, 0.25 + r.range(0, 0.12)) });
      if (r.chance(0.25)) rocks.push({ x: r.sign() * (ext + 1 + r.range(0, 3)), y: 0.2, z: -s, ry: r.range(0, 6.3), sx: 0.8 + r.range(0, 1.5), sy: 0.5 + r.range(0, 0.9), sz: 0.8 + r.range(0, 1.5), color: new THREE.Color().setHSL(0.25, 0.1, 0.3 + r.range(0, 0.1)) });
    }
    const fernGeo = (() => { const a = new THREE.PlaneGeometry(2.2, 1.6); a.translate(0, 0.8, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const c = a.clone(); c.rotateY(Math.PI / 4); const d = a.clone(); d.rotateY(-Math.PI / 4); return mergeGeometries([a, b, c, d]); })();
    group.add(instanced(fernGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), ferns));
    group.add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), rocks));

    // ruin pillars + lanterns every 10 units: the pass-by rhythm that sells speed
    const pillars = [], lamps = [];
    for (let s = 10; s < L.length; s += 10) {
      for (let side = -1; side <= 1; side += 2) {
        const ex = L.extentAt(s) - 0.4;
        const f = L.floorAt(side * ex, s, 50);
        if (!f) continue;
        const y = f.y;
        pillars.push(placeBox(0.7, 3.2, 0.7, side * ex, y + 1.6, -s, 0x6b6250));
        pillars.push(placeBox(1, 0.3, 1, side * ex, y + 3.3, -s, 0x50483a));
        lamps.push({ x: side * ex, y: y + 3.75, z: -s, s: 0.28 });
      }
    }
    group.add(merged(pillars, new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true })));
    group.add(instanced(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff8a2a, emissiveIntensity: 3, roughness: 0.4 }), lamps));

    // mountains far away
    const mts = [];
    for (let i = 0; i < 26; i++) {
      const s = r.range(-200, len + 400), x = r.sign() * r.range(90, 260), rad = 50 + r.range(0, 90), h = 60 + r.range(0, 120);
      const g = new THREE.ConeGeometry(rad, h, 7); g.translate(x, h / 2 - 10, -s); mts.push(colorGeo(g, new THREE.Color().setHSL(0.36, 0.25, 0.2 + r.range(0, 0.1))));
    }
    group.add(merged(mts, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true })));

    // water in the ravines
    const water = waterMaterial(0x0f3a3a, 0x2f8f80, 0xcfe9e0, 0.92);
    const pitGeos = [];
    for (const p of L.pits) { const ex = L.extentAt((p.s0 + p.s1) / 2); const g = new THREE.PlaneGeometry(ex * 2 + 6, p.s1 - p.s0 + 10, 4, 12); g.rotateX(-Math.PI / 2); g.translate(0, -9, -(p.s0 + p.s1) / 2); pitGeos.push(g); }
    if (pitGeos.length) { const wm = new THREE.Mesh(mergeGeometries(pitGeos), water); wm.frustumCulled = false; group.add(wm); }
    // ravine walls + submerged rocks
    const rav = [];
    for (const p of L.pits) {
      const ex = L.extentAt((p.s0 + p.s1) / 2);
      for (let side = -1; side <= 1; side += 2) rav.push(placeBox(2, 12, p.s1 - p.s0 + 2, side * (ex + 1), -6, -(p.s0 + p.s1) / 2, 0x5a5445, 0, 6));
      rav.push(placeBox(ex * 2 + 2, 1, 1.6, 0, -0.8, -p.s0 + 0.6, 0x45402f));
      rav.push(placeBox(ex * 2 + 2, 1, 1.6, 0, -0.8, -p.s1 - 0.6, 0x45402f));
    }
    if (rav.length) group.add(merged(rav, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true })));

    const rain = new Rain(q.high ? 1800 : 900, 0xcfe3ff, 0.45, 0.16, 48); group.add(rain.points);
    const flies = new Drift(q.high ? 260 : 120, 0xd8ff6a, 0.35, 0.4); group.add(flies.points);
    scene.add(group);

    let lightningT = 4 + r.range(0, 6), flash = 0, thunderQueued = -1;
    const baseSun = env.sun.intensity;
    return {
      update(dt, t, cam, api) {
        water.uniforms.time.value = t;
        water.uniforms.fogColor.value.copy(scene.fog.color); water.uniforms.fogNear.value = scene.fog.near; water.uniforms.fogFar.value = scene.fog.far;
        rain.update(dt, cam); flies.update(dt, cam);
        lightningT -= dt;
        if (lightningT <= 0) { lightningT = 5 + r.range(0, 9); flash = 1; thunderQueued = 0.35 + r.range(0, 1.1); api.lightning(); }
        if (thunderQueued > 0) { thunderQueued -= dt; if (thunderQueued <= 0) { api.thunder(); thunderQueued = -1; } }
        if (flash > 0) { flash = Math.max(0, flash - dt * 4.5); const f = flash * (0.6 + 0.4 * Math.sin(t * 90)); env.sky.uniforms.flash.value = f * 0.6; env.sun.intensity = baseSun * (1 + f * 2.2); env.hemi.intensity = env.hemiBase * (1 + f * 1.5); }
      },
      dispose() { scene.remove(group); },
    };
  },
};

// ---------- THEME 2: Cyberspace ----------
const cyber = {
  id: 'cyber', name: 'Cyberspace', blurb: 'Halvex pulled you into the mainframe. Ride the data lanes out before the firewall closes.',
  swatch: 'linear-gradient(135deg,#0b0620,#37e8ff 60%,#ff3fd1)',
  sky: { top: 0x04020e, mid: 0x1a0a3c, bot: 0x05030d, sun: 0xff3fd1, sunDir: [0, 0.12, -1], stripes: 1 },
  fog: { color: 0x0b0620, near: 40, far: 330 },
  lights: { hemiSky: 0x5b4cff, hemiGround: 0x0a1030, hemiI: 1.1, sunColor: 0x8fdfff, sunI: 1.4, sunPos: [20, 50, 30] },
  exposure: 1.1, bloom: 0.9, accent: 0x37e8ff,
  materials() {
    const [grid, gridE] = T.texGrid(512, '#37e8ff', '#0a0d1f');
    const [gridM, gridME] = T.texGrid(512, '#ff3fd1', '#120a1f');
    return {
      floor: new THREE.MeshStandardMaterial({ map: grid, emissiveMap: gridE, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.6, vertexColors: true }),
      ramp: new THREE.MeshStandardMaterial({ map: gridM, emissiveMap: gridME, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.6, vertexColors: true }),
      platform: new THREE.MeshStandardMaterial({ map: gridM, emissiveMap: gridME, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.6, vertexColors: true }),
      bridge: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x37e8ff, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.7, vertexColors: true }),
      side: new THREE.MeshStandardMaterial({ color: 0x141a33, roughness: 0.6, metalness: 0.5, vertexColors: true }),
      spike: new THREE.MeshStandardMaterial({ color: 0xff3fd1, emissive: 0xff3fd1, emissiveIntensity: 1.2, roughness: 0.3 }),
      hurdle: new THREE.MeshStandardMaterial({ color: 0x2a1f55, emissive: 0xff3fd1, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.6 }),
      pillar: new THREE.MeshStandardMaterial({ map: gridM, emissiveMap: gridME, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.6 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x1b2242, roughness: 0.4, metalness: 0.8 }),
      tile: 8,
    };
  },
  build(L, scene, r, q, env) {
    const group = new THREE.Group();
    const len = L.length + 300;
    // infinite-looking grid floor far below
    const [g1, g1e] = T.texGrid(512, '#2a8bff', '#06061a');
    g1.repeat.set(120, 120); g1e.repeat.set(120, 120);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: g1, emissiveMap: g1e, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.6, metalness: 0.4 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -28, -len / 2); group.add(ground);

    // towers
    const [win, winE] = T.texWindows(256, 6, 18, '#8fdfff', 0.45, '#0e1430');
    const towers = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let s = -60; s < len; s += 10 + r.range(0, 8)) {
        const h = 20 + r.range(0, 90), w = 6 + r.range(0, 10);
        towers.push({ x: side * (L.extentAt(s) + 8 + r.range(0, 70)), y: h / 2 - 28, z: -s, sx: w, sy: h, sz: w, color: new THREE.Color().setHSL(0.62 + r.range(0, 0.2), 0.5, 0.25 + r.range(0, 0.2)) });
      }
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: win, emissiveMap: winE, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5, metalness: 0.6 }), towers));

    // neon rails along the corridor + pylons every 8 units
    const rails = [];
    for (let s = -40; s < len; s += 4) for (let side = -1; side <= 1; side += 2) {
      const e0 = L.extentAt(s), e1 = L.extentAt(s + 4);
      const g = new THREE.BoxGeometry(0.22, 0.22, Math.hypot(4, e1 - e0) + 0.3); g.rotateY(Math.atan2((e1 - e0) * side, 4));
      g.translate(side * ((e0 + e1) / 2 + 0.6), 0.5, -(s + 2)); rails.push(colorGeo(g, side > 0 ? 0x37e8ff : 0xff3fd1));
    }
    const pylons = [], pylonTops = [];
    for (let s = 8; s < L.length; s += 8) {
      for (let side = -1; side <= 1; side += 2) {
        const ex = L.extentAt(s);
        const f = L.floorAt(side * (ex - 0.3), s, 50); if (!f) continue; const y = f.y;
        pylons.push(placeBox(0.3, 3.6, 0.3, side * (ex + 0.6), y + 1.8, -s, 0x1b2242));
        pylonTops.push({ x: side * (ex + 0.6), y: y + 3.8, z: -s, sx: 0.6, sy: 0.25, sz: 0.6, color: side > 0 ? 0x37e8ff : 0xff3fd1 });
      }
    }
    group.add(merged(rails, new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.6, vertexColors: true, roughness: 0.3 })));
    group.add(merged(pylons, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.8, vertexColors: true })));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 }), pylonTops));

    // glowing edges on platforms and bridges
    const edges = [];
    for (const b of L.blocks) {
      if (b.kind === 'floor') continue;
      const c = b.kind === 'bridge' ? 0x37e8ff : 0xff3fd1;
      const s0 = b.s0, s1 = b.s1, l = s1 - s0, mid = (s0 + s1) / 2;
      const yMid = b.y0 + b.slope * l / 2, rx = Math.atan(b.slope);
      for (const x of [b.x0 + 0.1, b.x1 - 0.1]) { const g = new THREE.BoxGeometry(0.16, 0.16, Math.hypot(l, b.slope * l)); g.rotateX(rx); g.translate(x, yMid + 0.05, -mid); edges.push(colorGeo(g, c)); }
    }
    if (edges.length) group.add(merged(edges, new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.8, vertexColors: true })));

    // floating shapes
    const shapes = [];
    for (let i = 0; i < (q.high ? 48 : 26); i++) shapes.push({ x: r.range(-W - 24, W + 24), y: 6 + r.range(0, 16), z: -r.range(0, L.length), s: 0.8 + r.range(0, 1.6), color: r.chance(0.5) ? 0x37e8ff : 0xff3fd1, spin: r.range(0.3, 1.2) });
    const shapeMesh = instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.8, flatShading: true }), shapes);
    group.add(shapeMesh);

    const data = new Drift(q.high ? 700 : 350, 0x37e8ff, 0.3, 2.2); group.add(data.points);

    // horizon sun disc with scanlines lives in the sky shader (stripes). Add a big ring for scale.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(260, 3, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff3fd1, fog: false }));
    ring.position.set(0, 40, -len - 500); group.add(ring);

    scene.add(group);
    return {
      update(dt, t, cam) {
        data.update(dt, cam);
        env.sky.uniforms.time.value = t;
        ring.rotation.z = t * 0.05; ring.position.x = cam.position.x;
        for (let i = 0; i < shapes.length; i++) {
          const sh = shapes[i];
          if (Math.abs(sh.z - cam.position.z) > 220) continue;
          _e.set(t * sh.spin, t * sh.spin * 0.7, 0); _q.setFromEuler(_e); _p.set(sh.x, sh.y + Math.sin(t + i) * 0.6, sh.z); _s.setScalar(sh.s);
          _m.compose(_p, _q, _s); shapeMesh.setMatrixAt(i, _m);
        }
        shapeMesh.instanceMatrix.needsUpdate = true;
      },
      dispose() { scene.remove(group); },
    };
  },
};

// ---------- THEME 3: Cargo ship ----------
const cargo = {
  id: 'cargo', name: 'The Freighter', blurb: 'Four hundred metres of container deck between you and the bow. The ship is theirs. The wheels are yours.',
  swatch: 'linear-gradient(135deg,#59646f,#c2442c 60%,#2b4a7a)',
  sky: { top: 0x44515e, mid: 0x9aa6ad, bot: 0x3a4650, sun: 0xfff2d8, sunDir: [0.5, 0.35, -1] },
  fog: { color: 0x8e9aa2, near: 70, far: 480 },
  lights: { hemiSky: 0xd6dee6, hemiGround: 0x3b444c, hemiI: 1.15, sunColor: 0xfff0d8, sunI: 1.6, sunPos: [40, 60, 30] },
  exposure: 0.95, bloom: 0.3, accent: 0xf2b705,
  materials() {
    const steel = T.texSteel(); const cont = T.texContainer(); const haz = T.texHazard();
    return {
      floor: new THREE.MeshStandardMaterial({ map: steel, roughness: 0.7, metalness: 0.5, vertexColors: true }),
      ramp: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7, metalness: 0.3, vertexColors: true }),
      platform: new THREE.MeshStandardMaterial({ map: cont, roughness: 0.7, metalness: 0.3, vertexColors: true }),
      bridge: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.6, metalness: 0.5, vertexColors: true }),
      side: new THREE.MeshStandardMaterial({ map: cont, roughness: 0.7, metalness: 0.3, vertexColors: true }),
      spike: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4, metalness: 0.7 }),
      hurdle: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7 }),
      pillar: new THREE.MeshStandardMaterial({ map: cont, color: 0xb5432b, roughness: 0.7, metalness: 0.3 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x2b4a7a, roughness: 0.6, metalness: 0.4 }),
      tile: 5,
    };
  },
  build(L, scene, r, q, env) {
    const group = new THREE.Group();
    const len = L.length + 200;
    // sea
    const sea = waterMaterial(0x16303f, 0x3a6a78, 0xd8e6ea, 1.0);
    const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 48, 48), sea);
    seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.set(0, -13, -len / 2); seaMesh.frustumCulled = false; group.add(seaMesh);
    // hull sides
    const hull = [];
    for (let side = -1; side <= 1; side += 2) {
      hull.push(placeBox(3, 16, len + 120, side * 42, -6.5, -len / 2 + 40, 0x1e2630));
      hull.push(placeBox(3.2, 1.2, len + 120, side * 42, -11, -len / 2 + 40, 0x8a2a1e));
      hull.push(placeBox(2, 0.6, len + 120, side * 41.2, 1.6, -len / 2 + 40, 0xd9dde0));
    }
    group.add(merged(hull, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.4, vertexColors: true })));

    // container stacks
    const palette = [0xb5432b, 0x2b4a7a, 0x2f6b3a, 0xd8731e, 0xd9dde0, 0x6a2f4a, 0x3a3f45, 0xc9a227];
    const boxes = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let s = -60; s < len; s += 6.3) {
        const ext = Math.max(L.extentAt(s), L.extentAt(s + 6));
        for (let row = 0; row < 2; row++) {
          const stack = r.int(1, 4);
          if (r.chance(0.08)) continue;
          for (let k = 0; k < stack; k++) boxes.push({ x: side * (ext + 2.2 + row * 2.6 + r.range(-0.05, 0.05)), y: 1.3 + k * 2.6, z: -(s + 3), color: r.pick(palette), sx: 2.45, sy: 2.6, sz: 6.1 });
        }
        for (let col = 0; col < 3; col++) if (r.chance(0.6)) { const stack = r.int(2, 5); const x = side * (ext + 9 + col * 2.7 + r.range(0, 1)); if (x * side > 39) continue; for (let k = 0; k < stack; k++) boxes.push({ x, y: 1.3 + k * 2.6, z: -(s + 3), color: r.pick(palette), sx: 2.45, sy: 2.6, sz: 6.1 }); }
      }
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: T.texContainer(), roughness: 0.75, metalness: 0.3 }), boxes));

    // rails + bollards + deck lamps along the corridor
    const rails = [], posts = [], lamps = [];
    for (let s = -30; s < len; s += 4) for (let side = -1; side <= 1; side += 2) {
      const e0 = L.extentAt(s), e1 = L.extentAt(s + 4);
      for (const h of [1.25, 0.7]) { const g = new THREE.BoxGeometry(0.12, 0.12, Math.hypot(4, e1 - e0) + 0.2); g.rotateY(Math.atan2((e1 - e0) * side, 4)); g.translate(side * ((e0 + e1) / 2 + 0.7), h, -(s + 2)); rails.push(colorGeo(g, 0xe8c547)); }
    }
    for (let s = 2; s < L.length; s += 2) for (let side = -1; side <= 1; side += 2) posts.push({ x: side * (L.extentAt(s) + 0.7), y: 0.65, z: -s, sx: 0.08, sy: 1.3, sz: 0.08, color: 0xd9dde0 });
    for (let s = 10; s < L.length; s += 10) for (let side = -1; side <= 1; side += 2) {
      const ex = L.extentAt(s);
      const f = L.floorAt(side * (ex - 0.3), s, 50); if (!f) continue; const y = f.y;
      rails.push(placeBox(0.25, 4.5, 0.25, side * (ex - 0.5), y + 2.25, -s, 0x3a3f45));
      rails.push(placeBox(1.6, 0.2, 0.3, side * (ex - 1.1), y + 4.5, -s, 0x3a3f45));
      lamps.push({ x: side * (ex - 1.7), y: y + 4.35, z: -s, sx: 0.5, sy: 0.18, sz: 0.5 });
      if (s % 30 === 0) rails.push(placeBox(0.7, 1.0, 0.7, side * (ex - 0.9), y + 0.5, -s - 4, 0xe8c547));
    }
    group.add(merged(rails, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.5, vertexColors: true })));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), posts));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b0, emissiveIntensity: 2.5 }), lamps));

    // gantry cranes
    const cranes = [];
    for (let s = 140; s < L.length; s += 330) {
      for (let side = -1; side <= 1; side += 2) cranes.push(placeBox(3, 36, 3, side * 44, 18, -s, 0x2b4a7a));
      cranes.push(placeBox(2 * 46, 3, 4, 0, 36, -s, 0xe8c547));
      cranes.push(placeBox(6, 4, 5, r.range(-W, W), 33, -s, 0x3a3f45));
      cranes.push(placeBox(0.3, 20, 0.3, r.range(-W, W), 23, -s, 0x1e2630));
    }
    group.add(merged(cranes, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4, vertexColors: true })));

    // superstructure at the bow end
    const [win, winE] = T.texWindows(256, 10, 6, '#ffe9b0', 0.6, '#c9ced3');
    const ss = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(52, 38, 22), new THREE.MeshStandardMaterial({ map: win, emissiveMap: winE, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.7 }));
    tower.position.set(0, 19, -(L.length + 70)); ss.add(tower);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 16, 16), new THREE.MeshStandardMaterial({ color: 0xb5432b, roughness: 0.7 }));
    funnel.position.set(10, 46, -(L.length + 74)); ss.add(funnel);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 24, 8), new THREE.MeshStandardMaterial({ color: 0xd9dde0 })); mast.position.set(-12, 50, -(L.length + 70)); ss.add(mast);
    group.add(ss);

    // open holds under the pits
    const holds = [];
    for (const p of L.pits) {
      const ex = L.extentAt((p.s0 + p.s1) / 2);
      holds.push(placeBox(ex * 2 + 2, 1, p.s1 - p.s0 + 2, 0, -7.5, -(p.s0 + p.s1) / 2, 0x11151a));
      for (let side = -1; side <= 1; side += 2) holds.push(placeBox(1, 8, p.s1 - p.s0 + 2, side * (ex + 1), -3.5, -(p.s0 + p.s1) / 2, 0x1c2229));
      for (let s = p.s0 + 2; s < p.s1 - 4; s += 6.4) for (let k = 0; k < 2; k++) if (r.chance(0.7)) holds.push(placeBox(2.4, 2.6, 6.1, r.range(-ex + 2, ex - 2), -5.7 + k * 2.6, -(s + 3), r.pick(palette), 0, 2.5));
      for (let s = p.s0 + 3; s < p.s1; s += 8) for (let side = -1; side <= 1; side += 2) holds.push(placeBox(0.5, 0.3, 0.5, side * (ex - 0.6), -3, -s, 0xffb060));
      holds.push(placeBox(ex * 2 + 2, 0.5, 0.6, 0, -0.25, -p.s0 + 0.3, 0xe8c547));
      holds.push(placeBox(ex * 2 + 2, 0.5, 0.6, 0, -0.25, -p.s1 - 0.3, 0xe8c547));
    }
    if (holds.length) group.add(merged(holds, new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.3, vertexColors: true })));

    const rain = new Rain(q.high ? 1200 : 600, 0xdde8f0, 0.35, 0.12, 40); group.add(rain.points);
    scene.add(group);
    return {
      update(dt, t, cam) {
        sea.uniforms.time.value = t * 0.8;
        sea.uniforms.fogColor.value.copy(scene.fog.color); sea.uniforms.fogNear.value = scene.fog.near; sea.uniforms.fogFar.value = scene.fog.far;
        seaMesh.position.z = cam.position.z - 400;
        rain.update(dt, cam);
      },
      dispose() { scene.remove(group); },
    };
  },
};

export const THEMES = [tropic, cyber, cargo];
