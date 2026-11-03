// Touch (drag = steer, tap = jump), mouse and keyboard.
export class Input {
  constructor(el) {
    this.el = el;
    this.steer = 0; this.keySteer = 0; this.touchSteer = 0;
    this.jumpHeld = false; this.jumpBuffer = 0; // seconds remaining in buffer
    this.onRespawn = null; this.onPause = null; this.onMute = null; this.onAny = null;
    this.touch = null; // active steering touch
    this.enabled = true;
    const keys = new Set(); this.keys = keys;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'w'].includes(k)) { this.queueJump(); this.jumpHeld = true; e.preventDefault(); }
      if (['a', 'arrowleft'].includes(k)) keys.add('L');
      if (['d', 'arrowright'].includes(k)) keys.add('R');
      if (k === 'r') this.onRespawn && this.onRespawn();
      if (k === 'escape' || k === 'p') this.onPause && this.onPause();
      if (k === 'm') this.onMute && this.onMute();
      this.onAny && this.onAny();
      this.updateKeySteer();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'w'].includes(k)) this.jumpHeld = false;
      if (['a', 'arrowleft'].includes(k)) keys.delete('L');
      if (['d', 'arrowright'].includes(k)) keys.delete('R');
      this.updateKeySteer();
    });
    window.addEventListener('blur', () => { keys.clear(); this.updateKeySteer(); this.jumpHeld = false; });

    // pointer events cover touch + mouse
    const pointers = new Map();
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.onAny && this.onAny();
      const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t0: performance.now(), moved: false, jumped: false, timer: null };
      if (pointers.size >= 1) { // a second finger while steering = instant jump
        p.jumped = true; this.queueJump(); this.jumpHeld = true;
      } else {
        // if the finger holds still for a beat, treat it as a jump right away (fast response), keep hold for a higher arc
        p.timer = setTimeout(() => { if (!p.moved && !p.jumped) { p.jumped = true; this.queueJump(); this.jumpHeld = true; } }, 200);
      }
      pointers.set(e.pointerId, p);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      p.x = e.clientX;
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!p.moved && Math.hypot(dx, dy) > 10) { p.moved = true; if (p.timer) clearTimeout(p.timer); }
      if (p.moved && !p.jumped) {
        const range = Math.min(140, Math.max(70, window.innerWidth * 0.16));
        this.touchSteer = Math.max(-1, Math.min(1, dx / range));
      }
    });
    const up = (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      if (!p.moved && !p.jumped && performance.now() - p.t0 < 300) this.queueJump();
      if (p.jumped) this.jumpHeld = false;
      pointers.delete(e.pointerId);
      if (![...pointers.values()].some((q) => q.moved)) this.touchSteer = 0;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  updateKeySteer() { this.keySteer = (this.keys.has('R') ? 1 : 0) - (this.keys.has('L') ? 1 : 0); }
  queueJump() { this.jumpBuffer = 0.14; }
  consumeJump() { if (this.jumpBuffer > 0) { this.jumpBuffer = 0; return true; } return false; }
  update(dt) {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const target = this.keySteer !== 0 ? this.keySteer : this.touchSteer;
    this.steer += (target - this.steer) * Math.min(1, dt * 14);
  }
  reset() { this.jumpBuffer = 0; this.touchSteer = 0; this.steer = 0; }
}
