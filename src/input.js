// Free-direction input: keyboard (WASD / arrows) and a touch joystick (drag from wherever the finger lands).
// Tap = jump, a second finger while steering = jump. Direction is camera-relative; main.js maps it to the world.
export class Input {
  constructor(el) {
    this.el = el;
    this.ix = 0; this.iy = 0;           // smoothed stick, unit disc
    this.kx = 0; this.ky = 0; this.tx = 0; this.ty = 0;
    this.jumpHeld = false; this.jumpBuffer = 0;
    this.onRespawn = null; this.onPause = null; this.onMute = null; this.onAny = null; this.onStick = null;
    this.enabled = true;
    const keys = new Set(); this.keys = keys;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'shift'].includes(k)) { this.queueJump(); this.jumpHeld = true; e.preventDefault(); }
      if (['a', 'arrowleft'].includes(k)) keys.add('L'); if (['d', 'arrowright'].includes(k)) keys.add('R');
      if (['w', 'arrowup'].includes(k)) keys.add('U'); if (['s', 'arrowdown'].includes(k)) keys.add('D');
      if (k === 'r') this.onRespawn && this.onRespawn();
      if (k === 'escape' || k === 'p') this.onPause && this.onPause();
      if (k === 'm') this.onMute && this.onMute();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      this.onAny && this.onAny();
      this.updateKeys();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if ([' ', 'shift'].includes(k)) this.jumpHeld = false;
      if (['a', 'arrowleft'].includes(k)) keys.delete('L'); if (['d', 'arrowright'].includes(k)) keys.delete('R');
      if (['w', 'arrowup'].includes(k)) keys.delete('U'); if (['s', 'arrowdown'].includes(k)) keys.delete('D');
      this.updateKeys();
    });
    window.addEventListener('blur', () => { keys.clear(); this.updateKeys(); this.jumpHeld = false; });

    const pointers = new Map(); this.stickPointer = null;
    const range = () => Math.min(90, Math.max(50, window.innerWidth * 0.1));
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.onAny && this.onAny();
      const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, jumped: false, timer: null };
      if (this.stickPointer !== null) { p.jumped = true; this.queueJump(); this.jumpHeld = true; }
      else {
        this.stickPointer = e.pointerId;
        this.onStick && this.onStick(true, p.x0, p.y0, 0, 0);
        p.timer = setTimeout(() => { if (!p.moved && !p.jumped) { p.jumped = true; this.queueJump(); this.jumpHeld = true; } }, 200);
      }
      pointers.set(e.pointerId, p);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!p.moved && Math.hypot(dx, dy) > 10) { p.moved = true; if (p.timer) clearTimeout(p.timer); }
      if (p.moved && e.pointerId === this.stickPointer) {
        const r = range(); let x = dx / r, y = -dy / r; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
        this.tx = x; this.ty = y;
        this.onStick && this.onStick(true, p.x0, p.y0, x, y);
      }
    });
    const up = (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      if (!p.moved && !p.jumped && performance.now() - p.t0 < 300) this.queueJump();
      if (p.jumped) this.jumpHeld = false;
      pointers.delete(e.pointerId);
      if (e.pointerId === this.stickPointer) { this.stickPointer = null; this.tx = 0; this.ty = 0; this.onStick && this.onStick(false, 0, 0, 0, 0); }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  updateKeys() {
    this.kx = (this.keys.has('R') ? 1 : 0) - (this.keys.has('L') ? 1 : 0);
    this.ky = (this.keys.has('U') ? 1 : 0) - (this.keys.has('D') ? 1 : 0);
    const m = Math.hypot(this.kx, this.ky); if (m > 1) { this.kx /= m; this.ky /= m; }
  }
  queueJump() { this.jumpBuffer = 0.14; }
  consumeJump() { if (this.jumpBuffer > 0) { this.jumpBuffer = 0; return true; } return false; }
  update(dt) {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const tx = this.kx || this.ky ? this.kx : this.tx, ty = this.kx || this.ky ? this.ky : this.ty;
    const k = Math.min(1, dt * 16);
    this.ix += (tx - this.ix) * k; this.iy += (ty - this.iy) * k;
  }
  reset() { this.jumpBuffer = 0; this.tx = 0; this.ty = 0; this.ix = 0; this.iy = 0; }
}
