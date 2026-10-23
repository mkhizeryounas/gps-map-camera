/*
 * Pinch-to-zoom for the photo viewer, like the Photos app: pinch (up to 5×) around the
 * fingers, one-finger pan while zoomed, double-tap to toggle 2.5×. While zoomed, the
 * swipe-between-photos scroller is locked so a pan doesn't change photo.
 */

const MAX = 5
const DOUBLE_TAP = 2.5

type Pt = { x: number; y: number }

export function attachZoom(track: HTMLElement, currentImage: () => HTMLImageElement | null) {
  let img: HTMLImageElement | null = null
  let s = 1
  let tx = 0
  let ty = 0
  // gesture start values
  let s0 = 1
  let t0: Pt = { x: 0, y: 0 }
  let d0 = 0
  let m0: Pt = { x: 0, y: 0 }
  let p0: Pt = { x: 0, y: 0 }
  let mode: 'none' | 'pinch' | 'pan' = 'none'
  let lastTap = 0 // time of the last real tap (finger lifted without moving)
  let tapStart: Pt | null = null

  const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  const mid = (a: Touch, b: Touch): Pt => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })
  const box = () => (img?.parentElement ?? track).getBoundingClientRect()

  function clamp() {
    const r = box()
    const mx = ((s - 1) * r.width) / 2
    const my = ((s - 1) * r.height) / 2
    tx = Math.min(mx, Math.max(-mx, tx))
    ty = Math.min(my, Math.max(-my, ty))
  }

  function apply(animate = false) {
    if (!img) return
    img.style.transition = animate ? 'transform .25s cubic-bezier(.2,.9,.3,1)' : 'none'
    img.style.transform = s === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`
    // Lock photo-to-photo swiping while zoomed in.
    track.style.overflowX = s > 1 ? 'hidden' : ''
  }

  /** Zoom to `next` keeping the screen point `at` fixed (relative to the original gesture state). */
  function zoomAround(at: Pt, next: number, from = { s: s0, t: t0, m: m0 }) {
    const r = box()
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    // Point on the image (relative to its centre, unscaled) that was under the fingers.
    const q = { x: (from.m.x - c.x - from.t.x) / from.s, y: (from.m.y - c.y - from.t.y) / from.s }
    s = Math.min(MAX, Math.max(1, next))
    tx = at.x - c.x - s * q.x
    ty = at.y - c.y - s * q.y
    if (s === 1) tx = ty = 0
    clamp()
  }

  function reset(animate = false) {
    s = 1
    tx = ty = 0
    apply(animate)
    img = null
  }

  track.addEventListener(
    'touchstart',
    (e) => {
      const cur = currentImage()
      if (cur !== img) {
        if (img) img.style.transform = ''
        img = cur
        s = 1
        tx = ty = 0
      }
      if (!img) return
      if (e.touches.length === 2) {
        e.preventDefault()
        mode = 'pinch'
        s0 = s
        t0 = { x: tx, y: ty }
        d0 = dist(e.touches[0], e.touches[1])
        m0 = mid(e.touches[0], e.touches[1])
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        const now = Date.now()
        if (now - lastTap < 280) {
          // Double-tap: toggle zoom at the tap point.
          e.preventDefault()
          lastTap = 0
          const at = { x: t.clientX, y: t.clientY }
          if (s > 1) s = 1, (tx = ty = 0)
          else zoomAround(at, DOUBLE_TAP, { s: 1, t: { x: 0, y: 0 }, m: at })
          apply(true)
          mode = 'none'
          return
        }
        tapStart = { x: t.clientX, y: t.clientY }
        if (s > 1) {
          e.preventDefault()
          mode = 'pan'
          p0 = { x: t.clientX, y: t.clientY }
          t0 = { x: tx, y: ty }
        }
      }
    },
    { passive: false },
  )

  track.addEventListener(
    'touchmove',
    (e) => {
      const t1 = e.touches[0]
      if (tapStart && t1 && Math.hypot(t1.clientX - tapStart.x, t1.clientY - tapStart.y) > 10) tapStart = null
      if (mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault()
        zoomAround(mid(e.touches[0], e.touches[1]), (s0 * dist(e.touches[0], e.touches[1])) / d0)
        apply()
      } else if (mode === 'pan' && e.touches.length === 1) {
        e.preventDefault()
        const t = e.touches[0]
        tx = t0.x + (t.clientX - p0.x)
        ty = t0.y + (t.clientY - p0.y)
        clamp()
        apply()
      }
    },
    { passive: false },
  )

  const end = (e: TouchEvent) => {
    // A single finger lifted without moving counts as a tap (for double-tap detection).
    if (e.touches.length === 0 && mode !== 'pinch') lastTap = tapStart ? Date.now() : 0
    tapStart = null
    if (mode === 'pinch' && e.touches.length < 2) {
      if (s < 1.05) {
        s = 1
        tx = ty = 0
        apply(true)
      }
      // Continue as a pan with the remaining finger.
      if (e.touches.length === 1 && s > 1) {
        mode = 'pan'
        p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        t0 = { x: tx, y: ty }
        return
      }
    }
    if (e.touches.length === 0) mode = 'none'
  }
  track.addEventListener('touchend', end)
  track.addEventListener('touchcancel', end)

  return { reset }
}
