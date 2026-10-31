export type UiSound = "success" | "error" | "warning" | "info";

export class SoundManager {
  private context: AudioContext | null = null;
  private enabled = true;
  private volume = 0.35;
  private lastPlayedAt = 0;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.35));
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!this.context) this.context = new AudioCtor();
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }

  play(type: UiSound) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastPlayedAt < 120) return;
    this.lastPlayedAt = now;

    const context = this.ensureContext();
    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;

    const frequencies: Record<UiSound, number> = {
      success: 660,
      info: 540,
      warning: 420,
      error: 210,
    };

    const envelopes: Record<UiSound, { duration: number; end: number; drift: number }> = {
      success: { duration: 0.11, end: 0.001, drift: 90 },
      info: { duration: 0.085, end: 0.001, drift: 55 },
      warning: { duration: 0.13, end: 0.001, drift: 35 },
      error: { duration: 0.18, end: 0.0005, drift: -40 },
    };

    const config = envelopes[type];
    oscillator.type = type === "error" ? "sawtooth" : "triangle";
    oscillator.frequency.setValueAtTime(frequencies[type], start);
    oscillator.frequency.linearRampToValueAtTime(frequencies[type] + config.drift, start + config.duration);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(this.volume * 0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(config.end, start + config.duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + config.duration + 0.03);
  }
}
