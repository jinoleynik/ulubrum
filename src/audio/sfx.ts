/** The slice of localStorage the audio settings need (same shape as session's KeyValueStore). */
interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SoundName =
  | 'click' | 'swap' | 'swapFail' | 'match' | 'bonusSpawn' | 'blast' | 'heal' | 'hurt' | 'hit' | 'crit'
  | 'shield' | 'absorbed' | 'debuff' | 'freeze' | 'enemyDie' | 'activate' | 'reshuffle' | 'win' | 'lose';

export const SFX_KEYS = { sfx: 'Match3.Sfx', music: 'Match3.Music', volume: 'Match3.Volume' } as const;

/** Sounds repeated sooner than this (ms) are dropped: poison ticks and cascades would otherwise pile up. */
const THROTTLE_MS = 40;

type Wave = OscillatorType;

const defaultFactory = (): (() => AudioContext) | null => {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
};

/**
 * Every sound is synthesized with the Web Audio API, so there are no asset files.
 * The context is created on the first user gesture (autoplay policy); without
 * Web Audio (tests, old browsers) every call is a harmless no-op.
 */
export class Sfx {
  sfxOn = true;
  musicOn = true;
  volume = 0.7;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicWanted = false;
  private step = 0;
  private readonly last = new Map<string, number>();

  constructor(
    private readonly store?: SettingsStore,
    private readonly factory: (() => AudioContext) | null = defaultFactory(),
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.sfxOn = this.readFlag(SFX_KEYS.sfx, true);
    this.musicOn = this.readFlag(SFX_KEYS.music, true);
    const v = Number(this.read(SFX_KEYS.volume));
    this.volume = this.read(SFX_KEYS.volume) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
  }

  // ── settings ─────────────────────────────────────────────────

  private read(key: string): string | null {
    try {
      return this.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  private readFlag(key: string, fallback: boolean): boolean {
    const raw = this.read(key);
    return raw === null ? fallback : raw === '1';
  }
  private write(key: string, value: string): void {
    try {
      this.store?.setItem(key, value);
    } catch {
      // storage blocked: the setting lasts for this page only
    }
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.write(SFX_KEYS.sfx, on ? '1' : '0');
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    this.write(SFX_KEYS.music, on ? '1' : '0');
    this.syncMusic();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.write(SFX_KEYS.volume, String(this.volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  // ── context ──────────────────────────────────────────────────

  /** Call from a user gesture. Creates the context once and wakes it if the browser suspended it. */
  unlock(): void {
    if (!this.ctx && this.factory) {
      try {
        const ctx = this.factory();
        const master = ctx.createGain();
        master.gain.value = this.volume;
        master.connect(ctx.destination);
        const music = ctx.createGain();
        music.gain.value = 0.35;
        music.connect(master);
        this.ctx = ctx;
        this.master = master;
        this.musicGain = music;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    this.syncMusic();
  }

  /** True when this sound should play now; records the time so quick repeats are dropped. */
  private allow(name: string): boolean {
    const now = this.clock();
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < THROTTLE_MS) return false;
    this.last.set(name, now);
    return true;
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  // ── synth primitives ─────────────────────────────────────────

  private tone(freq: number, dur: number, type: Wave = 'sine', vol = 0.2, slideTo?: number, delay = 0, dest?: AudioNode): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(dest ?? master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.15, from = 2000, to = 200, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  // ── effects ──────────────────────────────────────────────────

  /** `arg` is the cascade wave for `match`: each wave is a semitone higher. */
  play(name: SoundName, arg = 1): void {
    if (!this.sfxOn || !this.ctx || !this.allow(name)) return;
    switch (name) {
      case 'click': return this.tone(660, 0.04, 'square', 0.05);
      case 'swap': return this.tone(300, 0.09, 'sine', 0.12, 520);
      case 'swapFail': return this.tone(170, 0.16, 'sawtooth', 0.09, 110);
      case 'match': {
        const f = 392 * 2 ** (Math.min(Math.max(arg, 1) - 1, 12) / 12);
        this.tone(f, 0.14, 'triangle', 0.13);
        this.tone(f * 1.25, 0.14, 'triangle', 0.1, undefined, 0.05);
        this.tone(f * 1.5, 0.18, 'triangle', 0.1, undefined, 0.1);
        return this.noise(0.06, 0.05, 4000, 800);
      }
      case 'bonusSpawn':
        return [880, 1175, 1568, 2093].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.09, undefined, i * 0.05));
      case 'blast':
        this.noise(0.35, 0.22, 3000, 150);
        return this.tone(110, 0.35, 'sine', 0.28, 40);
      case 'heal':
        this.tone(523, 0.12, 'triangle', 0.13);
        return this.tone(784, 0.2, 'triangle', 0.13, undefined, 0.09);
      case 'hurt':
        this.tone(220, 0.2, 'sawtooth', 0.14, 100);
        return this.noise(0.08, 0.1, 1500, 300);
      case 'hit': return this.tone(190, 0.1, 'square', 0.1, 90);
      case 'crit':
        this.tone(190, 0.1, 'square', 0.12, 80);
        return this.tone(1300, 0.14, 'sawtooth', 0.08, 400);
      case 'shield':
        this.tone(1000, 0.12, 'triangle', 0.1);
        return this.tone(1500, 0.22, 'triangle', 0.08, undefined, 0.06);
      case 'absorbed': return this.tone(720, 0.08, 'square', 0.07, 480);
      case 'debuff': return this.tone(130, 0.3, 'sawtooth', 0.1, 70);
      case 'freeze': return this.tone(1800, 0.28, 'sine', 0.09, 900);
      case 'enemyDie':
        this.tone(420, 0.3, 'triangle', 0.14, 90);
        return this.noise(0.12, 0.08, 2500, 400);
      case 'activate':
        this.tone(262, 0.4, 'sawtooth', 0.07, 1046);
        return this.tone(523, 0.3, 'triangle', 0.1, undefined, 0.1);
      case 'reshuffle': return this.noise(0.45, 0.14, 300, 5000);
      case 'win': return [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.14, undefined, i * 0.12));
      case 'lose': return [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.08, undefined, i * 0.18));
    }
  }

  // ── music ────────────────────────────────────────────────────

  /** Round or menu music; stays quiet until a gesture has unlocked audio. */
  startMusic(): void {
    this.musicWanted = true;
    this.syncMusic();
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.syncMusic();
  }

  private syncMusic(): void {
    const run = this.musicWanted && this.musicOn && !!this.ctx;
    if (run && !this.musicTimer) {
      this.musicTimer = setInterval(() => this.musicStep(), 650);
    } else if (!run && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** A slow A-minor-pentatonic arpeggio over a low pad. */
  private musicStep(): void {
    const dest = this.musicGain ?? undefined;
    if (!dest) return;
    const scale = [220, 262, 294, 330, 392];
    const pattern = [0, 2, 4, 2, 3, 1, 4, 2];
    const n = this.step++;
    this.tone(scale[pattern[n % pattern.length]] * 2, 1.3, 'sine', 0.12, undefined, 0, dest);
    if (n % 8 === 0) this.tone(110, 5, 'triangle', 0.1, undefined, 0, dest);
  }
}
