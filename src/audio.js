// Procedural audio: engine hum + wind that scale with momentum, short synth SFX, and a tiny per-theme sequencer.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.speed = 0; this.musicOn = true; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.enabled ? 0.8 : 0; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.42; this.music.connect(this.master);
    // reverb
    const len = c.sampleRate * 1.4, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = c.createConvolver(); this.verb.buffer = buf; this.verbGain = c.createGain(); this.verbGain.gain.value = 0.35; this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.sfx.connect(this.verb); this.music.connect(this.verb);
    // engine
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 40;
    this.eng2 = c.createOscillator(); this.eng2.type = 'square'; this.eng2.frequency.value = 80.5;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 300; this.engF.Q.value = 4;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF); this.eng2.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master);
    this.eng.start(); this.eng2.start();
    // wind
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.wind = c.createBufferSource(); this.wind.buffer = nb; this.wind.loop = true;
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.6;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master); this.wind.start();
    this.seq = null;
  }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05); }
  // f = speed fraction (0..1.5), g = grounded
  setMotion(f, grounded, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(38 + f * 150, t, 0.1); this.eng2.frequency.setTargetAtTime(76 + f * 300, t, 0.1);
    this.engF.frequency.setTargetAtTime(250 + f * 1800, t, 0.1);
    this.engG.gain.setTargetAtTime((0.04 + f * 0.11) * (grounded ? 1 : 0.6), t, 0.1);
    this.windG.gain.setTargetAtTime(Math.pow(Math.min(1.4, f), 2) * 0.35 * (grounded ? 1 : 1.3), t, 0.1);
    this.windF.frequency.setTargetAtTime(400 + f * 1500, t, 0.1);
  }
  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, dest) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.3, freq = 800, type = 'lowpass') {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t); s.stop(t + dur + 0.02);
  }
  jump() { this.tone(240, 0.28, 'triangle', 0.25, 2.4); this.noise(0.18, 0.12, 1800, 'highpass'); }
  land(hard) { this.noise(0.14, hard ? 0.4 : 0.18, 500); this.tone(90, 0.12, 'sine', hard ? 0.35 : 0.15, 0.6); }
  hit() { this.noise(0.35, 0.5, 1200); this.tone(160, 0.35, 'sawtooth', 0.35, 0.3); this.tone(110, 0.4, 'square', 0.2, 0.5); }
  bolt(n) { const base = 660 * Math.pow(1.06, n % 8); this.tone(base, 0.12, 'sine', 0.18); this.tone(base * 2, 0.16, 'triangle', 0.08); }
  boost() { this.noise(0.5, 0.35, 600, 'bandpass'); this.tone(200, 0.5, 'sawtooth', 0.2, 3.5); }
  checkpoint() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.25), i * 90)); }
  finish() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.9, 'triangle', 0.25), i * 110)); }
  fall() { this.tone(400, 0.7, 'sine', 0.25, 0.25); this.noise(0.6, 0.2, 400); }
  thunder() { this.noise(2.2, 0.55, 220); setTimeout(() => this.noise(1.6, 0.35, 120), 180); }
  click() { this.tone(900, 0.05, 'square', 0.08); }

  // ---- music ----
  setTheme(index) {
    if (!this.ctx) { this.pendingTheme = index; return; }
    this.stopMusic();
    const themes = [
      { bpm: 120, scale: [0, 2, 4, 7, 9], root: 220, lead: 'triangle', bass: 'sine', chords: [0, 3, 4, 3], hats: true, pad: false },
      { bpm: 134, scale: [0, 2, 3, 5, 7, 8, 10], root: 174.6, lead: 'square', bass: 'sawtooth', chords: [0, 0, 5, 3], hats: true, pad: true },
      { bpm: 112, scale: [0, 2, 3, 5, 7, 9, 10], root: 196, lead: 'sawtooth', bass: 'sawtooth', chords: [0, 2, 3, 4], hats: false, pad: true },
    ];
    const th = themes[index % themes.length]; this.th = th;
    this.step = 0; this.nextT = this.ctx.currentTime + 0.1;
    this.seq = setInterval(() => this.schedule(), 40);
  }
  stopMusic() { if (this.seq) clearInterval(this.seq); this.seq = null; }
  schedule() {
    const c = this.ctx, th = this.th; const spb = 60 / th.bpm / 4; // 16th
    while (this.nextT < c.currentTime + 0.15) {
      const t = this.nextT, s = this.step;
      const bar = Math.floor(s / 16), chord = th.chords[bar % th.chords.length];
      const deg = (d) => th.root * Math.pow(2, (th.scale[(d) % th.scale.length] + 12 * Math.floor(d / th.scale.length)) / 12);
      // kick
      if (s % 4 === 0) this.drum(t, 150, 0.09, 0.55);
      if (th.hats && s % 2 === 1) this.hat(t, 0.06);
      if (s % 8 === 4) this.drum(t, 400, 0.12, 0.2, true);
      // bass
      if (s % 4 === 0 || s % 16 === 10) this.note(t, deg(chord) / 2, spb * 3.5, th.bass, 0.22, 400);
      // arp
      const arpDeg = chord + [0, 2, 4, 7, 4, 2, 0, 9][(s + bar) % 8];
      if (s % 2 === 0 || th.bpm > 125) this.note(t, deg(arpDeg) * 2, spb * 1.6, th.lead, th.lead === 'square' ? 0.05 : 0.09, 1600 + Math.sin(bar) * 400);
      // pad
      if (th.pad && s % 16 === 0) { this.note(t, deg(chord), spb * 15, 'triangle', 0.08, 700); this.note(t, deg(chord + 2) * 1.002, spb * 15, 'triangle', 0.06, 700); }
      this.nextT += spb; this.step++;
    }
  }
  note(t, f, dur, type, vol, cutoff) {
    const c = this.ctx; const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.05);
  }
  drum(t, f, dur, vol, snare) {
    const c = this.ctx; const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(snare ? 120 : 40, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.1);
    if (snare) { const s = c.createBufferSource(); s.buffer = this.noiseBuf; const ng = c.createGain(); ng.gain.setValueAtTime(vol * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; s.connect(hp); hp.connect(ng); ng.connect(this.music); s.start(t); s.stop(t + 0.15); }
  }
  hat(t, vol) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf; const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; s.connect(hp); hp.connect(g); g.connect(this.music); s.start(t); s.stop(t + 0.06);
  }
}
