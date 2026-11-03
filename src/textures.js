import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function finish(c, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function speckle(ctx, size, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * 255);
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha * Math.random()})` : `rgba(${v},${v},${v},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

// Mossy stone tiles (jungle floor)
export function texStone(size = 512) {
  const [c, g] = canvas(size);
  g.fillStyle = '#5c5f52'; g.fillRect(0, 0, size, size);
  const n = 4, t = size / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const moss = Math.random();
    const r = 118 + Math.random() * 30, gg = 120 + Math.random() * 25 + moss * 22, b = 100 + Math.random() * 22;
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
    g.fillStyle = `rgba(70,110,50,${0.22 * moss})`;
    g.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x * t + 3, y * t + 3, t - 6, 3);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x * t + 3, y * t + t - 7, t - 6, 4);
  }
  speckle(g, size, 4000, 0.25, false);
  return finish(c);
}

// Riveted steel deck plates (ship)
export function texSteel(size = 512, base = '#6f7781') {
  const [c, g] = canvas(size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const nx = 2, ny = 4, tw = size / nx, th = size / ny;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const v = 95 + Math.random() * 25;
    g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    g.fillRect(x * tw + 2, y * th + 2, tw - 4, th - 4);
    g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(x * tw + 2, y * th + 2, tw - 4, 2);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x * tw + 2, y * th + th - 4, tw - 4, 2);
    for (let i = 0; i < 6; i++) {
      const rx = x * tw + 10 + (i / 5) * (tw - 20);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(rx, y * th + 8, 3, 0, 6.3); g.fill();
      g.beginPath(); g.arc(rx, y * th + th - 8, 3, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(rx - 1, y * th + 7, 1.5, 0, 6.3); g.fill();
    }
  }
  speckle(g, size, 5000, 0.18, false);
  // rust streaks
  for (let i = 0; i < 20; i++) {
    g.fillStyle = `rgba(120,70,30,${0.08 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 6, 20 + Math.random() * 90);
  }
  return finish(c);
}

// Hazard stripes (ramps, hurdles)
export function texHazard(size = 256, a = '#f2b705', b = '#1a1a1a') {
  const [c, g] = canvas(size);
  g.fillStyle = b; g.fillRect(0, 0, size, size);
  g.fillStyle = a;
  const w = size / 4;
  for (let i = -1; i < 6; i++) {
    g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w + w / 2, 0); g.lineTo(i * w + w / 2 - size, size); g.lineTo(i * w - size, size); g.fill();
  }
  speckle(g, size, 1500, 0.2, false);
  return finish(c);
}

// Cyber grid: returns [colorMap, emissiveMap]
export function texGrid(size = 512, line = '#37e8ff', base = '#0a0d1f') {
  const [c, g] = canvas(size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const n = 4, t = size / n;
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  for (let i = 0; i <= n * 4; i++) { const p = (i * t) / 4; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke(); }
  const [e, eg] = canvas(size);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, size, size);
  eg.strokeStyle = line; eg.lineWidth = 4; eg.shadowColor = line; eg.shadowBlur = 10;
  for (let i = 0; i <= n; i++) { const p = Math.min(size - 2, Math.max(2, i * t)); eg.beginPath(); eg.moveTo(p, 0); eg.lineTo(p, size); eg.stroke(); eg.beginPath(); eg.moveTo(0, p); eg.lineTo(size, p); eg.stroke(); }
  return [finish(c), finish(e)];
}

// Windows for towers / superstructure: returns emissive map
export function texWindows(size = 256, cols = 8, rows = 16, color = '#ffe9b0', density = 0.5, tint = '#1a2233') {
  const [c, g] = canvas(size);
  g.fillStyle = tint; g.fillRect(0, 0, size, size);
  const [e, eg] = canvas(size);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, size, size);
  const cw = size / cols, rh = size / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const on = Math.random() < density;
    g.fillStyle = on ? '#2a3a4a' : '#0c1119';
    g.fillRect(x * cw + cw * 0.22, y * rh + rh * 0.25, cw * 0.56, rh * 0.5);
    if (on) { eg.fillStyle = color; eg.globalAlpha = 0.4 + Math.random() * 0.6; eg.fillRect(x * cw + cw * 0.22, y * rh + rh * 0.25, cw * 0.56, rh * 0.5); }
  }
  return [finish(c), finish(e)];
}

// Corrugated container side
export function texContainer(size = 256) {
  const [c, g] = canvas(size);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  const n = 16, w = size / n;
  for (let i = 0; i < n; i++) {
    const grad = g.createLinearGradient(i * w, 0, i * w + w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.05)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = grad; g.fillRect(i * w, 0, w, size);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, size, 8); g.fillRect(0, size - 8, size, 8);
  speckle(g, size, 2500, 0.25, false);
  for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(90,50,20,${0.1 + Math.random() * 0.2})`; g.fillRect(Math.random() * size, Math.random() * size, 3 + Math.random() * 10, 10 + Math.random() * 60); }
  return finish(c);
}

// Soft particle sprite
export function texDot(size = 64) {
  const [c, g] = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return finish(c, { srgb: false });
}

// Chevron boost pad emissive
export function texChevron(size = 256) {
  const [c, g] = canvas(size);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) {
    const y = i * (size / 3);
    g.beginPath(); g.moveTo(size * 0.1, y + size * 0.3); g.lineTo(size * 0.5, y + size * 0.08); g.lineTo(size * 0.9, y + size * 0.3);
    g.lineTo(size * 0.9, y + size * 0.18); g.lineTo(size * 0.5, y - size * 0.04); g.lineTo(size * 0.1, y + size * 0.18); g.fill();
  }
  return finish(c, { srgb: false });
}

// Dirt / jungle ground with leaf litter
export function texDirt(size = 512) {
  const [c, g] = canvas(size);
  g.fillStyle = '#6b5a42'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2500; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(70,110,50,${0.3 + Math.random() * 0.4})` : `rgba(150,120,70,${0.2 + Math.random() * 0.3})`;
    g.beginPath(); g.ellipse(Math.random() * size, Math.random() * size, 3 + Math.random() * 8, 2 + Math.random() * 4, Math.random() * 3, 0, 6.3); g.fill();
  }
  speckle(g, size, 4000, 0.2, false);
  return finish(c);
}
