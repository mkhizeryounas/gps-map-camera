/*
 * Camera shutter sound, synthesised with Web Audio (no audio file to download).
 * Two short filtered noise bursts: the "click" of the shutter opening and the "clack" of it closing.
 * Like the native camera, iOS mutes Web Audio when the ring/silent switch is on silent.
 */

let ctx: AudioContext | null = null
let buffer: AudioBuffer | null = null

function build(ac: AudioContext) {
  const rate = ac.sampleRate
  const len = Math.round(rate * 0.16)
  const buf = ac.createBuffer(1, len, rate)
  const data = buf.getChannelData(0)
  const burst = (start: number, dur: number, gain: number, decay: number) => {
    const s0 = Math.round(start * rate)
    const n = Math.round(dur * rate)
    for (let i = 0; i < n && s0 + i < len; i++) {
      data[s0 + i] += (Math.random() * 2 - 1) * gain * Math.exp((-i / n) * decay)
    }
  }
  burst(0, 0.03, 0.9, 6)
  burst(0.075, 0.06, 0.7, 5)
  return buf
}

/** Create/resume the audio context. Call from a user gesture (iOS requirement). */
export function unlockAudio() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx ??= new AC()
  buffer ??= build(ctx)
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
}

export function playShutter() {
  unlockAudio()
  if (!ctx || !buffer) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2600
  band.Q.value = 0.7
  const gain = ctx.createGain()
  gain.gain.value = 0.8
  src.connect(band).connect(gain).connect(ctx.destination)
  src.start()
}
