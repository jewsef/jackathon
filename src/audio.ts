/** Synthesised sound: a drone for the sky that follows the weather, and small cues for events. No audio files. */
export class Sound {
  ctx: AudioContext | null = null;
  on = false;
  private master!: GainNode; private rainGain!: GainNode; private droneGain!: GainNode; private windFilter!: BiquadFilterNode;
  start() {
    if (this.ctx) { this.on = true; this.master.gain.value = 0.5; void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext(); this.ctx = ctx; this.on = true;
      this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
      this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.06; this.droneGain.connect(this.master);
      for (const f of [55, 82.4, 110.2]) {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.05 + f / 4000; lg.gain.value = 0.6;
        lfo.connect(lg); lg.connect(o.detune); o.connect(this.droneGain); o.start(); lfo.start();
      }
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = "lowpass"; this.windFilter.frequency.value = 500;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.015;
      noise.connect(this.windFilter); this.windFilter.connect(this.rainGain); this.rainGain.connect(this.master); noise.start();
    } catch { this.on = false; }
  }
  stop() { if (this.ctx) this.master.gain.value = 0; this.on = false; }
  weather(rain: number, storm: boolean, zoom: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(0.012 + rain * 0.05 + (storm ? 0.08 : 0) + Math.min(0.04, zoom * 0.002), t, 0.8);
    this.windFilter.frequency.setTargetAtTime(storm ? 1400 : 400 + rain * 600, t, 0.8);
  }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  bell() { this.tone(660, 1.6, "sine", 0.12); this.tone(990, 1.2, "sine", 0.05); }
  boom() { this.tone(70, 1.8, "sawtooth", 0.18, 0.4); }
  thunder() { this.tone(110, 1.4, "square", 0.08, 0.3); }
  sick() { this.tone(196, 1.4, "triangle", 0.1); this.tone(233, 1.4, "triangle", 0.08); }
  drum() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone(90, 0.25, "triangle", 0.2, 0.6), i * 180); }
  chime() { this.tone(880, 0.6, "sine", 0.06); }
}
