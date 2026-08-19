/**
 * Procedural audio.
 *
 * Every sound is synthesised at runtime with the Web Audio API — there are no
 * sample files to license, ship, or wait on, and the whole layer costs a few
 * kilobytes. Music is a slow generative pad over a fixed chord progression so
 * it never loops audibly.
 */
import { prefs, onPrefsChange } from '../prefs';

export type Sfx =
  | 'click'
  | 'hover'
  | 'dice'
  | 'land'
  | 'step'
  | 'money_in'
  | 'money_out'
  | 'buy'
  | 'build'
  | 'demolish'
  | 'card'
  | 'detention'
  | 'trade'
  | 'bid'
  | 'turn'
  | 'error'
  | 'bankrupt'
  | 'victory'
  | 'join'
  | 'chat';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private started = false;
  private lastPlay = new Map<string, number>();

  /** Browsers require a gesture before audio can start; main.ts wires this up. */
  unlock(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);

    // A gentle low-pass keeps the pad from fighting the effects for space.
    const musicFilter = this.ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 1400;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(musicFilter);
    musicFilter.connect(this.master);

    this.buildNoise();
    this.applyVolumes();
    if (prefs.musicOn) this.startMusic();
  }

  private buildNoise(): void {
    if (!this.ctx) return;
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  applyVolumes(): void {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(prefs.sfxOn ? prefs.sfxVolume : 0, t, 0.05);
    this.musicBus.gain.setTargetAtTime(prefs.musicOn ? prefs.musicVolume * 0.5 : 0, t, 0.6);
    if (prefs.musicOn) this.startMusic();
    else this.stopMusic();
  }

  /* ---------------------------------------------------------------- */
  /* Building blocks                                                   */
  /* ---------------------------------------------------------------- */

  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    attack?: number;
  }): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), start + opts.dur);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(start);
    osc.stop(start + opts.dur + 0.05);
  }

  private noise(opts: {
    dur: number;
    gain?: number;
    delay?: number;
    filter?: number;
    filterTo?: number;
    q?: number;
    type?: BiquadFilterType;
  }): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noiseBuffer) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.filter ?? 900, start);
    if (opts.filterTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterTo), start + opts.dur);
    filter.Q.value = opts.q ?? 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.16, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(bus);
    src.start(start);
    src.stop(start + opts.dur + 0.05);
  }

  /* ---------------------------------------------------------------- */
  /* Effects                                                           */
  /* ---------------------------------------------------------------- */

  play(sound: Sfx, throttleMs = 0): void {
    if (!prefs.sfxOn) return;
    if (!this.ctx) return;
    if (throttleMs > 0) {
      const last = this.lastPlay.get(sound) ?? 0;
      const now = performance.now();
      if (now - last < throttleMs) return;
      this.lastPlay.set(sound, now);
    }
    switch (sound) {
      case 'click':
        this.tone({ freq: 620, to: 460, dur: 0.07, type: 'triangle', gain: 0.11 });
        break;
      case 'hover':
        this.tone({ freq: 900, dur: 0.045, type: 'sine', gain: 0.045 });
        break;
      case 'dice':
        // Three scattered clacks: dice tumbling across the table.
        for (let i = 0; i < 4; i++) {
          this.noise({ dur: 0.075, gain: 0.13, delay: i * 0.085 + Math.random() * 0.03, filter: 2200, q: 2.4 });
        }
        break;
      case 'land':
        this.noise({ dur: 0.13, gain: 0.16, filter: 480, filterTo: 140, type: 'lowpass' });
        this.tone({ freq: 220, to: 130, dur: 0.16, type: 'sine', gain: 0.12 });
        break;
      case 'step':
        this.tone({ freq: 760 + Math.random() * 120, dur: 0.05, type: 'triangle', gain: 0.05 });
        break;
      case 'money_in':
        this.tone({ freq: 880, dur: 0.14, type: 'sine', gain: 0.14 });
        this.tone({ freq: 1320, dur: 0.22, type: 'sine', gain: 0.1, delay: 0.06 });
        this.tone({ freq: 1760, dur: 0.28, type: 'sine', gain: 0.06, delay: 0.12 });
        break;
      case 'money_out':
        this.tone({ freq: 520, to: 300, dur: 0.2, type: 'triangle', gain: 0.13 });
        this.noise({ dur: 0.14, gain: 0.07, filter: 1400, filterTo: 400 });
        break;
      case 'buy':
        this.tone({ freq: 523, dur: 0.13, type: 'triangle', gain: 0.13 });
        this.tone({ freq: 659, dur: 0.13, type: 'triangle', gain: 0.13, delay: 0.08 });
        this.tone({ freq: 1046, dur: 0.3, type: 'sine', gain: 0.11, delay: 0.16 });
        break;
      case 'build':
        this.noise({ dur: 0.09, gain: 0.15, filter: 1600, q: 1.6 });
        this.tone({ freq: 180, to: 320, dur: 0.16, type: 'square', gain: 0.07, delay: 0.02 });
        this.tone({ freq: 1200, dur: 0.14, type: 'sine', gain: 0.07, delay: 0.1 });
        break;
      case 'demolish':
        this.noise({ dur: 0.34, gain: 0.16, filter: 900, filterTo: 120, type: 'lowpass' });
        break;
      case 'card':
        this.noise({ dur: 0.2, gain: 0.09, filter: 3200, filterTo: 1200, q: 0.8 });
        this.tone({ freq: 700, to: 1200, dur: 0.2, type: 'sine', gain: 0.08, delay: 0.05 });
        break;
      case 'detention':
        this.tone({ freq: 300, to: 120, dur: 0.42, type: 'sawtooth', gain: 0.11 });
        this.noise({ dur: 0.3, gain: 0.1, filter: 300, type: 'lowpass', delay: 0.06 });
        break;
      case 'trade':
        this.tone({ freq: 440, dur: 0.12, type: 'sine', gain: 0.11 });
        this.tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.11, delay: 0.1 });
        this.tone({ freq: 880, dur: 0.22, type: 'sine', gain: 0.1, delay: 0.2 });
        break;
      case 'bid':
        this.tone({ freq: 780, to: 1040, dur: 0.11, type: 'square', gain: 0.08 });
        break;
      case 'turn':
        this.tone({ freq: 660, dur: 0.14, type: 'sine', gain: 0.1 });
        this.tone({ freq: 990, dur: 0.24, type: 'sine', gain: 0.07, delay: 0.09 });
        break;
      case 'error':
        this.tone({ freq: 240, to: 160, dur: 0.2, type: 'square', gain: 0.09 });
        break;
      case 'bankrupt':
        this.tone({ freq: 400, to: 90, dur: 1.0, type: 'sawtooth', gain: 0.12 });
        this.noise({ dur: 0.8, gain: 0.1, filter: 700, filterTo: 90, type: 'lowpass' });
        break;
      case 'victory': {
        const notes = [523, 659, 784, 1046, 1318];
        notes.forEach((f, i) => this.tone({ freq: f, dur: 0.55, type: 'triangle', gain: 0.13, delay: i * 0.11 }));
        this.tone({ freq: 261, dur: 1.6, type: 'sine', gain: 0.09, delay: 0.5 });
        break;
      }
      case 'join':
        this.tone({ freq: 520, to: 780, dur: 0.16, type: 'sine', gain: 0.1 });
        break;
      case 'chat':
        this.tone({ freq: 1180, dur: 0.07, type: 'sine', gain: 0.06 });
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Generative music bed                                              */
  /* ---------------------------------------------------------------- */

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const beat = () => {
      this.musicChord();
      this.musicTimer = window.setTimeout(beat, 3800);
    };
    beat();
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** i - VI - III - VII in A minor, voiced as a slow shimmering pad. */
  private musicChord(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || !prefs.musicOn) return;
    const progression: number[][] = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
      [164.81, 196.0, 246.94],
    ];
    const chord = progression[this.musicStep % progression.length]!;
    this.musicStep++;
    const start = ctx.currentTime + 0.02;
    const dur = 4.6;
    for (let i = 0; i < chord.length; i++) {
      const freq = chord[i]!;
      for (const mul of [1, 2]) {
        const osc = ctx.createOscillator();
        osc.type = mul === 1 ? 'sine' : 'triangle';
        osc.frequency.value = freq * mul;
        // Slight detune per voice gives the pad natural chorus.
        osc.detune.value = (i - 1) * 5 + (mul === 2 ? 4 : -4);
        const g = ctx.createGain();
        const peak = (mul === 1 ? 0.12 : 0.045) / chord.length;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(peak, start + 1.5);
        g.gain.linearRampToValueAtTime(0.0001, start + dur);
        osc.connect(g);
        g.connect(bus);
        osc.start(start);
        osc.stop(start + dur + 0.1);
      }
    }
    // A sparse bell on every other chord keeps the bed from feeling static.
    if (this.musicStep % 2 === 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = chord[2]! * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start + 1.2);
      g.gain.linearRampToValueAtTime(0.03, start + 1.26);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 3.4);
      osc.connect(g);
      g.connect(bus);
      osc.start(start + 1.2);
      osc.stop(start + 3.5);
    }
  }
}

export const audio = new AudioEngine();

onPrefsChange(() => audio.applyVolumes());

/** Convenience for UI wiring. */
export function sfx(sound: Sfx, throttleMs = 0): void {
  audio.play(sound, throttleMs);
}
