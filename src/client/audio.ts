/**
 * Synthesized meow player over the Web Audio API.
 *
 * No audio asset ships with the plugin: each meow is a short sawtooth-ish
 * tone whose pitch rises then falls while a bandpass filter sweeps two vowel
 * formants, shaped by an attack/hold/release envelope. Each event kind has its
 * own pitch and character so the sound is identifiable without looking.
 *
 * Browsers require a user gesture before audio may start. The context is
 * created lazily; installAudioUnlock resumes it on the first pointer/key event,
 * and playMeow schedules only while the context is running so a long-suspended
 * context never replays a stale burst.
 *
 * @module dsh-meow/client/audio
 */
import type { MeowKind } from '../types.ts'

/** One meow voice profile. */
interface MeowVoice {
  /** Base frequency in Hz (the contour scales it). */
  f0: number
  wave: OscillatorType
  /** Total duration in seconds. */
  seconds: number
}

/** Per-kind character. */
const VOICES: Record<MeowKind, MeowVoice> = {
  // Questioning rise, bright.
  approval: { f0: 470, wave: 'sawtooth', seconds: 0.42 },
  // Softer, triangle for a polite ask.
  question: { f0: 520, wave: 'triangle', seconds: 0.40 },
  // Low and long, distinctly unhappy.
  error: { f0: 290, wave: 'square', seconds: 0.55 },
  // Content, slightly higher.
  done: { f0: 550, wave: 'sawtooth', seconds: 0.40 },
}

let audio: AudioContext | undefined
let unlockInstalled = false

/** Lazily create (and cache) the shared AudioContext. */
function context(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  if (audio === undefined) {
    const ctor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (ctor === undefined) return undefined
    audio = new ctor()
  }
  return audio
}

/**
 * Resume the shared AudioContext on the first user gesture.
 * @returns A disposer removing the gesture listeners.
 */
export function installAudioUnlock(): () => void {
  if (unlockInstalled) return () => {}
  unlockInstalled = true
  if (typeof window === 'undefined') {
    return () => {
      unlockInstalled = false
    }
  }
  const resume = (): void => {
    const ctx = context()
    if (ctx !== undefined && ctx.state === 'suspended') void ctx.resume()
  }
  window.addEventListener('pointerdown', resume, true)
  window.addEventListener('keydown', resume, true)
  return () => {
    window.removeEventListener('pointerdown', resume, true)
    window.removeEventListener('keydown', resume, true)
    unlockInstalled = false
  }
}

/** Clamp to the 0..1 unit range. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Schedule one meow on a running context. */
function schedule(ctx: AudioContext, kind: MeowKind, volume: number): void {
  const voice = VOICES[kind]
  const start = ctx.currentTime + 0.01
  const end = start + voice.seconds

  const master = ctx.createGain()
  master.gain.value = clamp01(volume) * 0.6
  master.connect(ctx.destination)

  // Sweeping bandpass approximates the vowel transition of a meow.
  const formant = ctx.createBiquadFilter()
  formant.type = 'bandpass'
  formant.Q.value = 3.2
  formant.frequency.setValueAtTime(900, start)
  formant.frequency.exponentialRampToValueAtTime(1900, start + voice.seconds * 0.28)
  formant.frequency.exponentialRampToValueAtTime(650, start + voice.seconds * 0.85)
  formant.connect(master)

  // Pitch contour: quick rise, then a lower fall.
  const osc = ctx.createOscillator()
  osc.type = voice.wave
  osc.frequency.setValueAtTime(voice.f0 * 0.85, start)
  osc.frequency.exponentialRampToValueAtTime(voice.f0 * 1.9, start + voice.seconds * 0.22)
  osc.frequency.exponentialRampToValueAtTime(voice.f0 * 0.72, start + voice.seconds * 0.8)

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(1, start + 0.03)
  envelope.gain.setValueAtTime(1, start + voice.seconds * 0.5)
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)

  osc.connect(envelope)
  envelope.connect(formant)
  osc.start(start)
  osc.stop(end + 0.02)
}

/**
 * Play one meow. Silently no-ops when Web Audio is unavailable or the context
 * is still waiting for a user gesture.
 * @param kind - which event this meow announces.
 * @param volume - requested volume, 0..1.
 */
export function playMeow(kind: MeowKind, volume: number): void {
  const ctx = context()
  if (ctx === undefined) return
  if (ctx.state === 'running') {
    schedule(ctx, kind, volume)
    return
  }
  void ctx.resume().then(() => {
    if (ctx.state === 'running') schedule(ctx, kind, volume)
  }).catch(() => {
    // Autoplay is blocked until a gesture; the next event after one plays.
  })
}
