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

/** Google-style map pin with its tip at (x, y). */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
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
  ctx.beginPath()
  ctx.arc(x, hy, r * 0.38, 0, Math.PI * 2)
  ctx.fillStyle = '#a50e0e'
  ctx.fill()
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

export function drawStamp(ctx: CanvasRenderingContext2D, W: number, H: number, d: StampData, map: MapImage | null, icon?: CanvasImageSource | null) {
  const u = Math.min(W, H) / REF
  const side = 14 * u
  const bottom = 80 * u
  const mapSize = 211 * u
  const cardH = 210 * u
  const top = H - bottom - cardH
  const cardX = side + mapSize + 9 * u
  const cardW = W - side - cardX

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
  const bx = W - side - bw
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
