const $ = (id) => document.getElementById(id);

export const UPGRADES = {
  speed:  { name: 'Overdrive Hub',   short: 'SPD', color: '#37e8ff', desc: 'Raises top speed. Longer flight, bigger gaps, louder wind.', apply: (s) => { s.maxSpeed += 8; } },
  accel:  { name: 'Torque Coil',     short: 'ACC', color: '#ffb347', desc: 'Spins back up faster after a hit, a stop, or a rewind.', apply: (s) => { s.accel += 4.5; } },
  jump:   { name: 'Spring Struts',   short: 'JMP', color: '#7ed957', desc: 'Legs store more energy. Higher arcs, longer hang time.', apply: (s) => { s.jump += 2.4; } },
  air:    { name: 'Gyro Fins',       short: 'AIR', color: '#c58cff', desc: 'Steer hard while airborne. Correct a bad line mid-leap.', apply: (s) => { s.airControl = Math.min(1.2, s.airControl + 0.5); } },
  shield: { name: 'Bumper Plating',  short: 'SHD', color: '#f2b705', desc: 'Absorb one hit per gate without losing momentum.', apply: (s) => { s.shieldMax += 1; s.shield = s.shieldMax; } },
  grip:   { name: 'Tread Grip',      short: 'GRP', color: '#ff7a1a', desc: 'Hits cost less momentum. Walls scrub less speed.', apply: (s) => { s.hitKeep = Math.min(0.8, s.hitKeep + 0.15); } },
  magnet: { name: 'Bolt Magnet',     short: 'MAG', color: '#ffe066', desc: 'Pulls bolts in from further away. Every bolt is a nudge of speed.', apply: (s) => { s.magnet += 1.6; s.boltBoost += 0.5; } },
};

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), level: $('hud-level'), checks: $('hud-checks'), time: $('hud-time'), bolts: $('hud-bolts'), speed: $('hud-speed'), bar: $('hud-bar'), ups: $('hud-ups'),
      toast: $('toast'), flash: $('flash'), fade: $('fade'), hint: $('hint'), loading: $('loading'),
      stick: $('stick'), menu: $('screen-menu'), upgrade: $('screen-upgrade'), pause: $('screen-pause'), complete: $('screen-complete'), picks: $('picks'), levelList: $('level-list'),
    };
    this.toastTimer = null; this.hintTimer = null;
    this.lastSpeed = -1; this.lastTime = ''; this.lastBolts = -1;
  }
  stick(on, x, y, ix, iy) {
    const el = this.el.stick; el.classList.toggle('on', on);
    if (on) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.firstElementChild.style.transform = `translate(${ix * 38}px, ${-iy * 38}px)`; }
  }
  showScreen(name) {
    for (const k of ['menu', 'upgrade', 'pause', 'complete']) this.el[k].hidden = k !== name;
  }
  hideScreens() { this.showScreen(null); }
  setHud(on) { this.el.hud.hidden = !on; }
  renderLevels(themes, best, onPick) {
    this.el.levelList.innerHTML = '';
    themes.forEach((t, i) => {
      const b = document.createElement('button'); b.className = 'level'; b.type = 'button';
      const bt = best[i] ? fmtTime(best[i]) : 'not cleared';
      b.innerHTML = `<div class="swatch" style="background:${t.swatch}"></div><div class="name">${i + 1}. ${t.name}</div><div class="meta">Best ${bt}</div>`;
      b.addEventListener('click', () => onPick(i));
      this.el.levelList.appendChild(b);
    });
  }
  hud(st) {
    const sp = Math.round(st.speed * 2.5);
    if (sp !== this.lastSpeed) { this.el.speed.textContent = sp; this.lastSpeed = sp; this.el.speed.classList.toggle('hot', st.speed > st.maxSpeed * 0.92); }
    const f = Math.min(1, st.speed / (st.maxSpeed * 1.3));
    this.el.bar.style.width = (f * 100).toFixed(1) + '%';
    this.el.bar.classList.toggle('over', st.speed > st.maxSpeed + 0.5);
    const t = fmtTime(st.time); if (t !== this.lastTime) { this.el.time.textContent = t; this.lastTime = t; }
    if (st.bolts !== this.lastBolts) { this.el.bolts.textContent = '⚙ ' + st.bolts; this.lastBolts = st.bolts; }
  }
  setLevel(name, index) { this.el.level.textContent = `${index + 1} · ${name}`; }
  setChecks(passed, total) {
    const kids = this.el.checks.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < passed);
  }
  setUpgrades(counts) {
    this.el.ups.innerHTML = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `<span class="up" style="border-color:${UPGRADES[k].color}55">${UPGRADES[k].short}<b>${n}</b></span>`).join('');
  }
  toast(text, sub = '', ms = 1400) {
    const el = this.el.toast; el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`; el.classList.add('show');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  hint(text, ms = 3000) {
    const el = this.el.hint; el.textContent = text; el.classList.add('show');
    clearTimeout(this.hintTimer); this.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  flash(color, strength = 0.5) {
    const el = this.el.flash; el.style.background = color; el.style.transition = 'none'; el.style.opacity = strength;
    requestAnimationFrame(() => { el.style.transition = 'opacity .45s'; el.style.opacity = 0; });
  }
  fade(to) { this.el.fade.style.opacity = to; }
  showUpgrade(gateIndex, total, keys, counts, onPick) {
    $('up-eyebrow').textContent = `Gate ${gateIndex} of ${total}`;
    const box = this.el.picks; box.innerHTML = '';
    keys.forEach((k) => {
      const u = UPGRADES[k];
      const b = document.createElement('button'); b.className = 'pick'; b.type = 'button';
      b.innerHTML = `<div class="ico" style="background:${u.color}">${u.short}</div><div class="t">${u.name}</div><div class="d">${u.desc}</div><div class="lvl">${counts[k] ? `Level ${counts[k]} → ${counts[k] + 1}` : 'New part'}</div>`;
      b.addEventListener('click', () => onPick(k));
      box.appendChild(b);
    });
    this.showScreen('upgrade');
    const first = box.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  showComplete(stats, hasNext, last) {
    $('done-eyebrow').textContent = last ? 'The run is over' : `Level ${stats.index + 1} clear`;
    $('done-title').textContent = last ? 'You got away. For now.' : stats.title;
    $('done-text').textContent = stats.text;
    $('done-time').textContent = fmtTime(stats.time);
    $('done-speed').textContent = Math.round(stats.topSpeed * 2.5);
    $('done-bolts').textContent = stats.bolts;
    $('btn-next').hidden = !hasNext;
    this.showScreen('complete');
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
