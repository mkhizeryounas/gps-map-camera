import { stampDateTime } from './format'
import type { MapImage } from './map'
import type { StampData } from './types'

/*
 * Layout mirrors the "GPS Map Camera" stamp FBR has accepted: a square satellite map on the
 * left, a translucent info card on the right, and an app badge sitting above the card's
 * right edge. Measurements are taken from a 960×1280 reference and scaled by the image's
 * short side, so the live preview and the saved photo match at any resolution.
 */
const REF = 960
const FONT = `Roboto, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif`
const EMOJI = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}, ${EMOJI}`

function flag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo).trimEnd() + '…'
}

/** Draws a single line, shrinking the font down to 80% before falling back to an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, weight: number, size: number) {
  let s = size
  ctx.font = font(weight, s)
  while (ctx.measureText(text).width > max && s > size * 0.8) {
    s -= size * 0.04
    ctx.font = font(weight, s)
  }
  ctx.fillText(ellipsize(ctx, text, max), x, y)
}

/** Google-style map pin with its tip at (x, y); `lens` draws a camera lens in the head. */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, lens = false) {
  const r = h * 0.34
  const hy = y - h + r
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = h * 0.15
  ctx.shadowOffsetY = h * 0.04
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x - r * 1.05, hy + r * 0.95, x - r, hy)
  ctx.arc(x, hy, r, Math.PI, 0)
  ctx.quadraticCurveTo(x + r * 1.05, hy + r * 0.95, x, y)
  ctx.closePath()
  ctx.fillStyle = '#ea4335'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = Math.max(1, h * 0.03)
  ctx.strokeStyle = '#b31412'
  ctx.stroke()
  if (lens) {
    ctx.beginPath()
    ctx.arc(x, hy, r * 0.66, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, hy, r * 0.52, 0, Math.PI * 2)
    ctx.fillStyle = '#16181d'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x - r * 0.16, hy - r * 0.16, r * 0.13, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(x, hy, r * 0.38, 0, Math.PI * 2)
    ctx.fillStyle = '#a50e0e'
    ctx.fill()
  }
  ctx.restore()
}

function drawMap(ctx: CanvasRenderingContext2D, d: StampData, map: MapImage | null, x: number, y: number, size: number, u: number) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, 6 * u)
  ctx.clip()
  ctx.fillStyle = '#3b4a3a'
  ctx.fillRect(x, y, size, size)
  if (map) ctx.drawImage(map.canvas, x, y, size, size)

  const cx = x + size / 2
  const cy = y + size / 2
  if (map && d.heading != null) {
    // Viewing-direction cone, like the reference stamp.
    const a = ((d.heading - 90) * Math.PI) / 180
    const spread = (28 * Math.PI) / 180
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, size * 0.42, a - spread, a + spread)
    ctx.closePath()
    ctx.fillStyle = 'rgba(66,133,244,0.38)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(66,133,244,0.7)'
    ctx.lineWidth = Math.max(1, 1.5 * u)
    ctx.stroke()
  } else if (map && d.fix) {
    const r = Math.min(d.fix.accuracy / map.metersPerPixel / (map.canvas.width / size), size * 0.45)
    if (r > 4 * u) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(66,133,244,0.25)'
      ctx.fill()
    }
  }
  if (d.fix) drawPin(ctx, cx, cy, 36 * u)

  if (map?.attribution) {
    ctx.font = font(500, 11 * u)
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 2 * u
    ctx.fillText(map.attribution, x + 5 * u, y + size - 5 * u)
  }
  if (!d.fix) {
    ctx.font = font(500, 18 * u)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Locating…', cx, cy)
  }
  ctx.restore()
}

function drawClassic(ctx: CanvasRenderingContext2D, W: number, H: number, d: StampData, map: MapImage | null, icon: CanvasImageSource | null | undefined, inset: StampInset) {
  const u = Math.min(W, H) / REF
  const side = 14 * u + (inset.left ?? 0)
  const sideR = 14 * u + (inset.right ?? 0)
  const bottom = 80 * u + (inset.bottom ?? 0)
  const mapSize = 211 * u
  const cardH = 210 * u
  const top = H - bottom - cardH
  const cardX = side + mapSize + 9 * u
  const cardW = W - sideR - cardX

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  drawMap(ctx, d, map, side, top, mapSize, u)

  // Card
  ctx.beginPath()
  ctx.roundRect(cardX, top, cardW, cardH, 8 * u)
  ctx.fillStyle = 'rgba(0,0,0,0.52)'
  ctx.fill()

  // Badge above the card's right edge
  const badgeText = 'GPS Map Camera'
  ctx.font = font(500, 16 * u)
  const iconSize = 30 * u
  const bh = 40 * u
  const bw = 10 * u + iconSize + 12 * u + ctx.measureText(badgeText).width + 14 * u
  const bx = W - sideR - bw
  const by = top - 10 * u - bh
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 6 * u)
  ctx.fillStyle = 'rgba(0,0,0,0.52)'
  ctx.fill()
  if (icon) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(bx + 10 * u, by + (bh - iconSize) / 2, iconSize, iconSize, 7 * u)
    ctx.clip()
    ctx.drawImage(icon, bx + 10 * u, by + (bh - iconSize) / 2, iconSize, iconSize)
    ctx.restore()
  }
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'middle'
  ctx.fillText(badgeText, bx + 10 * u + iconSize + 12 * u, by + bh / 2 + u)
  ctx.textBaseline = 'alphabetic'

  // Card text
  const tx = cardX + 22 * u
  const max = cardW - 22 * u - 16 * u
  ctx.fillStyle = '#fff'

  const title = d.place
    ? `${d.place.title.replace(/,\s*/g, ',')} ${flag(d.place.countryCode)}`.trim()
    : d.fix
      ? 'Fetching address…'
      : 'Waiting for GPS…'
  fitText(ctx, title, tx, top + 55 * u, max, 500, 32 * u)

  const lines = [
    d.place?.address ?? '',
    d.fix ? `Lat ${d.fix.lat.toFixed(6)}, Long ${d.fix.lon.toFixed(6)}` : '',
    stampDateTime(d.date),
    d.settings.note.trim() ? `Note : ${d.settings.note.trim()}` : '',
  ]
  const baselines = [93, 124, 156, 188]
  lines.forEach((text, i) => {
    if (text) fitText(ctx, text, tx, top + baselines[i] * u, max, 400, 21.5 * u)
  })
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Modern style: map panel with a lat/long strip, and text-hugging dark blocks for
// date, an amber place title, the address and the note. Measured from an 880-wide reference.

const MREF = 880
const AMBER = '#ffc21a'

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (!line || ctx.measureText(next).width <= max) {
      line = next
      continue
    }
    if (lines.length === maxLines - 1) {
      line = [line, ...words.slice(i)].join(' ')
      break
    }
    lines.push(line)
    line = words[i]
  }
  if (line) lines.push(ellipsize(ctx, line, max))
  return lines
}

function drawModern(ctx: CanvasRenderingContext2D, W: number, H: number, d: StampData, map: MapImage | null, icon: CanvasImageSource | null | undefined, inset: StampInset) {
  const u = Math.min(W, H) / MREF
  const side = 10 * u + (inset.left ?? 0)
  const bottom = 65 * u + (inset.bottom ?? 0)
  const panelH = 230 * u
  const top = H - bottom - panelH
  const mapW = 268 * u
  const cardX = side + mapW + 14 * u
  const cardR = W - 12 * u - (inset.right ?? 0)
  const cardW = cardR - cardX
  const pad = 12 * u // map panel text inset

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // ---- map panel -----------------------------------------------------------
  const stripH = 66 * u
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(side, top, mapW, panelH, 8 * u)
  ctx.clip()
  ctx.fillStyle = '#3b4a3a'
  ctx.fillRect(side, top, mapW, panelH)
  const px = side + mapW / 2
  const py = top + (panelH - stripH) * 0.66 // where the location sits (pin tip)
  if (map) {
    // Cover the panel with the square map, keeping the location under the pin.
    const s = Math.max(mapW, panelH) * 1.25
    ctx.drawImage(map.canvas, px - s / 2, py - s / 2, s, s)
  }
  if (d.fix) drawPin(ctx, px, py, 58 * u, true)
  const g = ctx.createLinearGradient(0, top + panelH - stripH * 1.3, 0, top + panelH)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(0.3, 'rgba(0,0,0,0.55)')
  g.addColorStop(1, 'rgba(0,0,0,0.7)')
  ctx.fillStyle = g
  ctx.fillRect(side, top + panelH - stripH * 1.3, mapW, stripH * 1.3)
  ctx.fillStyle = '#fff'
  if (d.fix) {
    fitText(ctx, `Lat ${d.fix.lat.toFixed(6)}°`, side + pad, top + panelH - 42 * u, mapW - pad * 2, 500, 26 * u)
    fitText(ctx, `Long ${d.fix.lon.toFixed(6)}°`, side + pad, top + panelH - 12 * u, mapW - pad * 2, 500, 26 * u)
  } else {
    fitText(ctx, 'Locating…', side + pad, top + panelH - 20 * u, mapW - pad * 2, 500, 21 * u)
  }
  if (map?.attribution) {
    ctx.font = font(500, 10 * u)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.textAlign = 'right'
    ctx.fillText(map.attribution, side + mapW - 5 * u, top + 13 * u)
    ctx.textAlign = 'left'
  }
  ctx.restore()

  // ---- info card: one dark panel matching the map panel ------------------------
  ctx.beginPath()
  ctx.roundRect(cardX, top, cardW, panelH, 8 * u)
  ctx.fillStyle = 'rgba(0,0,0,0.66)'
  ctx.fill()

  const date = d.date
  const dateLine = `${date.getDate()} ${date.toLocaleDateString('en-GB', { month: 'short' })}, ${date.getFullYear()}`
  const timeLine = `${date.toLocaleDateString('en-GB', { weekday: 'short' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  // Sizes and baselines measured from the reference photo (880 px wide).
  const tx = cardX + 14 * u
  const max = cardW - 28 * u

  ctx.fillStyle = '#fff'
  fitText(ctx, dateLine, tx, top + 36 * u, max, 500, 30 * u)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  fitText(ctx, timeLine, tx, top + 66 * u, max, 400, 24 * u)

  ctx.fillStyle = AMBER
  const title = d.place ? d.place.title : d.fix ? 'Fetching address…' : 'Waiting for GPS…'
  fitText(ctx, title, tx, top + 116 * u, max, 700, 42 * u)

  ctx.fillStyle = '#fff'
  ctx.font = font(400, 28 * u)
  const addr = d.place?.address ? wrap(ctx, d.place.address, max, 2) : []
  addr.forEach((l, i) => ctx.fillText(l, tx, top + (153 + i * 32) * u))

  const note = d.settings.note.trim()
  if (note) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.textAlign = 'right'
    fitText(ctx, note, cardR - 14 * u, top + panelH - 12 * u, max, 500, 26 * u)
    ctx.textAlign = 'left'
  }

  // ---- badge ------------------------------------------------------------------
  const iconS = 42 * u
  ctx.font = font(700, 17 * u)
  const bw = 10 * u + iconS + 10 * u + Math.max(ctx.measureText('GPS MAP').width, ctx.measureText('CAMERA').width) + 14 * u
  const bh = 56 * u
  const bx = cardR - bw
  const by = top - 10 * u - bh
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 8 * u)
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fill()
  if (icon) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(bx + 10 * u, by + (bh - iconS) / 2, iconS, iconS, 8 * u)
    ctx.clip()
    ctx.drawImage(icon, bx + 10 * u, by + (bh - iconS) / 2, iconS, iconS)
    ctx.restore()
  }
  ctx.fillStyle = '#fff'
  const lx = bx + 10 * u + iconS + 10 * u
  ctx.fillText('GPS MAP', lx, by + 24 * u)
  ctx.fillText('CAMERA', lx, by + 45 * u)
  ctx.restore()
}

/** Extra margins (in the photo's own upright frame) to keep the stamp clear of on-screen controls. */
export interface StampInset {
  left?: number
  right?: number
  bottom?: number
}

export function drawStamp(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  d: StampData,
  map: MapImage | null,
  icon?: CanvasImageSource | null,
  inset: StampInset = {},
) {
  if (d.settings.stampStyle === 'classic') drawClassic(ctx, W, H, d, map, icon, inset)
  else drawModern(ctx, W, H, d, map, icon, inset)
}
