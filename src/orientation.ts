/*
 * Physical device rotation from the motion sensor, relative to how the page is drawn.
 * The installed app is locked to portrait, so turning the phone doesn't rotate the UI;
 * this tells us which way is really "up" so photos and the stamp come out upright.
 *
 * Result is 0, 90, 180 or 270: how far the world is rotated clockwise on screen.
 * 90 means the phone's right edge points up (turned counter-clockwise to landscape).
 */

type Listener = (rotation: number) => void

let rotation = 0
let started = false
const listeners = new Set<Listener>()

function screenAngle() {
  const a = screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0
  return ((a % 360) + 360) % 360
}

function onTilt(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return
  const b = (e.beta * Math.PI) / 180
  const g = (e.gamma * Math.PI) / 180
  // "Up" (against gravity) in the device's screen plane.
  const ux = -Math.sin(g) * Math.cos(b)
  const uy = Math.sin(b)
  if (Math.hypot(ux, uy) < 0.5) return // lying (nearly) flat: keep the last orientation
  const angle = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360
  const snapped = Math.round(angle / 90) * 90
  // Hysteresis: only switch once clearly within 30° of the new orientation.
  if (Math.abs(angle - snapped) > 30) return
  const next = (((snapped % 360) - screenAngle()) % 360 + 360) % 360
  if (next !== rotation) {
    rotation = next
    listeners.forEach((fn) => fn(rotation))
  }
}

/** Start listening. On iOS this needs DeviceOrientation permission (granted with the compass). */
export function startOrientation() {
  if (started) return
  started = true
  window.addEventListener('deviceorientation', onTilt)
}

export const getRotation = () => rotation

export function onRotation(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
