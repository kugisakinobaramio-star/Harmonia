import type { EqPreset, Track } from '../types/music';

/**
 * Polyphonic Web Audio synthesizer + 3-band Equalizer + shared AnalyserNode
 * so both external audio streams and curated tracks play smoothly with real
 * Bass / Vocal / Late Night EQ shaping.
 */
class HarmoniaAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private midPeak: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private synthBus: GainNode | null = null;
  private mediaSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private synthTimer: number | null = null;
  private synthStep = 0;
  private volume = 0.85;
  private eqPreset: EqPreset = 'flat';
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;

  public ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();

      this.lowShelf = this.ctx.createBiquadFilter();
      this.lowShelf.type = 'lowshelf';
      this.lowShelf.frequency.value = 140;

      this.midPeak = this.ctx.createBiquadFilter();
      this.midPeak.type = 'peaking';
      this.midPeak.frequency.value = 1600;
      this.midPeak.Q.value = 1.0;

      this.highShelf = this.ctx.createBiquadFilter();
      this.highShelf.type = 'highshelf';
      this.highShelf.frequency.value = 6000;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.78;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;

      this.synthBus = this.ctx.createGain();
      this.synthBus.gain.value = 0.24 * this.volume;

      this.synthBus.connect(this.lowShelf);
      this.lowShelf.connect(this.midPeak);
      this.midPeak.connect(this.highShelf);
      this.highShelf.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.applyEqPreset(this.eqPreset);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public attachMediaElement(audioEl: HTMLAudioElement): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.lowShelf || this.mediaSources.has(audioEl)) return;
    try {
      const source = ctx.createMediaElementSource(audioEl);
      source.connect(this.lowShelf);
      this.mediaSources.set(audioEl, source);
    } catch {
      // The browser allows one MediaElementAudioSourceNode per media element.
    }
  }

  public setVolume(vol01: number): void {
    this.volume = Math.max(0, Math.min(1, vol01));
    if (this.synthBus && this.ctx) {
      this.synthBus.gain.setTargetAtTime(0.24 * this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public applyEqPreset(preset: EqPreset): void {
    this.eqPreset = preset;
    if (!this.ctx || !this.lowShelf || !this.midPeak || !this.highShelf) return;
    const now = this.ctx.currentTime;
    const presets: Record<EqPreset, [number, number, number]> = {
      flat: [0, 0, 0],
      bass: [6.5, -1.5, 1.5],
      vocal: [-2.0, 5.5, 2.5],
      latenight: [2.5, 1.5, -3.5],
    };
    const [low, mid, high] = presets[preset];
    this.lowShelf.gain.setTargetAtTime(low, now, 0.05);
    this.midPeak.gain.setTargetAtTime(mid, now, 0.05);
    this.highShelf.gain.setTargetAtTime(high, now, 0.05);
  }

  public startSynthLoop(track: Track): void {
    this.stopSynthLoop();
    const ctx = this.ensureContext();
    if (!ctx || !this.synthBus) return;

    const mood =
      track.synthMood ||
      (track.language === 'Hindi' ? 'hindi' : track.language === 'J-Pop' ? 'jpop' : 'synthwave');
    const bpm = track.bpm || 105;
    const stepMs = Math.max(210, Math.round(60_000 / bpm / 2));

    const progressions: Record<NonNullable<Track['synthMood']>, number[][]> = {
      hindi: [
        [220.0, 261.63, 329.63, 392.0], // Am7 warm
        [196.0, 246.94, 293.66, 392.0], // G6
        [174.61, 220.0, 261.63, 349.23], // Fmaj7
        [164.81, 220.0, 246.94, 329.63], // Esus4 -> Em
      ],
      jpop: [
        [174.61, 220.0, 261.63, 329.63], // Fmaj7 (Royal Road IV)
        [196.0, 246.94, 293.66, 392.0], // G (V)
        [164.81, 196.0, 246.94, 293.66], // Em7 (iii)
        [220.0, 261.63, 329.63, 440.0], // Am (vi)
      ],
      synthwave: [
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
        [130.81, 196.0, 261.63, 329.63],
        [196.0, 246.94, 293.66, 392.0],
      ],
      sunset: [
        [293.66, 349.23, 440.0, 523.25],
        [220.0, 261.63, 329.63, 392.0],
        [196.0, 246.94, 293.66, 349.23],
        [261.63, 329.63, 392.0, 493.88],
      ],
      lofi: [
        [174.61, 207.65, 261.63, 311.13],
        [155.56, 196.0, 233.08, 293.66],
        [138.59, 174.61, 207.65, 261.63],
        [130.81, 155.56, 196.0, 233.08],
      ],
      energetic: [
        [146.83, 220.0, 293.66, 349.23],
        [164.81, 246.94, 329.63, 392.0],
        [174.61, 261.63, 349.23, 440.0],
        [196.0, 293.66, 392.0, 493.88],
      ],
      ambient: [
        [196.0, 246.94, 293.66, 369.99],
        [164.81, 246.94, 293.66, 392.0],
        [146.83, 220.0, 293.66, 369.99],
        [130.81, 196.0, 246.94, 329.63],
      ],
      pop: [
        [261.63, 329.63, 392.0, 493.88],
        [196.0, 246.94, 293.66, 392.0],
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
      ],
    };

    const chords = progressions[mood];
    this.synthStep = 0;

    const triggerStep = () => {
      if (!this.ctx || !this.synthBus || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const chordIdx = Math.floor(this.synthStep / 4) % chords.length;
      const noteIdx = this.synthStep % 4;
      const chord = chords[chordIdx];

      if (noteIdx === 0) {
        chord.slice(0, 3).forEach((freq, idx) => {
          if (!this.ctx || !this.synthBus) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = mood === 'lofi' || mood === 'hindi' ? 'sine' : 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          const peak = idx === 0 ? 0.16 : 0.08;
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.exponentialRampToValueAtTime(peak, now + 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, now + (stepMs * 3.8) / 1000);
          osc.connect(gain);
          gain.connect(this.synthBus);
          osc.start(now);
          osc.stop(now + (stepMs * 4) / 1000);
        });
      }

      const arpOsc = this.ctx.createOscillator();
      const arpGain = this.ctx.createGain();
      arpOsc.type = mood === 'energetic' || mood === 'jpop' ? 'triangle' : 'sine';
      const arpFreq = chord[noteIdx] * (noteIdx === 3 ? 1.5 : 1);
      arpOsc.frequency.setValueAtTime(arpFreq, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(mood === 'lofi' ? 950 : 2100, now);

      arpGain.gain.setValueAtTime(0.001, now);
      arpGain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
      arpGain.gain.exponentialRampToValueAtTime(0.001, now + (stepMs * 0.9) / 1000);

      arpOsc.connect(filter);
      filter.connect(arpGain);
      arpGain.connect(this.synthBus);
      arpOsc.start(now);
      arpOsc.stop(now + stepMs / 1000);

      this.synthStep += 1;
    };

    triggerStep();
    this.synthTimer = window.setInterval(triggerStep, stepMs);
  }

  public stopSynthLoop(): void {
    if (this.synthTimer !== null) {
      window.clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
  }

  public getFrequencyData(): Uint8Array | null {
    if (!this.analyser || !this.freqBuffer) return null;
    this.analyser.getByteFrequencyData(this.freqBuffer);
    return this.freqBuffer;
  }

  /** RMS signal level from the shared output graph; near-zero means a silent stream. */
  public getSignalLevel(): number | null {
    if (!this.analyser || !this.timeBuffer || !this.ctx || this.ctx.state !== 'running') return null;
    this.analyser.getByteTimeDomainData(this.timeBuffer);
    let sumSquares = 0;
    for (const sample of this.timeBuffer) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }
    return Math.sqrt(sumSquares / this.timeBuffer.length);
  }
}

export const audioEngine = new HarmoniaAudioEngine();
