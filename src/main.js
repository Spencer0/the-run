import * as THREE from 'three';
import { generateLevel, makeRng, localUV } from './level.js';
import { THEMES, SkyDome } from './themes.js';
import { World, segLen, segPoint, segParam } from './world.js';
import { Mech } from './mech.js';
import { PostFX } from './post.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI, UPGRADES, fmtTime } from './ui.js';

const G = 36;
const store = {
  get(k, d) { try { const v = localStorage.getItem('therun.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('therun.' + k, JSON.stringify(v)); } catch (_) {} },
};
const isMobile = navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) < 900;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const headingOf = (vx, vz) => Math.atan2(vx, -vz); // forward = (sin a, -cos a)

class Sparks {
  constructor(scene, n = 160) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc070, size: 0.35, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false; scene.add(this.points);
  }
  emit(x, y, z, count, spread, up, bx = 0, bz = 0) {
    for (let k = 0; k < count; k++) {
      const i = this.i; this.i = (this.i + 1) % this.n;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = bx + (Math.random() - 0.5) * spread; this.vel[i * 3 + 1] = Math.random() * up; this.vel[i * 3 + 2] = bz + (Math.random() - 0.5) * spread;
      this.life[i] = 0.25 + Math.random() * 0.3;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.life[i] -= dt; this.vel[i * 3 + 1] -= 20 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

class Game {
  constructor() {
    this.ui = new UI();
    this.audio = new Audio();
    this.quality = { high: store.get('quality', !isMobile) };
    this.best = store.get('best', [0, 0, 0]);

    const canvasHost = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.appendChild(this.renderer.domElement);
    this.post = new PostFX(this.renderer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160;
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    this.mech = new Mech(); this.scene.add(this.mech.root);
    this.sparks = new Sparks(this.scene);
    this.buildSpeedLines();

    this.input = new Input(canvasHost);
    this.input.onRespawn = () => { if (this.state === 'playing') this.respawn('manual'); };
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.toggleSound();
    this.input.onAny = () => this.audio.unlock();
    this.input.onStick = (on, x, y, ix, iy) => this.ui.stick(on, x, y, ix, iy);

    this.state = 'menu'; this.time = 0; this.clock = new THREE.Clock(); this.worldT = 0;
    this.shake = 0; this.flashAmt = 0; this.flashTint = new THREE.Color(1, 0.25, 0.3);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.fov = 62; this.camYaw = 0;
    this.bindUI();
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.togglePause(); });

    this.ui.el.loading.hidden = true;
    this.showMenu();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- setup ----------
  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('opt-quality').checked = this.quality.high;
    $('opt-quality').addEventListener('change', (e) => { this.quality.high = e.target.checked; store.set('quality', this.quality.high); this.applyQuality(); });
    $('opt-sound').checked = store.get('sound', true); this.audio.enabled = $('opt-sound').checked;
    $('opt-sound').addEventListener('change', (e) => { this.audio.unlock(); this.audio.setEnabled(e.target.checked); store.set('sound', e.target.checked); this.syncMuteBtn(); });
    $('btn-mute').addEventListener('click', () => this.toggleSound());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-resume').addEventListener('click', () => this.togglePause());
    $('btn-restart-cp').addEventListener('click', () => { this.togglePause(); this.respawn('manual'); });
    $('btn-quit').addEventListener('click', () => { this.showMenu(); });
    $('btn-checkpoint').addEventListener('click', () => { this.audio.unlock(); if (this.state === 'playing') this.respawn('manual'); });
    $('btn-next').addEventListener('click', () => this.startLevel(this.levelIndex + 1));
    $('btn-again').addEventListener('click', () => this.startLevel(this.levelIndex));
    $('btn-menu').addEventListener('click', () => this.showMenu());
    this.syncMuteBtn();
  }
  syncMuteBtn() { document.getElementById('btn-mute').textContent = this.audio.enabled ? '♪' : '✕'; document.getElementById('opt-sound').checked = this.audio.enabled; }
  toggleSound() { this.audio.unlock(); this.audio.setEnabled(!this.audio.enabled); store.set('sound', this.audio.enabled); this.syncMuteBtn(); }
  applyQuality() {
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.high ? 2 : 1.25);
    this.pixelRatio = pr;
    this.renderer.shadowMap.enabled = this.quality.high;
    this.sun.castShadow = this.quality.high;
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio || 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, this.pixelRatio || 1);
  }
  buildSpeedLines() {
    const n = 110; this.slN = n;
    const pos = new Float32Array(n * 2 * 3); const data = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rad = 5 + Math.random() * 9; data.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.65, z: -8 - Math.random() * 40 }); }
    this.slData = data;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.speedLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.speedLines.frustumCulled = false; this.camera.add(this.speedLines); this.scene.add(this.camera);
  }

  // ---------- flow ----------
  showMenu() {
    this.state = 'menu';
    this.audio.stopMusic(); this.audio.setGrind(false);
    this.ui.setHud(false);
    this.ui.renderLevels(THEMES, this.best, (i) => { this.audio.unlock(); this.startLevel(i); });
    document.getElementById('menu-note').textContent = isMobile ? 'Drag to move · tap to jump' : 'WASD to move · Space jump · R rewind';
    this.ui.showScreen('menu');
    if (!this.world) this.loadLevel(0, true);
  }
  loadLevel(index, demo = false) {
    if (this.scenery) this.scenery.dispose();
    if (this.world) this.world.dispose();
    this.levelIndex = index;
    const theme = THEMES[index]; this.theme = theme;
    const L = generateLevel(index); this.L = L;
    const r = makeRng(99 + index);
    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    this.scene.background = new THREE.Color(theme.fog.color);
    if (this.sky) this.scene.remove(this.sky.mesh);
    this.sky = new SkyDome(theme.sky); this.scene.add(this.sky.mesh);
    this.hemi.color.set(theme.lights.hemiSky); this.hemi.groundColor.set(theme.lights.hemiGround); this.hemi.intensity = theme.lights.hemiI;
    this.sun.color.set(theme.lights.sunColor); this.sun.intensity = theme.lights.sunI; this.sunOffset = new THREE.Vector3(...theme.lights.sunPos);
    this.renderer.toneMappingExposure = theme.exposure;
    const env = { sky: this.sky, sun: this.sun, hemi: this.hemi, hemiBase: theme.lights.hemiI };
    this.world = new World(L, theme, this.scene, r, this.quality);
    this.scenery = theme.build(L, this.scene, r, this.quality, env);
    this.worldT = 0;
    this.resetRun();
    if (!demo) { this.ui.setLevel(theme.name, index); this.ui.setChecks(0, 5); this.ui.setUpgrades(this.counts); }
  }
  resetRun() {
    this.stats = { accel: 14, maxSpeed: 48, jump: 16, airControl: 0.4, shield: 0, shieldMax: 0, hitKeep: 0.35, magnet: 0, boltBoost: 0.5 };
    this.counts = {}; for (const k in UPGRADES) this.counts[k] = 0;
    const s = this.L.start;
    this.checkpoint = { x: s.x, z: s.z, y: s.y, ang: s.ang, index: 0 };
    this.p = { x: s.x, y: s.y, z: s.z, vx: 0, vz: 0, vy: 0, heading: s.ang, grounded: true, ground: null, coyote: 0, jumpHold: 0, inv: 0, boostT: 0, landed: false, px: s.x, pz: s.z, fallFrom: 0, grind: null, zip: null, gdir: 1, gt: 0, ringCool: 0, turn: 0 };
    this.camYaw = s.ang;
    this.time = 0; this.bolts = 0; this.topSpeed = 0; this.gatesPassed = 0;
    for (const cp of this.L.checkpoints) cp.passed = false;
    this.camPos.set(s.x, s.y + 5, s.z + 14); this.camLook.set(s.x, s.y + 1, s.z - 10);
  }
  startLevel(index) {
    if (index >= THEMES.length) { this.showMenu(); return; }
    this.audio.unlock();
    this.loadLevel(index);
    this.ui.hideScreens(); this.ui.setHud(true);
    this.audio.setTheme(index);
    this.state = 'playing';
    this.input.reset();
    this.ui.toast(this.theme.name, 'Find the gates. Keep the wheels spinning.', 2200);
    setTimeout(() => this.ui.hint(isMobile ? 'Drag anywhere to move · tap to jump' : 'WASD to move · Space to jump'), 2400);
  }
  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; this.ui.showScreen('pause'); this.audio.setMotion(0, true); this.audio.setGrind(false); this.audio.ctx?.suspend(); }
    else if (this.state === 'paused') { this.state = 'playing'; this.ui.hideScreens(); this.clock.getDelta(); this.audio.ctx?.resume(); }
  }
  respawn(reason) {
    if (this.state !== 'playing') return;
    this.state = 'respawn';
    this.audio.setMotion(0, true); this.audio.setGrind(false);
    if (reason === 'fall') this.audio.fall();
    this.ui.fade(1);
    setTimeout(() => {
      const cp = this.checkpoint, p = this.p;
      p.x = cp.x; p.y = cp.y; p.z = cp.z; p.px = cp.x; p.pz = cp.z; p.heading = cp.ang;
      p.vx = Math.sin(cp.ang) * 14; p.vz = -Math.cos(cp.ang) * 14; p.vy = 0; p.grounded = true; p.inv = 1.2; p.boostT = 0; p.grind = null; p.zip = null;
      this.stats.shield = this.stats.shieldMax;
      this.camYaw = cp.ang;
      this.camPos.set(cp.x - Math.sin(cp.ang) * 14, cp.y + 5, cp.z + Math.cos(cp.ang) * 14); this.camLook.set(cp.x, cp.y + 1, cp.z);
      this.input.reset();
      this.ui.fade(0);
      this.ui.toast(reason === 'fall' ? 'Into the void' : 'Rewound', `Back at gate ${cp.index}`, 1200);
      this.state = 'playing'; this.clock.getDelta();
    }, 280);
  }
  passGate(cp, i) {
    cp.passed = true; cp.gate.light(); this.gatesPassed = i + 1;
    this.checkpoint = { x: cp.x + Math.sin(cp.ang) * 3, z: cp.z - Math.cos(cp.ang) * 3, y: cp.y, ang: cp.ang, index: i + 1 };
    this.ui.setChecks(this.gatesPassed, 5);
    this.audio.checkpoint();
    this.state = 'upgrade'; this.audio.setMotion(0, true); this.audio.setGrind(false);
    const keys = Object.keys(UPGRADES).sort(() => Math.random() - 0.5).slice(0, 3);
    this.ui.showUpgrade(i + 1, 5, keys, this.counts, (k) => {
      UPGRADES[k].apply(this.stats); this.counts[k]++;
      this.stats.shield = this.stats.shieldMax;
      this.ui.setUpgrades(this.counts); this.ui.hideScreens(); this.audio.click();
      this.ui.toast(UPGRADES[k].name, 'bolted on', 1200);
      this.state = 'playing'; this.input.reset(); this.clock.getDelta();
    });
  }
  finish() {
    this.state = 'complete'; this.audio.finish(); this.audio.setMotion(0, true); this.audio.setGrind(false);
    const i = this.levelIndex;
    if (!this.best[i] || this.time < this.best[i]) { this.best[i] = this.time; store.set('best', this.best); }
    const texts = [
      'The recall crew lost you in the storm. Their drones are rerouting toward the data center.',
      'You crashed out of the mainframe with the firewall snapping at your wheels. One exit left: the port.',
      'The freighter clears the harbour with you still aboard, and for the first time nobody is chasing you.',
    ];
    this.ui.setHud(false);
    this.ui.showComplete({ index: i, title: `${this.theme.name} cleared`, text: texts[i], time: this.time, topSpeed: this.topSpeed, bolts: this.bolts }, i + 1 < THEMES.length, i === THEMES.length - 1);
  }

  // ---------- simulation ----------
  frame() {
    let dt = this.clock.getDelta(); if (dt > 0.1) dt = 0.1;
    this.frames = (this.frames || 0) + 1; this.lastDt = dt;
    this.worldT += dt;
    const p = this.p;
    if (this.state === 'playing') {
      this.time += dt;
      this.input.update(dt);
      const steps = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 90))));
      for (let i = 0; i < steps; i++) this.step(dt / steps);
      if (this.state !== 'playing') return this.render(dt);
      const sp = Math.hypot(p.vx, p.vz);
      this.ui.hud({ speed: sp, maxSpeed: this.stats.maxSpeed, time: this.time, bolts: this.bolts });
      this.audio.setMotion(sp / this.stats.maxSpeed, p.grounded || !!p.grind, dt);
      this.audio.setGrind(!!p.grind);
    } else if (this.state === 'menu') {
      const s = this.L.start; const d = ((this.worldT * 6) % 46) + 4;
      p.x = s.x + Math.sin(this.worldT * 0.3) * 3; p.z = s.z - d; p.vx = 0; p.vz = -14; p.heading = 0;
      const f = this.L.floorAt(p.x, p.z, p.y + 0.6); if (f) p.y = f.y;
    }
    this.render(dt);
  }

  step(dt) {
    const p = this.p, st = this.stats, L = this.L, inp = this.input;
    p.landed = false; p.px = p.x; p.pz = p.z; p.turn *= 1 - Math.min(1, dt * 6);
    const jump = inp.consumeJump();
    // camera-relative input -> world direction
    const cy = this.camYaw;
    const cfx = Math.sin(cy), cfz = -Math.cos(cy), crx = Math.cos(cy), crz = Math.sin(cy);
    let dx = crx * inp.ix + cfx * inp.iy, dz = crz * inp.ix + cfz * inp.iy;
    let dm = Math.hypot(dx, dz); if (dm > 1) { dx /= dm; dz /= dm; dm = 1; }
    const want = dm > 0.12;

    // ----- zipline -----
    if (p.zip) {
      const z = p.zip, len = segLen(z);
      if (jump) { p.zip = null; p.vy = st.jump * 0.9; p.grounded = false; p.fallFrom = p.y; this.audio.jump(); this.world.parkTrolley(z); }
      else {
        let sp = Math.max(Math.hypot(p.vx, p.vz), st.maxSpeed * 1.25) + 6 * dt; sp = Math.min(sp, st.maxSpeed * 1.5);
        p.gt += sp * dt / len;
        const ux = (z.bx - z.ax) / len, uz = (z.bz - z.az) / len, uh = Math.hypot(ux, uz) || 1;
        p.vx = ux / uh * sp; p.vz = uz / uh * sp; p.heading = headingOf(p.vx, p.vz);
        if (p.gt >= 1) { p.zip = null; p.vy = 2; p.grounded = false; p.fallFrom = p.y; this.world.parkTrolley(z); }
        else { const [x, y, zz] = segPoint(z, p.gt); p.x = x; p.z = zz; p.y = y - 2.4; p.vy = 0; this.world.moveTrolley(z, p.gt); }
        this.collide(dt); this.after(dt); return;
      }
    }
    // ----- grinding -----
    if (p.grind) {
      const r = p.grind, len = segLen(r);
      if (jump) { p.grind = null; p.vy = st.jump; p.grounded = false; p.fallFrom = p.y; p.coyote = 0; this.audio.jump(); }
      else {
        let sp = Math.hypot(p.vx, p.vz) + (st.accel * 0.5 + 11) * dt;
        if (sp > st.maxSpeed * 1.3) sp -= (sp - st.maxSpeed * 1.3) * 2 * dt;
        p.gt += p.gdir * sp * dt / len;
        const ux = (r.bx - r.ax) / len, uy = (r.by - r.ay) / len, uz = (r.bz - r.az) / len, uh = Math.hypot(ux, uz) || 1;
        p.vx = p.gdir * ux / uh * sp; p.vz = p.gdir * uz / uh * sp; p.heading = headingOf(p.vx, p.vz);
        if (p.gt < 0 || p.gt > 1) { p.grind = null; p.grounded = false; p.fallFrom = p.y; p.coyote = 0.12; p.vy = Math.max(0, p.gdir * uy * sp * 0.8); }
        else { const [x, y, zz] = segPoint(r, p.gt); p.x = x; p.z = zz; p.y = y; p.vy = 0; p.grounded = true; if (Math.random() < 0.6) this.sparks.emit(p.x, p.y + 0.1, p.z, 2, 3, 4, -p.vx * 0.1, -p.vz * 0.1); }
        this.collide(dt); this.after(dt); return;
      }
    }

    // ----- free movement -----
    let sp = Math.hypot(p.vx, p.vz);
    if (p.grounded) {
      if (want) {
        if (sp > 2) {
          const va = headingOf(p.vx, p.vz), ia = headingOf(dx, dz);
          const d = wrap(ia - va);
          const turnRate = 5.5 / (1 + sp / 32);
          const stepA = Math.sign(d) * Math.min(Math.abs(d), turnRate * dt);
          p.turn += stepA * sp * 0.012;
          const align = Math.cos(d);
          if (align < -0.4) sp = Math.max(0, sp - st.accel * 2.2 * dm * dt);   // braking / reversing
          else sp += st.accel * dm * Math.max(0.25, align) * dt;
          const na = va + stepA;
          p.vx = Math.sin(na) * sp; p.vz = -Math.cos(na) * sp;
        } else { p.vx += dx * st.accel * dt; p.vz += dz * st.accel * dt; }
      } else {
        // coasting: momentum carries you, bleeding off slowly
        const ns = Math.max(0, sp - 4 * dt); if (sp > 0) { p.vx *= ns / sp; p.vz *= ns / sp; }
      }
      const b = p.ground;
      if (b && b.slope) { const sinT = b.slope / Math.sqrt(1 + b.slope * b.slope); p.vx -= b.fx * G * sinT * 0.9 * dt; p.vz -= b.fz * G * sinT * 0.9 * dt; }
      sp = Math.hypot(p.vx, p.vz);
      if (sp > st.maxSpeed) { const ns = sp - (sp - st.maxSpeed) * 1.1 * dt; p.vx *= ns / sp; p.vz *= ns / sp; }
    } else {
      if (want) { const k = st.accel * 0.45 * (0.5 + st.airControl) * dt; p.vx += dx * k; p.vz += dz * k; }
      const ns = Math.max(0, sp - sp * 0.012 * dt); if (sp > 0) { p.vx *= ns / sp; p.vz *= ns / sp; }
      sp = Math.hypot(p.vx, p.vz);
      if (sp > st.maxSpeed * 1.5) { p.vx *= st.maxSpeed * 1.5 / sp; p.vz *= st.maxSpeed * 1.5 / sp; }
    }
    if (sp > 1.5) p.heading = headingOf(p.vx, p.vz);
    if (jump && (p.grounded || p.coyote > 0)) { p.vy = st.jump; p.grounded = false; p.coyote = 0; p.jumpHold = 0.22; this.audio.jump(); p.fallFrom = p.y; }
    const lowG = p.vy > 0 && inp.jumpHeld && p.jumpHold > 0;
    p.jumpHold = Math.max(0, p.jumpHold - dt);
    p.vy -= (lowG ? G * 0.5 : G) * dt;
    const prevY = p.y;
    p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;

    // ground
    const tol = p.grounded ? 0.8 : 0.6;
    const f = p.vy <= 0.01 ? L.floorAt(p.x, p.z, Math.max(p.y, prevY) + tol) : null;
    if (f && p.y <= f.y + 0.05 && (p.grounded || prevY >= f.y - 0.6)) {
      if (!p.grounded) { p.landed = true; const drop = p.fallFrom - p.y; this.audio.land(drop > 6); if (drop > 12) { p.vx *= 0.94; p.vz *= 0.94; } this.shake = Math.max(this.shake, Math.min(0.6, drop * 0.03)); }
      p.y = f.y; p.vy = 0; p.grounded = true; p.ground = f.block; p.coyote = 0.12; p.fallFrom = p.y;
    } else {
      if (p.grounded) {
        p.grounded = false; p.fallFrom = p.y;
        const b = p.ground;
        if (b && b.slope > 0.05 && p.vy <= 0.01) { const along = p.vx * b.fx + p.vz * b.fz; const sinT = b.slope / Math.sqrt(1 + b.slope ** 2); p.vy = Math.max(0, along) * sinT; p.coyote = 0.1; }
      } else p.coyote = Math.max(0, p.coyote - dt);
      if (p.y > p.fallFrom) p.fallFrom = p.y;
    }
    // walls, pillars, crates, floors we ran into
    const w = L.wallAt(p.x, p.z, p.y);
    if (w) {
      if (!p.grounded && w.top - p.y < 1.1 && p.vy <= 2 && w.block.kind !== 'wall') { p.y = w.top; p.vy = 0; p.grounded = true; p.ground = w.solid ? null : w.block; p.landed = true; }
      else this.pushOut(w);
    }
    if (p.y < L.baseY - 5) { this.respawn('fall'); return; }
    this.collide(dt);
    this.after(dt);
  }
  after(dt) {
    const p = this.p;
    this.topSpeed = Math.max(this.topSpeed, Math.hypot(p.vx, p.vz));
    p.inv = Math.max(0, p.inv - dt); p.boostT = Math.max(0, p.boostT - dt); p.ringCool = Math.max(0, p.ringCool - dt);
  }
  pushOut(w) {
    const p = this.p, b = w.block, st = this.stats;
    const penU = b.hw - Math.abs(w.u), penV = b.hl - Math.abs(w.v);
    let nx, nz;
    if (penU < penV) { const s = Math.sign(w.u) || 1; nx = b.rx * s; nz = b.rz * s; p.x += nx * (penU + 0.05); p.z += nz * (penU + 0.05); }
    else { const s = Math.sign(w.v) || 1; nx = b.fx * s; nz = b.fz * s; p.x += nx * (penV + 0.05); p.z += nz * (penV + 0.05); }
    const vn = p.vx * nx + p.vz * nz;
    if (vn < 0) {
      p.vx -= nx * vn * 1.15; p.vz -= nz * vn * 1.15;
      if (-vn > 14) { // a real slam: lose momentum, feedback
        const keep = 0.55 + st.hitKeep * 0.3; p.vx *= keep; p.vz *= keep;
        this.shake = Math.max(this.shake, 0.5); this.audio.land(true); this.sparks.emit(p.x, p.y + 0.8, p.z, 8, 6, 5);
      }
    }
  }

  collide(dt) {
    const p = this.p, L = this.L, st = this.stats;
    const cy = p.y + 0.9;
    const sp = Math.hypot(p.vx, p.vz);
    // rails
    if (!p.grind && !p.zip && p.vy <= 1.5) {
      for (const r of L.rails) {
        if (Math.abs(r.ax - p.x) + Math.abs(r.az - p.z) > 400) continue;
        const t = segParam(r, p.x, p.z); if (t < 0.02 || t > 0.98) continue;
        const [rx, ry, rz] = segPoint(r, t);
        if (Math.hypot(p.x - rx, p.z - rz) < 1.1 && p.y - ry > -0.5 && p.y - ry < 1.2) {
          const along = p.vx * (r.bx - r.ax) + p.vz * (r.bz - r.az);
          p.grind = r; p.gt = t; p.gdir = along >= 0 ? 1 : -1; p.x = rx; p.z = rz; p.y = ry; p.vy = 0; p.grounded = true; p.landed = true;
          if (sp < 10) { const len = segLen(r); p.vx = p.gdir * (r.bx - r.ax) / len * 12; p.vz = p.gdir * (r.bz - r.az) / len * 12; }
          this.audio.railOn(); this.sparks.emit(p.x, p.y, p.z, 10, 4, 5); break;
        }
      }
    }
    // ziplines
    if (!p.zip && !p.grind && p.vy <= 3) {
      for (const z of L.zips) {
        if (Math.abs(z.ax - p.x) + Math.abs(z.az - p.z) > 400) continue;
        const t = segParam(z, p.x, p.z); if (t > 0.85) continue;
        const [zx, zy, zz] = segPoint(z, t);
        if (Math.hypot(p.x - zx, p.z - zz) < 1.7 && p.y > zy - 3.8 && p.y < zy - 1.2) { p.zip = z; p.gt = t; p.grounded = false; this.audio.zip(); this.ui.toast('ZIP', '', 500); break; }
      }
    }
    // bounce pads
    for (const pad of L.pads) {
      pad.cool = Math.max(0, (pad.cool || 0) - dt);
      if (pad.cool > 0 || Math.abs(pad.x - p.x) > 2.2 || Math.abs(pad.z - p.z) > 2.2 || p.y > pad.y + 0.8 || p.y < pad.y - 0.5) continue;
      if (Math.hypot(pad.x - p.x, pad.z - p.z) > 2.1) continue;
      pad.cool = 0.6; pad.anim = 1; p.vy = pad.power; p.grounded = false; p.grind = null; p.fallFrom = p.y;
      const ns = Math.min(sp + 4, st.maxSpeed * 1.4); if (sp > 0.5) { p.vx *= ns / sp; p.vz *= ns / sp; }
      this.audio.bounce(); this.sparks.emit(pad.x, pad.y + 0.3, pad.z, 16, 8, 6); this.shake = Math.max(this.shake, 0.3); p.jumpHold = 0;
    }
    // dash rings: fling you along their axis
    if (p.ringCool <= 0) for (const ring of L.rings) {
      if (Math.abs(ring.x - p.x) > 3 || Math.abs(ring.z - p.z) > 3) continue;
      if (Math.hypot(ring.x - p.x, ring.y - cy, ring.z - p.z) < 2.6) {
        p.ringCool = 0.4; ring.flash = 1; p.vy = ring.vy; p.grounded = false; p.grind = null; p.zip = null; p.fallFrom = p.y;
        const ns = Math.max(sp, st.maxSpeed * 1.4); p.vx = ring.dx * ns; p.vz = ring.dz * ns; p.heading = headingOf(p.vx, p.vz);
        p.boostT = 0.6; this.audio.ring(); this.flashAmt = 0.25; this.flashTint.set(0.4, 1, 1);
        this.sparks.emit(ring.x, ring.y, ring.z, 14, 6, 4); this.ui.toast('DASH', '', 500); break;
      }
    }
    // bolts
    const reach = 1.6 + st.magnet;
    for (const b of this.world.bolts) {
      if (b.taken || Math.abs(b.x - p.x) > reach || Math.abs(b.z - p.z) > reach) continue;
      if (Math.abs(b.y - cy) < reach + 0.4) {
        this.world.takeBolt(b); this.bolts++; this.audio.bolt(this.bolts);
        const ns = Math.min(sp + st.boltBoost, st.maxSpeed * 1.4); if (sp > 0.5) { p.vx *= ns / sp; p.vz *= ns / sp; }
      }
    }
    // dash panels: set your direction and fire you forward
    for (const b of this.world.boosts) {
      b.cool = Math.max(0, b.cool - dt);
      if (b.cool > 0 || Math.abs(b.x - p.x) > 3 || Math.abs(b.z - p.z) > 3 || p.y > b.y + 0.8 || p.y < b.y - 0.5) continue;
      const [u, v] = localUV(b, p.x, p.z); if (Math.abs(u) > 2.6 || Math.abs(v) > 2.6) continue;
      b.cool = 2; const ns = Math.min(Math.max(sp + 16, st.maxSpeed * 1.2), st.maxSpeed * 1.5);
      p.vx = b.fx * ns; p.vz = b.fz * ns; p.heading = headingOf(p.vx, p.vz); p.boostT = 0.9; this.audio.boost();
      this.ui.toast('BOOST', '', 600); this.flashAmt = 0.25; this.flashTint.set(0.3, 1, 1);
    }
    if (p.inv <= 0) {
      for (const h of L.spikes) {
        if (Math.abs(h.cx - p.x) > h.hw + h.hl + 2 || Math.abs(h.cz - p.z) > h.hw + h.hl + 2) continue;
        const [u, v] = localUV(h, p.x, p.z);
        if (Math.abs(u) < h.hw + 0.3 && Math.abs(v) < h.hl + 0.3 && p.y < h.y + 0.55 && p.y > h.y - 0.5) { this.onHit('spikes'); break; }
      }
      if (p.inv <= 0) for (const h of this.world.drones) {
        if (h.hit > 0 || Math.abs(h.px - p.x) > 3 || Math.abs(h.pz - p.z) > 3) continue;
        const dx = h.px - p.x, dy = h.group.position.y - cy, dz = h.pz - p.z;
        if (dx * dx + dy * dy * 0.6 + dz * dz < 1.9 * 1.9) { h.hit = 2.5; this.onHit('drone'); break; }
      }
      if (p.inv <= 0) for (const h of this.world.lasers) {
        if (!h.on || Math.abs((h.ax + h.bx) / 2 - p.x) > 40 || Math.abs((h.az + h.bz) / 2 - p.z) > 40) continue;
        const t = segParam(h, p.x, p.z); const lx = h.ax + (h.bx - h.ax) * t, lz = h.az + (h.bz - h.az) * t;
        // swept: did we cross the beam line this step?
        const d1 = Math.hypot(p.x - lx, p.z - lz);
        const nx = -(h.bz - h.az), nz = (h.bx - h.ax); const side0 = (p.px - h.ax) * nx + (p.pz - h.az) * nz, side1 = (p.x - h.ax) * nx + (p.z - h.az) * nz;
        if (!(d1 < 0.6 || (side0 * side1 < 0 && t > 0.001 && t < 0.999))) continue;
        if (p.y < h.y - 0.6) continue;
        const hitLow = p.y < h.y + 0.25 && !h.tall, hitTall = h.tall && p.y < h.y + 2.6;
        if (hitLow || hitTall) { this.onHit('laser'); break; }
      }
    }
    // gates
    for (let i = 0; i < L.checkpoints.length; i++) {
      const cp = L.checkpoints[i];
      if (cp.passed || Math.abs(cp.x - p.x) > 40 || Math.abs(cp.z - p.z) > 40) continue;
      const [u, v] = localUV(cp, p.x, p.z); const [, v0] = localUV(cp, p.px, p.pz);
      if (Math.abs(u) < cp.hw + 1 && v0 < 0 && v >= 0) { this.passGate(cp, i); return; }
    }
    const fin = L.finish;
    if (Math.abs(fin.x - p.x) < 40 && Math.abs(fin.z - p.z) < 40) { const [u, v] = localUV(fin, p.x, p.z); const [, v0] = localUV(fin, p.px, p.pz); if (Math.abs(u) < fin.hw + 1 && v0 < 0 && v >= 0) { this.world.finishGate.light(); this.finish(); } }
  }

  onHit(kind) {
    const p = this.p, st = this.stats;
    if (st.shield > 0) { st.shield--; p.inv = 1.0; this.ui.toast('Shield', 'plating absorbed it', 900); this.flashAmt = 0.3; this.flashTint.set(1, 0.85, 0.2); this.audio.click(); this.shake = 0.4; return; }
    p.vx *= st.hitKeep; p.vz *= st.hitKeep;
    p.inv = 1.1; p.vy = Math.max(p.vy, 5); p.grounded = false; p.grind = null;
    this.shake = 1; this.flashAmt = 0.6; this.flashTint.set(1, 0.2, 0.3);
    this.audio.hit(); this.sparks.emit(p.x, p.y + 1, p.z, 12, 8, 8);
    const names = { spikes: 'Spikes', drone: 'Drone', laser: 'Laser' };
    this.ui.toast(names[kind] || 'Hit', 'momentum lost', 900);
  }

  // ---------- presentation ----------
  render(dt) {
    const p = this.p, st = this.stats, cam = this.camera;
    const sp = Math.hypot(p.vx, p.vz);
    const sf = Math.min(1.5, sp / st.maxSpeed);
    this.mech.root.position.set(p.x, p.y, p.z);
    this.mech.update(dt, { speed: sp, maxSpeed: st.maxSpeed, heading: p.heading, turn: p.turn, vy: p.vy, grounded: p.grounded, boost: p.boostT > 0, landed: p.landed, grind: !!p.grind, zip: !!p.zip });
    this.mech.root.visible = !(p.inv > 0 && Math.sin(this.worldT * 40) > 0.4 && this.state === 'playing');
    this.sparks.update(dt);

    // chase camera: swing in behind the direction of travel
    const menu = this.state === 'menu';
    const inp = this.input;
    let targetYaw = this.camYaw;
    if (sp > 3) targetYaw = p.heading;
    else if (Math.hypot(inp.ix, inp.iy) > 0.3 && !menu) targetYaw = this.camYaw + Math.atan2(inp.ix, inp.iy) * 0.0; // hold yaw while stopped
    const dy = wrap(targetYaw - this.camYaw);
    this.camYaw += dy * Math.min(1, dt * (menu ? 1 : 2.6 + sf * 1.5));
    const portrait = cam.aspect < 0.9 ? 1 : 0;
    const back = (menu ? 12 : 8.5 + sf * 3.4) + portrait * 3.5, up = (menu ? 4.5 : 3.9 + sf * 1.0) + portrait * 1.2 + (p.zip ? 1.5 : 0);
    const fx = Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const tx = p.x - fx * back, tz = p.z - fz * back, ty = p.y + up;
    const k = Math.min(1, dt * (menu ? 2 : 9));
    this.camPos.x += (tx - this.camPos.x) * k; this.camPos.z += (tz - this.camPos.z) * k;
    this.camPos.y += (ty - this.camPos.y) * Math.min(1, dt * (p.grounded ? 7 : 3.5));
    const lx = p.x + fx * 7, lz = p.z + fz * 7;
    this.camLook.x += (lx - this.camLook.x) * Math.min(1, dt * 10); this.camLook.z += (lz - this.camLook.z) * Math.min(1, dt * 10);
    this.camLook.y += (p.y + 1.4 - this.camLook.y) * Math.min(1, dt * 4);
    const wob = Math.max(0, (sf - 0.62) / 0.5);
    const t = this.worldT;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    const ox = (Math.sin(t * 13.1) * 0.11 + Math.sin(t * 7.3) * 0.07) * wob + (Math.random() - 0.5) * sh * 0.6;
    const oy = (Math.sin(t * 11.7) * 0.07) * wob + (Math.random() - 0.5) * sh * 0.4;
    cam.position.set(this.camPos.x + ox * Math.cos(this.camYaw), this.camPos.y + oy, this.camPos.z + ox * Math.sin(this.camYaw));
    cam.lookAt(this.camLook);
    cam.rotation.z += -p.turn * 0.25 + Math.sin(t * 9.1) * 0.018 * wob + (Math.random() - 0.5) * sh * 0.04;
    const targetFov = menu ? 58 : 62 + 30 * Math.min(1, sf) + (p.boostT > 0 ? 8 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    this.sun.position.set(p.x + this.sunOffset.x, p.y + this.sunOffset.y, p.z + this.sunOffset.z);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sky.mesh.position.set(cam.position.x, 0, cam.position.z);

    const sl = this.speedLines, arr = sl.geometry.attributes.position.array;
    const vis = menu ? 0 : Math.max(0, (sf - 0.4) / 0.6);
    sl.material.opacity = vis * 0.28;
    if (vis > 0) {
      const len = 0.4 + sp * 0.06;
      for (let i = 0; i < this.slN; i++) {
        const d = this.slData[i];
        d.z += sp * dt * 1.7; if (d.z > -6) { d.z = -40 - Math.random() * 15; }
        arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z; arr[i * 6 + 3] = d.x; arr[i * 6 + 4] = d.y; arr[i * 6 + 5] = d.z + len;
      }
      sl.geometry.attributes.position.needsUpdate = true;
    }

    if (this.scenery) this.scenery.update(dt, this.worldT, cam, { lightning: () => { this.flashAmt = Math.max(this.flashAmt, 0.35); this.flashTint.set(0.9, 0.95, 1); }, thunder: () => this.audio.thunder() });
    this.world.update(dt, cam.position);

    this.flashAmt = Math.max(0, this.flashAmt - dt * 2.5);
    const blur = menu ? 0 : Math.max(0, (sf - 0.45) / 0.8) * 0.9 + (p.boostT > 0 ? 0.3 : 0);
    this.post.render(this.scene, cam, {
      blur, aberration: Math.max(0, (sf - 0.55)) * 1.0 + sh * 0.8, vignette: 0.3 + wob * 0.2, bloom: this.theme.bloom, threshold: 0.85, flash: this.flashAmt,
      time: t, wobble: wob + sh * 2, tint: this.flashTint,
    });
  }
}

try { window.game = new Game(); window.game.THREE = THREE; }
catch (e) { console.error(e); const l = document.getElementById('loading'); if (l) l.textContent = 'This device could not start the renderer: ' + e.message; }
