import * as THREE from 'three';
import { generateLevel, makeRng, CORRIDOR_HALF as W } from './level.js';
import { THEMES, SkyDome } from './themes.js';
import { World } from './world.js';
import { Mech } from './mech.js';
import { PostFX } from './post.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI, UPGRADES, fmtTime } from './ui.js';

const G = 40;
const store = {
  get(k, d) { try { const v = localStorage.getItem('therun.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('therun.' + k, JSON.stringify(v)); } catch (_) {} },
};
const isMobile = navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) < 900;

class Game {
  constructor() {
    this.ui = new UI();
    this.audio = new Audio();
    this.quality = { high: store.get('quality', !isMobile) };
    this.best = store.get('best', [0, 0, 0]);

    const canvasHost = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.appendChild(this.renderer.domElement);
    this.post = new PostFX(this.renderer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160;
    const sc = this.sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    this.mech = new Mech(); this.scene.add(this.mech.root);
    this.buildSpeedLines();

    this.input = new Input(canvasHost);
    this.input.onRespawn = () => { if (this.state === 'playing') this.respawn('manual'); };
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.toggleSound();
    this.input.onAny = () => this.audio.unlock();

    this.state = 'menu'; this.time = 0; this.clock = new THREE.Clock(); this.worldT = 0;
    this.shake = 0; this.flashAmt = 0; this.flashTint = new THREE.Color(1, 0.25, 0.3);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.fov = 62;
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
    this.audio.stopMusic();
    this.ui.setHud(false);
    this.ui.renderLevels(THEMES, this.best, (i) => { this.audio.unlock(); this.startLevel(i); });
    document.getElementById('menu-note').textContent = isMobile ? 'Drag to steer · tap to jump' : 'A/D steer · Space jump · R rewind';
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
    // environment
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
    if (!demo) {
      this.ui.setLevel(theme.name, index); this.ui.setChecks(0, 5); this.ui.setUpgrades(this.counts);
    }
  }
  resetRun() {
    this.stats = { accel: 9, maxSpeed: 36, jump: 15, airControl: 0.35, shield: 0, shieldMax: 0, hitKeep: 0.35, magnet: 0, boltBoost: 0.4 };
    this.counts = {}; for (const k in UPGRADES) this.counts[k] = 0;
    this.checkpoint = { s: 4, x: 0, y: 0, index: 0 };
    this.p = { x: 0, y: 0, s: 4, vx: 0, vy: 0, speed: 8, grounded: true, groundSlope: 0, coyote: 0, jumpHold: 0, inv: 0, boostT: 0, landed: false, prevS: 4, fallFrom: 0 };
    this.time = 0; this.bolts = 0; this.topSpeed = 0; this.gatesPassed = 0;
    for (const cp of this.L.checkpoints) cp.passed = false;
    this.camPos.set(0, 5, 14); this.camLook.set(0, 1, -10);
  }
  startLevel(index) {
    if (index >= THEMES.length) { this.showMenu(); return; }
    this.audio.unlock();
    this.loadLevel(index);
    this.ui.hideScreens(); this.ui.setHud(true);
    this.audio.setTheme(index);
    this.state = 'playing';
    this.input.reset();
    this.ui.toast(this.theme.name, 'Reach the gate. Keep the wheels spinning.', 2200);
    setTimeout(() => this.ui.hint(isMobile ? 'Tap to jump · drag to steer' : 'Space to jump · A/D to steer'), 2400);
  }
  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; this.ui.showScreen('pause'); this.audio.setMotion(0, true); this.audio.ctx?.suspend(); }
    else if (this.state === 'paused') { this.state = 'playing'; this.ui.hideScreens(); this.clock.getDelta(); this.audio.ctx?.resume(); }
  }
  respawn(reason) {
    if (this.state !== 'playing') return;
    this.state = 'respawn';
    this.audio.setMotion(0, true);
    if (reason === 'fall') this.audio.fall();
    this.ui.fade(1);
    setTimeout(() => {
      const cp = this.checkpoint, p = this.p;
      p.x = cp.x; p.y = cp.y; p.s = cp.s; p.prevS = cp.s; p.vx = 0; p.vy = 0; p.speed = 10; p.grounded = true; p.inv = 1.2; p.boostT = 0;
      this.stats.shield = this.stats.shieldMax;
      this.camPos.set(cp.x, cp.y + 5, -cp.s + 14); this.camLook.set(cp.x, cp.y + 1, -cp.s - 10);
      this.input.reset();
      this.ui.fade(0);
      this.ui.toast(reason === 'fall' ? 'Into the void' : 'Rewound', `Back at gate ${cp.index}`, 1200);
      this.state = 'playing'; this.clock.getDelta();
    }, 280);
  }
  passGate(cp, i) {
    cp.passed = true; cp.gate.light(); this.gatesPassed = i + 1;
    this.checkpoint = { s: cp.s + 3, x: 0, y: cp.y, index: i + 1 };
    this.ui.setChecks(this.gatesPassed, 5);
    this.audio.checkpoint();
    this.state = 'upgrade'; this.audio.setMotion(0, true);
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
    this.state = 'complete'; this.audio.finish(); this.audio.setMotion(0, true);
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
      if (this.state !== 'playing') return this.render(dt); // state changed in step
      this.ui.hud({ speed: p.speed, maxSpeed: this.stats.maxSpeed, time: this.time, bolts: this.bolts });
      this.audio.setMotion(p.speed / this.stats.maxSpeed, p.grounded, dt);
    } else if (this.state === 'menu') {
      // slow demo drift so the title screen has life
      p.s += dt * 6; p.x = Math.sin(this.worldT * 0.3) * 3; p.speed = 14;
      const f = this.L.floorAt(p.x, p.s, p.y + 0.6); if (f) p.y = f.y; if (p.s > 50) p.s = 4;
    }
    this.render(dt);
  }

  step(dt) {
    const p = this.p, st = this.stats, L = this.L, inp = this.input;
    p.landed = false; p.prevS = p.s;
    const sf = p.speed / st.maxSpeed;
    // steering
    const lat = (8 + p.speed * 0.26) * (p.grounded ? 1 : 0.5 + st.airControl * 0.5);
    const targetVx = inp.steer * lat;
    p.vx += (targetVx - p.vx) * Math.min(1, dt * (p.grounded ? 11 : 6));
    // forward momentum
    if (p.grounded) {
      const sinT = p.groundSlope / Math.sqrt(1 + p.groundSlope * p.groundSlope);
      p.speed += (st.accel - G * sinT * 0.9) * dt;
      if (p.speed > st.maxSpeed) p.speed -= (p.speed - st.maxSpeed) * 1.1 * dt;
      if (p.speed < 3) p.speed = 3;
    } else {
      p.speed -= p.speed * 0.015 * dt;
    }
    // jump
    if (inp.consumeJump() && (p.grounded || p.coyote > 0)) {
      p.vy = st.jump; p.grounded = false; p.coyote = 0; p.jumpHold = 0.22; this.audio.jump(); p.fallFrom = p.y;
    }
    const lowG = p.vy > 0 && inp.jumpHeld && p.jumpHold > 0;
    p.jumpHold = Math.max(0, p.jumpHold - dt);
    p.vy -= (lowG ? G * 0.5 : G) * dt;
    const prevY = p.y;
    p.s += p.speed * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    // corridor walls
    const lim = W - 0.7;
    if (p.x > lim) { p.x = lim; if (p.vx > 0) { p.vx = -p.vx * 0.2; p.speed *= 1 - (1 - st.hitKeep) * 0.08; } }
    if (p.x < -lim) { p.x = -lim; if (p.vx < 0) { p.vx = -p.vx * 0.2; p.speed *= 1 - (1 - st.hitKeep) * 0.08; } }
    // ground: look for a surface we were above (or on) a moment ago and are now at or below
    const tol = p.grounded ? 0.8 : 0.6;
    const f = p.vy <= 0.01 ? L.floorAt(p.x, p.s, Math.max(p.y, prevY) + tol) : null;
    if (f && p.y <= f.y + 0.05 && (p.grounded || prevY >= f.y - 0.6)) {
      if (!p.grounded) { p.landed = true; const drop = p.fallFrom - p.y; this.audio.land(drop > 6); if (drop > 9) p.speed *= 0.93; this.shake = Math.max(this.shake, Math.min(0.6, drop * 0.04)); }
      p.y = f.y; p.vy = 0; p.grounded = true; p.groundSlope = f.block.slope; p.coyote = 0.12; p.fallFrom = p.y;
    } else {
      if (p.grounded) {
        p.grounded = false; p.fallFrom = p.y;
        if (p.groundSlope > 0.05 && p.vy <= 0.01) { const sinT = p.groundSlope / Math.sqrt(1 + p.groundSlope ** 2); p.vy = p.speed * sinT; p.coyote = 0.1; }
      } else p.coyote = Math.max(0, p.coyote - dt);
      if (p.y > p.fallFrom) p.fallFrom = p.y;
      // solid collision: running into the face of a platform
      const wall = L.wallAt(p.x, p.s, p.y);
      if (wall) {
        if (wall.top - p.y < 1.1 && p.vy <= 2) { p.y = wall.top; p.vy = 0; p.grounded = true; p.groundSlope = wall.block.slope; p.landed = true; } // ledge grab
        else { p.s = wall.block.s0 - 0.4; p.speed *= 0.2 + st.hitKeep * 0.2; p.vy = Math.max(p.vy, 3); this.onHit('wall'); }
      }
    }
    // fell out of the world
    if (p.y < -5) { this.respawn('fall'); return; }
    this.collide(dt);
    this.topSpeed = Math.max(this.topSpeed, p.speed);
    p.inv = Math.max(0, p.inv - dt); p.boostT = Math.max(0, p.boostT - dt);
  }

  collide(dt) {
    const p = this.p, L = this.L, st = this.stats;
    const s0 = Math.min(p.prevS, p.s), s1 = Math.max(p.prevS, p.s) + 0.001;
    const cy = p.y + 0.9;
    // bolts
    const reach = 1.5 + st.magnet;
    for (const b of this.world.bolts) {
      if (b.taken || b.s < s0 - reach || b.s > s1 + reach) continue;
      if (Math.abs(b.x - p.x) < reach && Math.abs(b.y - cy) < reach + 0.4) {
        this.world.takeBolt(b); this.bolts++; this.audio.bolt(this.bolts);
        p.speed = Math.min(p.speed + st.boltBoost, st.maxSpeed * 1.35);
      }
    }
    // boosts
    for (const b of this.world.boosts) {
      b.cool = Math.max(0, b.cool - dt);
      if (b.cool > 0 || b.s1 < s0 || b.s0 > s1) continue;
      if (p.x > b.x0 - 0.5 && p.x < b.x1 + 0.5 && p.y < b.y + 0.8) {
        b.cool = 2; p.speed = Math.max(p.speed + 14, st.maxSpeed * 1.15); p.speed = Math.min(p.speed, st.maxSpeed * 1.5); p.boostT = 0.9; this.audio.boost();
        this.ui.toast('BOOST', '', 600); this.flashAmt = 0.25; this.flashTint.set(0.3, 1, 1);
      }
    }
    if (p.inv <= 0) {
      for (const h of L.hazards) {
        if (h.type === 'spikes') {
          if (h.s1 < s0 || h.s0 > s1) continue;
          if (p.x > h.x0 - 0.3 && p.x < h.x1 + 0.3 && p.y < h.y + 0.55) { this.onHit('spikes'); break; }
        } else if (h.type === 'drone') {
          if (h.hit > 0 || Math.abs(h.s - p.s) > 3) continue;
          const dx = h.px - p.x, dy = h.group.position.y - cy, dz = h.s - p.s;
          if (dx * dx + dy * dy * 0.6 + dz * dz < 1.9 * 1.9) { h.hit = 2.5; this.onHit('drone'); break; }
        } else if (h.type === 'laser') {
          if (!h.on || h.s < s0 || h.s > s1) continue;
          if (p.x < h.x0 - 0.4 || p.x > h.x1 + 0.4) continue;
          const low = h.y, hitLow = p.y < low + 0.25 && !h.tall;
          const hitTall = h.tall && p.y < low + 2.6;
          if (hitLow || hitTall) { this.onHit('laser'); break; }
        } else if (h.type === 'hurdle') {
          if (h.s1 < s0 || h.s0 > s1) continue;
          if (p.x > h.x0 - 0.5 && p.x < h.x1 + 0.5 && p.y < h.y + h.h - 0.25) { p.s = h.s0 - 0.6; p.vy = Math.max(p.vy, 4); this.onHit('hurdle'); break; }
        }
      }
    }
    // gates
    for (let i = 0; i < L.checkpoints.length; i++) {
      const cp = L.checkpoints[i];
      if (!cp.passed && cp.s >= s0 && cp.s <= s1) { this.passGate(cp, i); return; }
    }
    if (L.finishS >= s0 && L.finishS <= s1) { this.world.finishGate.light(); this.finish(); }
  }

  onHit(kind) {
    const p = this.p, st = this.stats;
    if (st.shield > 0) { st.shield--; p.inv = 1.0; this.ui.toast('Shield', 'plating absorbed it', 900); this.flashAmt = 0.3; this.flashTint.set(1, 0.85, 0.2); this.audio.click(); this.shake = 0.4; return; }
    if (kind !== 'wall' && kind !== 'hurdle') p.speed *= st.hitKeep;
    p.inv = 1.1; p.vy = Math.max(p.vy, 5); p.grounded = false;
    this.shake = 1; this.flashAmt = 0.6; this.flashTint.set(1, 0.2, 0.3);
    this.audio.hit();
    const names = { spikes: 'Spikes', drone: 'Drone', laser: 'Laser', hurdle: 'Barrier', wall: 'Wall' };
    this.ui.toast(names[kind] || 'Hit', 'momentum lost', 900);
  }

  // ---------- presentation ----------
  render(dt) {
    const p = this.p, st = this.stats, cam = this.camera;
    const sf = Math.min(1.5, p.speed / st.maxSpeed);
    this.mech.root.position.set(p.x, p.y, -p.s);
    this.mech.update(dt, { speed: p.speed, maxSpeed: st.maxSpeed, vx: p.vx, vy: p.vy, grounded: p.grounded, boost: p.boostT > 0, landed: p.landed });
    this.mech.root.visible = !(p.inv > 0 && Math.sin(this.worldT * 40) > 0.4 && this.state === 'playing');

    // camera
    const menu = this.state === 'menu';
    const portrait = cam.aspect < 0.9 ? 1 : 0;
    const back = (menu ? 11 : 7.8 + sf * 3.2) + portrait * 3.5, up = (menu ? 4.5 : 3.6 + sf * 0.9) + portrait * 1.2;
    const tx = p.x * 0.75, ty = p.y + up, tz = -p.s + back;
    const k = Math.min(1, dt * (menu ? 2 : 7));
    this.camPos.x += (tx - this.camPos.x) * k; this.camPos.z += (tz - this.camPos.z) * Math.min(1, dt * 12);
    this.camPos.y += (ty - this.camPos.y) * Math.min(1, dt * (p.grounded ? 7 : 3.5));
    this.camLook.x += (p.x * 0.9 - this.camLook.x) * k; this.camLook.y += (p.y + 1.4 - this.camLook.y) * Math.min(1, dt * 4); this.camLook.z = -p.s - 12;
    // speed wobble + hit shake
    const wob = Math.max(0, (sf - 0.62) / 0.5);
    const t = this.worldT;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    const ox = (Math.sin(t * 13.1) * 0.11 + Math.sin(t * 7.3) * 0.07) * wob + (Math.random() - 0.5) * sh * 0.6;
    const oy = (Math.sin(t * 11.7) * 0.07) * wob + (Math.random() - 0.5) * sh * 0.4;
    cam.position.set(this.camPos.x + ox, this.camPos.y + oy, this.camPos.z);
    cam.lookAt(this.camLook);
    cam.rotation.z += -p.vx * 0.006 + Math.sin(t * 9.1) * 0.018 * wob + (Math.random() - 0.5) * sh * 0.04;
    const targetFov = menu ? 58 : 62 + 30 * Math.min(1, sf) + (p.boostT > 0 ? 8 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    // sun follows player for shadows
    this.sun.position.set(p.x + this.sunOffset.x, p.y + this.sunOffset.y, -p.s + this.sunOffset.z);
    this.sun.target.position.set(p.x, p.y, -p.s - 6);
    this.sky.mesh.position.set(cam.position.x, 0, cam.position.z);

    // speed lines
    const sl = this.speedLines, arr = sl.geometry.attributes.position.array;
    const vis = menu ? 0 : Math.max(0, (sf - 0.4) / 0.6);
    sl.material.opacity = vis * 0.28;
    if (vis > 0) {
      const len = 0.4 + p.speed * 0.06;
      for (let i = 0; i < this.slN; i++) {
        const d = this.slData[i];
        d.z += p.speed * dt * 1.7; if (d.z > -6) { d.z = -40 - Math.random() * 15; }
        arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z; arr[i * 6 + 3] = d.x; arr[i * 6 + 4] = d.y; arr[i * 6 + 5] = d.z + len;
      }
      sl.geometry.attributes.position.needsUpdate = true;
    }

    // scenery + world animation
    if (this.scenery) this.scenery.update(dt, this.worldT, cam, { lightning: () => { this.flashAmt = Math.max(this.flashAmt, 0.35); this.flashTint.set(0.9, 0.95, 1); }, thunder: () => this.audio.thunder() });
    this.world.update(dt, p.s, cam.position.z);

    // post
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
